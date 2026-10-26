-- Private activity reward receipts and read-only application boundary. Existing
-- point policy is the sole authority: no active amounts/caps, share verifier,
-- mission rules or grade formula is introduced or inferred by this migration.
begin;

-- Keep every predecessor ledger field untouched. Only newly persisted community
-- creations record a precise decision; old zero rows have an unknown cause.
create table private.point_activity_outcomes (
  entry_id uuid primary key references private.point_ledger(id) on delete restrict,
  outcome text not null check(outcome in('awarded','zero_amount','daily_cap'))
);
alter table private.point_activity_outcomes enable row level security;
revoke all on private.point_activity_outcomes from public,anon,authenticated,service_role;
create function private.point_activity_outcome_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'POINT_ACTIVITY_OUTCOME_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger point_activity_outcome_immutable before update or delete on private.point_activity_outcomes
  for each row execute function private.point_activity_outcome_immutable();
create trigger point_activity_outcome_no_truncate before truncate on private.point_activity_outcomes
  for each statement execute function private.point_activity_outcome_immutable();
create function private.point_activity_outcome_validate() returns trigger
language plpgsql set search_path='' as $$
declare entry private.point_ledger%rowtype;
begin
  select * into entry from private.point_ledger where id=new.entry_id;
  if entry.id is null or entry.reason not in('post','comment')
    or (new.outcome='awarded' and entry.amount<=0)
    or (new.outcome in('zero_amount','daily_cap') and entry.amount<>0) then
    raise exception 'POINT_ACTIVITY_OUTCOME_INVALID' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger point_activity_outcome_validate before insert on private.point_activity_outcomes
  for each row execute function private.point_activity_outcome_validate();

-- Preserve the existing contribution writer and cap semantics. The actor UPDATE
-- lock is already held by every owning community RPC before its INSERT. Its
-- transaction now appends one immutable decision beside its immutable ledger row.
create or replace function private.reward_community_creation() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg private.point_policy%rowtype; day date; award_reason public.point_reason;
  reward bigint; cap integer; parent public.posts%rowtype; outcome_value text; entry_id_value uuid;
begin
  select * into cfg from private.point_policy where singleton for share;
  if not found then return new; end if;
  if new.user_id is distinct from auth.uid() or new.is_hidden or new.deleted_at is not null then
    raise exception 'POINT_SOURCE_INELIGIBLE' using errcode='42501'; end if;
  perform private.require_community_actor(new.user_id);
  if tg_table_name='posts' then
    select * into parent from public.posts where id=new.id;
    perform private.require_community_artist(parent.artist_id);
    award_reason:='post'; reward:=cfg.post_amount; cap:=cfg.post_daily_cap;
  elsif tg_table_name='comments' then
    select p.* into parent from public.posts p join public.comments c on c.post_id=p.id where c.id=new.id;
    perform private.require_community_artist(parent.artist_id);
    if parent.id is null or parent.is_hidden or parent.deleted_at is not null then
      raise exception 'POINT_SOURCE_INELIGIBLE' using errcode='42501'; end if;
    award_reason:='comment'; reward:=cfg.comment_amount; cap:=cfg.comment_daily_cap;
  else raise exception 'POINT_SOURCE_INELIGIBLE' using errcode='42501'; end if;
  day:=private.point_kst_date(clock_timestamp());
  outcome_value:=case when reward=0 then 'zero_amount' else 'awarded' end;
  -- Cap counts ALL recorded eligible creations, including a prior configured
  -- zero amount or capped action. It is not the number of positive awards.
  if cap is not null and (select count(*) from private.point_ledger
    where user_id=new.user_id and point_ledger.reason=award_reason and earned_on=day)>=cap then
    reward:=0; outcome_value:='daily_cap';
  end if;
  entry_id_value:=private.append_point_entry(new.user_id,reward,award_reason,new.id::text,day,cfg.version,new.user_id,
    null,case when award_reason='post' then new.id end,case when award_reason='comment' then new.id end,
    to_jsonb(cfg)-'singleton');
  insert into private.point_activity_outcomes(entry_id,outcome) values(entry_id_value,outcome_value);
  return new;
end;
$$;

create function public.point_ui_activity(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; cfg private.point_policy%rowtype; day date;
  rows jsonb; cursor_value jsonb; policy_value jsonb;
  posts_used bigint; comments_used bigint; posts_awarded bigint; comments_awarded bigint;
begin
  -- The actor SHARE lock serializes against all existing actor-bound ledger
  -- writers, while simultaneous reads never upgrade it. Current authority is
  -- checked after waiting; board_actor rejects stale snapshot isolation.
  actor:=private.board_actor(auth.uid(),false);
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'POINT_PAGE_INVALID' using errcode='22023'; end if;
  select * into cfg from private.point_policy where singleton for share;
  day:=private.point_kst_date(clock_timestamp());
  select count(*) filter(where reason='post'),count(*) filter(where reason='comment'),
    count(*) filter(where reason='post' and amount>0),count(*) filter(where reason='comment' and amount>0)
    into posts_used,comments_used,posts_awarded,comments_awarded
    from private.point_ledger where user_id=actor.id and reason in('post','comment') and earned_on=day;
  if posts_used>9007199254740991 or comments_used>9007199254740991 then
    raise exception 'POINT_ACTIVITY_COUNT_OUT_OF_RANGE' using errcode='22003'; end if;
  if cfg.singleton then
    policy_value:=jsonb_build_object('version',cfg.version,'deleted_content_treatment',cfg.deleted_content_treatment,
      'post',jsonb_build_object('amount',cfg.post_amount,'daily_cap',cfg.post_daily_cap,'used',posts_used,'awarded',posts_awarded,
        'remaining',case when cfg.post_daily_cap is not null then greatest(0,cfg.post_daily_cap::bigint-posts_used) end),
      'comment',jsonb_build_object('amount',cfg.comment_amount,'daily_cap',cfg.comment_daily_cap,'used',comments_used,'awarded',comments_awarded,
        'remaining',case when cfg.comment_daily_cap is not null then greatest(0,cfg.comment_daily_cap::bigint-comments_used) end));
  end if;
  with page as materialized(
    select l.id,l.reason,l.amount,l.earned_on,l.created_at,coalesce(o.outcome,'legacy') as outcome
    from private.point_ledger l left join private.point_activity_outcomes o on o.entry_id=l.id
    where l.user_id=actor.id and l.reason in('post','comment')
      and (p_before_id is null or (l.created_at,l.id)<(p_before_created_at,p_before_id))
    order by l.created_at desc,l.id desc limit p_limit+1),
  shown as materialized(select * from page order by created_at desc,id desc limit p_limit)
  select coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
    case when (select count(*) from page)>p_limit then (select jsonb_build_object('created_at',s.created_at,'id',s.id)
      from shown s order by s.created_at,s.id limit 1) end into rows,cursor_value;
  return jsonb_build_object('actor_id',actor.id,'kst_date',to_char(day,'YYYY-MM-DD'),'contribution_policy',policy_value,
    'share',jsonb_build_object('configured',false,'reason','verification_unconfigured'),
    'missions',jsonb_build_object('configured',false,'reason','rules_unconfigured'),
    'grade',jsonb_build_object('configured',false,'reason','score_definition_unconfigured'),
    'entries',rows,'next_cursor',cursor_value);
end;
$$;

revoke all on function private.point_activity_outcome_immutable(),private.point_activity_outcome_validate(),
  private.reward_community_creation() from public,anon,authenticated,service_role;
revoke all on function public.point_ui_activity(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.point_ui_activity(integer,timestamptz,uuid) to authenticated;
comment on table private.point_activity_outcomes is
  'Immutable explanation for new atomic contribution awards. No row is backfilled: legacy zero causes remain unknown. Capped and configured-zero actions consume the existing daily creation count; hidden/deleted sources retain both ledger and explanation.';
comment on function public.point_ui_activity(integer,timestamptz,uuid) is
  'Actor-private read-only contribution rules/counters and bounded history. Used counts recorded creations, awarded counts positive entries, not promises. No share/mission/grade capability or policy is activated; no source content, IDs or correction notes are exposed.';
commit;

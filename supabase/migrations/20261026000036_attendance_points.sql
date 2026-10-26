-- Private attendance/history application boundary. Existing immutable ledger and
-- approved-policy writer remain the sole award implementation; no activation,
-- reward defaults, retroactive grants, redemption or activity grade is added.
begin;

create table private.point_attendance_operations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_id uuid not null,
  entry_id uuid not null references private.point_ledger(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
  primary key(actor_id,operation_id)
);
create index point_attendance_operations_entry_idx on private.point_attendance_operations(entry_id);
alter table private.point_attendance_operations enable row level security;
revoke all on private.point_attendance_operations from public,anon,authenticated,service_role;
create function private.point_attendance_operation_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'POINT_OPERATION_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger point_attendance_operation_immutable before update or delete on private.point_attendance_operations
  for each row execute function private.point_attendance_operation_immutable();
create trigger point_attendance_operation_no_truncate before truncate on private.point_attendance_operations
  for each statement execute function private.point_attendance_operation_immutable();

create function public.point_ui_snapshot(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; cfg private.point_policy%rowtype;
  day date; rows jsonb; cursor_value jsonb; balance_value bigint; attendance_id uuid;
begin
  -- SHARE serializes with every legacy/current ledger writer's profile UPDATE
  -- lock without upgrading simultaneous readers. Fresh authority is checked
  -- after waiting; unsupported snapshot isolation fails closed in board_actor.
  actor:=private.board_actor(auth.uid(),false);
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'POINT_PAGE_INVALID' using errcode='22023'; end if;
  select * into cfg from private.point_policy where singleton for share;
  -- Capture KST only after profile/policy waits; browser timezone/clock are not
  -- authority. Missing policy hides the amount, never substitutes a default.
  day:=private.point_kst_date(clock_timestamp());
  with page as materialized(
    select l.id,l.amount,l.reason,l.earned_on,l.created_at from private.point_ledger l
    where l.user_id=actor.id and (p_before_id is null or (l.created_at,l.id)<(p_before_created_at,p_before_id))
    order by l.created_at desc,l.id desc limit p_limit+1),
  shown as materialized(select * from page order by created_at desc,id desc limit p_limit)
  select coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
    case when (select count(*) from page)>p_limit then (select jsonb_build_object('created_at',s.created_at,'id',s.id)
      from shown s order by s.created_at,s.id limit 1) end,
    (select coalesce(sum(l.amount),0)::bigint from private.point_ledger l where l.user_id=actor.id),
    (select l.id from private.point_ledger l where l.user_id=actor.id and l.reason='attendance' and l.ref_id=to_char(day,'YYYY-MM-DD'))
    into rows,cursor_value,balance_value,attendance_id;
  return jsonb_build_object('actor_id',actor.id,'kst_date',to_char(day,'YYYY-MM-DD'),
    'attendance_entry_id',attendance_id,'attendance_amount',cfg.attendance_amount,
    'balance',balance_value,'entries',rows,'next_cursor',cursor_value);
end;
$$;

create function public.point_ui_check_attendance(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; entry_id_value uuid; entry private.point_ledger%rowtype;
begin
  actor:=private.board_actor(auth.uid(),false,true);
  if p_operation_id is null then raise exception 'POINT_OPERATION_REQUIRED' using errcode='22023'; end if;
  select o.entry_id into entry_id_value from private.point_attendance_operations o
    where o.actor_id=actor.id and o.operation_id=p_operation_id;
  if not found then
    -- The existing RPC captures real KST time after locks, checks the approved
    -- policy only for a new day, enforces balance safety, and awards at most once.
    entry_id_value:=public.point_check_attendance();
    insert into private.point_attendance_operations(actor_id,operation_id,entry_id)
      values(actor.id,p_operation_id,entry_id_value);
  end if;
  -- A lost response replay after midnight must return this operation's original
  -- immutable ledger entry, not silently claim the new day's reward. Current
  -- authority is still checked before every replay; no policy required to read it.
  select * into strict entry from private.point_ledger l where l.id=entry_id_value and l.user_id=actor.id and l.reason='attendance';
  return jsonb_build_object('actor_id',actor.id,'operation_id',p_operation_id,
    'entry_id',entry.id,'earned_on',to_char(entry.earned_on,'YYYY-MM-DD'),'amount',entry.amount);
end;
$$;

revoke all on function private.point_attendance_operation_immutable() from public,anon,authenticated,service_role;
revoke all on function public.point_ui_snapshot(integer,timestamptz,uuid),public.point_ui_check_attendance(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.point_ui_snapshot(integer,timestamptz,uuid),public.point_ui_check_attendance(uuid) to authenticated;
comment on table private.point_attendance_operations is
  'Immutable actor-bound attendance receipt references. Exact retry retains the original day across midnight; same-day distinct operations still reuse the one legacy ledger award. No policy or award is activated by migration.';
commit;

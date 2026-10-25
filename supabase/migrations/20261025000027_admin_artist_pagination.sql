-- Read-only pagination extension. Existing one-argument/no-argument RPCs keep
-- their exact first-page contracts; no content, policy or account is created.
begin;

create function public.admin_artist_detail_page(p_artist_id uuid,p_page integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.artists%rowtype; cfg private.message_policy%rowtype;
begin
  perform private.admin_artist_actor();
  if p_page is null or p_page not between 1 and 1000 then raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  a:=private.admin_artist_lock(p_artist_id);
  select * into cfg from private.message_policy where singleton for share;
  return jsonb_build_object('artist',private.admin_artist_projection(a.id),
    'previews',coalesce((select jsonb_agg(private.admin_artist_message_projection(m.id) order by m.preview_order)
      from public.messages m where m.artist_id=a.id and m.status='sent' and m.is_preview),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(private.admin_artist_message_projection(m.id) order by m.sent_at desc,m.id desc)
      from(select id,sent_at from public.messages where artist_id=a.id and status='sent' and sent_at<=clock_timestamp()
        order by sent_at desc,id desc offset (p_page-1)*50 limit 50)m),'[]'::jsonb),
    'messages_has_more',(select count(*)>p_page*50 from public.messages where artist_id=a.id and status='sent' and sent_at<=clock_timestamp()),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.user_id) from
      (select user_id,is_manager from public.artist_members where artist_id=a.id order by user_id offset (p_page-1)*50 limit 50)m),'[]'::jsonb),
    'members_has_more',(select count(*)>p_page*50 from public.artist_members where artist_id=a.id),
    'invitations',coalesce((select jsonb_agg(private.admin_artist_invitation_projection(i.id) order by i.created_at desc,i.id desc) from
      (select id,created_at from private.artist_account_invitations where artist_id=a.id order by created_at desc,id desc offset (p_page-1)*50 limit 50)i),'[]'::jsonb),
    'invitations_has_more',(select count(*)>p_page*50 from private.artist_account_invitations where artist_id=a.id),
    'account_link_ready',private.admin_artist_policy_ready(),'preview_max_count',coalesce(cfg.preview_max_count,0));
end;
$$;

create function public.artist_account_invitations_page(p_page integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.profiles%rowtype;
begin
  select * into p from public.profiles where id=actor for share;
  if p.id is null or p.role not in('fan','artist') or (p.is_restricted and (p.restricted_until is null or p.restricted_until>clock_timestamp())) then
    raise exception 'ADMIN_ARTIST_FORBIDDEN' using errcode='42501'; end if;
  if p_page is null or p_page not between 1 and 1000 then raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  return jsonb_build_object('invitations',coalesce((select jsonb_agg(private.admin_artist_invitation_projection(i.id) order by i.actionable desc,i.created_at desc,i.id desc)
    from(select id,created_at,(state='pending' and expires_at>clock_timestamp()) as actionable from private.artist_account_invitations
      where target_user_id=actor order by actionable desc,created_at desc,id desc offset (p_page-1)*50 limit 50)i),'[]'::jsonb),
    'has_more',(select count(*)>p_page*50 from private.artist_account_invitations where target_user_id=actor),'account_link_ready',private.admin_artist_policy_ready());
end;
$$;
create or replace function public.admin_artist_detail(p_artist_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin return public.admin_artist_detail_page(p_artist_id,1); end;
$$;
create or replace function public.artist_account_invitations() returns jsonb
language plpgsql security definer set search_path='' as $$
begin return public.artist_account_invitations_page(1); end;
$$;
revoke all on function public.admin_artist_detail_page(uuid,integer),public.artist_account_invitations_page(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_artist_detail_page(uuid,integer),public.artist_account_invitations_page(integer) to authenticated;

commit;

// Synthetic historical observations only. This does not prove that billing,
// message, signup or other business operations occurred; their source-bound
// ingestion is tested separately. No original/private document is copied here.
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function analyticsSourceSql(actor: string, policy: string) {
  if (!uuidPattern.test(actor) || !uuidPattern.test(policy))
    throw new Error('Synthetic analytics fixture UUID required.');
  return `
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at)
    values('${policy}','analytics','Synthetic CI analytics document','Fictional disposable test data; not an approved operating policy.',clock_timestamp()-interval '3 days',clock_timestamp()-interval '3 days');
    insert into private.analytics_policy(singleton,consent_version,enabled,retention_days)
    values(true,'${policy}',true,30)
    on conflict(singleton) do update set consent_version=excluded.consent_version,enabled=excluded.enabled,retention_days=excluded.retention_days;
    insert into private.analytics_consents(user_id,consent_version,granted,granted_at,updated_at)
    values('${actor}','${policy}',true,clock_timestamp()-interval '3 days',clock_timestamp());
    insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
    select '${actor}',gen_random_uuid(),n.name,
      case when n.name in ('message_open','voice_input_used') then 'client'
        when n.name in ('subscribe_complete','renew') then 'verified_charge' else 'server' end,
      case when n.name in ('signup_complete','font_size_selected','voice_input_used') then null else gen_random_uuid() end,
      case when n.name='font_size_selected' then 'normal'::public.font_scale end,
      case when n.name='voice_input_used' then 'reply'::public.analytics_voice_context end,
      '${policy}',((clock_timestamp() at time zone 'Asia/Seoul')::date-1+time '12:00') at time zone 'Asia/Seoul',clock_timestamp()
    from unnest(enum_range(null::public.analytics_event_name)) with ordinality n(name,ordinal)
    cross join lateral generate_series(1,n.ordinal::integer);
    select jsonb_build_object('from',to_char((clock_timestamp() at time zone 'Asia/Seoul')::date-1,'YYYY-MM-DD'),
      'to',to_char((clock_timestamp() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD'),
      'emptyDate',to_char((clock_timestamp() at time zone 'Asia/Seoul')::date-2,'YYYY-MM-DD'));
  `;
}

import assert from 'node:assert/strict';

// Inputs are generated UUIDs and fixed fictional labels. No live credentials,
// project selection, payment provider call, or production policy activation.
export function settlementReportSourceSql(input: {
  admin: string;
  other: string;
  fan: string;
  member: string;
  outsider: string;
  artist: string;
  otherArtist: string;
  terms: string;
  privacy: string;
  charge: string;
  refund: string;
  unverified: string;
}) {
  for (const value of Object.values(input))
    assert.match(
      value,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  const i = input;
  return `begin;
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
      ('${i.terms}','terms','Synthetic report terms','Fictional CI only.',clock_timestamp(),clock_timestamp()),
      ('${i.privacy}','privacy','Synthetic report privacy','Fictional CI only.',clock_timestamp(),clock_timestamp());
    insert into private.profile_onboarding_policy(singleton,name_policy_version,name_approved_at,call_name_min,call_name_max,profanity_words,terms_version,privacy_version)
      values(true,gen_random_uuid(),clock_timestamp(),2,10,array['fixture-forbidden'],'${i.terms}','${i.privacy}')
      on conflict(singleton) do update set name_policy_version=excluded.name_policy_version,name_approved_at=excluded.name_approved_at,call_name_min=excluded.call_name_min,call_name_max=excluded.call_name_max,profanity_words=excluded.profanity_words,terms_version=excluded.terms_version,privacy_version=excluded.privacy_version;
    update public.profiles set font_selected_at=clock_timestamp(),age_self_attested_at=clock_timestamp(),profile_completed_at=clock_timestamp()
      where id in ('${i.admin}','${i.other}','${i.fan}','${i.member}','${i.outsider}');
    insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
      select actor.id,document.kind,document.version,clock_timestamp() from public.profiles actor cross join private.onboarding_documents document
      where actor.id in ('${i.admin}','${i.other}','${i.fan}','${i.member}','${i.outsider}') and document.version in ('${i.terms}','${i.privacy}');
    insert into public.artists(id,slug,name,grade,status) values
      ('${i.artist}','settlement-${i.artist}','=허구 <가수> & 검토','B','active'),
      ('${i.otherArtist}','settlement-${i.otherArtist}','허구 다른 가수','B','active');
    insert into public.artist_members(artist_id,user_id) values ('${i.artist}','${i.member}'),('${i.otherArtist}','${i.outsider}');
    insert into public.subscriptions(id,user_id,artist_id,provider) values ('${i.artist}','${i.fan}','${i.artist}','toss');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at) values
      ('${i.charge}','${i.artist}','charge',11000,'toss','2026-01-01 00:00+09','2026-02-01 00:00+09','2026-01-01 00:00+09'),
      ('${i.unverified}','${i.artist}','charge',999999,'toss','2026-01-01 00:00+09','2026-02-01 00:00+09','2026-01-10 00:00+09');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,original_event_id,period_start,period_end,occurred_at) values
      ('${i.refund}','${i.artist}','refund',-1000,'toss','${i.charge}','2026-01-01 00:00+09','2026-02-01 00:00+09','2026-01-31 23:59:59.999999+09');
    insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
      select id,provider,'test','fictional-report-merchant',id::text,gen_random_uuid() from public.payment_events where id in ('${i.charge}','${i.refund}');
    insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled)
      values('${i.artist}','2026-01-01',true,'2026-01-01','2026-02-01',0.3,0.4,0.1,0.03,false);
    insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at) values
      ('${i.artist}','${i.member}','photo','Never export this private fictional message.','sent','2026-01-05 12:00+09','2026-01-05 12:00+09'),
      ('${i.artist}','${i.member}','text','Never export this private fictional message.','sent','2026-01-10 12:00+09','2026-01-10 12:00+09');
    commit;`;
}

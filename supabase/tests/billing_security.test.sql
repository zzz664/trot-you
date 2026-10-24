begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Independent adversarial checks. Fictional local fixtures; every change rolls back.
insert into auth.users (id, email, raw_user_meta_data) values
  ('71000000-0000-4000-8000-000000000001', 'billing-owner@example.invalid', '{}'),
  ('71000000-0000-4000-8000-000000000002', 'billing-other@example.invalid', '{}'),
  ('71000000-0000-4000-8000-000000000003', 'billing-admin@example.invalid', '{}'),
  ('71000000-0000-4000-8000-000000000004', 'billing-artist@example.invalid', '{}');
update public.profiles set call_name = '검증팬', onboarding_completed_at = now()
  where id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
update public.profiles set role = 'admin' where id = '71000000-0000-4000-8000-000000000003';
update public.profiles set role = 'artist' where id = '71000000-0000-4000-8000-000000000004';
insert into public.artists (id, slug, name, grade, status) values
  ('72000000-0000-4000-8000-000000000001', 'security-billing-artist', '검증가수', 'B', 'active');
insert into public.artist_members (artist_id, user_id) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000004');

create temporary table security_billing_fixture (name text primary key, id uuid not null);
grant all on security_billing_fixture to service_role;
grant select on security_billing_fixture to authenticated, anon;

select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in
  ('public.subscriptions'::regclass, 'public.payment_events'::regclass,
   'private.payment_mandates'::regclass, 'private.billing_obligations'::regclass,
   'private.payment_attempts'::regclass, 'private.payment_event_verifications'::regclass)),
  'every new billing base table has RLS');
select ok((select bool_and(not has_table_privilege(r, t, 'INSERT,UPDATE,DELETE,TRUNCATE'))
  from unnest(array['anon', 'authenticated', 'service_role']) r
  cross join unnest(array['public.subscriptions', 'public.payment_events',
    'private.payment_mandates', 'private.billing_obligations', 'private.payment_attempts',
    'private.payment_event_verifications']) t), 'all application roles lack direct billing mutation privileges');
select ok((select bool_and(not has_table_privilege(r, t, 'SELECT'))
  from unnest(array['anon', 'authenticated']) r
  cross join unnest(array['private.payment_mandates', 'private.billing_obligations',
    'private.payment_attempts', 'private.payment_event_verifications']) t),
  'client roles cannot read any private billing table');
select ok((select bool_and(not has_function_privilege(r, p.oid, 'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon', 'authenticated']) r
  where n.nspname = 'public' and p.proname like 'billing\_%' escape '\'),
  'client roles cannot execute any privileged billing RPC');
select ok((select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'billing\_%' escape '\'),
  'service role has explicit billing RPC grants');
select ok((select bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'billing\_%' escape '\' or p.proname = 'cancel_subscription')),
  'all privilege-crossing billing RPCs pin the empty search path');
select ok(not has_function_privilege('service_role', 'private.require_billing_service()', 'EXECUTE'),
  'private caller guard is not an RPC');
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
  where table_schema = 'public' and table_name = 'payment_events') collate "C",
  'id,subscription_id,kind,amount_krw,currency,provider,original_event_id,period_start,period_end,occurred_at,recorded_at'::text collate "C",
  'public money DTO is an explicit safe projection without provider credentials or payload');
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
  where table_schema = 'public' and table_name = 'subscriptions') collate "C",
  'id,user_id,artist_id,provider,status,intro_redeemed_at,first_started_at,episode_started_at,current_period_start,current_period_end,grace_started_at,grace_ends_at,next_billing_at,canceled_at,created_at,updated_at'::text collate "C",
  'public subscription DTO contains no billing credential or customer reference');

set local role service_role;
insert into security_billing_fixture values ('subscription', public.billing_open_subscription(
  '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'toss'));
insert into security_billing_fixture values ('other_subscription', public.billing_open_subscription(
  '71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'kakaopay'));
insert into security_billing_fixture values ('mandate', public.billing_register_mandate(
  (select id from security_billing_fixture where name = 'subscription'), 'test', 'fictional-merchant',
  '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000002', 'fixture-v1'));
select throws_ok($$select public.billing_prepare_obligation(
  (select id from security_billing_fixture where name = 'subscription'), '-infinity', now() + interval '30 days',
  1000, true, 'fixture-v1', 259200, 86400, 3)$$, '23514', null,
  'nonfinite period start cannot grant unlimited history');
select throws_ok($$select public.billing_prepare_obligation(
  (select id from security_billing_fixture where name = 'subscription'), now() - interval '1 hour', 'infinity',
  1000, true, 'fixture-v1', 259200, 86400, 3)$$, '23514', null,
  'nonfinite period end cannot grant permanent paid access');
insert into security_billing_fixture values ('obligation', public.billing_prepare_obligation(
  (select id from security_billing_fixture where name = 'subscription'), now() - interval '1 hour', now() + interval '30 days',
  1000, true, 'fixture-v1', 259200, 86400, 3));
insert into security_billing_fixture values ('attempt', public.billing_prepare_attempt(
  (select id from security_billing_fixture where name = 'obligation')));
select ok(public.billing_claim_attempt((select id from security_billing_fixture where name = 'attempt'), 120) is not null,
  'legitimate service can claim a fixture operation');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'security-charge', null, 'KRW', now(), '74000000-0000-4000-8000-000000000001')$$,
  '22004', 'VERIFIED_RESULT_REQUIRED', 'null charge amount fails closed');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'security-charge', 1000, null, now(), '74000000-0000-4000-8000-000000000001')$$,
  '22004', 'VERIFIED_RESULT_REQUIRED', 'null charge currency fails closed');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'security-charge', 1000, 'KRW', now(), null)$$,
  '22004', 'VERIFIED_RESULT_REQUIRED', 'charge without verification evidence fails closed');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'security-charge', 999, 'KRW', now(), '74000000-0000-4000-8000-000000000001')$$,
  '23514', 'VERIFIED_RESULT_MISMATCH', 'verified amount must match the immutable obligation');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'security-charge', 1000, 'USD', now(), '74000000-0000-4000-8000-000000000001')$$,
  '23514', 'VERIFIED_RESULT_MISMATCH', 'non-KRW charge cannot settle a KRW obligation');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'security-charge', 1000, 'KRW', now() + interval '1 day', '74000000-0000-4000-8000-000000000001')$$,
  '23514', 'VERIFIED_RESULT_MISMATCH', 'future approval cannot mint paid access');
select is((select count(*) from public.payment_events), 0::bigint, 'all rejected results leave the ledger empty');
select is((select status::text from public.subscriptions where id = (select id from security_billing_fixture where name = 'subscription')),
  'pending', 'all rejected results leave subscription pending');
insert into security_billing_fixture values ('charge', public.billing_finalize_charge(
  (select id from security_billing_fixture where name = 'attempt'), 'security-charge', 1000, 'KRW', date_trunc('second', now()),
  '74000000-0000-4000-8000-000000000001'));
select is((select occurred_at from public.payment_events where id = (select id from security_billing_fixture where name = 'charge')),
  date_trunc('second', now()), 'provider seconds-precision approval in the creation second is preserved');
select is(public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'security-charge', 1000, 'KRW', date_trunc('second', now()), '74000000-0000-4000-8000-000000000001'),
  (select id from security_billing_fixture where name = 'charge'), 'exact charge replay returns original immutable event');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'different-action', 1000, 'KRW', now(), '74000000-0000-4000-8000-000000000001')$$,
  '23514', 'VERIFIED_RESULT_CONFLICT', 'charge replay with changed provider action is rejected');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'security-charge', 1000, 'KRW', now() - interval '1 second', '74000000-0000-4000-8000-000000000001')$$,
  '23514', 'VERIFIED_RESULT_CONFLICT', 'charge replay with changed approval time is rejected');
select throws_ok($$update public.subscriptions set status = 'active'$$, '42501', null,
  'service cannot bypass RPCs to forge subscription state');
select throws_ok($$insert into public.payment_events select * from public.payment_events$$, '42501', null,
  'service cannot forge a ledger insert directly');
select throws_ok($$update private.payment_mandates set secure_credential_ref = gen_random_uuid()$$, '42501', null,
  'service cannot replace a mandate outside controlled registration');
reset role;

-- Both an owner and a privileged app-admin remain unable to forge money.
set local role anon;
select set_config('request.jwt.claims', '{}', true);
select throws_ok('select * from public.subscriptions', '42501', null, 'anonymous cannot enumerate subscriptions');
select throws_ok('select * from public.payment_events', '42501', null, 'anonymous cannot enumerate payment history');
select throws_ok('select * from private.payment_mandates', '42501', null, 'anonymous cannot read private credential handles');
select throws_ok($$select public.cancel_subscription((select id from security_billing_fixture where name = 'subscription'))$$,
  '42501', null, 'anonymous cannot cancel a subscription');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.subscriptions), 1::bigint, 'owner sees only own subscription');
select is((select count(*) from public.payment_events), 1::bigint, 'owner sees own safe financial history');
select ok(public.has_active_access('72000000-0000-4000-8000-000000000001'), 'owner has access from verified charge');
select throws_ok('select * from private.payment_mandates', '42501', null, 'owner cannot read their own charging credentials');
select throws_ok('select * from private.payment_event_verifications', '42501', null, 'owner cannot read private provider evidence');
select throws_ok($$update public.subscriptions set intro_redeemed_at = null$$, '42501', null, 'owner cannot reset intro redemption');
select throws_ok($$update public.payment_events set amount_krw = 999999$$, '42501', null, 'owner cannot change money');
select throws_ok($$select public.cancel_subscription((select id from security_billing_fixture where name = 'other_subscription'))$$,
  '42501', 'FORBIDDEN', 'owner cannot cancel another user subscription');
select throws_ok($$select public.billing_finalize_charge((select id from security_billing_fixture where name = 'attempt'),
  'forged', 1000, 'KRW', now(), gen_random_uuid())$$, '42501', null, 'owner cannot call financial finalizer');
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.subscriptions), 1::bigint, 'other fan sees only their own pending subscription');
select is((select count(*) from public.payment_events), 0::bigint, 'other fan cannot read owner payment history');
select ok(not public.has_active_access('72000000-0000-4000-8000-000000000001'), 'pending other fan gains no paid access');
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*) from public.subscriptions), 0::bigint, 'artist membership does not expose fan subscriptions');
select is((select count(*) from public.payment_events), 0::bigint, 'artist membership does not expose fan payments');
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.subscriptions), 2::bigint, 'app admin can inspect safe subscription records');
select is((select count(*) from public.payment_events), 1::bigint, 'app admin can inspect safe financial records');
select throws_ok('select * from private.payment_mandates', '42501', null, 'app admin cannot read credential handles');
select throws_ok($$update public.subscriptions set status = 'active'$$, '42501', null, 'app admin cannot forge active subscriptions');
select throws_ok($$select public.billing_record_refund((select id from security_billing_fixture where name = 'charge'),
  'forged-refund', 1000, 'KRW', now(), gen_random_uuid())$$, '42501', null, 'app admin cannot forge refund results');
select throws_ok($$select public.cancel_subscription((select id from security_billing_fixture where name = 'subscription'))$$,
  '42501', 'FORBIDDEN', 'app admin has no implicit cross-user cancellation permission');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is((select count(*) from public.payment_events), 0::bigint, 'missing subject fails closed on financial reads');
select ok(not public.has_active_access('72000000-0000-4000-8000-000000000001'), 'missing subject fails closed on access');
reset role;

-- Defense in depth: even a future mistaken grant must not turn JWT claims into
-- service identity. This grant is test-only and is reverted before other tests.
grant execute on function public.billing_open_subscription(uuid, uuid, public.payment_provider) to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000003","role":"service_role"}', true);
select throws_ok($$select public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', 'toss')$$, '42501', 'BILLING_SERVICE_REQUIRED',
  'forged JWT service role and app admin cannot bypass strict database caller guard');
reset role;
revoke execute on function public.billing_open_subscription(uuid, uuid, public.payment_provider) from authenticated;
select throws_ok($$select public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', 'toss')$$, '42501', 'BILLING_SERVICE_REQUIRED',
  'definer-owner identity is not mistaken for an authorized service caller');

-- Privileges are not the only append-only protection: owner SQL is guarded too.
select throws_ok('update public.payment_events set amount_krw = 123', '55000', 'IMMUTABLE_PAYMENT_LEDGER',
  'ledger UPDATE trigger rejects privileged mutation');
select throws_ok('delete from public.payment_events', '55000', 'IMMUTABLE_PAYMENT_LEDGER',
  'ledger DELETE trigger rejects privileged mutation');
select throws_ok('truncate public.payment_events, private.payment_event_verifications, private.notification_jobs, private.notification_attempts, private.subscription_enrollments, private.enrollment_reconciliations', '55000', 'IMMUTABLE_PAYMENT_LEDGER',
  'ledger TRUNCATE is rejected even with all related tables named');
select throws_ok($$update private.payment_event_verifications set provider_action_id = 'rewritten'$$,
  '55000', 'IMMUTABLE_PAYMENT_LEDGER', 'provider verification identity cannot be rewritten');
select throws_ok('delete from private.payment_event_verifications', '55000', 'IMMUTABLE_PAYMENT_LEDGER',
  'provider verification identity cannot be erased');
select throws_like($$delete from auth.users where id = '71000000-0000-4000-8000-000000000001'$$,
  '%violates%foreign key constraint%', 'account deletion cannot cascade away financial identity or intro history');
select throws_like($$delete from public.artists where id = '72000000-0000-4000-8000-000000000001'$$,
  '%violates%foreign key constraint%', 'artist deletion cannot erase paid subscription history');

set local role service_role;
select throws_ok($$select public.billing_record_refund((select id from security_billing_fixture where name = 'charge'),
  'security-refund', 1, null, now(), gen_random_uuid())$$, '22004', 'VERIFIED_RESULT_REQUIRED',
  'null refund currency cannot evade matching');
select throws_ok($$select public.billing_record_refund((select id from security_billing_fixture where name = 'charge'),
  'security-refund', -2147483648, 'KRW', now(), gen_random_uuid())$$, '23514', 'REFUND_RESULT_MISMATCH',
  'negative integer boundary cannot overflow into a valid refund');
select throws_ok($$select public.billing_record_refund((select id from security_billing_fixture where name = 'charge'),
  'security-charge', 500, 'KRW', now(), gen_random_uuid())$$, '23514', 'REFUND_RESULT_CONFLICT',
  'a charge provider action cannot be reused as a refund action');
insert into security_billing_fixture values ('refund', public.billing_record_refund(
  (select id from security_billing_fixture where name = 'charge'), 'security-refund', 400, 'KRW', now(),
  '74000000-0000-4000-8000-000000000002'));
select is(public.billing_record_refund((select id from security_billing_fixture where name = 'charge'),
  'security-refund', 400, 'KRW', now(), '74000000-0000-4000-8000-000000000002'),
  (select id from security_billing_fixture where name = 'refund'), 'exact refund replay returns original event');
select throws_ok($$select public.billing_record_refund((select id from security_billing_fixture where name = 'charge'),
  'security-refund', 401, 'KRW', now(), gen_random_uuid())$$, '23514', 'REFUND_RESULT_CONFLICT',
  'changed-amount replay cannot alter or duplicate refund');
select throws_ok($$select public.billing_record_refund((select id from security_billing_fixture where name = 'refund'),
  'refund-of-refund', 1, 'KRW', now(), gen_random_uuid())$$, '23514', 'REFUND_REQUIRES_CHARGE',
  'negative ledger entry cannot be refunded again');
select throws_ok($$select public.billing_record_refund((select id from security_billing_fixture where name = 'charge'),
  'over-refund', 601, 'KRW', now(), gen_random_uuid())$$, '23514', 'REFUND_EXCEEDS_CHARGE',
  'partial refund total cannot exceed the original charge');
select is((select sum(amount_krw) from public.payment_events), 600::bigint,
  'rejected and duplicate refund requests leave exact net money');
select is((select count(*) from private.payment_event_verifications), 2::bigint,
  'every recognized event has exactly one verification with no rejected-result residue');
reset role;

select * from finish();
rollback;

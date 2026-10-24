begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- All identities, provider action IDs and evidence UUIDs are fictional DB fixtures.
-- These tests prove SQL state transitions, NOT provider verification or payment.
-- Owner-only clock fixture writes below avoid sleeps. Production service_role has
-- no direct mutation grants, and immutable ledger rows are never rewritten.
create temporary table billing_test_context (key text primary key, id uuid, data jsonb);
grant all on billing_test_context to authenticated, service_role;
insert into auth.users(id, email, raw_user_meta_data) values
  ('71000000-0000-4000-8000-000000000001', 'billing-lifecycle@example.invalid', '{}');
update public.profiles set call_name = '결제테스트', onboarding_completed_at = now()
  where id = '71000000-0000-4000-8000-000000000001';
insert into public.artists(id, slug, name, grade, status) values
  ('72000000-0000-4000-8000-000000000001', 'billing-lifecycle-main', '결제 가상 하나', 'B', 'active'),
  ('72000000-0000-4000-8000-000000000002', 'billing-lifecycle-retry', '결제 가상 둘', 'B', 'active'),
  ('72000000-0000-4000-8000-000000000003', 'billing-lifecycle-lease', '결제 가상 셋', 'B', 'active');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into billing_test_context(key, id) values ('main', public.billing_open_subscription(
  '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'toss'));
select is(public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', 'toss'),
  (select id from billing_test_context where key = 'main'), 'double-click keeps one pending subscription identity');
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'pending', 'new subscription is pending without entitlement');
select is((select count(*) from public.payment_events), 0::bigint, 'opening subscription creates no presumed money');
select throws_ok($$select public.billing_prepare_obligation((select id from billing_test_context where key = 'main'),
  now() - interval '1 day', now() + interval '29 days', 1000, true, 'fixture-price-v1', 259200, 86400, 3)$$,
  '55000', 'MANDATE_REQUIRED', 'cannot prepare a bill without registered mandate');
insert into billing_test_context(key, id) values ('main-mandate', public.billing_register_mandate(
  (select id from billing_test_context where key = 'main'), 'test', 'fictional-toss-merchant',
  '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'fixture-consent-v1'));
select is(public.billing_register_mandate((select id from billing_test_context where key = 'main'), 'test', 'fictional-toss-merchant',
  '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'fixture-consent-v1'),
  (select id from billing_test_context where key = 'main-mandate'), 'identical mandate registration is idempotent');
select throws_ok($$select public.billing_register_mandate((select id from billing_test_context where key = 'main'),
  'live', 'fictional-toss-merchant', '73000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001', 'fixture-consent-v1')$$,
  '23514', 'MANDATE_CONFLICT', 'environment cannot silently change on mandate replay');
select throws_ok($$select public.billing_register_mandate((select id from billing_test_context where key = 'main'),
  'test', 'different-merchant', '73000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001', 'fixture-consent-v1')$$,
  '23514', 'MANDATE_CONFLICT', 'merchant cannot silently change on mandate replay');
insert into billing_test_context(key, id) values ('initial', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'main'), now() - interval '1 day', now() + interval '29 days',
  1000, true, 'fixture-price-v1', 259200, 86400, 3));
select is(public.billing_prepare_obligation((select id from billing_test_context where key = 'main'),
  now() - interval '1 day', now() + interval '29 days', 1000, true, 'fixture-price-v1', 259200, 86400, 3),
  (select id from billing_test_context where key = 'initial'), 'same subscription period resolves to same obligation');
select throws_ok($$select public.billing_prepare_obligation((select id from billing_test_context where key = 'main'),
  now() - interval '1 day', now() + interval '29 days', 6500, true, 'fixture-price-v1', 259200, 86400, 3)$$,
  '23514', 'OBLIGATION_CONFLICT', 'price cannot change on obligation replay');
select throws_ok($$select public.billing_prepare_obligation((select id from billing_test_context where key = 'main'),
  now() - interval '1 day', now() + interval '29 days', 1000, true, 'fixture-price-v1', 259200, 86400, 4)$$,
  '23514', 'OBLIGATION_CONFLICT', 'retry policy snapshot cannot change on replay');
select throws_ok($$select public.billing_prepare_obligation((select id from billing_test_context where key = 'main'),
  now() - interval '2 days', now() + interval '28 days', 1000, true, 'fixture-price-v1', 259200, 86400, 3)$$,
  '23505', null, 'alternate period cannot create second open obligation');
insert into billing_test_context(key, id) values ('initial-attempt',
  public.billing_prepare_attempt((select id from billing_test_context where key = 'initial')));
select is(public.billing_prepare_attempt((select id from billing_test_context where key = 'initial')),
  (select id from billing_test_context where key = 'initial-attempt'), 'created attempt order ID is stable across retries');
select is((select state::text from private.payment_attempts where id = (select id from billing_test_context where key = 'initial-attempt')),
  'created', 'prepared attempt is not yet dispatched');
select throws_ok($$select public.billing_finalize_charge((select id from billing_test_context where key = 'initial-attempt'),
  'fixture-initial-action', 1000, 'KRW', now(), '75000000-0000-4000-8000-000000000001')$$,
  '55000', 'ATTEMPT_NOT_FINALIZABLE', 'unclaimed attempt cannot become paid');
insert into billing_test_context(key, data) values ('initial-claim',
  public.billing_claim_attempt((select id from billing_test_context where key = 'initial-attempt'), 120));
select is((select data ->> 'provider' from billing_test_context where key = 'initial-claim'), 'toss', 'claim uses persisted provider');
select is((select data ->> 'environment' from billing_test_context where key = 'initial-claim'), 'test', 'claim retains test namespace');
select is((select (data ->> 'order_id')::uuid from billing_test_context where key = 'initial-claim'),
  (select id from billing_test_context where key = 'initial-attempt'), 'dispatch order is stable attempt identity');
select is((select (data ->> 'amount_krw')::integer from billing_test_context where key = 'initial-claim'), 1000, 'claim takes immutable obligation amount');
select is(public.billing_claim_attempt((select id from billing_test_context where key = 'initial-attempt'), 120),
  null::jsonb, 'second worker receives no dispatch lease');
select is(public.billing_prepare_attempt((select id from billing_test_context where key = 'initial')),
  (select id from billing_test_context where key = 'initial-attempt'), 'inflight attempt is not replaced');
select throws_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'initial-attempt'),
  '76000000-0000-4000-8000-000000000099', 'unknown', null)$$,
  '55000', 'ATTEMPT_OUTCOME_CONFLICT', 'wrong lease token cannot change an inflight attempt');
select throws_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'initial-attempt'),
  (select (data ->> 'lease_token')::uuid from billing_test_context where key = 'initial-claim'), 'failed', null)$$,
  '22023', 'VERIFIED_OUTCOME_REQUIRED', 'failure requires definitive evidence, not a timeout guess');
select lives_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'initial-attempt'),
  (select (data ->> 'lease_token')::uuid from billing_test_context where key = 'initial-claim'), 'unknown', null)$$,
  'lost response becomes unknown');
select is((select count(*) from public.payment_events), 0::bigint, 'unknown result is not revenue');
select is(public.billing_prepare_attempt((select id from billing_test_context where key = 'initial')),
  (select id from billing_test_context where key = 'initial-attempt'), 'unknown outcome blocks a new attempt identity');
select is(public.billing_claim_attempt((select id from billing_test_context where key = 'initial-attempt'), 120),
  null::jsonb, 'unknown attempt cannot be dispatched again');
select throws_ok($$select public.billing_finalize_charge((select id from billing_test_context where key = 'initial-attempt'),
  'fixture-initial-action', 6500, 'KRW', now(), '75000000-0000-4000-8000-000000000001')$$,
  '23514', 'VERIFIED_RESULT_MISMATCH', 'approval amount must equal obligation');
select throws_ok($$select public.billing_finalize_charge((select id from billing_test_context where key = 'initial-attempt'),
  'fixture-initial-action', 1000, 'USD', now(), '75000000-0000-4000-8000-000000000001')$$,
  '23514', 'VERIFIED_RESULT_MISMATCH', 'approval currency must be KRW');
select is((select count(*) from public.payment_events), 0::bigint, 'rejected approval leaves ledger empty');
insert into billing_test_context(key, id) values ('initial-charge', public.billing_finalize_charge(
  (select id from billing_test_context where key = 'initial-attempt'), 'fixture-initial-action', 1000, 'KRW', now(),
  '75000000-0000-4000-8000-000000000001'));
select is((select state::text from private.payment_attempts where id = (select id from billing_test_context where key = 'initial-attempt')),
  'success', 'recovered approval finishes original unknown attempt');
select is((select state from private.billing_obligations where id = (select id from billing_test_context where key = 'initial')),
  'settled', 'approval settles obligation in same transaction');
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'active', 'verified first payment activates subscription');
select is((select intro_redeemed_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now(), 'first successful payment records permanent intro redemption');
select is((select episode_started_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now() - interval '1 day', 'first episode history start matches paid initial period');
select is(public.billing_finalize_charge((select id from billing_test_context where key = 'initial-attempt'),
  'fixture-initial-action', 1000, 'KRW', now(), '75000000-0000-4000-8000-000000000002'),
  (select id from billing_test_context where key = 'initial-charge'), 'same verified financial result is idempotent even with new evidence handle');
select is((select count(*) from public.payment_events), 1::bigint, 'duplicate approval recognizes exactly one money event');
select is((select current_period_end from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now() + interval '29 days', 'duplicate approval does not extend period a second time');
select throws_ok($$select public.billing_finalize_charge((select id from billing_test_context where key = 'initial-attempt'),
  'different-action', 1000, 'KRW', now(), '75000000-0000-4000-8000-000000000002')$$,
  '23514', 'VERIFIED_RESULT_CONFLICT', 'changed provider action is not accepted as idempotent success');
select throws_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'initial-attempt'),
  null, 'failed', '75000000-0000-4000-8000-000000000002')$$,
  '55000', 'ATTEMPT_OUTCOME_CONFLICT', 'stale failed callback cannot overwrite success');
select is(public.billing_claim_attempt((select id from billing_test_context where key = 'initial-attempt'), 120),
  null::jsonb, 'successful attempt never dispatches again');

-- Paid access has an inclusive start and exclusive end, without an expiry job.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), true, 'active paid period grants owner access');
reset role;
update public.subscriptions set current_period_start = now() where id = (select id from billing_test_context where key = 'main');
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), true, 'paid access includes period start exactly');
reset role;
update public.subscriptions set current_period_start = now() + interval '1 microsecond' where id = (select id from billing_test_context where key = 'main');
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), false, 'paid access cannot begin before its start');
reset role;
update public.subscriptions set current_period_start = now() - interval '1 day', current_period_end = now() where id = (select id from billing_test_context where key = 'main');
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), false, 'paid access ends exactly at period end');
reset role;
update public.subscriptions set current_period_end = now() + interval '1 microsecond' where id = (select id from billing_test_context where key = 'main');
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), true, 'paid access remains just before exclusive end');
reset role;
update public.subscriptions set current_period_end = now() - interval '1 microsecond' where id = (select id from billing_test_context where key = 'main');
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), false, 'paid access remains closed after end');
reset role;

-- Move only fixture clocks to a due renewal boundary, not an actual calendar job.
update public.subscriptions set current_period_end = now() - interval '10 seconds', next_billing_at = now() - interval '10 seconds'
  where id = (select id from billing_test_context where key = 'main');
set local role service_role;
select throws_ok($$select public.billing_prepare_obligation((select id from billing_test_context where key = 'main'),
  now() - interval '10 seconds', now() + interval '30 days', 1000, true, 'fixture-price-v1', 259200, 86400, 3)$$,
  '23514', 'INTRO_ALREADY_REDEEMED', 'renewal cannot reuse introductory price entitlement');
select throws_ok($$select public.billing_prepare_obligation((select id from billing_test_context where key = 'main'),
  now(), now() + interval '30 days', 6500, false, 'fixture-price-v1', 259200, 86400, 3)$$,
  '23514', 'INVALID_BILLING_PERIOD', 'renewal must start at exact previous paid end');
insert into billing_test_context(key, id) values ('renewal', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'main'), now() - interval '10 seconds', now() + interval '30 days',
  6500, false, 'fixture-price-v1', 259200, 86400, 3));
insert into billing_test_context(key, id) values ('renewal-attempt', public.billing_prepare_attempt((select id from billing_test_context where key = 'renewal')));
insert into billing_test_context(key, data) values ('renewal-claim', public.billing_claim_attempt((select id from billing_test_context where key = 'renewal-attempt'), 120));
select lives_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'renewal-attempt'),
  (select (data ->> 'lease_token')::uuid from billing_test_context where key = 'renewal-claim'), 'failed',
  '75000000-0000-4000-8000-000000000003')$$, 'definitive renewal failure enters grace');
select is((select count(*) from public.payment_events), 1::bigint, 'failed renewal creates no revenue');
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'grace', 'failed renewal has explicit grace status');
select is((select grace_started_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now() - interval '10 seconds', 'grace starts at unpaid period boundary, not failure arrival');
select is((select grace_ends_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now() - interval '10 seconds' + interval '3 days', 'grace length comes from obligation snapshot');
select throws_ok($$select public.billing_prepare_attempt((select id from billing_test_context where key = 'renewal'))$$,
  '55000', 'RETRY_NOT_DUE_OR_EXHAUSTED', 'definitive failure does not allow immediate retry');
reset role;
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), true, 'grace grants access after paid period has ended');
reset role;
update public.subscriptions set grace_started_at = now(), grace_ends_at = now() + interval '1 microsecond'
  where id = (select id from billing_test_context where key = 'main');
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), true, 'grace includes exact start and excludes only its end');
reset role;
update public.subscriptions set grace_ends_at = now() where id = (select id from billing_test_context where key = 'main');
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), false, 'grace access ends exactly at grace boundary');
reset role;
update public.subscriptions set grace_started_at = now() - interval '10 seconds', grace_ends_at = now() - interval '10 seconds' + interval '3 days'
  where id = (select id from billing_test_context where key = 'main');
update private.billing_obligations set next_attempt_at = now() where id = (select id from billing_test_context where key = 'renewal');
set local role service_role;
insert into billing_test_context(key, id) values ('renewal-retry', public.billing_prepare_attempt((select id from billing_test_context where key = 'renewal')));
select isnt((select id from billing_test_context where key = 'renewal-retry'),
  (select id from billing_test_context where key = 'renewal-attempt'), 'definitive failure permits a genuinely new retry ID when due');
insert into billing_test_context(key, data) values ('renewal-retry-claim', public.billing_claim_attempt((select id from billing_test_context where key = 'renewal-retry'), 120));
select lives_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'renewal-retry'),
  (select (data ->> 'lease_token')::uuid from billing_test_context where key = 'renewal-retry-claim'), 'unknown', null)$$,
  'retry timeout remains unknown, not decline');
select is((select grace_ends_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now() - interval '10 seconds' + interval '3 days', 'retry does not reset or extend grace');
select is((select next_billing_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  null::timestamptz, 'unknown retry is removed from automatic next-billing queue');
reset role;
set local role authenticated;
select lives_ok($$select public.cancel_subscription((select id from billing_test_context where key = 'main'))$$,
  'owner may cancel during grace with unknown provider outcome');
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), false,
  'canceling during grace grants only already-paid access, not unpaid grace');
reset role;
set local role service_role;
select is((select state from private.billing_obligations where id = (select id from billing_test_context where key = 'renewal')),
  'open', 'cancel preserves unknown operation for reconciliation');
select throws_ok($$select public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', 'kakaopay')$$,
  '55000', 'BILLING_UNRESOLVED', 'unknown canceled renewal blocks resubscription and provider fallback');
insert into billing_test_context(key, id) values ('renewal-charge', public.billing_finalize_charge(
  (select id from billing_test_context where key = 'renewal-retry'), 'fixture-renewal-action', 6500, 'KRW', now(),
  '75000000-0000-4000-8000-000000000004'));
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'canceled', 'late verified success never reopens future renewal after cancel');
select is((select next_billing_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  null::timestamptz, 'late successful charge cannot restore next billing');
select is((select grace_ends_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  null::timestamptz, 'verified renewal clears grace separately from cancellation');
select is((select episode_started_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now() - interval '1 day', 'renewal preserves current episode history start');
select is((select count(*) from public.payment_events), 2::bigint, 'late verified renewal adds only one genuine charge');
select throws_ok($$select public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', 'kakaopay')$$,
  '55000', 'SUBSCRIPTION_EXISTS', 'resubscribe before canceled paid end is explicitly unsupported');
select lives_ok($$select public.billing_expire_subscription((select id from billing_test_context where key = 'main'))$$,
  'early expiry call is harmless');
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'canceled', 'early expiry does not erase paid cancellation period');
reset role;
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), true,
  'canceled subscription retains newly verified paid access');
reset role;
update public.subscriptions set current_period_end = now() where id = (select id from billing_test_context where key = 'main');
set local role service_role;
select lives_ok($$select public.billing_expire_subscription((select id from billing_test_context where key = 'main'))$$,
  'canceled subscription expires at exact paid end');
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'expired', 'expiry persisted after paid end');
select is(public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', 'kakaopay'), (select id from billing_test_context where key = 'main'),
  'resubscription reuses lifetime user+artist identity');
select is((select intro_redeemed_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now(), 'resubscription preserves lifetime introduction redemption');
select is((select is_active from private.payment_mandates where id = (select id from billing_test_context where key = 'main-mandate')),
  false, 'new episode disables old local mandate selection');
select is((select provider::text from private.payment_mandates where id = (select id from billing_test_context where key = 'main-mandate')),
  'toss', 'old mandate retains original provider for historic reconciliation');
select is((select provider::text from public.payment_events where id = (select id from billing_test_context where key = 'initial-charge')),
  'toss', 'new subscription provider does not rewrite historic charge provider');
insert into billing_test_context(key, id) values ('resubscribe-mandate', public.billing_register_mandate(
  (select id from billing_test_context where key = 'main'), 'test', 'fictional-kakao-merchant',
  '73000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', 'fixture-consent-v2'));
select throws_ok($$select public.billing_prepare_obligation((select id from billing_test_context where key = 'main'),
  now(), now() + interval '30 days', 1000, true, 'fixture-price-v2', 259200, 86400, 3)$$,
  '23514', 'INTRO_ALREADY_REDEEMED', 'resubscribe cannot redeem intro twice');
insert into billing_test_context(key, id) values ('resubscribe', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'main'), now(), now() + interval '30 days',
  6500, false, 'fixture-price-v2', 259200, 86400, 3));
insert into billing_test_context(key, id) values ('resubscribe-attempt', public.billing_prepare_attempt((select id from billing_test_context where key = 'resubscribe')));
insert into billing_test_context(key, data) values ('resubscribe-claim', public.billing_claim_attempt((select id from billing_test_context where key = 'resubscribe-attempt'), 120));
select is((select data ->> 'provider' from billing_test_context where key = 'resubscribe-claim'), 'kakaopay',
  'new consent and episode claim use new provider snapshot');
insert into billing_test_context(key, id) values ('resubscribe-charge', public.billing_finalize_charge(
  (select id from billing_test_context where key = 'resubscribe-attempt'), 'fixture-new-episode-action', 6500, 'KRW', now(),
  '75000000-0000-4000-8000-000000000005'));
select is((select episode_started_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now(), 'verified resubscribe starts new episode history window');
select is((select first_started_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now() - interval '1 day', 'lifetime first start survives resubscribe');
select is((select count(*) from public.subscriptions where user_id = '71000000-0000-4000-8000-000000000001'
  and artist_id = '72000000-0000-4000-8000-000000000001'), 1::bigint, 'all episodes retain exactly one subscription row');

-- Verified refunds are bounded negative ledger entries, never mutable charges.
select throws_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'initial-charge'),
  'fixture-refund-invalid', 0, 'KRW', now(), '75000000-0000-4000-8000-000000000006')$$,
  '23514', 'REFUND_RESULT_MISMATCH', 'zero refund is rejected');
select throws_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'initial-charge'),
  'fixture-refund-invalid', 1001, 'KRW', now(), '75000000-0000-4000-8000-000000000006')$$,
  '23514', 'REFUND_EXCEEDS_CHARGE', 'refund cannot exceed original amount');
select throws_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'initial-charge'),
  'fixture-refund-invalid', 300, 'USD', now(), '75000000-0000-4000-8000-000000000006')$$,
  '23514', 'REFUND_RESULT_MISMATCH', 'refund currency must match charge');
insert into billing_test_context(key, id) values ('refund-one', public.billing_record_refund(
  (select id from billing_test_context where key = 'initial-charge'), 'fixture-refund-one', 300, 'KRW', now(),
  '75000000-0000-4000-8000-000000000006'));
select is((select amount_krw from public.payment_events where id = (select id from billing_test_context where key = 'refund-one')),
  -300, 'partial refund is a negative immutable amount');
select is((select original_event_id from public.payment_events where id = (select id from billing_test_context where key = 'refund-one')),
  (select id from billing_test_context where key = 'initial-charge'), 'refund identifies its original charge');
select is(public.billing_record_refund((select id from billing_test_context where key = 'initial-charge'),
  'fixture-refund-one', 300, 'KRW', now(), '75000000-0000-4000-8000-000000000007'),
  (select id from billing_test_context where key = 'refund-one'), 'duplicate verified partial refund is idempotent');
select throws_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'initial-charge'),
  'fixture-refund-one', 301, 'KRW', now(), '75000000-0000-4000-8000-000000000007')$$,
  '23514', 'REFUND_RESULT_CONFLICT', 'duplicate refund action cannot change amount');
select throws_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'renewal-charge'),
  'fixture-refund-one', 300, 'KRW', now(), '75000000-0000-4000-8000-000000000007')$$,
  '23514', 'REFUND_RESULT_CONFLICT', 'same provider action cannot point at another original charge');
select throws_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'refund-one'),
  'fixture-refund-of-refund', 100, 'KRW', now(), '75000000-0000-4000-8000-000000000007')$$,
  '23514', 'REFUND_REQUIRES_CHARGE', 'a refund cannot itself be refunded');
select throws_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'initial-charge'),
  'fixture-refund-too-much', 701, 'KRW', now(), '75000000-0000-4000-8000-000000000007')$$,
  '23514', 'REFUND_EXCEEDS_CHARGE', 'sum of partial refunds cannot exceed charge');
select lives_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'initial-charge'),
  'fixture-refund-two', 700, 'KRW', now(), '75000000-0000-4000-8000-000000000007')$$,
  'remaining refundable amount can be recorded exactly');
select is((select sum(amount_krw) from public.payment_events where id = (select id from billing_test_context where key = 'initial-charge')
  or original_event_id = (select id from billing_test_context where key = 'initial-charge')),
  0::bigint, 'fully refunded charge nets exactly zero integer KRW');
select throws_ok($$select public.billing_record_refund((select id from billing_test_context where key = 'initial-charge'),
  'fixture-refund-after-full', 1, 'KRW', now(), '75000000-0000-4000-8000-000000000007')$$,
  '23514', 'REFUND_EXCEEDS_CHARGE', 'fully refunded charge cannot be refunded again');
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'active', 'recording old money refund does not invent current entitlement revocation policy');

-- Per-artist intro entitlement and maximum retries use separate obligations.
insert into billing_test_context(key, id) values ('retry-sub', public.billing_open_subscription(
  '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'toss'));
select is((select intro_redeemed_at from public.subscriptions where id = (select id from billing_test_context where key = 'retry-sub')),
  null::timestamptz, 'another artist has its own unredeemed intro entitlement');
select lives_ok($$select public.billing_register_mandate((select id from billing_test_context where key = 'retry-sub'),
  'test', 'fictional-toss-merchant', '73000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000003', 'fixture-consent-v1')$$, 'second artist has an independent mandate');
insert into billing_test_context(key, id) values ('retry-obligation', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'retry-sub'), now(), now() + interval '30 days',
  1000, true, 'fixture-price-v1', 259200, 86400, 1));
insert into billing_test_context(key, id) values ('retry-attempt-one', public.billing_prepare_attempt((select id from billing_test_context where key = 'retry-obligation')));
insert into billing_test_context(key, data) values ('retry-claim-one', public.billing_claim_attempt((select id from billing_test_context where key = 'retry-attempt-one'), 120));
select lives_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'retry-attempt-one'),
  (select (data ->> 'lease_token')::uuid from billing_test_context where key = 'retry-claim-one'), 'failed',
  '75000000-0000-4000-8000-000000000008')$$, 'initial definitive failure is separate from money');
select is((select intro_redeemed_at from public.subscriptions where id = (select id from billing_test_context where key = 'retry-sub')),
  null::timestamptz, 'failed first payment does not consume intro redemption');
reset role;
update private.billing_obligations set next_attempt_at = now() where id = (select id from billing_test_context where key = 'retry-obligation');
set local role service_role;
insert into billing_test_context(key, id) values ('retry-attempt-two', public.billing_prepare_attempt((select id from billing_test_context where key = 'retry-obligation')));
insert into billing_test_context(key, data) values ('retry-claim-two', public.billing_claim_attempt((select id from billing_test_context where key = 'retry-attempt-two'), 120));
select lives_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'retry-attempt-two'),
  (select (data ->> 'lease_token')::uuid from billing_test_context where key = 'retry-claim-two'), 'failed',
  '75000000-0000-4000-8000-000000000009')$$, 'one allowed retry can finish definitively failed');
reset role;
update private.billing_obligations set next_attempt_at = now() where id = (select id from billing_test_context where key = 'retry-obligation');
set local role service_role;
select throws_ok($$select public.billing_prepare_attempt((select id from billing_test_context where key = 'retry-obligation'))$$,
  '55000', 'RETRY_NOT_DUE_OR_EXHAUSTED', 'max_retries excludes initial attempt and prevents an extra retry');
select is((select count(*) from private.payment_attempts where obligation_id = (select id from billing_test_context where key = 'retry-obligation')),
  2::bigint, 'exhausted retries persist exactly initial plus configured retries');
select is((select count(*) from public.payment_events where subscription_id = (select id from billing_test_context where key = 'retry-sub')),
  0::bigint, 'all failed attempts still total zero money events');
select lives_ok($$select public.cancel_subscription((select id from billing_test_context where key = 'retry-sub'))$$,
  'exhausted pending subscription can be canceled');
select is((select state from private.billing_obligations where id = (select id from billing_test_context where key = 'retry-obligation')),
  'void', 'cancel voids definitively failed unpaid obligation');
select is((select is_active from private.payment_mandates where id = (select id from billing_test_context where key = 'resubscribe-mandate')),
  true, 'canceling artist two does not revoke artist one mandate');

-- Lease expiry never authorizes replay, including pending first Kakao charges.
insert into billing_test_context(key, id) values ('lease-sub', public.billing_open_subscription(
  '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000003', 'kakaopay'));
select lives_ok($$select public.billing_register_mandate((select id from billing_test_context where key = 'lease-sub'),
  'test', 'fictional-kakao-merchant', '73000000-0000-4000-8000-000000000004',
  '74000000-0000-4000-8000-000000000004', 'fixture-consent-v1')$$, 'Kakao uses independent opaque secure reference');
insert into billing_test_context(key, id) values ('lease-obligation', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'lease-sub'), now(), now() + interval '30 days',
  1000, true, 'fixture-price-v1', 259200, 86400, 3));
insert into billing_test_context(key, id) values ('lease-attempt', public.billing_prepare_attempt((select id from billing_test_context where key = 'lease-obligation')));
insert into billing_test_context(key, data) values ('lease-claim', public.billing_claim_attempt((select id from billing_test_context where key = 'lease-attempt'), 120));
reset role;
update private.payment_attempts set lease_expires_at = now() where id = (select id from billing_test_context where key = 'lease-attempt');
set local role service_role;
select is(public.billing_claim_attempt((select id from billing_test_context where key = 'lease-attempt'), 120), null::jsonb,
  'expired lease cannot be reacquired by another worker');
select is((select state::text from private.payment_attempts where id = (select id from billing_test_context where key = 'lease-attempt')),
  'unknown', 'expired lease is durably marked unknown, not failed');
select is(public.billing_prepare_attempt((select id from billing_test_context where key = 'lease-obligation')),
  (select id from billing_test_context where key = 'lease-attempt'), 'expired lease retains original order ID for reconciliation');
select lives_ok($$select public.cancel_subscription((select id from billing_test_context where key = 'lease-sub'))$$,
  'cancel stops future charging even when first approval is unknown');
select throws_ok($$select public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000003', 'toss')$$,
  '55000', 'BILLING_UNRESOLVED', 'unknown first charge blocks cross-provider fallback');
select lives_ok($$select public.billing_expire_subscription((select id from billing_test_context where key = 'lease-sub'))$$,
  'unpaid canceled first subscription may expire while uncertainty is retained');
select is((select state from private.billing_obligations where id = (select id from billing_test_context where key = 'lease-obligation')),
  'open', 'expiry does not discard uncertain financial obligation');
select lives_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'lease-attempt'),
  null, 'failed', '75000000-0000-4000-8000-000000000010')$$,
  'verified reconciliation can resolve unknown as definitively failed without old lease');
select is((select state from private.billing_obligations where id = (select id from billing_test_context where key = 'lease-obligation')),
  'void', 'resolved failed canceled obligation closes without money');
select is(public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000003', 'toss'), (select id from billing_test_context where key = 'lease-sub'),
  'only after definitive reconciliation may a new provider episode start');
select is((select intro_redeemed_at from public.subscriptions where id = (select id from billing_test_context where key = 'lease-sub')),
  null::timestamptz, 'unapproved unknown-then-failed episode retains intro eligibility');

-- An unclaimed operation may be voided safely; a created ID is not dispatch permission.
select is(public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002', 'toss'), (select id from billing_test_context where key = 'retry-sub'),
  'definitively failed canceled initial subscription can start again');
select lives_ok($$select public.billing_register_mandate((select id from billing_test_context where key = 'retry-sub'),
  'test', 'fictional-toss-merchant', '73000000-0000-4000-8000-000000000005',
  '74000000-0000-4000-8000-000000000005', 'fixture-consent-v2')$$, 'restart requires fresh local mandate');
insert into billing_test_context(key, id) values ('unclaimed-obligation', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'retry-sub'), now() - interval '1 second', now() + interval '30 days',
  1000, true, 'fixture-price-v1', 259200, 86400, 1));
insert into billing_test_context(key, id) values ('unclaimed-attempt', public.billing_prepare_attempt(
  (select id from billing_test_context where key = 'unclaimed-obligation')));
select lives_ok($$select public.cancel_subscription((select id from billing_test_context where key = 'retry-sub'))$$,
  'cancel wins before first dispatch claim');
select is((select state from private.billing_obligations where id = (select id from billing_test_context where key = 'unclaimed-obligation')),
  'void', 'cancel voids never-dispatched obligation');
select is(public.billing_claim_attempt((select id from billing_test_context where key = 'unclaimed-attempt'), 120),
  null::jsonb, 'created attempt cannot claim after cancellation');
select is((select count(*) from public.payment_events where subscription_id = (select id from billing_test_context where key = 'retry-sub')),
  0::bigint, 'cancel-before-claim creates no money or refund event');

-- Simulate a scheduler arriving after grace has elapsed. Uncertainty survives
-- expiry and prevents a newer episode; later verified recovery remains atomic.
reset role;
update public.subscriptions set current_period_start = now() - interval '1 day',
  current_period_end = now() - interval '1 hour', next_billing_at = now() - interval '1 hour'
  where id = (select id from billing_test_context where key = 'main');
set local role service_role;
insert into billing_test_context(key, id) values ('expired-grace-obligation', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'main'), now() - interval '1 hour', now() + interval '29 days',
  6500, false, 'fixture-price-v2', 1, 86400, 3));
insert into billing_test_context(key, id) values ('expired-grace-attempt', public.billing_prepare_attempt(
  (select id from billing_test_context where key = 'expired-grace-obligation')));
insert into billing_test_context(key, data) values ('expired-grace-claim', public.billing_claim_attempt(
  (select id from billing_test_context where key = 'expired-grace-attempt'), 120));
select lives_ok($$select public.billing_record_attempt_outcome((select id from billing_test_context where key = 'expired-grace-attempt'),
  (select (data ->> 'lease_token')::uuid from billing_test_context where key = 'expired-grace-claim'), 'unknown', null)$$,
  'delayed unknown response retains overdue grace boundary');
reset role;
set local role authenticated;
select is(public.has_active_access('72000000-0000-4000-8000-000000000001'), false,
  'overdue grace has no access even before expiry worker runs');
reset role;
set local role service_role;
select lives_ok($$select public.billing_expire_subscription((select id from billing_test_context where key = 'main'))$$,
  'expiry worker processes overdue grace');
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'expired', 'grace expiry is persisted');
select is((select state from private.billing_obligations where id = (select id from billing_test_context where key = 'expired-grace-obligation')),
  'open', 'grace expiry cannot discard an unknown charge');
select throws_ok($$select public.billing_open_subscription('71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', 'toss')$$,
  '55000', 'BILLING_UNRESOLVED', 'expired unknown period cannot be superseded by a new episode');
select is((select count(*) from public.payment_events where subscription_id = (select id from billing_test_context where key = 'main')),
  5::bigint, 'unknown overdue grace still recognizes no revenue');
select throws_ok($$select public.billing_finalize_charge((select id from billing_test_context where key = 'expired-grace-attempt'),
  'fixture-new-episode-action', 6500, 'KRW', now(), '75000000-0000-4000-8000-000000000011')$$,
  '23505', null, 'same provider action cannot settle a different obligation');
select is((select count(*) from public.payment_events where subscription_id = (select id from billing_test_context where key = 'main')),
  5::bigint, 'provider identity collision rolls back inserted money event atomically');
select is((select state::text from private.payment_attempts where id = (select id from billing_test_context where key = 'expired-grace-attempt')),
  'unknown', 'failed finalization leaves attempt recoverable');
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'expired', 'failed finalization cannot accidentally extend entitlement');
insert into billing_test_context(key, id) values ('expired-grace-charge', public.billing_finalize_charge(
  (select id from billing_test_context where key = 'expired-grace-attempt'), 'fixture-recovered-expired-action', 6500, 'KRW', now(),
  '75000000-0000-4000-8000-000000000011'));
select is((select status::text from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  'active', 'verified recovered payment restores still-valid paid access after grace expiry');
select is((select episode_started_at from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now(), 'recovered renewal retains original episode history');
select is((select current_period_end from public.subscriptions where id = (select id from billing_test_context where key = 'main')),
  now() + interval '29 days', 'recovery extends only the originally obligated period');

-- Future renewal obligations may be prepared, but cannot dispatch before due.
insert into billing_test_context(key, id) values ('future-obligation', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'main'), now() + interval '29 days', now() + interval '59 days',
  6500, false, 'fixture-price-v2', 259200, 86400, 3));
select throws_ok($$select public.billing_prepare_attempt((select id from billing_test_context where key = 'future-obligation'))$$,
  '55000', 'RETRY_NOT_DUE_OR_EXHAUSTED', 'future obligation cannot create a dispatchable attempt');
reset role;
-- Owner-only fixture stages a previously created attempt, then moves due time.
update private.billing_obligations set next_attempt_at = now() where id = (select id from billing_test_context where key = 'future-obligation');
set local role service_role;
insert into billing_test_context(key, id) values ('future-attempt', public.billing_prepare_attempt(
  (select id from billing_test_context where key = 'future-obligation')));
reset role;
update private.billing_obligations set next_attempt_at = now() + interval '29 days' where id = (select id from billing_test_context where key = 'future-obligation');
set local role service_role;
select is(public.billing_claim_attempt((select id from billing_test_context where key = 'future-attempt'), 120), null::jsonb,
  'claim independently rechecks due time before granting dispatch');
select lives_ok($$select public.cancel_subscription((select id from billing_test_context where key = 'main'))$$,
  'cancellation also voids an unstarted future renewal');
select is((select state from private.billing_obligations where id = (select id from billing_test_context where key = 'future-obligation')),
  'void', 'prepared future renewal is no longer billable after cancellation');
select is((select state::text from private.payment_attempts where id = (select id from billing_test_context where key = 'future-attempt')),
  'created', 'future canceled attempt was never dispatched');

-- INT_MAX is structurally valid input; max_retries + initial must not overflow.
select lives_ok($$select public.billing_register_mandate((select id from billing_test_context where key = 'lease-sub'),
  'test', 'fictional-toss-merchant', '73000000-0000-4000-8000-000000000006',
  '74000000-0000-4000-8000-000000000006', 'fixture-consent-v2')$$, 'resolved pending episode can register replacement mandate');
insert into billing_test_context(key, id) values ('intmax-obligation', public.billing_prepare_obligation(
  (select id from billing_test_context where key = 'lease-sub'), now() - interval '2 seconds', now() + interval '30 days',
  1000, true, 'fixture-price-v1', 259200, 86400, 2147483647));
select lives_ok($$select public.billing_prepare_attempt((select id from billing_test_context where key = 'intmax-obligation'))$$,
  'valid INT_MAX retry snapshot does not overflow initial-attempt arithmetic');
select is((select count(*) from private.payment_attempts where obligation_id = (select id from billing_test_context where key = 'intmax-obligation')),
  1::bigint, 'INT_MAX snapshot still prepares only one stable attempt');

reset role;
select * from finish();
rollback;

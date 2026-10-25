-- Fictional retained billing rows in disposable pre-00029 schema only.
insert into auth.users(id,email,raw_user_meta_data) values
 ('af700000-0000-4000-8000-000000000001','subscription-upgrade-admin@example.invalid','{}'),
 ('af700000-0000-4000-8000-000000000002','subscription-upgrade-fan@example.invalid','{}');
update public.profiles set role='admin' where id='af700000-0000-4000-8000-000000000001';
insert into public.artists(id,slug,name,grade,status) values
 ('af700000-0000-4000-8000-000000000003','subscription-upgrade-one','Fictional retained subscription','B','active'),
 ('af700000-0000-4000-8000-000000000004','subscription-upgrade-two','Fictional missing history','B','paused');
insert into public.subscriptions(id,user_id,artist_id,provider,status,current_period_start,current_period_end,canceled_at)
values('af700000-0000-4000-8000-000000000005','af700000-0000-4000-8000-000000000002','af700000-0000-4000-8000-000000000003','toss','canceled','2019-12-20','2020-01-20','2020-01-10'),
 ('af700000-0000-4000-8000-000000000006','af700000-0000-4000-8000-000000000002','af700000-0000-4000-8000-000000000004','toss','pending',null,null,null);
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at,recorded_at)
values('af700000-0000-4000-8000-000000000007','af700000-0000-4000-8000-000000000005','charge',1000,'toss','2019-12-20','2020-01-20','2019-12-20','2019-12-20');
insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
values('af700000-0000-4000-8000-000000000007','toss','test','fictional-upgrade-merchant','fictional-upgrade-action','af700000-0000-4000-8000-000000000008');
-- A cancellation cleared before migration is irretrievable and not fabricated.
update public.subscriptions set status='canceled',canceled_at='2020-01-11' where id='af700000-0000-4000-8000-000000000006';
update public.subscriptions set status='pending',canceled_at=null where id='af700000-0000-4000-8000-000000000006';

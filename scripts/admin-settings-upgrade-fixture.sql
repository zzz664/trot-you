-- CI-only fictional pre-upgrade rows. This is never an operational seed.
insert into private.message_policy values(true,'fictional-upgrade-message',172800,120,900,80,8,160,55,4,10485760,20971520,104857600);
insert into private.community_policy values(true,'fictional-upgrade-community',80,900,90,90,2,10485760,1500,4,70,9,4,
 array['fictional-private-term'],array['fictional-private-pattern']);
insert into private.checkout_policies(version,title,body,regular_price_krw,intro_price_krw,approved_at,published_at,billing_period_calendar,payment_tax_basis)
 values('ae900000-0000-4000-8000-000000000001','Fictional upgrade policy','Synthetic only; never operational terms.',7100,1100,
 '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','seoul_monthly_clamped','taxable_krw');
insert into private.checkout_policy_current values(true,'ae900000-0000-4000-8000-000000000001');
insert into private.renewal_policies values('ae900000-0000-4000-8000-000000000001',172800,86400,2,true,86400,
 '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
insert into private.billing_notice_policies values('ae900000-0000-4000-8000-000000000001',2,10,true,
 '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

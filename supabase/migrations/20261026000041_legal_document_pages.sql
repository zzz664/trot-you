-- Read-only public legal navigation. No legal copy, activation or acceptance is
-- created here. "Current" means the configured pointer, never publication order.
begin;

create view public.current_onboarding_policy_documents with (security_barrier=true) as
  select document.version,document.kind,document.title,document.body,
    document.approved_at,document.published_at
  from private.profile_onboarding_policy policy
  cross join lateral (values
    ('terms'::text,policy.terms_version),
    ('privacy'::text,policy.privacy_version)
  ) current_document(kind,version)
  join public.onboarding_policy_documents document
    on document.version=current_document.version and document.kind=current_document.kind
  where policy.singleton;

comment on view public.current_onboarding_policy_documents is
  'Only current terms/privacy pointers joined to approved, published immutable public documents. Missing, wrong-kind or unreadable pointers yield no row; no draft IDs or private onboarding/account state is exposed.';
revoke all on public.current_onboarding_policy_documents from public,anon,authenticated,service_role;
grant select on public.current_onboarding_policy_documents to anon,authenticated,service_role;

commit;

# Artist administration and first-admin setup

## Configuration-ready boundary

This feature manages artist profile text, public discovery order, status, preview
selection and account membership. It does not create Auth accounts, send email,
issue credentials or tokens, grant a merchant permission, charge/refund money,
change approved billing policy, or approve an artist contract. A successful build
or fictional isolated CI scenario is not evidence of a configured live service.

Artist account onboarding is deliberately **disabled until an operator records an
explicitly approved method**. The original planning material did not resolve the
identity verification, invitation delivery or account-recovery procedure. The
implemented method offers access to an exact, already authenticated user's UUID
and requires that same user to accept it. It does not guess an account from an
email address or create one automatically. Email/phone verification is checked
against Auth's verified identity fields, never editable profile metadata.

Before enablement, the owner must separately approve the artist/manager identity
checking procedure, appropriate recipient and issuer permissions, invitation
lifetime, access-removal procedure and recovery support. A verified email or phone
proves control of that identity, not a real-world artist's authority or contract.
The administrator must verify that authority outside this UI and check the exact
recipient UUID with the person before offering access.

## First administrator: explicit operator step only

No administrator is seeded and no application route can run the bootstrap tool.
`scripts/admin-bootstrap.sql` only defines a temporary, session-local helper. It
performs **no role grant when loaded** and is not part of migrations, seeds,
builds, application startup or deployment hooks. Do not add it to those paths.

Using the helper against any persistent environment is a separate privileged
operation requiring the owner's explicit authorization for the named environment
and exact existing account. Development authorization is not that approval.
Obtain the approval reference and verify the target through an independent,
authorized channel before opening a privileged database session.

An authorized operator would:

1. Confirm the database/project identity and obtain the exact existing Auth user
   UUID. The account must have completed ordinary onboarding, have the `fan` role,
   be unrestricted, unbanned and undeleted, and have the exact verified Auth email
   or phone. No Auth account is created by this tool.
2. Use a short-lived, properly secured `postgres` database session. Do not expose
   the connection string or credentials in shell history, screenshots, issue
   descriptions or this repository. The helper rejects application roles and
   invocations after `SET ROLE` to an application role.
3. Load `scripts/admin-bootstrap.sql` in that session. Review the function before
   proceeding. The helper is `SECURITY INVOKER`, not a persistent elevated RPC.
4. Begin a transaction and invoke
   `pg_temp.bootstrap_initial_admin(user_uuid, identity_kind, exact_verified_identity, confirmation, approval_reference)`
   with manually reviewed values. `identity_kind` is `email` or `phone`.
   `confirmation` must be the exact text `CONFIRM INITIAL ADMIN ` followed by the
   canonical UUID. Use approved secure client parameter handling; the contact
   value is PII even though it is not stored in the audit row.
5. Inspect the returned UUID, the single intended profile role and the new
   `private.admin_bootstrap_audit` entry. If anything differs, **ROLLBACK**. Only
   after checking the target and the approval again, explicitly **COMMIT**.
   Close the session immediately. An open transaction holds profile-write locks;
   do not leave it unattended.
6. Verify that the intended person signs in normally and can reach `/admin`.
   Check an unrelated account still cannot access administrator functionality.
   Record outcome in the organization's approved operator log, not public source.

The helper serializes competing calls and other profile writes. It fails if any
administrator already exists, including a restricted administrator, or if the
one-time bootstrap audit has ever been recorded. A repeated call does not grant
another role. It does not demote or replace an existing administrator. Recovery
when the first administrator is lost requires a separately approved recovery
procedure; deleting the audit row to reuse this helper is not such a procedure.
Audit records exclude the contact value and contain the target UUID, approval
reference and execution timestamp. Keep approval references free of credentials
or unnecessary personal data. Database owners remain highly privileged; this
code is not a defense against a malicious database owner.

## Enable the approved account-link method

Only after separate approval, a privileged operator can provision the single
`private.artist_account_link_policy` record with:

- `singleton = true`;
- `enabled = true`;
- the actual `approved_at` timestamp;
- a nonempty `decision_reference` pointing to the approved onboarding procedure;
- an explicitly approved `invitation_ttl_hours`, within the validated 1–168-hour
  technical range. The range is not a recommended business policy.

There is deliberately no seeded approval or production-ready default. Do not
copy fictional CI policy references into a persistent environment. Policy setup
is not exposed as an artist edit, and it does not approve billing, contracts or
any external account access. No live policy was provisioned during development.

When the policy is absent or disabled, new offers and acceptances fail closed.
Cancellation and removal remain available so disabling onboarding does not trap
existing access. An administrator selects the artist, enters the exact existing
user UUID, explicitly confirms the access offer, and checks the recorded result.
The person opens `/me/artist-access` while authenticated as that exact user and
explicitly accepts or declines. There is no email-delivery claim, bearer token or
shareable acceptance link; do not treat an offer's database identity as a secret.
Offers expire and can be canceled. Replays do not create duplicate memberships.

The current administrator and recipient roles, restriction state, artist state,
invitation state and revision are rechecked transactionally. Stale page revisions
produce a conflict rather than overwrite another operator's work. Refresh and
review the latest state before making a new decision after a conflict. On an
uncertain network result, refresh first; do not assume the operation failed and
blindly repeat it with a fresh identity.

## Profile, preview and deactivation boundaries

Profile editing covers name, slug, introduction, grade, agency, contract dates,
status and display order. Contract dates and grade are metadata, not an approved
contract or permission to change settlement/billing policy. No final contract
text or licensed publicity asset is supplied by this feature.

New profile-image uploads are not exposed: public portrait publication needs a
separately approved asset/licensing and public-storage ownership workflow.
Existing profile-image values are retained. Arbitrary URL/path input is not an
acceptable substitute for that workflow.

Preview selection uses sent messages of the selected artist and already accepted
media. It cannot publish draft/canceled messages or arbitrary storage paths.
Existing media read authorization and short-lived protected media URLs still
apply. Operators must separately have rights to publish the selected content.

Use pause/retire rather than hard deletion. Artist deactivation removes active
public discovery and prevents new work allowed only for active artists, but
retains subscriptions, immutable payment events, messages, settlement history
and audit evidence. It is **not** a customer-subscription cancellation, refund,
merchant revocation or a declaration that previously paid access can be removed
without consequence. Review any affected customer obligations through the
separate approved billing/support process. This UI never edits an artist price
or bypasses an immutable approved payment policy.

## Verification record

Repository tests include isolated fictional account/artist lifecycle checks.
The temporary bootstrap helper is exercised only by rollback-scoped CI database
fixtures. No real invite, email, account, credential, role grant, operator-policy
record or deployment is authorized by those tests. Confirm the exact commit's
CI results before treating the code path as verified; staging setup and live
operator execution remain separate evidence.

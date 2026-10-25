# Administrative operational settings

## Scope and authority

`/admin/settings` manages existing numeric message/community policy snapshots and
chat page size. It does not create an account, grant a role, activate a provider,
change credentials, install a scheduler, approve legal text, or change historical
money. Saving a numeric operational change is not approval of a commercial,
legal, moderation, consent, points, or artist contract policy.

There is no legacy `app_settings` or `system_settings` key/value table. The
37 keys in `src/config/settings.ts` describe a **documented draft**, not live
settings or approved fallbacks. The editor reads the actual private policy
consumed by the application. `src/config/admin-settings-catalog.ts` accounts for
each documented key exactly once and directs other operational families to their
specific workflow below. Wildcard families are coverage labels, not permission
to read or write arbitrary matching keys.

Only a currently authorized administrator may read or save the editor. A save
rechecks current authorization, validates the complete numeric group, compares
the version reviewed by the administrator, and records a sanitized immutable
before/after audit with actor UUID and database timestamp. The editor cannot
choose the actor, approval time, or audit content; its expected revision must
match the current stored revision.
Concurrent changes must produce a conflict, not last-writer-wins overwrite.

Review the displayed units and impact before confirming. Cancel leaves persisted
state unchanged; reset reloads the reviewed values rather than documented draft
defaults. On a stale-version conflict, reload, compare the new state and review
again. On an uncertain network outcome, refresh first and inspect current
revision/audit evidence before retrying. A successful response means the settings
transaction committed, not that a provider delivered anything.

### Initial setup and privileged changes

An absent message or community policy remains unconfigured. The editor does not
fill missing fields from draft defaults or manufacture approval. The following
operator procedure is separate from ordinary editor use:

1. Obtain owner authorization for the **named environment**, policy domain and
   exact reviewed inputs. The implementation task is not this authorization.
2. Collect the complete required fields in the relevant section below, including
   every unresolved approval and explicit empty-list decision where allowed.
   Do not copy CI fixture policies, synthetic legal text, or source draft prices.
3. Have an authorized operator review a narrowly scoped change in a secured,
   short-lived database session. No raw SQL execution interface is exposed by the
   settings page. Keep connection strings and credentials outside source, logs,
   screenshots and browser forms.
4. Begin a transaction; lock the relevant policy/pointer rows and preserve the
   application lock order. Compare the exact reviewed current version. Make only
   the separately authorized initial provisioning or new-version/pointer change.
   Never disable an immutability trigger to amend an approved version.
5. Before commit, verify the full stored policy, affected pointers, version,
   currentness rules and intended consumer behavior. Keep an approval reference
   and sanitized before/after evidence in the organization's protected operator
   record. If any input, scope, or verification differs, **ROLLBACK**.
6. Commit only the reviewed change, close the privileged session, and verify via
   the normal authorized application path. If an already committed change is
   wrong, prepare a newly reviewed corrective version; do not delete audit or
   financial history. A rollback plan must account for consumers that may
   already have snapshotted the committed policy.

No privileged setup described here was performed during feature development.

## message-policy

**Editor:** existing `private.message_policy` numeric fields. New snapshots retain
the nonnumeric configuration and a traceable version; no missing policy is
activated. The mappings are:

| Documented setting                         | Actual field and units                                         |
| ------------------------------------------ | -------------------------------------------------------------- |
| `message.max_text_length`                  | `max_text_length`, Unicode characters                          |
| `message.max_photos`                       | `max_photos`, count                                            |
| `message.max_voice_seconds`                | `max_voice_seconds`, seconds                                   |
| `message.max_video_seconds`                | `max_video_seconds`, seconds                                   |
| `message.cancel_window_minutes`            | `cancel_window_seconds`, seconds                               |
| `message.visible_before_subscription_days` | `history_before_seconds`, seconds                              |
| `message.preview_max_count`                | `preview_max_count`, count                                     |
| `reply.max_length`                         | `max_reply_length`, Unicode characters                         |
| `media.*` message byte limits              | `max_photo_bytes`, `max_voice_bytes`, `max_video_bytes`, bytes |

The stored seconds are shown explicitly rather than rounding a nonintegral
number of days or minutes. All limits use the actual database bounds, not the
much wider draft registry integer bounds. They affect future validation and
current access checks, not a rewrite of historical message content. History and
cancellation windows have access consequences; review them explicitly.

A lower preview maximum must not silently truncate an existing selected set.
Reduce the selected previews through artist management first when the proposed
maximum is below the existing selection. Existing selections and a simultaneous
selection change must be validated under the database's concurrency contract.

Initial provisioning needs the version and **every field above**, with an
explicitly approved history/cancel policy and media limits. The message policy
is consumed by chat, replies, composition, dispatch, discovery, preview management
and authorized media operations. The `media.*` family also includes the community
image byte cap in [community-policy](#community-policy). It does **not** include
upload/signing URLs, bucket grants, MIME allowlists, parser ceilings, or signing
TTL security configuration; those remain reviewed code/security configuration.

## community-policy

**Editor:** existing `private.community_policy` numeric fields:
`max_title_length`, `max_body_length`, `max_comment_length`, `max_reason_length`,
`max_images`, `max_image_bytes`, `max_image_long_edge`, `auto_hide_report_count`,
`rate_window_seconds`, `max_contributions_per_window`,
`max_reports_per_window`. `board.max_images`, `board.image_max_long_edge_px`, and
`board.auto_hide_report_count` map to the corresponding fields; `media.*` includes
`max_image_bytes`. The contribution and report rates are separate counters.

The editor preserves `forbidden_terms` and `forbidden_patterns` verbatim and
cannot approve their semantics. Initial provisioning requires all numeric fields,
`version`, and both reviewed moderation arrays, including explicit approval of
any allowed empty array. Community policy is enforced by the existing database
creation/edit/report/image-registration operations. This feature does not claim
the later community UI or image uploader is complete. A threshold change does
not retroactively rerun every historical report or rewrite stored rewards.

## display-policy

**Editor:** `message.page_size` controls the default page size used by chat when
no explicit bounded limit was supplied. Its validated range is 1–100. The
compatibility value 30 preserves the preexisting display behavior; it is not
approval of a billing, access, moderation or notification policy. A valid
explicit caller page limit retains the existing API contract. No private chat
response is added to a shared cache.

## checkout-policy

**Runbook:** `subscription.price_krw` and `subscription.intro_price_krw` map to
`private.checkout_policies.regular_price_krw` and `intro_price_krw`. Required owner
inputs are a new UUID `version`, exact prices, final `title`/`body`, approved
`billing_period_calendar`, `payment_tax_basis`, and actual approval/publication
instants. Supported calendars and tax basis are structural capabilities, not
recommendations or legal advice. A structurally accepted zero introductory price
is not a supported zero-value provider charge; enrollment currently requires a
positive initial charge, so do not advertise free enrollment through this path.

An approved row cannot be updated/deleted. Prepare a new unapproved version and
validate the complete contract; approval and publication must be recorded
without trying to edit a previously approved row. After owner review, the
operator transaction may point `private.checkout_policy_current.policy_version`
to that exact approved/published version. Review the renewal and notice version
links **before** changing the pointer. Existing subscriptions retain accepted
price snapshots; a new current pointer does not silently reprice them and can
block renewal/current-access prerequisites until an explicitly designed consent
transition is complete. This editor provides no migration of subscribers or
retroactive consent. See [checkout contract](../database/checkout-sessions.md).

## renewal-policy

**Runbook:** `subscription.grace_days`, `subscription.retry_interval_hours`, and
`subscription.retry_max` map to `private.renewal_policies.grace_seconds`,
`retry_seconds`, and `max_retries`. The operator supplies exact durations and
retry count, `notice_required`, `notice_lead_seconds`, and real approval and
publication instants tied to **one** `checkout_policy_version`.

Approved renewal rows are immutable and keyed by checkout version. A revision
requires a deliberately reviewed new checkout/renewal version pair and a current
pointer/consent plan, not an UPDATE to accepted history. `notice_required=false`
is an explicit approved waiver, never a fallback for missing infrastructure;
the database requires zero lead seconds with that waiver. Existing obligations
snapshot retry/grace inputs. Do not rewrite payment attempts, periods, receipts,
or obligation amounts when revising policy. No worker or Cron is enabled here.
See [renewal contract](../configuration/subscription-renewal.md).

## billing-notice-policy

**Runbook:** `subscription.billing_notice_days_before` maps to
`private.billing_notice_policies.days_before`, keyed to the exact approved
checkout/renewal pair. Owner inputs also include `hour_kst`, `mandatory_inapp`,
and real approval/publication instants. Days are Seoul calendar days, not an
assumed 24-hour duration. The computed time must satisfy renewal's minimum lead
for the actual billing instant. A late inbox item does not satisfy it.

An approved notice row is immutable; a changed notice policy follows the new
checkout/renewal version choreography. Existing notices keep period and amount
snapshots. Mandatory in-app status is an approved product choice, not an inferred
legal requirement and not permission for Web Push. Creating/reading an inbox
item or provider acceptance does not create `renewal_notice_receipts` delivery
evidence. See [notice contract](../database/billing-notices.md).

## refund-policy

**Runbook:** the actual runtime domain is `private.refund_policies`, not a generic
price setting. Required owner inputs are a new UUID, final title/body, reviewed
`access_effect` and `payment_tax_basis`, and real approval/publication instants.
The current implementation supports `preserve_paid_access` and `taxable_krw`
only. Do not invent a refund period or eligibility rule from source examples.

Create a new approved/published immutable version and change
`private.refund_policy_current.version` only within a separately approved
transaction. Existing approved rows and refund decisions remain unchanged.
Policy publication is **not** approval of a refund request; a case still needs
explicit administrator review through the refund workflow, and approval is not
provider success. No payment event or paid-access period is changed by this
runbook. See [cancellation/refund contract](../database/subscription-cancellation.md).

## settlement-policy

**Runbook:** `artist.weekly_message_min`, `artist.weekly_photo_min`, and all five
`settlement.*` registry keys map to the corresponding fields of
`private.settlement_policies`, scoped to an exact artist and month. Additional
required inputs are the contract interval, `enabled`, `activity_enabled`,
`partial_week_policy`, `negative_net_policy`, and `late_event_policy`.
`weekly_message_min`/`weekly_photo_min` must be supplied only with explicitly
approved activity requirements. Rates use bounded precise decimals, not floating
point estimates. `performance_conditions` is currently constrained to NULL;
there is no invented or executable performance-rule editor.

This table is not itself an immutable version store: report snapshots and
confirmed reports provide the historical boundary. Accordingly the settings
editor never writes it. A separately authorized operator must review the
artist/month contract and the existing report/source state before provisioning a
new period's policy. Do not overwrite an existing period or confirmed snapshot
under the pretext of a global default change. Revising an existing reporting
period requires the dedicated settlement review workflow; confirmed history
remains immutable. Do not change payment events, calculate a settlement, confirm
a report, or initiate payout through settings. See
[settlement contract](../database/settlement-reports.md).

## profile-policy

**Runbook:** `profile.call_name_min` and `profile.call_name_max` are
`private.profile_onboarding_policy` fields, constrained to 2–10 with min ≤ max.
Owner inputs include a new `name_policy_version`, actual `name_approved_at`, a
reviewed nonempty `profanity_words` list, and exact terms/privacy/optional analytics
version references. Changing limits can invalidate an existing user's current
name/readiness; review that consequence before switching a policy.

The names policy is a mutable current snapshot, not an editable legal document.
Keep a protected versioned before/after operator record. Reference only the
proper kind of approved/published immutable `private.onboarding_documents`
version. Never rewrite `profile_policy_acceptances`, set onboarding completion,
or manufacture user acceptance to accommodate a new policy. See
[onboarding contract](../database/profile-onboarding.md).

## moderation-policy

**Runbook:** `moderation.profanity_words` and `moderation.forbidden_patterns` do
not have one interchangeable global implementation. The operator must identify
and separately approve the consumer scope:

- Names: `profile_onboarding_policy.profanity_words`, nonempty reviewed literals
  with a new name-policy version and approval as above.
- Replies: `reply_policy.version`, `approved_at`, nonempty bounded
  `forbidden_terms`, and `forbidden_patterns` containing only the built-in
  `phone`, `account`, `url` detector identifiers. Arbitrary regex is not accepted.
- Community: `community_policy.forbidden_terms` and `forbidden_patterns`; this
  legacy contract supports regex, requiring separate review and validation of
  syntax/cost before approved provisioning. The numeric editor cannot change it.

Keep version history in the protected operator record and validate the intended
consumer's ordinary accepted/rejected examples in an isolated environment first.
No moderation dataset, allow-all list, or approval is synthesized by the UI.
Literal terms and regex text are not copied into the numeric editor's audit.

## points-policy

**Runbook:** `points.attendance`, `points.post`, and `points.comment` map to
`private.point_policy.attendance_amount`, `post_amount`, and `comment_amount`.
Required approval also covers `version`, `post_daily_cap`, `comment_daily_cap`,
and `deleted_content_treatment`. A NULL daily cap explicitly means no count cap;
it is not interchangeable with zero. Only `retain` deleted-content treatment is
implemented. Missing policy means no automatic reward activation.

The operator must review a complete snapshot and record its versioned history
before an authorized provisioning/change. New awards snapshot the policy; never
rewrite existing `private.point_ledger` rows or silently backfill awards.
`points.share` is **not implemented**: verified-share evidence, eligibility,
deduplication and caps must be designed and approved before a new feature can
consume it. Do not store a pretend active share reward. See
[points contract](../database/points-ledger.md).

## notification-policy

**Runbook:** `notification.retry_max` corresponds to retries **after** the first
attempt. `private.notification_policy.max_attempts` counts the first attempt as
well: an approved retry count maps to `max_attempts = retry count + 1`, within
the actual 1–10 attempt bound. Owner inputs additionally include `version`,
`consent_version`, `webpush_enabled`, `retry_seconds`, `lease_seconds`, and
`schedule_lead_seconds`. Existing jobs snapshot their attempt/retry/lease policy;
changing the current row must not rewrite queued/uncertain job history.

Provision only an explicitly approved snapshot and retain before/after version
evidence. Enabling the policy is distinct from runtime provider/worker flags,
valid VAPID configuration, active user/session/device consent and permissions.
None of those is changed by this UI. A renewal notice waiver is unrelated.

`notification.batch_size` is not a live database setting today. Actual dispatch
uses the reviewed technical `WEBPUSH.batchSize` in `src/config/webpush.ts`
(currently 100), bounded by worker budget, concurrency, recovery and RPC limits.
The draft value 500 is not the running value or approved capacity. A capacity
change requires a scoped code/configuration review and isolated load/lease tests;
it must not be accepted by an inert database control. After authorization, a
later runtime-settings integration may replace that deployment-bound limit.
See [Web Push contract](../database/webpush-delivery.md).

## activity-grades

**Blocked policy/implementation:** `board.grade_thresholds` has a draft shape but
no approved activity-score definition or runtime consumer. Before implementing,
obtain the score sources, aggregation window, abuse/deletion treatment,
thresholds and recalculation semantics. Then implement and test a versioned score
consumer. Entering thresholds into this editor cannot make grades functional;
there is deliberately no save control for an inert value.

## schedule-notice-policy

**Blocked calendar-hour mapping:** `schedule.notice_hour_kst` has no runtime
consumer. Existing notification scheduling uses
`notification_policy.schedule_lead_seconds` relative to each start, which is not
equivalent to “the previous day at a fixed Seoul hour.” An operator must first
approve the fixed-hour versus lead-duration behavior and late/rescheduled event
semantics. A separate implementation must connect that choice to the schedule
outbox and verify KST boundaries before the documented hour can be active. Do
not edit the billing-notice `hour_kst` as a substitute: it is a different domain.

## rate-policy

The documented rate-limit family has no generic `rate.*` store. Community's
`rate_window_seconds`, `max_contributions_per_window`, and
`max_reports_per_window` are real numeric editor fields in an existing approved
community snapshot. Replies use `private.reply_policy.rate_window_seconds` and
`rate_max_count`; a versioned, reviewed reply snapshot must include those values
alongside its approved moderation inputs. Rates count distinct operations under
existing actor locks; no client-only check replaces atomic database enforcement.
The operator runbook preserves current counters and must not delete them to make
a policy change appear effective.

## public-copy-and-legal-policy

The spec names a `public.*` family but does not define authoritative key names,
support contact values, or final legal text. There is no generic public settings
projection. For legally operative text, supply the actual reviewed content and
new UUIDs in `private.onboarding_documents`, `checkout_policies`, or
`refund_policies` as appropriate, following their immutable publication and
pointer steps. Do not publish placeholders or fabricate a support identity.

A support phone/contact or cancellation help copy change requires owner-approved
content and its precise display destination. Existing centralized UI copy is in
`src/messages/ko.json` and changes through normal reviewed development; a later
explicit public-settings projection must restrict itself to defined safe fields
before runtime editing exists. A wildcard route must never expose private
policies, drafts, credentials or arbitrary configuration.

## analytics-policy

`private.analytics_policy` requires an explicitly reviewed `consent_version`,
`enabled`, and `retention_days`. It is a mutable current policy, so record the
versioned operator decision and verify the matching approved analytics document
and consent handling before any separately authorized change. Rotating consent
must not create user consent. Retention is a legal/business decision, not a
recommended technical default; this editor runs no collection or deletion job.
See [analytics contract](../database/analytics-events.md).

## account-link-policy

`private.artist_account_link_policy` requires an explicitly approved onboarding
method, `decision_reference`, `approved_at`, `invitation_ttl_hours`, and deliberate
`enabled` state. It controls new offers/acceptances, not automatic account or role
creation. The admin-settings editor cannot modify it. Follow the separately
authorized [account-link setup procedure](admin-artist-management.md#enable-the-approved-account-link-method).
Do not expose a credential, Auth email/phone, bootstrap action, or role grant as a
settings field.

## Excluded configuration and verification

All environment values and credential material remain outside this catalog's
read/save payloads and audit. This includes Supabase service credentials, payment
secret keys/merchant identifiers/vault material, VAPID values, Cron secrets,
provider URLs, payment mode, provider/worker activation flags, and test-runtime
overrides. Public environment variables are not a reason to add an environment
editor. Technical security ceilings, endpoint allowlists, signing parameters and
RLS/role/bootstrap controls remain reviewed code/operator responsibilities.

Before release, verify existing-policy migration compatibility, exact-key
coverage, group validation, stale CAS, unchanged saves, current administrator
loss/restriction, forbidden direct access, sanitized audit immutability, missing
policy behavior, and concurrent editor/preview/role operations. Use synthetic
isolated policies only. Generated DB types must come from the actual CI database;
local code checks are not claims of a live policy change or provider activation.

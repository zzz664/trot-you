# Analytics observations and unavailable business metrics

## What the dashboard means

The administrator dashboard reports **event observations, not unique people,
conversion rates, cohorts, revenue or approved business funnels**. The thirteen
existing event identifiers and their typed accepted properties remain unchanged.
The four business metrics referenced by the project still lack their original
approved definitions. They are explicitly unavailable. Numerators, denominators,
identity rules, qualifying events, cohort windows and deduplication rules must be
approved before those metrics can be implemented; silence is not approval.

`admin_analytics_dashboard(from, to)` accepts inclusive KST calendar dates, from
2000-01-01 through the current KST day, covering at most 366 days. Internally the
window is `[from midnight, day after to midnight)` in `Asia/Seoul`. Daily rows are
sparse positive event counts; totals always contain exactly the thirteen event
names. All counts are safe JSON integers. No person/source identifiers, names,
contents, properties, secrets, payment-provider payloads or actor dimensions are
returned. `actor_id` is only the requesting administrator's identity, used to
reject stale responses after account replacement.

Counts include only observations that meet **all** of these current conditions:

- The current analytics policy is enabled and its immutable analytics document
  is approved and published, with neither effective timestamp in the future.
- The fan currently grants that policy version, and the event has that version.
- The fan is currently onboarded, still has the fan role, and is not restricted.
- The occurrence is at or after the fan's current grant timestamp. Withdrawal
  followed by a new grant does not resurrect the previous consent epoch.
- The recording is within the current configured retention horizon and at or
  before this read's recorded-time fence. The occurrence is in the selected KST
  window.

Withdrawal, policy rotation, a restriction or role change can therefore lower
these counts. That is deliberate and must not be interpreted as negative new
activity. The underlying accepted rows are **not erased** by this dashboard;
existing bounded retention is separate and no scheduler is enabled here. The
legacy `analytics_daily_counts` API still reports retained historical rows under
its old documented semantics and is not the source for this screen.

Missing, unpublished or future policy documents yield `unconfigured`; an approved
published but disabled policy yields `disabled`. Both return **null** totals and
no daily rows, never fabricated zero activity. An enabled, configured policy with
no eligible observations returns real zero event counts. These are absence of
eligible stored observations, not proof that no product activity occurred.

## Coverage and ingestion

The immutable `instrumentation_from` marker records **migration installation**,
not exact application deployment or collection activation. `history_complete` is
always false. No historical onboarding, purchases, content or attendance is
backfilled, and no unsupported acquisition/anonymous tracking is invented.
Application hooks are prospective and optional analytics cannot change the
result of the underlying business operation. Event receipt keys must remain
stable across retries. Client observations are not proof that a message was read
or speech was used; purchase/renewal events require verified immutable billing
ledger evidence. There is no external analytics SDK or provider transmission.

New service-only `analytics_capture_server` and `analytics_capture_charge`
wrappers require current approved published policy and a source timestamp at or
after the installation marker, as well as the existing current-consent checks.
Replaying an older business receipt is not permission to backfill analytics.
Subscription starts use the persisted enrollment session ID and creation time,
not a reused subscription ID or a retry's wall clock. Cancellation capture derives
the retry key from the current immutable observed cancellation-history epoch.
Blocked replies do not count as delivered replies. Generic server capture cannot
accept client observations or verified charges.

**Font instrumentation remains unavailable.** `font_selected_at` preserves the
first selection but does not prove the occurrence time of the current font value;
pairing those values would fabricate evidence. The new capture wrapper therefore
returns `ANALYTICS_CAPTURE_SOURCE_UNAVAILABLE` for `font_size_selected`. The legacy
typed event schema and accepted RPC remain for compatibility, not as a claim of
complete automatic coverage. No pre-consent or incomplete-onboarding event is
retroactively collected.

The aggregate adds no source triggers and preserves every legacy event, policy,
consent and financial field. Existing public ingestion functions, allowlists and
source validation contracts are unchanged. Actual self-service consent continues
to require the approved published document; this feature grants nobody consent
and seeds no live policy.

## Current authority and concurrency

Only an actual authenticated, currently unrestricted administrator may invoke
the dashboard. A service credential is not an administrator browser identity.
The RPC rejects repeatable-read and serializable transactions rather than serving
stale authority. It holds SHARE locks on the administrator and all profile
rows with observations in the fenced date window together, ordered by UUID, before taking
SHARE locks on the current policy and document. Current eligibility is evaluated
in a fresh READ COMMITTED statement after any wait. This profile → policy →
document order matches consent/ingestion and prevents a committed withdrawal or
restriction from being resurrected after lock waiting. A read that obtained the
locks first finishes before a later withdrawal or policy update can commit.

The date/time fence bounds the event scan. No raw table grants are added. Coverage
metadata is immutable and RLS protected. Private helper execution is revoked from
all application roles, and the public RPC pins an empty search path.

## Remaining approval and verification boundaries

No analytics policy approval, retention-policy change, actual user opt-in,
provider call, role assignment, deployment or Cron activation is part of this
change. All automated test fixtures are fictional. Production funnel fidelity
remains blocked on the four metric definitions and actual approved collection
policy. Local static checks are not database/browser execution; exact hosted
pgTAP, race, populated-upgrade and visual results belong in the dated work log.

## Explicit application producers

The application adopts the stricter prospective wrappers only after successful
source operations. Optional analytics errors/timeouts do not replace those source
results and never cause a provider/business retry.

| Event                         | Current application observation and stable identity                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `signup_complete`             | Successful installation/onboarding completion; verified actor key and persisted completion time                                             |
| `font_size_selected`          | New capture unavailable: current value has no trustworthy occurrence timestamp; no retroactive collection                                   |
| `preview_view`                | Mounted visible preview message, not an HTML/RSC request or prefetch; one key per committed target lifecycle                                |
| `subscribe_start`             | Persisted enrollment start; enrollment session key (not the reused subscription ID)                                                         |
| `subscribe_complete`, `renew` | Successful trusted finalization/reconciliation; immutable verified payment-event key; classification comes from DB evidence                 |
| `subscribe_fail`              | Definitive verified initial-charge failure; private attempt key, never an unverified provider response                                      |
| `message_open`                | Successful visible-message read receipt; same request-bound authenticated capability and message key, not a second cookie-swappable request |
| `reply_sent`                  | Successfully stored unblocked reply; immutable reply key                                                                                    |
| `voice_input_used`            | Existing accepted voice recognition observation; one recognition-session key, no transcript                                                 |
| `cancel`                      | Current observed immutable cancellation-history epoch; repeated subscription IDs do not collapse separate epochs                            |
| `post_create`, `attendance`   | Existing committed creation/attendance hooks retain their stable source/operation keys                                                      |

The generic browser endpoint accepts only `message_open` and `voice_input_used`.
Preview uses a fixed-purpose same-origin endpoint with only the event/source keys
in its body. Its own-actor header must match the newly authenticated session; the
header is an assertion, never authority. Hidden/unmounted/navigated targets abort
and do not retry. No client observation proves human viewing or speech use.

The identity-only administrator page does not serialize aggregate snapshots in
reusable RSC payloads. Private GET responses are no-store and must echo the
current actor and exact requested range. Navigation, actor/range replacement,
pagehide, visibility loss and stale responses cannot restore previous data.
Each successful response validates all thirteen names, unique sparse daily
buckets and exact totals with safe integer arithmetic; the UI pages the daily
rows without inventing a business calculation.

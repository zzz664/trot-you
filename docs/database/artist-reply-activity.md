# Artist received replies and current-week activity

This feature is read-only. It does not create artist-to-fan messages, send a notification, activate a scheduler, mutate operational settings, calculate a settlement, change immutable payments, or infer rankings, subscriber counts, reply rates, read rates, or revenue.

## Public contracts

All public functions return JSON, derive the actor from the real authenticated subject, pin an empty search path, and require an unrestricted, onboarded `artist` profile. Anonymous, fan, admin and service-role calls do not enter artist mode. Private helper execution is revoked from every application role.

| RPC                              | Inputs                                                                                          | Output                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `artist_reply_activity_artists`  | Optional `p_after_slug`                                                                         | `{artists:[{id,slug,name}],has_more}`; at most 50 active assigned artists, ascending strict slug cursor.    |
| `artist_reply_activity_context`  | `p_artist_slug`, optional `p_message_id`, optional paired `p_before_created_at` / `p_before_id` | `{artist,server_now,replies,selected_message,has_more,activity}`; at most 30 visible replies, newest first. |
| `artist_reply_activity_messages` | `p_artist_slug`, optional paired `p_before_sent_at` / `p_before_id`                             | `{artist,messages,has_more}`; at most 30 sent message filter choices, newest first.                         |

`artist` is exactly `{id,slug,name}`. Reply objects are exactly `{id,call_name,body,created_at,message_id}`: `id` identifies the reply, **not the fan**. Fan UUID, subscription UUID, operation UUID, email, phone, nickname, demographics and profile objects are never projected. Calling name is the only joined fan profile field in the response. The message-filter DTO and optional selected message are exactly `{id,kind,sent_at}`; no template body, author ID, private media paths or resource URLs are needed for choosing a reply filter.

Reply and message ordering uses exact timestamp plus UUID descending. Both parts are required together, nonfinite timestamps are rejected, and one extra visible row establishes `has_more`. The application encodes and binds cursors to their artist/filter. The database independently enforces current actor, artist and filter access even if a caller forges a cursor. An index on `(artist_id,message_id,created_at DESC,id DESC)` accelerates the bounded filtered reply query.

## Visibility and retained content

- Artists read replies for their currently assigned active artists, including messages authored by a teammate. This is received-artist content, not permission to edit another author's private draft.
- Blocked replies are absent, including their calling names. The source schema has `is_blocked`, not a separate reply `is_hidden` state; no invented soft-deletion or moderation API is introduced.
- A currently restricted fan, non-fan profile, unonboarded profile or missing calling name excludes the entire reply. An elapsed restriction stops excluding the fan at its exact end boundary. Current calling names are used on a fresh query.
- Expired subscriptions do **not** erase previously received replies. A fan needed valid access to send; subsequent artist reading does not pretend the past accepted reply never existed.
- A canceled, draft, future-dated or foreign-artist message cannot be selected as a filter. When a previously linked message becomes unavailable, the artist-wide feed retains the visible reply but projects `message_id:null`, not a broken content link. General artist-wide replies also have a null message ID.
- Physically deleted reply rows cannot appear. There is no profile/reply soft-delete timestamp in the established schema. Financial/content foreign keys deliberately restrict physical fan deletion; this feature does not remove those protections or invent an account-deletion policy. A missing profile can never join into a response.
- The service-only `messaging_list_replies` ABI is retained, including its existing trusted actor checks, errors and four-column safe result. Its fan visibility is aligned with the new feed so it cannot become a stale restricted-content path. Existing lifecycle fixtures already establish fan onboarding and calling names; no weakening or guessed legacy fallback is required.

The raw replies table stays inaccessible to authenticated clients. No broader profile, subscription, read-receipt, policy or settlement grants are added.

## Current-week source definition

`activity` contains exactly:

```text
week_start, week_end,
message_count, photo_count,
weekly_message_min, weekly_photo_min, requirements_ready
```

The response's `server_now` is captured after potentially waiting authorization and selected-message locks. The week is `[Monday 00:00 Asia/Seoul, next Monday 00:00 Asia/Seoul)`, independent of the database/session timezone. Counts include assigned-artist messages with `status='sent'`, `sent_at` inside that week, and `sent_at <= server_now`. Every sent kind counts as one message. Photos count **photo messages**, not attachments, and are a subset of message count. Draft, scheduled, canceled and future-dated sources are excluded. This is the same source/status/kind basis used by settlement activity, with an explicit current as-of cap; it does not read historical settlement snapshots as if they were live activity.

Minima come only from the existing private, enabled, activity-enabled per-artist monthly settlement policies. No draft `app_settings` value, 3/2 document example, zero, or frontend fallback is treated as an approved contract. For each of the week's seven KST calendar days, its month must have an enabled policy, activity must be enabled, and `[contract_from,contract_until)` must cover the day. All covered monthly policies must specify identical positive message and photo minima. This supports a week crossing two months when both policies agree. Missing, disabled, differing or partial-contract policy yields `requirements_ready=false` and **both minima null**, while factual counts remain readable. It does not invent a prorated weekly target. Financial rates, contract dates, policy IDs, report IDs and payout amounts are never returned.

No settlement is created or modified. Existing report snapshots, exact financial fractions and immutable payment/event behavior are untouched. Live weekly progress is not an estimated payout or a historical report confirmation.

## Concurrency and freshness

The supported transaction isolation is READ COMMITTED. Artist reads take share locks in actor → artist → membership order; a selected message takes its share lock afterward. An artist restriction, role change, artist pause, membership removal or selected-message cancellation that wins first is rechecked after the real lock wait. Earlier authorized reads may finish before a later revocation; already delivered browser text cannot be recalled by SQL.

Fan profiles are **not** locked after acquiring an artist lock: existing fan sends lock fan → artist, so that inversion would risk deadlocks. Reply visibility, calling-name projection and activity use a current query snapshot after authorization gates. A concurrently uncommitted moderation/profile change does not retroactively erase an already authorized response; a subsequent refresh reflects committed changes. The client must clear private content on an access failure and discard stale responses after newer refresh/filter/navigation actions.

The new functions reject repeatable-read/serializable transactions rather than using an old transaction snapshot after waiting. They do not take a financial reporting fence or write source-version rows.

## Verification

- `artist_reply_activity.test.sql`: RPC grants, private-helper boundaries, role/member isolation, calling-name-only projection, omitted hidden/restricted/nonfan/unonboarded content, expired restrictions/subscriptions, tied cursor pagination, independent message selector, stale filter cancellation, physical reply deletion, legacy ABI and no notification/payment/settlement effects.
- `artist_reply_activity_week.test.sql`: exact KST Monday and as-of boundaries; all source kinds/statuses; timezone independence; cross-month consistent policy, missing month, mismatched minima, disabled activity and partial-contract behavior.
- `scripts/test-artist-reply-activity-concurrency.mjs`: independent PostgreSQL sessions, observed `pg_blocking_pids`, actor/member/status/cancel races, rollback, fresh visibility/name/source snapshots, and rejection of stale transaction isolation. Only the disposable CLI-managed local database is accepted; it uses fictional rows and resets afterward. No provider, live user or hosted connection is involved.

Local Docker execution is unavailable in the assigned environment; actual pgTAP, multi-session races and generated schema types must come from the exact-head isolated CI run. JavaScript syntax/lint checks are not substitutes for executing PostgreSQL. Never hand-edit generated database types. Browser verification is also CI-only under the existing environment restriction.

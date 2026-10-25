# Artist replies and current-week activity

## Read-only application surface

- `/artist` links to `/artist/replies`, the cursor-paginated assigned-artist menu.
- `/artist/[slug]/replies` displays the current KST week's source message/photo
  counts and a descending cursor page of received fan replies.
- `?message=<uuid>` limits the feed to one eligible sent message; `cursor` is
  scoped to the artist, filter and reply-page domain. Message options have their
  own cursor endpoint, so older messages remain selectable.
- POST `/api/artist/[slug]/replies` and its `/messages` child are **reads**. They
  use same-origin JSON, current verified sessions, artist-role checks, bounded
  bodies and responses, and private no-store responses. There is no send action.

## Display and privacy

The only fan profile field in the DTO is `callName`. Reply IDs are content IDs,
not fan IDs. The feed does not include fan UUIDs, account names, email, telephone,
subscription identifiers, billing details, report counts, or a fan directory.
The UI renders text as text, never HTML. This is data minimization, not a promise
that freely authored text or a permitted calling name cannot identify a person.

Blocked replies and replies from currently restricted, non-fan, unnamed or
incomplete profiles are omitted. Deleted source rows cannot appear. A canceled
linked artist message is not selectable and its association is cleared in the
unfiltered feed; otherwise-visible reply text remains. Existing financial
retention and deletion restrictions are not changed. Subscription expiry alone
does not retroactively delete an otherwise-visible received reply.

Every screen and request rechecks the assigned artist. The client discards
previous private content before refresh/navigation and after failed revalidation.
Out-of-order responses and aborted requests do not restore stale content. Native
Back/Forward navigation revalidates rather than trusting cached reply bodies.
Already-delivered content cannot be remotely erased from a user's memory or
external recording; no such revocation guarantee is made.

## Activity source and boundaries

The live dashboard counts source rows in `messages`, not telemetry, cached
weekly aggregates, draft settlement snapshots, read receipts or attachments:

- Week: Monday 00:00 Asia/Seoul through the next Monday, end exclusive.
- As-of: database time, visible in the response.
- Message count: this artist's `status='sent'` rows in that week whose `sent_at`
  is no later than as-of time. Draft, scheduled, canceled and future rows do not
  count. All message kinds contribute to total messages.
- Photo count: the same source rows where type is `photo`; one photo message
  counts once regardless of attachment count.

The source inclusion rule matches the established settlement message-source
model, but this dashboard neither calculates nor changes settlement amounts.
Counts can fall if an eligible message is canceled before a later refresh.

Contract comparison appears only when existing enabled, activity-enabled
per-artist monthly policies cover every day of the week and agree on the two
weekly minima. Missing policy, disabled policy, partial contract coverage or
conflicting minima yields `requirementsReady=false` and null minima; current
counts remain readable. Documented draft defaults are never treated as approved
contract values. Cross-month weeks require both applicable policies. No new
policy is activated and no operational setting is changed by this feature.

## Explicit exclusions and verification

No artist-to-fan DM, delivery provider, notification job, new Cron activation,
ranking, subscriber analytics, payment event or settlement mutation is added.
The later admin calendar/analytics work remains separate.

Unit tests cover DTO validation/projection, cursor scopes, auth routing,
transport bounds and stale-screen handling. Disposable-CI Supabase tests cover
real RPCs and isolation; browser tests use fictional accounts and generated test
records only. Local Docker and local browser execution are unavailable under
the inherited environment restrictions. Actual database and browser results are
reported separately at the exact CI head, never inferred from unit tests.

The previously blocked independent media-security review remains unperformed;
this feature does not retry it or add media payload probes.

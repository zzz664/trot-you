# Community posts

## Current scope

Authenticated fans with completed onboarding, eligible artists and administrators
can read active-artist boards without a subscription. Board list/detail show only
visible, undeleted posts. Names use the existing calling-name field only. There are
no comment/like/report/reward buttons in this feature; those flows remain separate.

An existing explicitly configured `private.community_policy` is required. Without
it, the board and protected-image read fail closed. Actual title/body/image count,
byte/dimension limits, prohibited-content filtering and contribution rate limits
remain database-owned. No policy is activated by installing this feature.

Creation publishes the post and every selected completed image atomically. Images
first enter `board-quarantine` through a short-lived signed upload; the real storage
adapter downloads bounded bytes, uses the existing image verifier/sanitizer, writes
an immutable object into `board-media`, then registers a private reservation. Only
the create transaction attaches verified reservations to the post. The picker has
no external URL or caller-selected bucket/path capability. Pending reservations are
actor-owned, bounded by the configured image count, and expire after two hours.
This also bounds abandoned parallel drafts; it is a transport safeguard rather
than a newly approved business quota.

The owner can confirm soft deletion. Administrators alone can create notices or
change notice/pinned flags; revision checks prevent overwriting newer state. This
is not an administrator moderation/deletion screen. Pins sort before ordinary
posts, then by creation timestamp and UUID, using a bounded explicit next-page
cursor. Refreshing returns current authority/state instead of retaining a stale
snapshot.

## Retry and privacy behavior

Every mutation is bound to the currently mounted account and a freshly verified
session. A lost create/delete/notice response retains its original operation ID and
exact input for explicit replay, never an automatic second post. Creation also
preallocates its post UUID so the uncertain-result screen can check that post.
Changing account, losing authority or leaving the page removes private snapshots.
No board body, policy snapshot or signed image URL is placed in an RSC/history
payload or browser persistence.

Image PUT requests are immutable. After an uncertain PUT, retry means attempting
completion of the same reservation; it does not upload a duplicate. Removing an
uncertain reservation performs confirmed server revocation. Publication is disabled
while image completion or removal is unresolved. If the begin step is confirmed
expired before any bytes could be sent, the picker clears that unstarted intent.
Explicit composer Cancel and Back-to-board confirm revocation of all staged uploads
before leaving, preserving cleanup retry if a response is lost. They are disabled
while creation itself has an unknown outcome, because the images may already be
attached. Hardware Back may abandon unreadable reservations until the bounded expiry;
it is not reported as completed cleanup.

Image viewing requires a fresh signed read capability after two authorization
checks, with maximum lifetime 60 seconds. Already issued bearer capabilities cannot
be revoked retroactively during that bounded lifetime; new grants fail after
post deletion/hiding, restriction, artist pause or missing policy. The UI removes
image sources when closed, expired, navigated away from, hidden, or revalidated.
Service-worker caches never store these private routes or objects.

After a validated create receipt, the server makes a best-effort `post_create`
analytics observation using the existing server-event RPC. Ownership, event time,
current analytics policy/consent and deduplication are database-derived. Missing
configuration, missing consent or an observation failure never changes a committed
post's response. No post text or private media locator is an analytics property.

## Integration and verification

The existing Supabase URL, publishable key and server-only service role key are
required for the real database/storage adapter. Service credentials are never sent
to the browser. There is no fake-success fallback. No new API credentials, settings
approval, live posts, private assets, delivery provider, deployment or Cron are
activated by this feature.

The isolated `test:e2e:community-posts` fixture job uses disposable local Supabase
Auth/Postgres/Storage, synthetic PNGs and fictional identities. It is opt-in and
rejects hosted origins or enabled payment/delivery capabilities. Runtime browser
and PostgreSQL results must come from hosted CI in the restricted task environment;
fixture tests and discovery are not those results. Full-page and offscreen captures
at three font scales and 360/1280 widths are retained for pixel review.

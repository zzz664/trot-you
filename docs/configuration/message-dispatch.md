# Message publication and scheduled dispatch

This feature publishes a saved, individually owned artist draft to the **in-app
conversation**. It is not a Web Push or Alimtalk delivery implementation. The
existing transactional outbox records eligible Web Push device jobs; no provider
adapter is invoked and no provider/device receipt is fabricated.

## Artist workflow

The existing composer only enables publication for a saved, unchanged revision
with no pending upload. Immediate and scheduled actions each require a separate
confirmation. Scheduling uses an explicitly labeled **Asia/Seoul (KST,
UTC+09:00)** wall-clock input, regardless of the browser's timezone. The server
rejects a newly submitted time that is no longer future; an exact operation replay
is allowed after its original time has passed.

The app submits the stable message ID, saved revision and a fresh operation ID.
The authenticated RPC derives the actor from the verified session. Current role,
restriction, ownership, active artist membership, policy and content are checked
under locks. Another member is not an impersonation capability. A different
operation cannot republish the same immutable message.

A network error does not mean failure. The UI retains the original request,
freezes editing, and offers an exact retry or an exact-message status read. It
never generates a fresh retry key or automatically repeats a write. Successful
responses are current authoritative receipts, so replaying an earlier publish
after cancellation cannot falsely present it as still published. Reload and
Back/Forward to an old draft URL recover the owned publication instead of
reopening it as an editable draft. Permission loss clears private content.

History uses a bounded, artist-bound keyset cursor and an independently resolved
selected message. Scheduled, in-app published and canceled records are distinct.
Notification labels indicate queue registration only. Cancellation hides the
in-app content and cancels not-yet-claimed jobs within the existing policy's
exclusive cutoff. Already read/saved content, issued media URLs and any already
accepted external notification cannot be recalled. Read records are preserved.

## Eligibility and media

Publication does not create per-fan copies of the message template. The existing
shared sent-message feed is the in-app inbox: every later read still checks
current fan access and the configured subscription-history window. A new
subscriber may therefore see an eligible earlier message. Personal-name
substitution remains server-only through the canonical renderer.

Notification recipients/devices are selected at the **actual publication
transaction**, not at schedule creation. Current subscription access, onboarding,
restriction, device consent and notification preference policy apply. The
snapshot is completed even if no device is eligible or notification setup is
missing; later replay does not enqueue an old message for newly eligible devices.
Future provider delivery must recheck current eligibility at claim time. No raw
message template or recipient identity appears in the artist receipt.

Publication reuses existing logical media associations, without re-uploading or
copying final files. This is ordinary integration with the already accepted
media API, not a new media parser review. The previously blocked independent
media-security review remains blocked; actual device permissions and universal
video playback are not established by these tests.

## Protected recovery worker (disabled by default)

- Route: `GET` or empty `POST /api/cron/dispatch-messages`.
- `MESSAGE_DISPATCH_ENABLED=true` and a dedicated
  `MESSAGE_DISPATCH_CRON_SECRET` are required. The secret must contain 32–256
  URL-safe characters and must differ from the general, renewal and
  reconciliation Cron secrets. Do not put it in `NEXT_PUBLIC_*`.
- Authenticate with `Authorization: Bearer <dedicated secret>`. Cookies, query
  tokens, request bodies and caller-specified limits/times are not accepted.
- One invocation asks the service-only RPC to examine at most 10 due messages.
  It reports aggregate `published`, `blocked`, `skipped`, `hasMore`, not delivery
  completion. It does not drain indefinitely or retry an uncertain RPC itself.
- The DB owns the claim and publication in one transaction. A crash before commit
  rolls back source/outbox together; a later invocation safely retries scheduled
  work. A lost response after commit does not duplicate effects. Contention is
  skipped and known blocked prerequisites retain a retry note.
- Safety ceilings reject excess submissions/pending work/fanout atomically.
  They never silently truncate the recipient set. See the DB contract for exact
  limits; these are technical ceilings, not newly approved commercial quotas.

No `vercel.json` schedule, deployed environment, hosted policy, real user,
notification device, secret or provider has been activated. Hosting and an
explicitly authorized scheduler/manual invocation are still required for future
scheduled work to run. The keyless build is not proof of operational scheduling.
Provider acceptance, end-device reception and a 1,000-subscriber delivery SLA
remain separate delivery-feature and connected-device verification work.

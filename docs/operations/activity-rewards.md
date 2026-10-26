# Activity reward visibility and approval boundaries

## What this feature does

The private activity page reads the signed-in user's post/comment ledger entries
and the currently configured contribution amounts and daily caps. Existing
creation RPCs remain the only way for community creation to earn points; a
separate claim, browser click or page view never awards them.

Creation, its ledger entry and newly recorded outcome metadata commit together.
A replay returns the existing creation instead of firing another insert trigger.
The user profile lock serializes parallel contributions and point writes. The
Korean calendar day comes from the database clock after lock waits, not browser
time. Configured limits count persisted contribution ledger entries per reason
per Korean day, including zero-amount entries; they do not count only positive
awards. Unlimited is represented only by an explicitly configured null cap.

## No approval inferred

No policy is installed or activated by this feature. If an approved point policy
is absent, community content can still be created but receives no new ledger
award. A displayed configuration is a database snapshot, not a promise that a
future creation will qualify or that policy will remain unchanged.

Share verification, missions and activity grades remain unavailable. These
boundaries do not contain a dummy completion engine or a hypothetical formula.
A successful Web Share dialog, outbound link, copied URL or claimed completion
is not proof of a qualifying share. There is no public reward claim endpoint.

Before activating additional behavior, obtain explicit decisions for:

- Reward amount and KST daily cap for each eligible activity, including whether
  zero and unlimited are intended.
- Content eligibility, deletion/moderation treatment and abuse handling.
- A trustworthy share-verification source, evidence identity and replay scope.
- Mission definitions, eligibility, progress/completion rules and time windows.
- Grade score inputs, aggregation window, weighting and ordered thresholds.

Do not copy historical specification examples into live configuration. Existing
administrator operational-setting screens intentionally leave these settings
unavailable; this feature does not bypass that approval boundary.

## History and zero awards

New contribution outcomes distinguish a positive award, a configured zero amount,
and an exhausted daily cap. These describe the creation transaction, not a
recomputed current policy. Historical entries created before this migration lack
that metadata and are explicitly shown as an unknown legacy outcome. No history
is backfilled or guessed from its amount.

The original immutable ledger remains authoritative. A deleted or hidden source
retains its historical award under the existing explicit retain-only policy.
Source text, identifiers and moderation details are not exposed by this page.
There is no automatic clawback. Any already-supported authorized correction is a
new ledger delta, never mutation of old entries, and is not reclassified as
contribution activity.

## Validation and rollout

Use only the isolated local CI fixture for synthetic policy and account data.
The database job must pass both pgTAP runs, every historical/new race, populated
upgrade preservation, official schema generation and committed-type drift checks.
The new private UI requires all three text scales at 360px and 1280px, settled
asynchronous screens, pagination/offscreen inspection and identity/navigation/
visibility invalidation coverage. Local static tests are not database or browser
evidence. Deployment and live policy approval remain separate authorized actions.

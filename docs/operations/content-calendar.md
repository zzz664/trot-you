# Private content calendars

## Available workflow

- An administrator opens **콘텐츠 캘린더 관리**, chooses an artist, and navigates
  months. A date has at most one editorial topic and optional reference example.
- Add a new date explicitly. An occupied date returns a conflict rather than
  overwriting an existing topic. Edit keeps the artist and date immutable; use an
  explicitly confirmed delete followed by a new entry to change the date.
- Artist members open their artist's **콘텐츠 캘린더** from the artist menu. Only
  an active artist's current authorized members can read it. Fans, unrelated
  artists, restricted accounts and stale roles cannot read private topics.
- Admins can manage inactive artists' planning records; inactivity is visibly
  identified and does not make those records available in the artist view.
- Topic/example text remains literal reference material, including `{이름}`.
  Calendar actions do not compose, publish or dispatch a message, enqueue a
  notification, change a schedule, or update activity/settlement policy.

## Activity and date semantics

The selected month filters editorial dates only. The accompanying activity panel
always measures the current Monday-to-Monday Korean-time week using the existing
sent-message/photo computation. It reports existing approved requirements, or an
explicit unavailable-requirements state. No default targets or grades are inferred,
and the provisional activity display is not a settlement decision.

## Conflict and recovery

Every loaded entry has a monotonically increasing revision. Updates from legacy
RPCs and operator SQL also invalidate stale UI edits. Same-value saves do not
invent an edit, increment a revision, or add another content audit row.

Each mutation has an actor-bound immutable operation ID and request receipt. An
unknown response offers **같은 요청 결과 확인** with the same payload and ID;
there is no automatic mutation retry. A different payload under the same ID is a
conflict. Changing the logged-in account cannot replay the previous account's
request. Closing a screen does not cancel a transaction already accepted by the
server, and the UI says so when the result is uncertain.

Reads are private/no-store. Browser Back/Forward, restored pages, visibility changes,
and focus revalidate authority. Late or aborted responses cannot repaint a newer
route. Private rows and editor content disappear when authorization is lost.
The RSC response carries a mount/account key, not a cached editorial snapshot.

## Verification and deployment boundaries

The isolated `content-calendar-browser` job uses fictional local accounts and
editorial records; outbound application traffic is blocked. It covers the three
font scales at both 360 and 1280 pixel widths, including offscreen controls and
stable full-page captures. Only actual hosted CI results establish that these
browser/database checks ran. Local fixture guards or test discovery are not
browser/SQL execution.

Database verification includes both pgTAP passes, independent-session races,
populated upgrade preservation and official Supabase-generated types. A new
migration/shared dependency selects full CI; the required aggregate includes the
new browser job. No hosted project, external provider, operational settings,
production deployment or scheduler is activated by these changes.

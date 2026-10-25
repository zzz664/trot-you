# Schedule management database contract

Migration `20261025000030_schedule_management.sql` extends the existing schedule/catalog model without adding notice dispatch or content-calendar behavior.

| RPC                                                                               | Contract                                                                                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule_list(month, artist_ids?, after_starts_at?, after_id?, limit?)`          | Existing public published/active safe catalog; KST month-overlap semantics; max100; stable `(starts_at,id)` cursor.                                       |
| `schedule_get(id)`                                                                | Existing current public event projection; no author/profile data.                                                                                         |
| `schedule_my_artists()`                                                           | Authenticated current-ready unrestricted actor's active artists having existing current subscription access. No actor argument.                           |
| `schedule_admin_list(month,page=1)`                                               | Current administrator only; first-of-month date, page1..1000;30 rows plus has_more; includes draft/artist status/revision, never author contact identity. |
| `schedule_admin_get(id)`                                                          | Current administrator safe event projection.                                                                                                              |
| `schedule_admin_save(operation_id,id?,expected_revision?,input?,confirmed=false)` | Create when id/revision absent; update when both present and current. Publication requires confirmation. Exact11-key event input. Event artist immutable. |
| `schedule_admin_delete(operation_id,id,expected_revision,confirmed)`              | Explicit confirmed current-revision deletion; same operation replays accepted receipt. Existing optout cascade semantics preserved.                       |

## Authority and serialization

New privileged/personal RPCs are executable only by `authenticated`; anonymous and service-role access is revoked. Private helpers and operation table have no API-role grants. Security-definer functions pin `search_path=''`.

Authority requires READ COMMITTED and the current DB role, not JWT-supplied business role claims. Reads take a current profile share lock; writes take a profile update lock before artist/event locks. A fresh wall clock after waits reevaluates restrictions. Repeatable-read snapshots are rejected rather than reused for authority.

A trigger advances safe-integer revisions on every update, including legacy authorized RPCs. Legacy CRUD remains compatible; clients of the new UI must use CAS functions. The existing append-only audit records actual creates/updates/deletes; failed writes and receipt replay do not add duplicate audit entries.

Actor-scoped operation UUIDs retain exact accepted request/response. An operation replay checks current authority before returning the stored result. Changed payload with the same UUID fails. Immutable receipt triggers reject UPDATE, DELETE and TRUNCATE, and no API caller can read the private receipt table. Receipts represent the accepted operation, not a promise that the event remains unchanged forever; fresh detail reads establish current state.

## Compatibility and testing

The public catalog projection is unchanged, and revisions remain admin-only. The populated upgrade test compares all original schedule fields, public catalog, schedule optouts, content-calendar rows, audit entries and profiles before/after. New revisions start at1 without fabricating accepted operations. The migration does not alter live roles, external integration mode, commercial policy or scheduler configuration.

Actual CI runs pgTAP twice, independent-session conflict/revocation/replay races, populated upgrade checks and official type generation. Static SQL reading alone is not runtime proof. See [UI/configuration and verification boundaries](../configuration/schedules.md).

# Community board DB checkpoint parser correction — 2026-10-25

Hosted checkpoint run 40228248033 failed during Supabase startup while applying
migration 33, before pgTAP, race, upgrade or generated-type verification. PostgreSQL
reported SQLSTATE 42601 in `private.board_actor`: an unparenthesized CASE expression
inside an IF condition let PL/pgSQL treat the CASE's inner THEN as the IF expression
terminator, leaving an incomplete expression.

The correction parenthesizes only that CASE expression. Role comparison, fresh
actor locks and every authorization branch are unchanged. A focused static guard
reproduced the offending source shape before the fix; all 30 upgrade/migration
contract unit checks now pass. ESLint, Prettier and diff whitespace pass. The
failed hosted run is not counted as DB validation. Corrected migration execution
and official generated types still require a new hosted run; no denied local
Docker/socket or independent media-security runtime was attempted.

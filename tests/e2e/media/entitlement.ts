import assert from 'node:assert/strict';
import { z } from 'zod';

const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6,
  );
function micros(value: string) {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return (
    BigInt(Date.parse(value)) * 1000n +
    BigInt(fraction.padEnd(6, '0').slice(3, 6))
  );
}
const entitlementSchema = z
  .strictObject({
    actorId: z.uuid(),
    artistId: z.uuid(),
    expiresAt: instant,
    databaseNow: instant,
    expired: z.boolean(),
  })
  .refine(
    (value) =>
      value.expired === micros(value.expiresAt) <= micros(value.databaseNow),
  );
export type MediaEntitlement = z.output<typeof entitlementSchema>;
export function parseMediaEntitlement(
  value: unknown,
  actorId: string,
  artistId: string,
): MediaEntitlement {
  const snapshot = entitlementSchema.parse(value);
  assert.equal(snapshot.actorId, actorId);
  assert.equal(snapshot.artistId, artistId);
  return snapshot;
}

// A bearer token can expire before its underlying subscription. Only the
// persisted deadline and DB clock establish the final fresh-grant denial gate.
export function mediaEntitlementDeadlineReached(
  snapshot: MediaEntitlement,
  originalDeadline: string,
) {
  assert.equal(snapshot.expiresAt, originalDeadline);
  return snapshot.expired;
}

// @vitest-environment node
import { expect, it } from 'vitest';
import {
  parseMediaEntitlement,
  mediaEntitlementDeadlineReached,
} from '../e2e/media/entitlement';
const actorId = 'a1000000-0000-4000-8000-000000000001';
const artistId = 'a1000000-0000-4000-8000-000000000002';
const otherId = 'a1000000-0000-4000-8000-000000000003';
const expiresAt = '2026-10-25T10:00:04.800001+00:00';
const initial = {
  actorId,
  artistId,
  expiresAt,
  databaseNow: '2026-10-25T10:00:03.000000+00:00',
  expired: false,
};
it('expired bearer token does not satisfy the still-live entitlement deadline', () => {
  const oldTokenExpiresAt = '2026-10-25T10:00:03Z';
  const snapshot = parseMediaEntitlement(initial, actorId, artistId);
  expect(Date.parse(oldTokenExpiresAt)).toBeLessThanOrEqual(
    Date.parse(snapshot.databaseNow),
  );
  expect(mediaEntitlementDeadlineReached(snapshot, expiresAt)).toBe(false);
});
it.each(['2026-10-25T10:00:04.800001+00:00', '2026-10-25T10:00:05+00:00'])(
  'accepts the observed DB deadline at or after expiry: %s',
  (databaseNow) => {
    const snapshot = parseMediaEntitlement(
      { ...initial, databaseNow, expired: true },
      actorId,
      artistId,
    );
    expect(mediaEntitlementDeadlineReached(snapshot, expiresAt)).toBe(true);
  },
);
it('retains sub-millisecond precision instead of mistaking one microsecond early for expiry', () => {
  const value = { ...initial, databaseNow: '2026-10-25T10:00:04.800000+00:00' };
  expect(
    mediaEntitlementDeadlineReached(
      parseMediaEntitlement(value, actorId, artistId),
      expiresAt,
    ),
  ).toBe(false);
  expect(() =>
    parseMediaEntitlement({ ...value, expired: true }, actorId, artistId),
  ).toThrow();
});
it('rejects a changed subscription deadline rather than waiting on a different entitlement', () => {
  const snapshot = parseMediaEntitlement(initial, actorId, artistId);
  expect(() =>
    mediaEntitlementDeadlineReached(snapshot, '2026-10-25T10:00:03Z'),
  ).toThrow();
});
it.each([
  null,
  {},
  { ...initial, actorId: otherId },
  { ...initial, artistId: otherId },
  { ...initial, expiresAt: 'infinity' },
  { ...initial, databaseNow: 'bad' },
  { ...initial, expired: true },
  { ...initial, expired: 'false' },
  { ...initial, databaseNow: '2026-10-25T10:00:04.8000001Z' },
  { ...initial, extra: 'unapproved' },
])(
  'fails malformed or wrong-resource entitlement evidence closed %#',
  (value) => {
    expect(() => parseMediaEntitlement(value, actorId, artistId)).toThrow();
  },
);

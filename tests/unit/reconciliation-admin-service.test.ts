// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { listAdminReconciliation } from '@/server/services/reconciliation/admin';
import {
  RECONCILIATION_ADMIN_MAX_PAGE,
  RECONCILIATION_ADMIN_LIMIT,
} from '@/config/reconciliation-admin';
import {
  reconciliationAdminCase,
  reconciliationAdminList,
} from './reconciliation-admin-fixtures';

const unavailable = { ok: false, code: 'UNAVAILABLE' };
function setup(data: unknown = reconciliationAdminList) {
  return { list: vi.fn().mockResolvedValue({ ok: true, data }) };
}
describe('read-only reconciliation administration service', () => {
  it.each([
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    true,
    null,
    [],
    ['1'],
    {},
    '',
    '01',
    ' 1',
    '1.0',
    '1e2',
    '1&next=2',
    RECONCILIATION_ADMIN_MAX_PAGE + 1,
  ])('rejects invalid page %j without DB work', async (page) => {
    const db = setup();
    expect(await listAdminReconciliation(db, page)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(db.list).not.toHaveBeenCalled();
  });
  it.each([undefined, 1, '1', RECONCILIATION_ADMIN_MAX_PAGE])(
    'reads a bounded valid page %j without mutating',
    async (page) => {
      const expectedPage = page === undefined ? 1 : Number(page);
      const db = setup({ ...reconciliationAdminList, page: expectedPage });
      expect(await listAdminReconciliation(db, page)).toEqual({
        ok: true,
        data: { ...reconciliationAdminList, page: expectedPage },
      });
      expect(db.list).toHaveBeenCalledExactlyOnceWith(expectedPage);
      expect(Object.keys(db)).toEqual(['list']);
    },
  );
  it('rejects a wrong-page result instead of silently jumping navigation', async () => {
    expect(await listAdminReconciliation(setup(), 2)).toEqual(unavailable);
  });
  it('strips provider identities and opaque payloads at the client boundary', async () => {
    const db = setup({
      ...reconciliationAdminList,
      secret: 'private',
      cases: [
        {
          ...reconciliationAdminCase,
          customer_ref: 'private-customer',
          provider_payment_id: 'private-tid',
          credential_ciphertext: { private: true },
          payload: 'private-payload',
        },
      ],
    });
    expect(await listAdminReconciliation(db)).toEqual({
      ok: true,
      data: reconciliationAdminList,
    });
  });
  it.each([
    { amount_krw: 0 },
    { amount_krw: 1.2 },
    { amount_krw: Infinity },
    { query_attempts: 4 },
    { query_attempts: -1 },
    { query_attempts: 0.5 },
    { status: 'failed' },
    { reason: 'PRIVATE_ERROR_MESSAGE' },
    { provider: 'mock' },
    { environment: 'production' },
    { kind: 'mandate' },
    { created_at: 'invalid' },
    { updated_at: null },
    { id: 'bad' },
    { subscription_id: 'bad' },
  ])('fails closed on malformed visible case %j', async (patch) => {
    expect(
      await listAdminReconciliation(
        setup({
          ...reconciliationAdminList,
          cases: [{ ...reconciliationAdminCase, ...patch }],
        }),
      ),
    ).toEqual(unavailable);
  });
  it('rejects duplicate identities and oversized projections', async () => {
    expect(
      await listAdminReconciliation(
        setup({
          ...reconciliationAdminList,
          cases: [reconciliationAdminCase, reconciliationAdminCase],
        }),
      ),
    ).toEqual(unavailable);
    expect(
      await listAdminReconciliation(
        setup({
          ...reconciliationAdminList,
          cases: Array(RECONCILIATION_ADMIN_LIMIT + 1).fill(
            reconciliationAdminCase,
          ),
        }),
      ),
    ).toEqual(unavailable);
  });
  it('returns safe errors without converting unavailable storage to an empty success', async () => {
    const db = setup();
    db.list.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await listAdminReconciliation(db)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    db.list.mockRejectedValue(new Error('private database message'));
    expect(await listAdminReconciliation(db)).toEqual(unavailable);
  });
});

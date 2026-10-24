// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { RECONCILIATION_ADMIN_LIMIT } from '@/config/reconciliation-admin';
import { createReconciliationAdminDbPort } from '@/server/db/reconciliation-admin';
import type { ActorClient } from '@/server/db/client';
import {
  reconciliationAdminCase,
  reconciliationAdminList,
} from './reconciliation-admin-fixtures';
function setup(data: unknown = reconciliationAdminList, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const from = vi.fn(() => {
    throw new Error('Direct SQL forbidden');
  });
  return {
    rpc,
    from,
    db: createReconciliationAdminDbPort({
      rpc,
      from,
    } as unknown as ActorClient),
  };
}
describe('actor-only reconciliation admin database adapter', () => {
  it('uses only fixed authenticated RPC without caller role/user override', async () => {
    const { db, rpc, from } = setup();
    expect(await db.list(1)).toEqual({
      ok: true,
      data: reconciliationAdminList,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reconciliation_admin_list', {
      p_page: 1,
      p_limit: RECONCILIATION_ADMIN_LIMIT,
    });
    expect(from).not.toHaveBeenCalled();
    expect(Object.keys(db)).toEqual(['list']);
  });
  it('drops unexpected provider/PII fields from storage response', async () => {
    const { db } = setup({
      ...reconciliationAdminList,
      private: 'secret',
      cases: [
        {
          ...reconciliationAdminCase,
          customer_ref: 'secret',
          provider_payment_id: 'secret',
        },
      ],
    });
    expect(await db.list(1)).toEqual({
      ok: true,
      data: reconciliationAdminList,
    });
  });
  it.each([
    [null, 'UNAVAILABLE'],
    [{ message: 'FORBIDDEN' }, 'FORBIDDEN'],
    [{ message: 'private provider credentials' }, 'UNAVAILABLE'],
    [{ code: 'FORBIDDEN' }, 'UNAVAILABLE'],
    ['FORBIDDEN', 'UNAVAILABLE'],
  ])('maps storage errors %j to a safe code', async (error, code) => {
    const { db } = setup(null, error);
    expect(await db.list(1)).toEqual({ ok: false, code });
  });
  it.each([
    null,
    [],
    {},
    { ...reconciliationAdminList, cases: null },
    { ...reconciliationAdminList, has_more: 'true' },
  ])('rejects malformed RPC response %j', async (data) => {
    expect(await setup(data).db.list(1)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});

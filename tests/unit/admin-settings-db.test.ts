// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createAdminSettingsPort } from '@/server/db/admin-settings';
import type { ActorClient } from '@/server/db/client';
import {
  displayGroup,
  settingsList,
  settingsSave,
} from './admin-settings-fixtures';
function client(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as ActorClient, rpc };
}
it('uses actor-bound read with no caller-provided identity', async () => {
  const c = client({ data: settingsList, error: null });
  expect(await createAdminSettingsPort(c.client).list()).toEqual({
    ok: true,
    data: settingsList,
  });
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith('admin_settings_list');
});
it('passes exact version/CAS/confirmation payload', async () => {
  const c = client({ data: displayGroup, error: null });
  expect(await createAdminSettingsPort(c.client).save(settingsSave)).toEqual({
    ok: true,
    data: displayGroup,
  });
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith('admin_settings_save', {
    p_group: settingsSave.group,
    p_operation_id: settingsSave.operation_id,
    p_expected_revision: settingsSave.expected_revision,
    p_values: settingsSave.values,
    p_confirmed: true,
    p_decision_reference: settingsSave.decision_reference,
  });
});
it.each([
  ['FORBIDDEN', 'FORBIDDEN'],
  ['INVALID_INPUT', 'INVALID_INPUT'],
  ['CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED'],
  ['SETUP_NOT_READY', 'SETUP_NOT_READY'],
  ['REVISION_CONFLICT', 'CONFLICT'],
  ['OPERATION_CONFLICT', 'CONFLICT'],
  ['PREVIEW_LIMIT_CONFLICT', 'PREVIEW_LIMIT_CONFLICT'],
  ['ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['private secret', 'UNAVAILABLE'],
])('maps %s to safe %s', async (input, code) => {
  const c = client({
    data: null,
    error: {
      message: input === 'private secret' ? input : `ADMIN_SETTINGS_${input}`,
    },
  });
  expect(await createAdminSettingsPort(c.client).list()).toEqual({
    ok: false,
    code,
  });
  expect(await createAdminSettingsPort(c.client).save(settingsSave)).toEqual({
    ok: false,
    code,
  });
});
it.each([
  null,
  {},
  [],
  { ...settingsList, extra: 'secret' },
  { ...settingsList, groups: [{ ...displayGroup, values: { page_size: 0 } }] },
])('rejects malformed DTO %#', async (data) => {
  expect(
    await createAdminSettingsPort(client({ data, error: null }).client).list(),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});

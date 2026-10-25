// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  ADMIN_SETTINGS,
  adminSettingsFields,
  adminSettingsListSchema,
  adminSettingsSaveSchema,
  adminSettingsGroupSchema,
  adminSettingsAuditSchema,
} from '@/config/admin-settings';
import {
  listAdminSettings,
  saveAdminSettings,
  type AdminSettingsPort,
} from '@/server/services/admin-settings/manage';
import {
  displayGroup,
  settingsList,
  settingsSave,
} from './admin-settings-fixtures';
function port(): AdminSettingsPort {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, data: settingsList }),
    save: vi.fn().mockResolvedValue({ ok: true, data: displayGroup }),
  };
}
it('reads without manufacturing missing policy defaults or activating policy', async () => {
  const p = port();
  expect(await listAdminSettings(p)).toEqual({ ok: true, data: settingsList });
  expect(p.save).not.toHaveBeenCalled();
});
it('passes only validated confirmed typed update and UUID reference to port', async () => {
  const p = port();
  expect(await saveAdminSettings(p, settingsSave)).toEqual({
    ok: true,
    data: displayGroup,
  });
  expect(p.save).toHaveBeenCalledExactlyOnceWith(settingsSave);
});
it.each([
  null,
  {},
  [],
  'value',
  { ...settingsSave, actor_id: 'forged' },
  { ...settingsSave, group: 'checkout' },
  { ...settingsSave, confirmed: false },
  { ...settingsSave, confirmed: null },
  { ...settingsSave, decision_reference: 'a secret reference' },
  { ...settingsSave, operation_id: 'invalid' },
  { ...settingsSave, expected_revision: -1 },
  { ...settingsSave, expected_revision: 1.5 },
  { ...settingsSave, expected_revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...settingsSave, values: { page_size: '30' } },
  { ...settingsSave, values: { page_size: 0 } },
  { ...settingsSave, values: { page_size: 101 } },
  { ...settingsSave, values: { page_size: 30, secret: 'hidden' } },
])('rejects invalid input %# before port', async (input) => {
  const p = port();
  expect(await saveAdminSettings(p, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.save).not.toHaveBeenCalled();
});
for (const group of ADMIN_SETTINGS.groupKeys) {
  const values = Object.fromEntries(
    adminSettingsFields[group].map(({ key, min }) => [key, min]),
  );
  it(`${group} requires exact complete numeric shape`, () => {
    expect(
      adminSettingsSaveSchema.safeParse({ ...settingsSave, group, values })
        .success,
    ).toBe(true);
    expect(
      adminSettingsSaveSchema.safeParse({
        ...settingsSave,
        group,
        values: { ...values, secret: 1 },
      }).success,
    ).toBe(false);
    expect(
      adminSettingsSaveSchema.safeParse({ ...settingsSave, group, values: {} })
        .success,
    ).toBe(false);
  });
  for (const field of adminSettingsFields[group]) {
    it.each([
      field.min - 1,
      field.max + 1,
      field.min + 0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])(`${group}.${field.key} rejects out-of-range %s`, (value) => {
      expect(
        adminSettingsSaveSchema.safeParse({
          ...settingsSave,
          group,
          values: { ...values, [field.key]: value },
        }).success,
      ).toBe(false);
    });
    it(`${group}.${field.key} accepts exact maximum`, () => {
      expect(
        adminSettingsSaveSchema.safeParse({
          ...settingsSave,
          group,
          values: { ...values, [field.key]: field.max },
        }).success,
      ).toBe(true);
    });
  }
}
it.each(['list', 'save'] as const)(
  'sanitizes rejected %s without raw errors',
  async (method) => {
    const p = port();
    vi.mocked(p[method]).mockRejectedValue(new Error('private credential'));
    const result = await (method === 'list'
      ? listAdminSettings(p)
      : saveAdminSettings(p, settingsSave));
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it('requires all unique groups and rejects hidden response fields', () => {
  expect(adminSettingsListSchema.safeParse(settingsList).success).toBe(true);
  for (const value of [
    { ...settingsList, groups: [] },
    { ...settingsList, groups: [displayGroup, displayGroup, displayGroup] },
    { ...settingsList, secret: 'hidden' },
  ])
    expect(adminSettingsListSchema.safeParse(value).success).toBe(false);
  expect(
    adminSettingsGroupSchema.safeParse({
      ...displayGroup,
      configured: false,
      values: null,
    }).success,
  ).toBe(false);
  expect(
    adminSettingsGroupSchema.safeParse({
      ...displayGroup,
      values: { page_size: 30, secret: 1 },
    }).success,
  ).toBe(false);
});

it('matches finite revision ceiling and positive-only audit revision', () => {
  expect(
    adminSettingsSaveSchema.safeParse({
      ...settingsSave,
      expected_revision: Number.MAX_SAFE_INTEGER,
    }).success,
  ).toBe(false);
  expect(
    adminSettingsSaveSchema.safeParse({
      ...settingsSave,
      expected_revision: Number.MAX_SAFE_INTEGER - 1,
    }).success,
  ).toBe(true);
  const audit = {
    id: settingsSave.operation_id,
    group_key: 'display',
    revision: 1,
    actor_id: null,
    source: 'operator',
    decision_reference: null,
    operation_id: null,
    before_value: { page_size: 30 },
    after_value: { page_size: 40 },
    created_at: '2026-10-25T00:00:00Z',
  };
  expect(adminSettingsAuditSchema.safeParse(audit).success).toBe(true);
  expect(
    adminSettingsAuditSchema.safeParse({ ...audit, revision: 0 }).success,
  ).toBe(false);
});

import {
  adminSettingsFields,
  type AdminSettingsGroup,
  type AdminSettingsList,
  type AdminSettingsSaveInput,
} from '@/config/admin-settings';
export const settingsActor = 'a2900000-0000-4000-8000-000000000001';
export const settingsOperation = 'a2900000-0000-4000-8000-000000000002';
export const settingsDecision = 'a2900000-0000-4000-8000-000000000003';
export const settingsInstant = '2026-10-25T00:00:00.123456+00:00';
export const displayGroup: AdminSettingsGroup = {
  key: 'display',
  revision: 0,
  configured: true,
  values: { page_size: 30 },
  updated_at: null,
  updated_by: null,
};
export const settingsList: AdminSettingsList = {
  groups: [
    {
      key: 'message',
      revision: 1,
      configured: true,
      values: Object.fromEntries(
        adminSettingsFields.message.map(({ key, min }) => [key, min]),
      ),
      updated_at: settingsInstant,
      updated_by: null,
    },
    {
      key: 'community',
      revision: 0,
      configured: false,
      values: null,
      updated_at: null,
      updated_by: null,
    },
    displayGroup,
  ],
  audit: [],
};
export const settingsSave: AdminSettingsSaveInput = {
  group: 'display',
  operation_id: settingsOperation,
  expected_revision: 0,
  values: { page_size: 25 },
  confirmed: true,
  decision_reference: settingsDecision,
};

import 'server-only';
import {
  adminSettingsSaveSchema,
  type AdminSettingsGroup,
  type AdminSettingsList,
  type AdminSettingsResult,
  type AdminSettingsSaveInput,
} from '@/config/admin-settings';

export type AdminSettingsPort = {
  list(): Promise<AdminSettingsResult<AdminSettingsList>>;
  save(
    input: AdminSettingsSaveInput,
  ): Promise<AdminSettingsResult<AdminSettingsGroup>>;
};
export async function listAdminSettings(port: AdminSettingsPort) {
  try {
    return await port.list();
  } catch {
    return { ok: false, code: 'UNAVAILABLE' } as const;
  }
}
export async function saveAdminSettings(
  port: AdminSettingsPort,
  input: unknown,
) {
  const parsed = adminSettingsSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' } as const;
  try {
    return await port.save(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' } as const;
  }
}

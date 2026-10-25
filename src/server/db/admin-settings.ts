import 'server-only';
import { z } from 'zod';
import {
  adminSettingsGroupSchema,
  adminSettingsListSchema,
  type AdminSettingsError,
  type AdminSettingsResult,
} from '@/config/admin-settings';
import type { AdminSettingsPort } from '@/server/services/admin-settings/manage';
import type { ActorClient } from './client';
const errors: Record<string, AdminSettingsError> = {
  ADMIN_SETTINGS_FORBIDDEN: 'FORBIDDEN',
  ADMIN_SETTINGS_INVALID_INPUT: 'INVALID_INPUT',
  ADMIN_SETTINGS_CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  ADMIN_SETTINGS_SETUP_NOT_READY: 'SETUP_NOT_READY',
  ADMIN_SETTINGS_REVISION_CONFLICT: 'CONFLICT',
  ADMIN_SETTINGS_OPERATION_CONFLICT: 'CONFLICT',
  ADMIN_SETTINGS_PREVIEW_LIMIT_CONFLICT: 'PREVIEW_LIMIT_CONFLICT',
  ADMIN_SETTINGS_ISOLATION_UNSUPPORTED: 'UNAVAILABLE',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): AdminSettingsResult<T> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createAdminSettingsPort(
  client: ActorClient,
): AdminSettingsPort {
  return {
    async list() {
      const { data, error } = await client.rpc('admin_settings_list');
      return parsed(adminSettingsListSchema, data, error);
    },
    async save(input) {
      const { data, error } = await client.rpc('admin_settings_save', {
        p_group: input.group,
        p_operation_id: input.operation_id,
        p_expected_revision: input.expected_revision,
        p_values: input.values,
        p_confirmed: input.confirmed,
        p_decision_reference: input.decision_reference,
      });
      return parsed(adminSettingsGroupSchema, data, error);
    },
  };
}

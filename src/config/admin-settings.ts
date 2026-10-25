import { z } from 'zod';

// Exact existing database constraints. These are technical safety bounds, not
// approved commercial terms or a source of values for missing policy rows.
export const ADMIN_SETTINGS = {
  groupKeys: ['message', 'community', 'display'],
  bodyLimit: 8192,
  bodyTimeoutMs: 5000,
  requestTimeoutMs: 15_000,
  responseMaxBytes: 256 * 1024,
  auditLimit: 30,
  maxExpectedRevision: Number.MAX_SAFE_INTEGER - 1,
  httpOk: 200,
} as const;
export const ADMIN_SETTINGS_TIME_ZONE = 'Asia/Seoul';
export const ADMIN_SETTINGS_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  CONFIRMATION_REQUIRED: 400,
  SETUP_NOT_READY: 503,
  PREVIEW_LIMIT_CONFLICT: 409,
  UNAVAILABLE: 503,
} as const;
export type AdminSettingsError = keyof typeof ADMIN_SETTINGS_ERROR_STATUS;
export type AdminSettingsResult<T> =
  { ok: true; data: T } | { ok: false; code: AdminSettingsError };
export type AdminSettingsGroupKey = (typeof ADMIN_SETTINGS.groupKeys)[number];
export const adminSettingsFields = {
  message: [
    { key: 'history_before_seconds', min: 0, max: 31_536_000 },
    { key: 'cancel_window_seconds', min: 0, max: 86_400 },
    { key: 'max_text_length', min: 1, max: 100_000 },
    { key: 'max_reply_length', min: 1, max: 10_000 },
    { key: 'max_photos', min: 1, max: 100 },
    { key: 'max_voice_seconds', min: 1, max: 86_400 },
    { key: 'max_video_seconds', min: 1, max: 86_400 },
    { key: 'preview_max_count', min: 0, max: 100 },
    { key: 'max_photo_bytes', min: 1, max: 10_485_760 },
    { key: 'max_voice_bytes', min: 1, max: 20_971_520 },
    { key: 'max_video_bytes', min: 1, max: 104_857_600 },
  ],
  community: [
    { key: 'max_title_length', min: 1, max: 1000 },
    { key: 'max_body_length', min: 1, max: 100_000 },
    { key: 'max_comment_length', min: 1, max: 10_000 },
    { key: 'max_reason_length', min: 1, max: 10_000 },
    { key: 'max_images', min: 0, max: 100 },
    { key: 'max_image_bytes', min: 1, max: 10_485_760 },
    { key: 'max_image_long_edge', min: 1, max: 100_000 },
    { key: 'auto_hide_report_count', min: 1, max: 100_000 },
    { key: 'rate_window_seconds', min: 1, max: 86_400 },
    { key: 'max_contributions_per_window', min: 1, max: 10_000 },
    { key: 'max_reports_per_window', min: 1, max: 10_000 },
  ],
  display: [{ key: 'page_size', min: 1, max: 100 }],
} as const;
export type AdminSettingsField =
  (typeof adminSettingsFields)[AdminSettingsGroupKey][number];
const valuesSchema = z.record(z.string(), z.number().int().safe());
export function validAdminSettingsValues(
  group: AdminSettingsGroupKey,
  values: Record<string, number>,
) {
  const fields = adminSettingsFields[group];
  return (
    Object.keys(values).length === fields.length &&
    fields.every(
      ({ key, min, max }) =>
        Object.hasOwn(values, key) &&
        Number.isSafeInteger(values[key]) &&
        values[key]! >= min &&
        values[key]! <= max,
    )
  );
}
const groupKey = z.enum(ADMIN_SETTINGS.groupKeys);
const instant = z.iso.datetime({ offset: true });
const revision = z.number().int().nonnegative().safe();
export const adminSettingsGroupSchema = z
  .strictObject({
    key: groupKey,
    revision,
    configured: z.boolean(),
    values: valuesSchema.nullable(),
    updated_at: instant.nullable(),
    updated_by: z.uuid().nullable(),
  })
  .refine((group) =>
    group.configured
      ? group.values !== null &&
        validAdminSettingsValues(group.key, group.values)
      : group.key !== 'display' && group.values === null,
  );
export type AdminSettingsGroup = z.output<typeof adminSettingsGroupSchema>;
export const adminSettingsAuditSchema = z
  .strictObject({
    id: z.uuid(),
    group_key: groupKey,
    revision: revision.min(1),
    actor_id: z.uuid().nullable(),
    source: z.enum(['admin', 'operator']),
    decision_reference: z.uuid().nullable(),
    operation_id: z.uuid().nullable(),
    before_value: valuesSchema.nullable(),
    after_value: valuesSchema.nullable(),
    created_at: instant,
  })
  .refine(
    (audit) =>
      [audit.before_value, audit.after_value].every(
        (value) =>
          value === null || validAdminSettingsValues(audit.group_key, value),
      ) &&
      (audit.source !== 'admin' ||
        (audit.actor_id !== null &&
          audit.decision_reference !== null &&
          audit.operation_id !== null)),
  );
export type AdminSettingsAudit = z.output<typeof adminSettingsAuditSchema>;
export const adminSettingsListSchema = z
  .strictObject({
    groups: z
      .array(adminSettingsGroupSchema)
      .length(ADMIN_SETTINGS.groupKeys.length),
    audit: z.array(adminSettingsAuditSchema).max(ADMIN_SETTINGS.auditLimit),
  })
  .refine(
    (list) =>
      new Set(list.groups.map((group) => group.key)).size ===
      ADMIN_SETTINGS.groupKeys.length,
  );
export type AdminSettingsList = z.output<typeof adminSettingsListSchema>;
export const adminSettingsSaveSchema = z
  .strictObject({
    group: groupKey,
    operation_id: z.uuid(),
    expected_revision: revision.max(ADMIN_SETTINGS.maxExpectedRevision),
    values: valuesSchema,
    confirmed: z.literal(true),
    decision_reference: z.uuid(),
  })
  .refine((input) => validAdminSettingsValues(input.group, input.values));
export type AdminSettingsSaveInput = z.output<typeof adminSettingsSaveSchema>;

import 'server-only';
import {
  documentedSettingsDefaults,
  settingDecisions,
  settingKeys,
  settingSchemas,
  settingsDraftSchema,
  unresolvedSettingDecisions,
  type SettingKey,
  type SettingsDraft,
  type SettingValue,
} from '@/config/settings';

export type SettingsIssue = {
  key: SettingKey | null;
  reason:
    'invalid_input' | 'unknown_key' | 'invalid_value' | 'inconsistent_values';
};
export type SettingsValidation<T> =
  { ok: true; data: T } | { ok: false; issues: SettingsIssue[] };

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && Object.hasOwn(settingSchemas, key);
}

// Accept JSON-style own data only, without invoking getters/toJSON or accepting
// prototype-derived settings. Unknown property names are never echoed to logs.
function readPlainDataRecord(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object') return null;
  try {
    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        typeof key !== 'string' ||
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        return null;
      }
      snapshot[key] = descriptor.value as unknown;
    }
    return snapshot;
  } catch {
    // Revoked/throwing proxies are invalid input, not an unhandled exception.
    return null;
  }
}

export function validateSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): SettingsValidation<SettingValue<K>> {
  if (!isSettingKey(key)) {
    return { ok: false, issues: [{ key: null, reason: 'unknown_key' }] };
  }
  const candidate =
    key === 'board.grade_thresholds' ? readPlainDataRecord(value) : value;
  if (key === 'board.grade_thresholds' && candidate === null) {
    return { ok: false, issues: [{ key, reason: 'invalid_input' }] };
  }
  const result = settingSchemas[key].safeParse(candidate);
  if (!result.success) {
    return { ok: false, issues: [{ key, reason: 'invalid_value' }] };
  }
  // The schema is selected by the same key K; do not let callers choose T.
  return { ok: true, data: result.data as SettingValue<K> };
}

export function validateSettingsDraft(
  input: unknown,
): SettingsValidation<SettingsDraft> {
  const candidate = readPlainDataRecord(input);
  if (candidate === null) {
    return { ok: false, issues: [{ key: null, reason: 'invalid_input' }] };
  }
  if (Object.keys(candidate).some((key) => !isSettingKey(key))) {
    return { ok: false, issues: [{ key: null, reason: 'unknown_key' }] };
  }
  if (Object.hasOwn(candidate, 'board.grade_thresholds')) {
    const grades = readPlainDataRecord(candidate['board.grade_thresholds']);
    if (grades === null) {
      return {
        ok: false,
        issues: [{ key: 'board.grade_thresholds', reason: 'invalid_input' }],
      };
    }
    candidate['board.grade_thresholds'] = grades;
  }
  const result = settingsDraftSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        key: isSettingKey(issue.path[0]) ? issue.path[0] : null,
        reason:
          issue.code === 'custom' ? 'inconsistent_values' : 'invalid_value',
      })),
    };
  }
  return { ok: true, data: result.data };
}

export function getSettingDraftMetadata(key: SettingKey) {
  if (!isSettingKey(key)) throw new TypeError('Unknown setting key');
  const pendingDecision = Object.hasOwn(settingDecisions, key)
    ? settingDecisions[key as keyof typeof settingDecisions]
    : null;
  return {
    source: 'documented-draft' as const,
    status:
      documentedSettingsDefaults[key] === null
        ? ('unset' as const)
        : pendingDecision === null
          ? ('documented' as const)
          : ('provisional' as const),
    pendingDecision,
  };
}

// Explicitly named draft: there is no DB access, cache, production fallback or
// automatic approval. A later settings repository must validate actual rows.
export function createDocumentedSettingsDraft() {
  return {
    source: 'documented-draft' as const,
    values: settingsDraftSchema.parse(documentedSettingsDefaults),
    unresolvedDecisions: [...unresolvedSettingDecisions],
    keys: [...settingKeys],
  };
}

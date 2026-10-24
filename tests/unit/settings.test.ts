import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  documentedSettingsDefaults,
  settingKeys,
  type SettingValue,
} from '@/config/settings';
import {
  createDocumentedSettingsDraft,
  getSettingDraftMetadata,
  isSettingKey,
  validateSetting,
  validateSettingsDraft,
} from '@/server/settings/registry';

const defaults = () => createDocumentedSettingsDraft().values;

describe('documented settings drafts', () => {
  it('covers every registered key with validated, explicitly non-live defaults', () => {
    const draft = createDocumentedSettingsDraft();
    expect(draft.source).toBe('documented-draft');
    expect(Object.keys(draft.values)).toEqual(settingKeys);
    expect(draft.values).toEqual(documentedSettingsDefaults);
    expect(validateSettingsDraft(draft.values)).toEqual({
      ok: true,
      data: draft.values,
    });
    expect(draft.values['subscription.price_krw']).toBe(6500);
    expect(draft.values['subscription.intro_price_krw']).toBe(1000);
    expect(draft.values['subscription.retry_interval_hours']).toBe(24);
    expect(draft.values['subscription.retry_max']).toBe(3);
    expect(draft.values['notification.batch_size']).toBe(500);
  });

  it('does not share mutable nested draft values or decision lists', () => {
    const first = createDocumentedSettingsDraft();
    first.values['board.grade_thresholds'].fervent = 25;
    first.unresolvedDecisions.pop();
    const second = createDocumentedSettingsDraft();
    expect(second.values['board.grade_thresholds'].fervent).toBe(20);
    expect(second.unresolvedDecisions.length).toBeGreaterThan(
      first.unresolvedDecisions.length,
    );
    expect(Object.isFrozen(documentedSettingsDefaults)).toBe(true);
    expect(
      Object.isFrozen(documentedSettingsDefaults['board.grade_thresholds']),
    ).toBe(true);
  });

  it('keeps missing moderation and performance policy explicitly unset', () => {
    for (const key of [
      'moderation.forbidden_patterns',
      'moderation.profanity_words',
      'settlement.performance_conditions',
    ] as const) {
      expect(defaults()[key]).toBeNull();
      expect(getSettingDraftMetadata(key).status).toBe('unset');
      expect(validateSetting(key, [])).toMatchObject({ ok: false });
      expect(validateSetting(key, {})).toMatchObject({ ok: false });
      expect(validateSetting(key, null)).toEqual({ ok: true, data: null });
    }
  });

  it('keeps documented point amounts separate from activation and unresolved rules', () => {
    for (const key of [
      'points.attendance',
      'points.post',
      'points.comment',
    ] as const) {
      expect(getSettingDraftMetadata(key)).toEqual({
        source: 'documented-draft',
        status: 'provisional',
        pendingDecision: 'points-policy-activation-unapproved',
      });
    }
    const draft = createDocumentedSettingsDraft();
    expect(draft.values['points.attendance']).toBe(10);
    expect(draft.values['points.post']).toBe(20);
    expect(draft.values['points.comment']).toBe(5);
    for (const decision of [
      'points-daily-caps-unapproved',
      'points-deleted-content-treatment-unapproved',
      'missions-verification-unset',
    ]) {
      expect(draft.unresolvedDecisions).toContain(decision);
    }
    expect(
      getSettingDraftMetadata('board.grade_thresholds').pendingDecision,
    ).toBe('activity-score-definition-unset');
    expect(getSettingDraftMetadata('points.share').pendingDecision).toBe(
      'share-verification-and-caps-unset',
    );
  });

  it('marks proposals and commercial values as pending rather than approved', () => {
    expect(getSettingDraftMetadata('settlement.pg_fee_rate')).toEqual({
      source: 'documented-draft',
      status: 'provisional',
      pendingDecision: 'provider-contract-fee-unset',
    });
    expect(getSettingDraftMetadata('subscription.retry_max').status).toBe(
      'provisional',
    );
    expect(getSettingDraftMetadata('message.max_text_length').status).toBe(
      'documented',
    );
    expect(createDocumentedSettingsDraft().unresolvedDecisions).toContain(
      'refund-policy-unapproved',
    );
    expect(createDocumentedSettingsDraft().unresolvedDecisions).toContain(
      'rate-limit-values-unset',
    );
  });
});

describe('typed settings validation', () => {
  it('infers each value from its key instead of a caller-supplied type', () => {
    const numberResult = validateSetting('message.page_size', 30);
    if (numberResult.ok)
      expectTypeOf(numberResult.data).toEqualTypeOf<number>();
    const gradeResult = validateSetting('board.grade_thresholds', {
      sprout: 0,
      fervent: 20,
      core: 100,
    });
    if (gradeResult.ok) {
      expectTypeOf(gradeResult.data).toEqualTypeOf<{
        sprout: number;
        fervent: number;
        core: number;
      }>();
    }
    expectTypeOf<
      SettingValue<'moderation.profanity_words'>
    >().toEqualTypeOf<null>();
    // @ts-expect-error Unknown keys cannot be requested by typed callers.
    expect(validateSetting('unregistered', 30).ok).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, -1, 0.5, '30', null, undefined, true])(
    'rejects invalid integer settings (%s) without coercion',
    (value) => {
      expect(validateSetting('message.page_size', value).ok).toBe(false);
    },
  );

  it('applies only documented or structural numeric bounds', () => {
    expect(validateSetting('message.page_size', 100).ok).toBe(true);
    expect(validateSetting('message.page_size', 101).ok).toBe(false);
    expect(validateSetting('message.page_size', 0).ok).toBe(false);
    expect(validateSetting('schedule.notice_hour_kst', 0).ok).toBe(true);
    expect(validateSetting('schedule.notice_hour_kst', 23).ok).toBe(true);
    expect(validateSetting('schedule.notice_hour_kst', 24).ok).toBe(false);
    expect(validateSetting('settlement.base_rate', 0).ok).toBe(true);
    expect(validateSetting('settlement.base_rate', 1).ok).toBe(true);
    expect(validateSetting('settlement.base_rate', 1.01).ok).toBe(false);
    expect(validateSetting('settlement.base_rate', -0.01).ok).toBe(false);
    expect(validateSetting('points.attendance', 0).ok).toBe(true);
    expect(validateSetting('artist.weekly_message_min', 0).ok).toBe(false);
    expect(
      validateSetting('points.attendance', Number.MAX_SAFE_INTEGER).ok,
    ).toBe(true);
    expect(
      validateSetting('points.attendance', Number.MAX_SAFE_INTEGER + 1).ok,
    ).toBe(false);
  });

  it('rejects reversed profile ranges and overlapping/out-of-order grades', () => {
    expect(
      validateSettingsDraft({ ...defaults(), 'profile.call_name_min': 11 }),
    ).toMatchObject({
      ok: false,
      issues: [{ key: 'profile.call_name_min', reason: 'inconsistent_values' }],
    });
    for (const grades of [
      { sprout: 20, fervent: 10, core: 100 },
      { sprout: 0, fervent: 20, core: 20 },
      { sprout: 0, fervent: 20, core: 10 },
    ]) {
      expect(validateSetting('board.grade_thresholds', grades).ok).toBe(false);
      expect(
        validateSettingsDraft({
          ...defaults(),
          'board.grade_thresholds': grades,
        }).ok,
      ).toBe(false);
    }
  });

  it('requires complete settings rather than silently filling missing rows', () => {
    expect(validateSettingsDraft({}).ok).toBe(false);
    const incomplete: Record<string, unknown> = defaults();
    delete incomplete['subscription.price_krw'];
    expect(validateSettingsDraft(incomplete)).toMatchObject({
      ok: false,
      issues: [{ key: 'subscription.price_krw', reason: 'invalid_value' }],
    });
  });

  it.each(['__proto__', 'constructor', 'toString', 'unknown.secret'])(
    'rejects unregistered and prototype keys (%s)',
    (key) => {
      expect(isSettingKey(key)).toBe(false);
      const result = validateSettingsDraft({ ...defaults(), [key]: 'secret' });
      expect(result).toEqual({
        ok: false,
        issues: [{ key: null, reason: 'unknown_key' }],
      });
      expect(JSON.stringify(result)).not.toContain('secret');
    },
  );

  it('rejects unexpected nested fields without returning raw values', () => {
    const result = validateSetting('board.grade_thresholds', {
      sprout: 0,
      fervent: 20,
      core: 100,
      privatePayload: 'must-never-be-returned',
    });
    expect(result).toEqual({
      ok: false,
      issues: [{ key: 'board.grade_thresholds', reason: 'invalid_value' }],
    });
    expect(JSON.stringify(result)).not.toContain('must-never-be-returned');
  });

  it('does not accept inherited settings, symbols, arrays or accessors', () => {
    let getterRead = false;
    const accessor = Object.defineProperty(
      defaults(),
      'subscription.price_krw',
      {
        enumerable: true,
        get: () => {
          getterRead = true;
          return 6500;
        },
      },
    );
    for (const input of [
      null,
      [],
      Object.create(defaults()),
      { ...defaults(), [Symbol('private')]: 'secret' },
      accessor,
      {
        ...defaults(),
        'board.grade_thresholds': Object.create({
          sprout: 0,
          fervent: 20,
          core: 100,
        }),
      },
    ]) {
      expect(validateSettingsDraft(input).ok).toBe(false);
    }
    expect(getterRead).toBe(false);
  });

  it('rejects hostile proxies without throwing or leaking their error payloads', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwing = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('private-provider-payload');
        },
      },
    );
    for (const value of [revoked.proxy, throwing]) {
      expect(validateSettingsDraft(value)).toEqual({
        ok: false,
        issues: [{ key: null, reason: 'invalid_input' }],
      });
      expect(validateSetting('board.grade_thresholds', value)).toEqual({
        ok: false,
        issues: [{ key: 'board.grade_thresholds', reason: 'invalid_input' }],
      });
    }
  });
});

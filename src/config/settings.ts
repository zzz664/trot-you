import { z } from 'zod';

// Structural bounds, not newly invented commercial limits. API §2.5 caps pages
// at 100; integer bounds avoid unsafe JSON/JavaScript quantities.
export const SETTING_BOUNDS = {
  maxSafeInteger: Number.MAX_SAFE_INTEGER,
  maxPageSize: 100,
  maxHourKst: 23,
} as const;

const nonnegativeInteger = z
  .number()
  .int()
  .min(0)
  .max(SETTING_BOUNDS.maxSafeInteger);
const positiveInteger = nonnegativeInteger.min(1);
const rate = z.number().min(0).max(1);

export const settingSchemas = {
  'subscription.price_krw': positiveInteger,
  'subscription.intro_price_krw': nonnegativeInteger,
  'subscription.grace_days': nonnegativeInteger,
  'subscription.billing_notice_days_before': nonnegativeInteger,
  'subscription.retry_interval_hours': positiveInteger,
  'subscription.retry_max': nonnegativeInteger,
  'message.max_text_length': positiveInteger,
  'message.max_photos': positiveInteger,
  'message.max_voice_seconds': positiveInteger,
  'message.max_video_seconds': positiveInteger,
  'message.cancel_window_minutes': nonnegativeInteger,
  'message.visible_before_subscription_days': nonnegativeInteger,
  'message.page_size': positiveInteger.max(SETTING_BOUNDS.maxPageSize),
  'message.preview_max_count': nonnegativeInteger,
  'reply.max_length': positiveInteger,
  'profile.call_name_min': positiveInteger,
  'profile.call_name_max': positiveInteger,
  'board.max_images': nonnegativeInteger,
  'board.image_max_long_edge_px': positiveInteger,
  'board.auto_hide_report_count': positiveInteger,
  'board.grade_thresholds': z
    .strictObject({
      sprout: nonnegativeInteger,
      fervent: nonnegativeInteger,
      core: nonnegativeInteger,
    })
    .refine(
      (grades) =>
        grades.sprout < grades.fervent && grades.fervent < grades.core,
    ),
  'points.attendance': nonnegativeInteger,
  'points.post': nonnegativeInteger,
  'points.comment': nonnegativeInteger,
  'points.share': nonnegativeInteger,
  'artist.weekly_message_min': positiveInteger,
  'artist.weekly_photo_min': positiveInteger,
  'settlement.base_rate': rate,
  'settlement.performance_rate': rate,
  'settlement.vat_rate': rate,
  'settlement.pg_fee_rate': rate,
  // No approved condition shape or moderation dataset exists. Null is an
  // explicit blocker, never an empty "allow all" ruleset or enabled policy.
  'settlement.performance_conditions': z.null(),
  'schedule.notice_hour_kst': nonnegativeInteger.max(SETTING_BOUNDS.maxHourKst),
  'moderation.forbidden_patterns': z.null(),
  'moderation.profanity_words': z.null(),
  'notification.retry_max': nonnegativeInteger,
  'notification.batch_size': positiveInteger,
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.output<
  (typeof settingSchemas)[K]
>;
export type SettingsDraft = { [K in SettingKey]: SettingValue<K> };

export const settingKeys = Object.freeze(
  Object.keys(settingSchemas) as SettingKey[],
);

// Document defaults are draft data for validation/seeding work, not live
// app_settings values and not a fallback after failed/missing database reads.
export const documentedSettingsDefaults = Object.freeze({
  'subscription.price_krw': 6500,
  'subscription.intro_price_krw': 1000,
  'subscription.grace_days': 3,
  'subscription.billing_notice_days_before': 1,
  'subscription.retry_interval_hours': 24,
  'subscription.retry_max': 3,
  'message.max_text_length': 1000,
  'message.max_photos': 10,
  'message.max_voice_seconds': 180,
  'message.max_video_seconds': 60,
  'message.cancel_window_minutes': 5,
  'message.visible_before_subscription_days': 7,
  'message.page_size': 30,
  'message.preview_max_count': 5,
  'reply.max_length': 100,
  'profile.call_name_min': 2,
  'profile.call_name_max': 10,
  'board.max_images': 3,
  'board.image_max_long_edge_px': 1600,
  'board.auto_hide_report_count': 3,
  'board.grade_thresholds': Object.freeze({
    sprout: 0,
    fervent: 20,
    core: 100,
  }),
  'points.attendance': 10,
  'points.post': 20,
  'points.comment': 5,
  'points.share': 5,
  'artist.weekly_message_min': 3,
  'artist.weekly_photo_min': 2,
  'settlement.base_rate': 0.3,
  'settlement.performance_rate': 0.4,
  'settlement.vat_rate': 0.1,
  'settlement.pg_fee_rate': 0.03,
  'settlement.performance_conditions': null,
  'schedule.notice_hour_kst': 10,
  'moderation.forbidden_patterns': null,
  'moderation.profanity_words': null,
  'notification.retry_max': 3,
  'notification.batch_size': 500,
} satisfies SettingsDraft);

export const settingDecisions = {
  'subscription.intro_price_krw': 'intro-eligibility-unapproved',
  'subscription.grace_days': 'billing-retry-policy-unapproved',
  'subscription.retry_interval_hours': 'billing-retry-policy-unapproved',
  'subscription.retry_max': 'billing-retry-policy-unapproved',
  'message.visible_before_subscription_days': 'history-policy-unapproved',
  'board.grade_thresholds': 'activity-score-definition-unset',
  'points.attendance': 'points-policy-activation-unapproved',
  'points.post': 'points-policy-activation-unapproved',
  'points.comment': 'points-policy-activation-unapproved',
  'points.share': 'share-verification-and-caps-unset',
  'artist.weekly_message_min': 'artist-contract-unapproved',
  'artist.weekly_photo_min': 'artist-contract-unapproved',
  'settlement.base_rate': 'artist-contract-unapproved',
  'settlement.performance_rate': 'artist-contract-unapproved',
  'settlement.vat_rate': 'accounting-policy-unapproved',
  'settlement.pg_fee_rate': 'provider-contract-fee-unset',
  'settlement.performance_conditions': 'performance-condition-schema-unset',
  'moderation.forbidden_patterns': 'moderation-rules-unset',
  'moderation.profanity_words': 'moderation-word-list-unset',
  'notification.batch_size': 'delivery-capacity-unverified',
  'notification.retry_max': 'notification-retry-and-lease-policy-unapproved',
} as const satisfies Partial<Record<SettingKey, string>>;

export const unresolvedSettingDecisions = Object.freeze([
  'intro-eligibility-unapproved',
  'refund-policy-unapproved',
  'billing-retry-policy-unapproved',
  'history-policy-unapproved',
  'activity-score-definition-unset',
  'points-policy-activation-unapproved',
  'points-deleted-content-treatment-unapproved',
  'points-daily-caps-unapproved',
  'missions-verification-unset',
  'share-verification-and-caps-unset',
  'artist-contract-unapproved',
  'accounting-policy-unapproved',
  'provider-contract-fee-unset',
  'performance-condition-schema-unset',
  'moderation-rules-unset',
  'moderation-word-list-unset',
  'delivery-capacity-unverified',
  'notification-consent-version-unapproved',
  'notification-retry-and-lease-policy-unapproved',
  'notification-schedule-lead-policy-unapproved',
  'webpush-provider-origin-validation-unimplemented',
  'alimtalk-provider-templates-and-phone-consent-unset',
  'analytics-consent-policy-unapproved',
  'analytics-retention-policy-unapproved',
  'analytics-funnel-definitions-unset',
  'analytics-anonymous-consent-design-unset',
  'rate-limit-values-unset',
  'media-upload-byte-limits-unset',
  'public-support-and-legal-copy-unset',
] as const);

export const settingsDraftSchema = z
  .strictObject(settingSchemas)
  .superRefine((values, context) => {
    if (values['profile.call_name_min'] > values['profile.call_name_max']) {
      context.addIssue({ code: 'custom', path: ['profile.call_name_min'] });
    }
  });

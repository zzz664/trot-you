// UI-safe coverage inventory, not a generic key/value store or approval source.
// Wildcard entries name documented families or actual policy domains; they do
// not imply that arbitrary matching keys can be read, written or activated.
export const ADMIN_SETTINGS_CATALOG = [
  {
    key: 'subscription.price_krw',
    kind: 'runbook',
    group: 'checkout',
    section: 'checkout-policy',
  },
  {
    key: 'subscription.intro_price_krw',
    kind: 'runbook',
    group: 'checkout',
    section: 'checkout-policy',
  },
  {
    key: 'subscription.grace_days',
    kind: 'runbook',
    group: 'renewal',
    section: 'renewal-policy',
  },
  {
    key: 'subscription.billing_notice_days_before',
    kind: 'runbook',
    group: 'billing-notice',
    section: 'billing-notice-policy',
  },
  {
    key: 'subscription.retry_interval_hours',
    kind: 'runbook',
    group: 'renewal',
    section: 'renewal-policy',
  },
  {
    key: 'subscription.retry_max',
    kind: 'runbook',
    group: 'renewal',
    section: 'renewal-policy',
  },
  {
    key: 'message.max_text_length',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  {
    key: 'message.max_photos',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  {
    key: 'message.max_voice_seconds',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  {
    key: 'message.max_video_seconds',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  {
    key: 'message.cancel_window_minutes',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  {
    key: 'message.visible_before_subscription_days',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  {
    key: 'message.page_size',
    kind: 'editor',
    group: 'display',
    section: 'display-policy',
  },
  {
    key: 'message.preview_max_count',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  {
    key: 'reply.max_length',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  {
    key: 'profile.call_name_min',
    kind: 'runbook',
    group: 'profile',
    section: 'profile-policy',
  },
  {
    key: 'profile.call_name_max',
    kind: 'runbook',
    group: 'profile',
    section: 'profile-policy',
  },
  {
    key: 'board.max_images',
    kind: 'editor',
    group: 'community',
    section: 'community-policy',
  },
  {
    key: 'board.image_max_long_edge_px',
    kind: 'editor',
    group: 'community',
    section: 'community-policy',
  },
  {
    key: 'board.auto_hide_report_count',
    kind: 'editor',
    group: 'community',
    section: 'community-policy',
  },
  {
    key: 'board.grade_thresholds',
    kind: 'runbook',
    group: 'activity',
    section: 'activity-grades',
  },
  {
    key: 'points.attendance',
    kind: 'runbook',
    group: 'points',
    section: 'points-policy',
  },
  {
    key: 'points.post',
    kind: 'runbook',
    group: 'points',
    section: 'points-policy',
  },
  {
    key: 'points.comment',
    kind: 'runbook',
    group: 'points',
    section: 'points-policy',
  },
  {
    key: 'points.share',
    kind: 'runbook',
    group: 'points',
    section: 'points-policy',
  },
  {
    key: 'artist.weekly_message_min',
    kind: 'runbook',
    group: 'settlement',
    section: 'settlement-policy',
  },
  {
    key: 'artist.weekly_photo_min',
    kind: 'runbook',
    group: 'settlement',
    section: 'settlement-policy',
  },
  {
    key: 'settlement.base_rate',
    kind: 'runbook',
    group: 'settlement',
    section: 'settlement-policy',
  },
  {
    key: 'settlement.performance_rate',
    kind: 'runbook',
    group: 'settlement',
    section: 'settlement-policy',
  },
  {
    key: 'settlement.vat_rate',
    kind: 'runbook',
    group: 'settlement',
    section: 'settlement-policy',
  },
  {
    key: 'settlement.pg_fee_rate',
    kind: 'runbook',
    group: 'settlement',
    section: 'settlement-policy',
  },
  {
    key: 'settlement.performance_conditions',
    kind: 'runbook',
    group: 'settlement',
    section: 'settlement-policy',
  },
  {
    key: 'schedule.notice_hour_kst',
    kind: 'runbook',
    group: 'schedule',
    section: 'schedule-notice-policy',
  },
  {
    key: 'moderation.forbidden_patterns',
    kind: 'runbook',
    group: 'moderation',
    section: 'moderation-policy',
  },
  {
    key: 'moderation.profanity_words',
    kind: 'runbook',
    group: 'moderation',
    section: 'moderation-policy',
  },
  {
    key: 'notification.retry_max',
    kind: 'runbook',
    group: 'notification',
    section: 'notification-policy',
  },
  {
    key: 'notification.batch_size',
    kind: 'runbook',
    group: 'notification',
    section: 'notification-policy',
  },
  {
    key: 'media.*',
    kind: 'editor',
    group: 'message',
    section: 'message-policy',
  },
  { key: 'rate.*', kind: 'runbook', group: 'rate', section: 'rate-policy' },
  {
    key: 'public.*',
    kind: 'runbook',
    group: 'public',
    section: 'public-copy-and-legal-policy',
  },
  {
    key: 'analytics.*',
    kind: 'runbook',
    group: 'analytics',
    section: 'analytics-policy',
  },
  {
    key: 'artist.account_link.*',
    kind: 'runbook',
    group: 'account-link',
    section: 'account-link-policy',
  },
  {
    key: 'refund.*',
    kind: 'runbook',
    group: 'refund',
    section: 'refund-policy',
  },
] as const;

export type AdminSettingsCatalogEntry = (typeof ADMIN_SETTINGS_CATALOG)[number];
export type AdminSettingsManagement = AdminSettingsCatalogEntry['kind'];
export type AdminSettingsCatalogGroup = AdminSettingsCatalogEntry['group'];
export type AdminSettingsRunbookSection = AdminSettingsCatalogEntry['section'];

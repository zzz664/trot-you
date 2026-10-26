// Exact per-work manifests replace cumulative dependency groups.
// Unknown impact is an error; no event/path is permission to run all tests.
export const BROWSER_JOBS = Object.freeze([
  'auth-browser',
  'enrollment-browser',
  'renewal-browser',
  'cancellation-browser',
  'reconciliation-browser',
  'media-browser',
  'chat-browser',
  'reply-browser',
  'speech-browser',
  'compose-browser',
  'dispatch-browser',
  'activity-browser',
  'webpush-browser',
  'billing-notices-browser',
  'admin-artists-browser',
  'admin-settings-browser',
  'admin-subscriptions-browser',
  'schedules-browser',
  'schedule-notices-browser',
  'content-calendar-browser',
  'community-posts-browser',
  'community-interactions-browser',
  'community-moderation-browser',
  'attendance-points-browser',
  'activity-rewards-browser',
  'analytics-funnel-browser',
  'settlement-reports-browser',
]);

export const CONDITIONAL_JOBS = Object.freeze(['database', ...BROWSER_JOBS]);
export const REQUIRED_JOB_IDS = Object.freeze([
  'impact',
  'quality',
  ...CONDITIONAL_JOBS,
]);

export function isDocumentation(path) {
  return (
    path === 'README.md' || path === 'AGENTS.md' || /^docs\/.+\.md$/.test(path)
  );
}

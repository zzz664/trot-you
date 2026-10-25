// Conservative dependency groups, not filename-to-test guesses. Full rules
// always win; all matching feature groups are unioned. Unknown paths run full.
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
]);

export const CONDITIONAL_JOBS = Object.freeze(['database', ...BROWSER_JOBS]);
export const REQUIRED_JOB_IDS = Object.freeze([
  'impact',
  'quality',
  ...CONDITIONAL_JOBS,
]);

const browsers = (...names) => names.map((name) => `${name}-browser`);
const communication = browsers(
  'auth',
  'media',
  'chat',
  'reply',
  'speech',
  'compose',
  'dispatch',
  'activity',
  'admin-artists',
  'community-posts',
);
const payment = browsers(
  'auth',
  'enrollment',
  'renewal',
  'cancellation',
  'reconciliation',
  'billing-notices',
  'admin-subscriptions',
);
// Calendar consumes shared schedule date/navigation helpers, activity and artist
// choices. New calendar paths remain unknown/full until separately reviewed.
const schedules = browsers(
  'auth',
  'schedules',
  'schedule-notices',
  'content-calendar',
  'community-posts',
);
const notification = browsers(
  'auth',
  'webpush',
  'billing-notices',
  'schedule-notices',
  'schedules',
);

export const FULL_RULES = Object.freeze([
  {
    id: 'ci-and-toolchain',
    patterns: [
      /^\.github\//,
      /^scripts\/ci-/,
      /^(?:package(?:-lock)?\.json|\.nvmrc|\.node-version|\.npmrc|\.env(?:\..*)?)$/,
      /^(?:next|vitest|eslint|postcss|serwist)\.config\./,
      /^playwright\.config\.ts$/,
      /^tsconfig(?:\.[^/]+)?\.json$/,
      /^scripts\/(?:build-pwa|generate-offline-page|check-contrast)\.mjs$/,
    ],
  },
  {
    id: 'database-and-shared-adapters',
    patterns: [
      /^supabase\//,
      /^src\/server\/(?:db|adapters|settings)\//,
      /^src\/types\//,
      /^scripts\/(?:test-|generate-database-types|activity-race-observer)/,
    ],
  },
  {
    id: 'auth-and-application-shell',
    patterns: [
      /^src\/server\/(?:auth|onboarding|install|artists)\//,
      /^src\/server\/services\/(?:auth|onboarding|artists)\//,
      /^src\/components\/(?:ui|auth|onboarding|artists|pwa)\//,
      /^src\/components\/.*Entr(?:y|ies)\.tsx?$/,
      /^src\/app\/(?:layout|globals|page|error|global-error|not-found|loading)\./,
      /^src\/app\/(?:\(fan\)|onboarding|start|restricted)\//,
      /^src\/app\/(?:admin|artist)\/page\.tsx$/,
      /^src\/app\/api\/(?:auth|onboarding)\//,
      /^src\/proxy\.ts$/,
      /^scripts\/auth-local-/,
      /^tests\/e2e\/authenticated\//,
      /^playwright\.auth\.config\.ts$/,
    ],
  },
  {
    id: 'global-config-and-worker',
    patterns: [
      /^src\/(?:messages|i18n)\//,
      // Feature config is also imported by the global environment schema and by
      // other feature schemas. Keep the entire runtime configuration layer full.
      /^src\/config\//,
      /^src\/lib\/(?:result|design-tokens)\.ts$/,
      /^src\/worker\/(?:sw|cache-policy)\.ts$/,
      /^src\/server\/configuration\.ts$/,
    ],
  },
]);

export const FEATURE_RULES = Object.freeze([
  {
    id: 'schedules-and-notices',
    jobs: schedules,
    patterns: [
      /^src\/(?:components|server(?:\/services)?)\/(?:schedules|schedule-notices)\//,
      /^src\/(?:client|config)\/(?:schedules|schedule-notices|schedule-view)\.ts$/,
      /^src\/lib\/(?:schedule-[^/]+|map-links)\.ts$/,
      /^src\/app\/(?:schedules|admin\/schedules|api\/(?:schedules|admin\/schedules|schedule-notices|cron\/notify-schedules))\//,
      /^tests\/unit\/(?:schedules|schedule-notices|schedule-view)-/,
      /^tests\/fixtures\/schedule-timezone\.json$/,
      /^tests\/e2e\/(?:schedules|schedule-notices)(?:\/|-unconfigured\.spec\.ts$)/,
      /^scripts\/(?:schedules|schedule-notices)-local-/,
      /^playwright\.(?:schedules|schedule-notices)\.config\.ts$/,
    ],
  },
  {
    id: 'notification-delivery',
    jobs: notification,
    patterns: [
      /^src\/(?:components|server(?:\/services)?)\/(?:webpush|billing-notices|notification)\//,
      /^src\/(?:client|config)\/(?:webpush(?:-[^/]+)?|billing-notices)\.ts$/,
      /^src\/worker\/webpush\.ts$/,
      /^src\/app\/(?:settings\/notifications|me\/billing-notices|api\/(?:push|billing-notices|cron\/(?:send-notifications|billing-notices)))\//,
      /^tests\/unit\/(?:webpush|billing-notices)-/,
      /^tests\/e2e\/(?:webpush|billing-notices)(?:\/|-unconfigured\.spec\.ts$)/,
      /^scripts\/(?:webpush|billing-notices)-local-/,
      /^playwright\.(?:webpush|billing-notices)\.config\.ts$/,
    ],
  },
  {
    id: 'payment-lifecycle',
    jobs: payment,
    patterns: [
      /^src\/(?:components|server(?:\/services)?)\/(?:checkout|enrollment|renewal|subscription(?:-management)?|reconciliation|provider-events)\//,
      /^src\/components\/admin\/(?:refunds|reconciliation)\//,
      /^src\/(?:client|config)\/(?:checkout|enrollment(?:-[^/]+)?|renewal(?:-[^/]+)?|cancellation(?:-[^/]+)?|reconciliation(?:-[^/]+)?|subscription(?:-management)?|management|refunds?|refund-provider|provider-events|billing-policy|payment-preparation)\.ts$/,
      /^src\/lib\/billing-period\.ts$/,
      /^src\/app\/(?:checkout|me\/subscriptions|admin\/(?:refunds|reconciliation)|api\/(?:checkout|subscriptions|admin\/refunds|webhooks\/payment|cron\/(?:charge-renewals|reconcile-payments)))\//,
      /^tests\/unit\/(?:checkout|enrollment|renewal|cancellation|reconciliation|subscription|management|refund|provider-event|payment-preparation)/,
      /^tests\/e2e\/(?:enrollment|renewal|cancellation|reconciliation)(?:\/|-unconfigured\.spec\.ts$)/,
      /^scripts\/(?:enrollment|renewal|cancellation|reconciliation)-local-/,
      /^playwright\.(?:enrollment|renewal|cancellation|reconciliation)\.config\.ts$/,
    ],
  },
  {
    id: 'communication-and-shared-media',
    jobs: communication,
    patterns: [
      /^src\/components\/(?:media|fan|speech|artist-compose(?:-menu)?|artist-dispatch)\//,
      /^src\/server\/(?:media|chat|replies|artist-compose|message-dispatch)\//,
      /^src\/server\/services\/(?:media|chat|replies|artist-compose|message(?:-dispatch)?)\//,
      /^src\/(?:client|config)\/(?:media(?:-[^/]+)?|chat|replies|speech|compose(?:-[^/]+)?|artist-compose|message-dispatch|dispatch)\.ts$/,
      /^src\/lib\/speech-draft\.ts$/,
      /^src\/app\/artist\/\[slug\]\/(?:compose|dispatch)\//,
      /^src\/app\/artist\/messages\//,
      /^src\/app\/api\/(?:media|artist\/\[slug\]\/(?:compose|dispatch)|artists\/\[slug\]\/(?:messages|replies)|cron\/dispatch-messages)\//,
      /^src\/app\/artists\/\[slug\]\//,
      /^tests\/unit\/(?:media|chat|reply|speech|compose|dispatch|message-render|storage)-/,
      /^tests\/fixtures\/media\//,
      /^tests\/e2e\/(?:media|chat|replies|speech|compose|dispatch)(?:\/|-unconfigured\.spec\.ts$)/,
      /^scripts\/(?:media|chat|reply|speech|compose|dispatch)-local-/,
      /^playwright\.(?:media|chat|replies|speech|compose|dispatch)\.config\.ts$/,
    ],
  },
  {
    id: 'artist-reply-activity',
    jobs: browsers('auth', 'activity', 'content-calendar'),
    patterns: [
      /^src\/(?:components|server(?:\/services)?)\/artist-reply-activity\//,
      /^src\/(?:client|config)\/artist-reply-activity\.ts$/,
      /^src\/app\/(?:artist\/(?:\[slug\]\/)?replies|api\/artist\/\[slug\]\/replies)\//,
      /^tests\/unit\/(?:activity|artist-reply-activity)-/,
      /^tests\/e2e\/activity(?:\/|-unconfigured\.spec\.ts$)/,
      /^scripts\/activity-local-/,
      /^playwright\.activity\.config\.ts$/,
    ],
  },
  {
    id: 'admin-artists-and-access',
    jobs: [...communication, 'schedules-browser', 'content-calendar-browser'],
    patterns: [
      /^src\/(?:components|server(?:\/services)?)\/admin-artists\//,
      /^src\/(?:client|config)\/admin-artists\.ts$/,
      /^src\/app\/(?:admin\/artists|me\/artist-access|api\/(?:admin\/artists|artist-access))\//,
      /^tests\/unit\/admin-artists-/,
      /^tests\/e2e\/admin-artists(?:\/|-unconfigured\.spec\.ts$)/,
      /^scripts\/admin-artists-local-/,
      /^playwright\.admin-artists\.config\.ts$/,
    ],
  },
  ...['admin-settings', 'admin-subscriptions'].map((feature) => ({
    id: feature,
    jobs: browsers(
      'auth',
      feature,
      ...(feature === 'admin-settings' ? ['community-posts'] : []),
    ),
    patterns: [
      new RegExp(`^src/(?:components|server(?:/services)?)/${feature}/`),
      new RegExp(`^src/(?:client|config)/${feature}\\.ts$`),
      new RegExp(`^src/app/(?:admin|api/admin)/${feature.slice(6)}/`),
      new RegExp(`^tests/unit/${feature}-`),
      new RegExp(`^tests/e2e/${feature}(?:/|-unconfigured\\.spec\\.ts$)`),
      new RegExp(`^scripts/${feature}-local-`),
      new RegExp(`^playwright\\.${feature}\\.config\\.ts$`),
    ],
  })),
]);

export function isDocumentation(path) {
  return path === 'README.md' || /^docs\/.+\.md$/.test(path);
}

export function classifyPath(path) {
  const full = FULL_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(path)),
  );
  if (full.length) return { kind: 'full', rules: full.map(({ id }) => id) };
  if (isDocumentation(path)) return { kind: 'docs', rules: [] };
  const matches = FEATURE_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(path)),
  );
  return matches.length
    ? { kind: 'feature', rules: matches.map(({ id }) => id) }
    : { kind: 'full', rules: ['unknown-path'] };
}

export const routes = {
  home: '/',
  communityReports: '/me/reports',
  communityModerationApi: '/api/community/moderation',
  adminModeration: '/admin/moderation',
  adminModerationApi: '/api/admin/moderation',
  board: '/board',
  boardApi: '/api/board',
  communityImageBegin: '/api/board/media/begin',
  communityImageComplete: '/api/board/media/complete',
  communityImageRevoke: '/api/board/media/revoke',
  communityImageRead: '/api/board/media/read',
  schedules: '/schedules',
  schedulesApi: '/api/schedules',
  scheduleNoticeStatus: '/api/schedule-notices',
  scheduleNoticePreference: '/api/schedule-notices/preference',
  scheduleNoticeEvent: '/api/schedule-notices/event',
  notifySchedulesCron: '/api/cron/notify-schedules',
  adminContentCalendar: '/admin/content-calendar',
  adminContentCalendarApi: '/api/admin/content-calendar',
  adminSchedules: '/admin/schedules',
  adminSchedulesApi: '/api/admin/schedules',
  start: '/start',
  onboarding: '/onboarding',
  onboardingFont: '/onboarding/font',
  onboardingName: '/onboarding/name',
  onboardingConsent: '/onboarding/consent',
  onboardingArtists: '/onboarding/artists',
  onboardingInstall: '/onboarding/install',
  artists: '/artists',
  artistMessages: '/api/artists',
  analytics: '/api/analytics',
  notifications: '/settings/notifications',
  billingNotices: '/me/billing-notices',
  billingNoticeStatus: '/api/billing-notices',
  billingNoticeRead: '/api/billing-notices/read',
  billingNoticePreference: '/api/billing-notices/preference',
  createBillingNotices: '/api/cron/billing-notices',
  notificationInstallGuide:
    '/settings/notifications#notification-install-guide',
  pushSubscription: '/api/push/subscribe',
  sendNotifications: '/api/cron/send-notifications',
  mediaUpload: '/api/media/upload-url',
  mediaComplete: '/api/media/complete',
  mediaRead: '/api/media/signed-url',
  mediaRevoke: '/api/media/revoke',
  artistSelectionSubmit: '/api/onboarding/artist',
  onboardingSubmit: '/api/onboarding',
  installSubmit: '/api/onboarding/install',
  checkout: '/checkout',
  checkoutSubmit: '/api/checkout',
  checkoutCancel: '/api/checkout/cancel',
  checkoutReturn: '/api/checkout/return',
  enrollmentStart: '/api/checkout/enrollment/start',
  enrollmentConfirm: '/api/checkout/enrollment/confirm',
  enrollmentCancel: '/api/checkout/enrollment/cancel',
  enrollmentReconcile: '/api/checkout/enrollment/reconcile',
  enrollmentStatus: '/api/checkout/enrollment/status',
  enrollmentComplete: '/checkout/complete',
  dispatchMessages: '/api/cron/dispatch-messages',
  chargeRenewals: '/api/cron/charge-renewals',
  reconcilePayments: '/api/cron/reconcile-payments',
  tossPaymentWebhook: '/api/webhooks/payment/toss',
  adminReconciliation: '/admin/reconciliation',
  subscriptions: '/me/subscriptions',
  subscriptionStatus: '/api/subscriptions/status',
  subscriptionCancel: '/api/subscriptions/cancel',
  refundRequest: '/api/subscriptions/refund-request',
  adminRefunds: '/admin/refunds',
  adminRefundStatus: '/api/admin/refunds/status',
  refundAuthorize: '/api/admin/refunds/authorize',
  refundExecute: '/api/admin/refunds/execute',
  refundReconcile: '/api/admin/refunds/reconcile',
  refundReject: '/api/admin/refunds/reject',
  restricted: '/restricted',
  artist: '/artist',
  artistDispatchHistory: '/artist/messages',
  artistReplyActivityMenu: '/artist/replies',
  artistComposeApi: '/api/artist',
  admin: '/admin',
  adminArtists: '/admin/artists',
  adminSettings: '/admin/settings',
  adminSubscriptions: '/admin/subscriptions',
  adminSubscriptionsApi: '/api/admin/subscriptions',
  adminSettingsPolicies: '/admin/settings/policies',
  adminSettingsApi: '/api/admin/settings',
  adminArtistsApi: '/api/admin/artists',
  artistAccess: '/me/artist-access',
  artistAccessApi: '/api/artist-access',
  authLogin: '/api/auth/login',
  authCallback: '/api/auth/callback',
  authLogout: '/api/auth/logout',
  uiPreview: '/ui-preview',
} as const;
export type AppRoute = (typeof routes)[keyof typeof routes];

export function artistPreviewPath(slug: string) {
  return `${routes.artists}/${encodeURIComponent(slug)}`;
}
export function artistCatalogPath(page: number, onboarding = false) {
  const base = onboarding ? routes.onboardingArtists : routes.artists;
  return page > 1 ? `${base}?page=${page}` : base;
}

export function checkoutPath(slug: string) {
  return `${routes.checkout}/${encodeURIComponent(slug)}`;
}

export function enrollmentCompletePath(sessionId: string) {
  return `${routes.enrollmentComplete}?session=${encodeURIComponent(sessionId)}`;
}

export function subscriptionPath(subscriptionId: string, page = 1) {
  const base = `${routes.subscriptions}/${encodeURIComponent(subscriptionId)}`;
  return page > 1 ? `${base}?page=${page}` : base;
}

export function adminRefundPath(requestId: string) {
  return `${routes.adminRefunds}/${encodeURIComponent(requestId)}`;
}

export function subscriptionListPath(page: number) {
  return page > 1
    ? `${routes.subscriptions}?page=${page}`
    : routes.subscriptions;
}

export function adminRefundListPath(page: number) {
  return page > 1 ? `${routes.adminRefunds}?page=${page}` : routes.adminRefunds;
}

export function adminReconciliationPath(page: number) {
  return page > 1
    ? `${routes.adminReconciliation}?page=${page}`
    : routes.adminReconciliation;
}

export function chatMessagesPath(slug: string) {
  return `${routes.artistMessages}/${encodeURIComponent(slug)}/messages`;
}

export function chatReadPath(slug: string, messageId: string) {
  return `${chatMessagesPath(slug)}/${encodeURIComponent(messageId)}/read`;
}

export function fanRepliesPath(slug: string) {
  return `${routes.artistMessages}/${encodeURIComponent(slug)}/replies`;
}

export function artistComposePath(slug: string, messageId?: string) {
  const path = `${routes.artist}/${encodeURIComponent(slug)}/compose`;
  return messageId ? `${path}?draft=${encodeURIComponent(messageId)}` : path;
}
export function artistComposeApiPath(
  slug: string,
  action?: 'save' | 'preview' | 'remove',
) {
  const path = `${routes.artistComposeApi}/${encodeURIComponent(slug)}/compose`;
  return action ? `${path}/${action}` : path;
}

export function artistComposeMenuPath(afterSlug?: string) {
  return afterSlug
    ? `${routes.artist}?after=${encodeURIComponent(afterSlug)}`
    : routes.artist;
}

export function artistDispatchApiPath(
  slug: string,
  action?: 'submit' | 'cancel',
) {
  const path = `${routes.artistComposeApi}/${encodeURIComponent(slug)}/dispatch`;
  return action ? `${path}/${action}` : path;
}

export function artistDispatchPath(slug: string) {
  return `${routes.artist}/${encodeURIComponent(slug)}/dispatch`;
}
export function artistDispatchMenuPath(afterSlug?: string) {
  return afterSlug
    ? `${routes.artistDispatchHistory}?after=${encodeURIComponent(afterSlug)}`
    : routes.artistDispatchHistory;
}

export function artistReplyActivityMenuPath(afterSlug?: string) {
  return afterSlug
    ? `${routes.artistReplyActivityMenu}?after=${encodeURIComponent(afterSlug)}`
    : routes.artistReplyActivityMenu;
}
export function artistReplyActivityPath(
  slug: string,
  messageId?: string | null,
  cursor?: string | null,
) {
  const path = `${routes.artist}/${encodeURIComponent(slug)}/replies`;
  const query = new URLSearchParams();
  if (messageId) query.set('message', messageId);
  if (cursor) query.set('cursor', cursor);
  return query.size ? `${path}?${query.toString()}` : path;
}
export function artistReplyActivityApiPath(slug: string, action?: 'messages') {
  const path = `${routes.artistComposeApi}/${encodeURIComponent(slug)}/replies`;
  return action ? `${path}/${action}` : path;
}

export function billingNoticePath(cursor?: string | null) {
  return cursor
    ? `${routes.billingNotices}?cursor=${encodeURIComponent(cursor)}`
    : routes.billingNotices;
}

export function adminArtistPath(id: string, page = 1) {
  const base = `${routes.adminArtists}/${encodeURIComponent(id)}`;
  return page > 1 ? `${base}?page=${page}` : base;
}
export function artistAccessPath(page = 1) {
  return page > 1 ? `${routes.artistAccess}?page=${page}` : routes.artistAccess;
}
export function adminArtistListPath(page: number) {
  return page > 1 ? `${routes.adminArtists}?page=${page}` : routes.adminArtists;
}
export function adminArtistApiPath(
  action?: 'save' | 'previews' | 'invite' | 'cancel-invite' | 'unlink',
) {
  return action
    ? `${routes.adminArtistsApi}/${action}`
    : routes.adminArtistsApi;
}

export function adminSettingsPolicyPath(section: string) {
  return `${routes.adminSettingsPolicies}#${encodeURIComponent(section)}`;
}

export function adminSubscriptionPath(
  query: { from: string; to: string; artist_id: string | null; page: number },
  api = false,
) {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.artist_id) params.set('artist_id', query.artist_id);
  if (query.page > 1) params.set('page', String(query.page));
  return `${api ? routes.adminSubscriptionsApi : routes.adminSubscriptions}?${params.toString()}`;
}

export function scheduleListPath(
  month: string,
  cursor?: string | null,
  api = false,
) {
  const params = new URLSearchParams({ month });
  if (cursor) params.set('cursor', cursor);
  return `${api ? routes.schedulesApi : routes.schedules}?${params.toString()}`;
}
export function scheduleDetailPath(id: string, month?: string) {
  const base = `${routes.schedules}/${encodeURIComponent(id)}`;
  return month ? `${base}?${new URLSearchParams({ month }).toString()}` : base;
}
export function adminScheduleListPath(month: string, page = 1, api = false) {
  const params = new URLSearchParams({ month });
  if (page > 1) params.set('page', String(page));
  return `${api ? routes.adminSchedulesApi : routes.adminSchedules}?${params.toString()}`;
}
export function adminSchedulePath(id: string) {
  return `${routes.adminSchedules}/${encodeURIComponent(id)}`;
}
export function adminScheduleApiPath(action?: 'save' | 'delete') {
  return action
    ? `${routes.adminSchedulesApi}/${action}`
    : routes.adminSchedulesApi;
}

export function adminContentCalendarPath(
  month: string,
  artistId?: string | null,
  page = 1,
  api = false,
) {
  const query = new URLSearchParams({ month });
  if (artistId) query.set('artist_id', artistId);
  if (page > 1) query.set('page', String(page));
  return `${api ? routes.adminContentCalendarApi : routes.adminContentCalendar}?${query}`;
}
export function adminContentCalendarApiPath(action?: 'save' | 'delete') {
  return action
    ? `${routes.adminContentCalendarApi}/${action}`
    : routes.adminContentCalendarApi;
}
export function artistContentCalendarPath(
  slug: string,
  month?: string,
  api = false,
) {
  const base = `${api ? routes.artistComposeApi : routes.artist}/${encodeURIComponent(slug)}/calendar`;
  return month ? `${base}?${new URLSearchParams({ month })}` : base;
}

export function communityBoardPath(
  slug: string,
  cursor?: string | null,
  api = false,
) {
  const base = `${api ? routes.boardApi : routes.board}/${encodeURIComponent(slug)}`;
  return cursor ? `${base}?${new URLSearchParams({ cursor })}` : base;
}
export function communityPostPath(slug: string, postId: string, api = false) {
  return `${communityBoardPath(slug, null, api)}/${encodeURIComponent(postId)}`;
}
export function communityCreatePath(slug: string) {
  return `${communityBoardPath(slug)}/new`;
}
export function communityPostActionPath(
  slug: string,
  postId: string,
  action: 'delete' | 'notice',
) {
  return `${communityPostPath(slug, postId, true)}/${action}`;
}
export function communityMediaPath(
  action: 'begin' | 'complete' | 'revoke' | 'read',
) {
  return `${routes.boardApi}/media/${action}`;
}

export function communityCommentsPath(
  slug: string,
  postId: string,
  cursor?: string | null,
) {
  const base = `${communityPostPath(slug, postId, true)}/comments`;
  return cursor ? `${base}?${new URLSearchParams({ cursor })}` : base;
}
export function communityCommentActionPath(
  slug: string,
  postId: string,
  commentId: string,
  action: 'edit' | 'delete',
) {
  return `${communityCommentsPath(slug, postId)}/${encodeURIComponent(commentId)}/${action}`;
}
export function communityLikePath(slug: string, postId: string) {
  return `${communityPostPath(slug, postId, true)}/like`;
}

export function moderationContextPath(target: {
  target_type: string;
  target_id: string;
}) {
  return `${routes.communityModerationApi}?${new URLSearchParams(target)}`;
}
export function moderationReportPath() {
  return `${routes.communityModerationApi}/report`;
}
export function moderationQueuePath(cursor?: string | null) {
  return cursor
    ? `${routes.adminModerationApi}?${new URLSearchParams({ cursor })}`
    : routes.adminModerationApi;
}
export function moderationNoticesPath(cursor?: string | null) {
  const base = `${routes.communityModerationApi}/notices`;
  return cursor ? `${base}?${new URLSearchParams({ cursor })}` : base;
}
export function moderationAdminActionPath(action: 'resolve' | 'restrict') {
  return `${routes.adminModerationApi}/${action}`;
}

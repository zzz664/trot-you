export const routes = {
  home: '/',
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
  artistComposeApi: '/api/artist',
  admin: '/admin',
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

/** Protocol/safety limits, not user-editable notification policy. */
export const WEBPUSH_PROTOCOL = {
  curve: 'prime256v1',
  keyBytes: 65,
  scalarBytes: 32,
  base64InputBytes: 3,
  base64OutputCharacters: 4,
  authBytes: 16,
  saltBytes: 16,
  nonceBytes: 12,
  aesKeyBytes: 16,
  tagBytes: 16,
  recordSize: 4096,
  // Keep the generic application notification well below provider limits.
  payloadMaxBytes: 2048,
  endpointMaxLength: 2048,
  subjectMaxLength: 512,
  topicMaxLength: 32,
  timeoutMs: 4000,
  timeoutMinMs: 1,
  timeoutMaxMs: 4000,
  ttlSeconds: 300,
  vapidLifetimeSeconds: 3600,
  millisecondsPerSecond: 1000,
  retryAfterMaxSeconds: 86400,
  yearsPerCentury: 100,
  obsoleteDateFutureYears: 50,
  tlsPort: 443,
  responseHeaderMaxBytes: 8192,
  p256PointPrefix: 4,
  finalRecordDelimiter: 2,
  recordSizeBytes: 4,
  https: 'https:',
  fcmHost: 'fcm.googleapis.com',
  fcmPaths: ['/wp/', '/fcm/send/'],
  mozillaHost: 'updates.push.services.mozilla.com',
  mozillaPath: '/wpush/',
  appleSuffix: '.push.apple.com',
  acceptedStatuses: [201, 202],
  deadStatuses: [404, 410],
  retryableStatuses: [429, 503],
  ambiguousStatuses: [408, 425, 502, 504],
  clientErrorMin: 400,
  clientErrorMax: 499,
  redirectMin: 300,
  redirectMax: 399,
} as const;

// RFC9110 HTTP-date forms: IMF-fixdate plus the two obsolete forms recipients
// must understand. Date parsing is never used as a permissive integer parser.
export const WEBPUSH_HTTP_DATE_PATTERNS = [
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/,
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4}$/,
] as const;

// Conservative egress policy: ordinary global addresses only. More-specific
// globally reachable exceptions inside special-purpose ranges are not needed.
export const WEBPUSH_BLOCKED_IPV4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const;
export const WEBPUSH_BLOCKED_IPV6 = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const;
export const WEBPUSH_ADDRESS_BITS = {
  ipv4Family: 4,
  ipv4: 32,
  ipv6: 128,
  octet: 8,
  hextet: 16,
  ipv6Hextets: 8,
  radix: 16,
  globalIpv6: ['2000::', 3],
} as const;

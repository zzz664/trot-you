// Public RFC 8291 section 5 / Appendix A cryptographic example material.
// Deliberately static, synthetic CI fixtures. NEVER production VAPID credentials.
// No key generation or external endpoint request is performed by these fixtures.
export const WEBPUSH_CI_ENV = Object.freeze({
  WEBPUSH_LOCAL_E2E: 'true',
  WEBPUSH_ENABLED: 'true',
  WEBPUSH_WORKER_ENABLED: 'false',
  VAPID_PUBLIC_KEY:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  VAPID_PRIVATE_KEY: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  VAPID_SUBJECT: 'mailto:synthetic-push@example.invalid',
});
export const WEBPUSH_CI_SUBSCRIPTION = Object.freeze({
  endpoint: 'https://fcm.googleapis.com/wp/synthetic-ci-device',
  expirationTime: null,
  keys: Object.freeze({
    p256dh:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }),
});

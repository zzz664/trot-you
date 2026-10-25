// Published RFC8291 Section 5 / Appendix A examples. These are public,
// synthetic protocol test material, NOT account credentials or usable secrets.
// Never use them in an actual deployment or provider subscription.
export const PUSH_VECTOR = {
  receiverPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  receiverPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  senderPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  ciphertext:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
} as const;
export const SYNTHETIC_PUSH_CONFIGURATION = {
  publicKey: PUSH_VECTOR.senderPublic,
  privateKey: PUSH_VECTOR.senderPrivate,
  subject: 'mailto:synthetic-push@example.invalid',
} as const;
export const SYNTHETIC_PUSH_MESSAGE = {
  endpoint: 'https://fcm.googleapis.com/wp/synthetic-ci-device',
  p256dh: PUSH_VECTOR.receiverPublic,
  auth: PUSH_VECTOR.auth,
  topic: 'synthetic_notification_1',
  payload: JSON.stringify({
    version: 1,
    notificationId: '00000000-0000-4000-8000-000000000001',
    url: '/me/subscriptions',
  }),
} as const;

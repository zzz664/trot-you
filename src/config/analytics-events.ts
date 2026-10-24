import { z } from 'zod';

// The complete documented event vocabulary. These are measurements, not funnel
// definitions or proof that a browser-supplied business operation took place.
export const AnalyticsEvent = {
  SIGNUP_COMPLETE: 'signup_complete',
  FONT_SIZE_SELECTED: 'font_size_selected',
  PREVIEW_VIEW: 'preview_view',
  SUBSCRIBE_START: 'subscribe_start',
  SUBSCRIBE_COMPLETE: 'subscribe_complete',
  SUBSCRIBE_FAIL: 'subscribe_fail',
  MESSAGE_OPEN: 'message_open',
  REPLY_SENT: 'reply_sent',
  VOICE_INPUT_USED: 'voice_input_used',
  RENEW: 'renew',
  CANCEL: 'cancel',
  POST_CREATE: 'post_create',
  ATTENDANCE: 'attendance',
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

// Only these two observations are accepted from an authenticated client. A
// successful parse is not consent, authorization, source access or DB ingestion.
export const ClientAnalyticsEvent = {
  MESSAGE_OPEN: AnalyticsEvent.MESSAGE_OPEN,
  VOICE_INPUT_USED: AnalyticsEvent.VOICE_INPUT_USED,
} as const;

export const VerifiedChargeAnalyticsEvent = {
  SUBSCRIBE_COMPLETE: AnalyticsEvent.SUBSCRIBE_COMPLETE,
  RENEW: AnalyticsEvent.RENEW,
} as const;

// Server observations exclude charge recognition: the latter must be derived
// from the verified immutable payment ledger through its dedicated DB boundary.
export const ServerAnalyticsEvent = {
  SIGNUP_COMPLETE: AnalyticsEvent.SIGNUP_COMPLETE,
  FONT_SIZE_SELECTED: AnalyticsEvent.FONT_SIZE_SELECTED,
  PREVIEW_VIEW: AnalyticsEvent.PREVIEW_VIEW,
  SUBSCRIBE_START: AnalyticsEvent.SUBSCRIBE_START,
  SUBSCRIBE_FAIL: AnalyticsEvent.SUBSCRIBE_FAIL,
  REPLY_SENT: AnalyticsEvent.REPLY_SENT,
  CANCEL: AnalyticsEvent.CANCEL,
  POST_CREATE: AnalyticsEvent.POST_CREATE,
  ATTENDANCE: AnalyticsEvent.ATTENDANCE,
} as const;

const sourceProperties = z.strictObject({ source_id: z.uuid() });

// No arbitrary JSON values, text, URLs, provider payloads or credential fields.
// UUID source handles are resolved/validated by the trusted database entry point;
// accepting a UUID here neither establishes its ownership nor makes it public.
export const analyticsPropertySchemas = {
  [AnalyticsEvent.SIGNUP_COMPLETE]: z.strictObject({}),
  [AnalyticsEvent.FONT_SIZE_SELECTED]: z.strictObject({
    font_scale: z.enum(['normal', 'large', 'xlarge']),
  }),
  [AnalyticsEvent.PREVIEW_VIEW]: sourceProperties,
  [AnalyticsEvent.SUBSCRIBE_START]: sourceProperties,
  [AnalyticsEvent.SUBSCRIBE_COMPLETE]: sourceProperties,
  [AnalyticsEvent.SUBSCRIBE_FAIL]: sourceProperties,
  [AnalyticsEvent.MESSAGE_OPEN]: sourceProperties,
  [AnalyticsEvent.REPLY_SENT]: sourceProperties,
  [AnalyticsEvent.VOICE_INPUT_USED]: z.strictObject({
    voice_context: z.enum(['reply', 'post', 'comment']),
  }),
  [AnalyticsEvent.RENEW]: sourceProperties,
  [AnalyticsEvent.CANCEL]: sourceProperties,
  [AnalyticsEvent.POST_CREATE]: sourceProperties,
  [AnalyticsEvent.ATTENDANCE]: sourceProperties,
} as const satisfies Record<AnalyticsEventName, z.ZodType>;

function eventSchema<Name extends AnalyticsEventName>(name: Name) {
  return z.strictObject({
    event_key: z.uuid(),
    name: z.literal(name),
    properties: analyticsPropertySchemas[name],
  });
}

// No actor, timestamp, user-agent, address, session or device identifiers are
// accepted. The authenticated RPC binds auth.uid() and uses database time.
export const clientAnalyticsEventSchema = z.discriminatedUnion('name', [
  eventSchema(ClientAnalyticsEvent.MESSAGE_OPEN),
  eventSchema(ClientAnalyticsEvent.VOICE_INPUT_USED),
]);

export const serverAnalyticsEventSchema = z.discriminatedUnion('name', [
  eventSchema(ServerAnalyticsEvent.SIGNUP_COMPLETE),
  eventSchema(ServerAnalyticsEvent.FONT_SIZE_SELECTED),
  eventSchema(ServerAnalyticsEvent.PREVIEW_VIEW),
  eventSchema(ServerAnalyticsEvent.SUBSCRIBE_START),
  eventSchema(ServerAnalyticsEvent.SUBSCRIBE_FAIL),
  eventSchema(ServerAnalyticsEvent.REPLY_SENT),
  eventSchema(ServerAnalyticsEvent.CANCEL),
  eventSchema(ServerAnalyticsEvent.POST_CREATE),
  eventSchema(ServerAnalyticsEvent.ATTENDANCE),
]);

export const verifiedChargeAnalyticsEventSchema = z.discriminatedUnion('name', [
  eventSchema(VerifiedChargeAnalyticsEvent.SUBSCRIBE_COMPLETE),
  eventSchema(VerifiedChargeAnalyticsEvent.RENEW),
]);

// Internal shape validation only. Never use this inclusive schema as a browser
// ingestion allowlist or treat its parsed charge event as verified revenue.
export const analyticsEventSchema = z.discriminatedUnion('name', [
  ...clientAnalyticsEventSchema.options,
  ...serverAnalyticsEventSchema.options,
  ...verifiedChargeAnalyticsEventSchema.options,
]);

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;
export type ClientAnalyticsEventInput = z.infer<
  typeof clientAnalyticsEventSchema
>;
export type ServerAnalyticsEventInput = z.infer<
  typeof serverAnalyticsEventSchema
>;
export type VerifiedChargeAnalyticsEventInput = z.infer<
  typeof verifiedChargeAnalyticsEventSchema
>;

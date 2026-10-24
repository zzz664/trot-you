import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AnalyticsEvent,
  ClientAnalyticsEvent,
  ServerAnalyticsEvent,
  VerifiedChargeAnalyticsEvent,
  analyticsEventSchema,
  analyticsPropertySchemas,
  clientAnalyticsEventSchema,
  serverAnalyticsEventSchema,
  verifiedChargeAnalyticsEventSchema,
  type AnalyticsEventInput,
  type AnalyticsEventName,
  type ClientAnalyticsEventInput,
  type ServerAnalyticsEventInput,
  type VerifiedChargeAnalyticsEventInput,
} from '@/config/analytics-events';
import { unresolvedSettingDecisions } from '@/config/settings';

const eventKey = 'b1000000-0000-4000-8000-000000000001';
const sourceId = 'b2000000-0000-4000-8000-000000000001';
const validEvents = [
  { name: AnalyticsEvent.SIGNUP_COMPLETE, properties: {} },
  {
    name: AnalyticsEvent.FONT_SIZE_SELECTED,
    properties: { font_scale: 'large' },
  },
  { name: AnalyticsEvent.PREVIEW_VIEW, properties: { source_id: sourceId } },
  {
    name: AnalyticsEvent.SUBSCRIBE_START,
    properties: { source_id: sourceId },
  },
  {
    name: AnalyticsEvent.SUBSCRIBE_COMPLETE,
    properties: { source_id: sourceId },
  },
  { name: AnalyticsEvent.SUBSCRIBE_FAIL, properties: { source_id: sourceId } },
  { name: AnalyticsEvent.MESSAGE_OPEN, properties: { source_id: sourceId } },
  { name: AnalyticsEvent.REPLY_SENT, properties: { source_id: sourceId } },
  {
    name: AnalyticsEvent.VOICE_INPUT_USED,
    properties: { voice_context: 'reply' },
  },
  { name: AnalyticsEvent.RENEW, properties: { source_id: sourceId } },
  { name: AnalyticsEvent.CANCEL, properties: { source_id: sourceId } },
  { name: AnalyticsEvent.POST_CREATE, properties: { source_id: sourceId } },
  { name: AnalyticsEvent.ATTENDANCE, properties: { source_id: sourceId } },
] as const;

const input = (event: (typeof validEvents)[number]) => ({
  event_key: eventKey,
  ...event,
});

// Content must not be stored in analytics, even when supplied under a plausible
// key. These are fictional rejection fixtures, never external transmissions.
const forbiddenProperties = {
  name: 'Fictional person',
  email: 'fictional@example.invalid',
  phone: '01000000000',
  url: 'https://example.invalid/profile',
  token: 'fictional-secret',
  payment_key: 'fictional-payment-key',
  body: 'Fictional private content',
  metadata: { arbitrary: true },
};

describe('analytics event vocabulary and authority', () => {
  it('contains exactly the thirteen documented names', () => {
    expect(Object.values(AnalyticsEvent)).toEqual([
      'signup_complete',
      'font_size_selected',
      'preview_view',
      'subscribe_start',
      'subscribe_complete',
      'subscribe_fail',
      'message_open',
      'reply_sent',
      'voice_input_used',
      'renew',
      'cancel',
      'post_create',
      'attendance',
    ]);
    expect(Object.keys(analyticsPropertySchemas)).toEqual(
      Object.values(AnalyticsEvent),
    );
  });

  it('separates browser observations, trusted observations and verified charges', () => {
    expect(Object.values(ClientAnalyticsEvent)).toEqual([
      AnalyticsEvent.MESSAGE_OPEN,
      AnalyticsEvent.VOICE_INPUT_USED,
    ]);
    expect(Object.values(VerifiedChargeAnalyticsEvent)).toEqual([
      AnalyticsEvent.SUBSCRIBE_COMPLETE,
      AnalyticsEvent.RENEW,
    ]);
    const names = [
      ...Object.values(ClientAnalyticsEvent),
      ...Object.values(ServerAnalyticsEvent),
      ...Object.values(VerifiedChargeAnalyticsEvent),
    ];
    expect(new Set(names).size).toBe(13);
    expect(names.toSorted()).toEqual(Object.values(AnalyticsEvent).toSorted());
  });

  it.each(validEvents)(
    'validates the exact property shape for $name',
    (event) => {
      expect(analyticsEventSchema.parse(input(event))).toEqual(input(event));
      expect(clientAnalyticsEventSchema.safeParse(input(event)).success).toBe(
        Object.values(ClientAnalyticsEvent).some((name) => name === event.name),
      );
      expect(serverAnalyticsEventSchema.safeParse(input(event)).success).toBe(
        Object.values(ServerAnalyticsEvent).some((name) => name === event.name),
      );
      expect(
        verifiedChargeAnalyticsEventSchema.safeParse(input(event)).success,
      ).toBe(
        Object.values(VerifiedChargeAnalyticsEvent).some(
          (name) => name === event.name,
        ),
      );
    },
  );

  it('preserves discriminated properties and authority boundaries in inferred types', () => {
    expectTypeOf<
      AnalyticsEventInput['name']
    >().toEqualTypeOf<AnalyticsEventName>();
    expectTypeOf<ClientAnalyticsEventInput['name']>().toEqualTypeOf<
      'message_open' | 'voice_input_used'
    >();
    expectTypeOf<VerifiedChargeAnalyticsEventInput['name']>().toEqualTypeOf<
      'subscribe_complete' | 'renew'
    >();
    expectTypeOf<
      Extract<ServerAnalyticsEventInput, { name: 'renew' }>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<AnalyticsEventInput, { name: 'font_size_selected' }>['properties']
    >().toEqualTypeOf<{ font_scale: 'normal' | 'large' | 'xlarge' }>();
    expectTypeOf<
      Extract<
        ClientAnalyticsEventInput,
        { name: 'voice_input_used' }
      >['properties']
    >().toEqualTypeOf<{ voice_context: 'reply' | 'post' | 'comment' }>();
  });
});

describe('strict analytics payloads', () => {
  it.each(validEvents)(
    'rejects PII, credentials and arbitrary keys for $name',
    (event) => {
      for (const [key, value] of Object.entries(forbiddenProperties)) {
        expect(
          analyticsEventSchema.safeParse({
            ...input(event),
            properties: { ...event.properties, [key]: value },
          }).success,
        ).toBe(false);
      }
    },
  );

  it.each(validEvents)(
    'rejects actor, time and tracking metadata for $name',
    (event) => {
      for (const field of [
        'actor_id',
        'user_id',
        'occurred_at',
        'recorded_at',
        'consented',
        'session_id',
        'device_id',
        'ip_address',
        'user_agent',
        'origin',
      ]) {
        expect(
          analyticsEventSchema.safeParse({ ...input(event), [field]: sourceId })
            .success,
        ).toBe(false);
      }
    },
  );

  it.each(validEvents)(
    'rejects malformed containers and missing fields for $name',
    (event) => {
      for (const properties of [null, undefined, [], 'text', 0, true]) {
        expect(
          analyticsEventSchema.safeParse({ ...input(event), properties })
            .success,
        ).toBe(false);
      }
      for (const event_key of [null, undefined, '', 'not-a-uuid', 1, {}, []]) {
        expect(
          analyticsEventSchema.safeParse({ ...input(event), event_key })
            .success,
        ).toBe(false);
      }
    },
  );

  it.each(validEvents.filter((event) => 'source_id' in event.properties))(
    'accepts only a UUID source handle for $name',
    (event) => {
      for (const source_id of [
        null,
        undefined,
        'Fictional Person',
        'fictional@example.invalid',
        'https://example.invalid/source',
        'fictional-token',
        123,
        { id: sourceId },
        [sourceId],
      ]) {
        expect(
          analyticsEventSchema.safeParse({
            ...input(event),
            properties: { source_id },
          }).success,
        ).toBe(false);
      }
    },
  );

  it.each(['normal', 'large', 'xlarge'])(
    'allows documented font scale %s',
    (font_scale) => {
      expect(
        analyticsPropertySchemas.font_size_selected.safeParse({ font_scale })
          .success,
      ).toBe(true);
    },
  );

  it.each(['reply', 'post', 'comment'])(
    'allows bounded voice context %s',
    (voice_context) => {
      expect(
        analyticsPropertySchemas.voice_input_used.safeParse({ voice_context })
          .success,
      ).toBe(true);
    },
  );

  it('rejects coercion, unknown enum values and unknown event names', () => {
    for (const value of [
      null,
      undefined,
      1,
      'email@example.invalid',
      'https://example.invalid',
      'Large',
      {},
      [],
    ]) {
      expect(
        analyticsPropertySchemas.font_size_selected.safeParse({
          font_scale: value,
        }).success,
      ).toBe(false);
      expect(
        analyticsPropertySchemas.voice_input_used.safeParse({
          voice_context: value,
        }).success,
      ).toBe(false);
    }
    for (const name of [
      null,
      undefined,
      'purchase',
      'renewal',
      'page_view',
      'SIGNUP_COMPLETE',
    ]) {
      expect(
        analyticsEventSchema.safeParse({
          event_key: eventKey,
          name,
          properties: {},
        }).success,
      ).toBe(false);
    }
  });

  it('keeps consent, retention, anonymous consent and funnel formulas unapproved', () => {
    expect(unresolvedSettingDecisions).toEqual(
      expect.arrayContaining([
        'analytics-consent-policy-unapproved',
        'analytics-retention-policy-unapproved',
        'analytics-funnel-definitions-unset',
        'analytics-anonymous-consent-design-unset',
      ]),
    );
  });
});

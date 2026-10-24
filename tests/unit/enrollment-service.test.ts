// @vitest-environment node
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  startEnrollment,
  captureEnrollment,
  confirmEnrollment,
  reconcileEnrollment,
  readEnrollment,
  cancelEnrollment,
  type EnrollmentDependencies,
} from '@/server/services/enrollment/flow';
import {
  publicEnrollment,
  type PrivateEnrollment,
} from '@/server/services/enrollment/model';
import { initialBillingPeriod } from '@/lib/billing-period';
const id = (n: number) =>
  `b1700000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const actor = {
  actorId: id(1),
  nonceHash: 'a'.repeat(64),
  authSessionHash: 'b'.repeat(64),
};
const envelope = {
  version: 'unit',
  iv: 'a'.repeat(16),
  tag: 'a'.repeat(22),
  ciphertext: 'cGlp',
};
const now = new Date('2026-10-24T12:00:00.000Z');
function row(overrides: Partial<PrivateEnrollment> = {}): PrivateEnrollment {
  return {
    session_id: id(2),
    user_id: actor.actorId,
    artist_id: id(3),
    artist_slug: 'fictional-star',
    artist_name: '허구 가수',
    provider: 'toss',
    environment: 'test',
    merchant_account: 'fictional_mid',
    subscription_id: id(4),
    mandate_id: id(5),
    credential_ref: id(6),
    customer_ref: id(7),
    order_id: id(8),
    policy_version: id(9),
    billing_period_calendar: 'utc_monthly_clamped',
    payment_tax_basis: 'taxable_krw',
    policy_title: '허구 약관',
    policy_body: '격리 단위 점검',
    initial_price_krw: 1000,
    regular_price_krw: 6500,
    intro_eligible: true,
    expires_at: '2026-10-24T12:15:00.000Z',
    state: 'awaiting_confirmation',
    stage: null,
    public_status: 'awaiting_confirmation',
    callback_ciphertext: envelope,
    callback_expires_at: '2026-10-24T12:05:00.000Z',
    credential_ciphertext: null,
    tid: null,
    redirects: null,
    payment_event_id: null,
    period_start: null,
    period_end: null,
    ...overrides,
  };
}
const good = (data: PrivateEnrollment) => ({ ok: true as const, data });
const charge = {
  customerRef: id(7),
  orderId: id(8),
  amountKrw: 1000,
  providerPaymentId: 'fictional_payment',
  providerTransactionId: 'fictional_action',
  approvedAt: '2026-10-24T12:00:01.000Z',
  currency: 'KRW' as const,
  merchantAccount: 'fictional_mid',
};
let deps: EnrollmentDependencies;
let db: {
  [K in keyof EnrollmentDependencies['db']]: Mock<
    EnrollmentDependencies['db'][K]
  >;
};
beforeEach(() => {
  db = Object.fromEntries(
    [
      'start',
      'read',
      'capture',
      'claim',
      'recordReady',
      'recordCredential',
      'recordOutcome',
      'finalize',
      'recordReconciliation',
      'cancel',
    ].map((name) => [name, vi.fn().mockResolvedValue(good(row()))]),
  ) as typeof db;
  db.claim.mockImplementation(async (_a, _s, stage) =>
    good(
      row({
        state: 'processing',
        public_status: 'processing',
        stage,
        dispatch: true,
        lease_token: id(10),
        credential_ciphertext: stage === 'charge' ? envelope : null,
      }),
    ),
  );
  db.recordCredential.mockResolvedValue(
    good(row({ credential_ciphertext: envelope, callback_ciphertext: null })),
  );
  db.finalize.mockResolvedValue(
    good(
      row({
        state: 'succeeded',
        public_status: 'succeeded',
        payment_event_id: id(11),
      }),
    ),
  );
  db.recordOutcome.mockImplementation(async (_a, _s, _l, outcome) =>
    good(row({ state: outcome, public_status: outcome })),
  );
  deps = {
    db,
    checkout: {
      read: vi.fn().mockResolvedValue({
        ok: true,
        data: { id: id(2), provider: 'toss_card_billing' },
      }),
      prepare: vi.fn(),
      cancel: vi.fn(),
    },
    vault: {
      seal: vi.fn().mockReturnValue(envelope),
      open: vi.fn().mockImplementation((_e, b) =>
        b.purpose === 'callback'
          ? JSON.stringify({
              provider: 'toss',
              authKey: 'fictional_auth',
              customerKey: id(7),
            })
          : b.purpose === 'ready'
            ? JSON.stringify({
                mobile: 'https://online-pay.kakao.com/mobile',
                desktop: 'https://online-pay.kakao.com/desktop',
              })
            : 'fictional_credential',
      ),
    },
    toss: {
      exchange: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          credential: 'fictional_credential',
          customerRef: id(7),
          merchantAccount: 'fictional_mid',
        },
      }),
      charge: vi.fn().mockResolvedValue({ ok: true, data: charge }),
      query: vi.fn().mockResolvedValue({ ok: true, data: charge }),
    },
    kakao: {
      ready: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          tid: 'fictional_tid',
          redirects: {
            mobile: 'https://online-pay.kakao.com/mobile',
            desktop: 'https://online-pay.kakao.com/desktop',
          },
        },
      }),
      approve: vi.fn().mockResolvedValue({
        ok: true,
        data: { credential: 'fictional_sid', charge },
      }),
      query: vi.fn().mockResolvedValue({ ok: true, data: charge }),
    },
    configuration: vi
      .fn()
      .mockReturnValue({ environment: 'test', merchant: 'fictional_mid' }),
    prepareToss: vi.fn().mockReturnValue({
      ok: true,
      data: {
        kind: 'toss_billing_auth',
        sdkUrl: 'https://js.tosspayments.com/v2/standard',
        clientKey: 'test_ck_fixture',
        payment: { customerKey: id(7) },
        requestBillingAuth: {
          method: 'CARD',
          successUrl: 'https://app.example/callback',
          failUrl: 'https://app.example/callback',
        },
        launchAvailable: false,
      },
    }),
    evidenceRef: () => id(12),
    now: () => now,
  };
});
const input = {
  sessionId: id(2),
  policyVersion: id(9),
  amountKrw: 1000,
  accepted: true,
};
describe('initial enrollment orchestration: offline ports only', () => {
  it('exchanges Toss credential, stores encrypted key, then claims one exact first charge and atomically finalizes', async () => {
    expect(await confirmEnrollment(deps, actor, input)).toMatchObject({
      ok: true,
      data: { status: 'succeeded' },
    });
    expect(deps.toss.exchange).toHaveBeenCalledWith({
      customerRef: id(7),
      authKey: 'fictional_auth',
      idempotencyKey: id(2),
    });
    expect(db.recordCredential).toHaveBeenCalledWith(
      actor.actorId,
      id(2),
      id(10),
      envelope,
    );
    expect(db.claim).toHaveBeenLastCalledWith(actor, id(2), 'charge', {
      accepted: true,
      policyVersion: id(9),
      amountKrw: 1000,
      periodStart: now.toISOString(),
      periodEnd: '2026-11-24T12:00:00.000Z',
    });
    expect(deps.toss.charge).toHaveBeenCalledWith({
      customerRef: id(7),
      orderId: id(8),
      amountKrw: 1000,
      credential: 'fictional_credential',
      idempotencyKey: id(8),
    });
    expect(db.finalize).toHaveBeenCalledOnce();
  });
  it('Kakao approve is the first charge, never follows it with another charge', async () => {
    const kakao = row({ provider: 'kakaopay', tid: 'fictional_tid' });
    db.read.mockResolvedValue(good(kakao));
    db.claim.mockResolvedValue(
      good({
        ...kakao,
        state: 'processing',
        public_status: 'processing',
        stage: 'approve',
        dispatch: true,
        lease_token: id(10),
      }),
    );
    vi.mocked(deps.vault.open).mockReturnValue(
      JSON.stringify({ provider: 'kakaopay', pgToken: 'fictional_token' }),
    );
    expect(await confirmEnrollment(deps, actor, input)).toMatchObject({
      ok: true,
      data: { status: 'succeeded' },
    });
    expect(deps.kakao.approve).toHaveBeenCalledOnce();
    expect(deps.toss.charge).not.toHaveBeenCalled();
    expect(deps.toss.exchange).not.toHaveBeenCalled();
    expect(db.finalize).toHaveBeenCalledWith(
      actor.actorId,
      id(2),
      charge,
      id(12),
      envelope,
    );
  });
  it.each([
    'processing',
    'succeeded',
    'failed',
    'canceled',
    'expired',
    'unknown',
    'manual_review',
  ] as const)('never dispatches confirm again from %s', async (status) => {
    db.read.mockResolvedValue(
      good(row({ state: status, public_status: status })),
    );
    await confirmEnrollment(deps, actor, input);
    expect(db.claim).not.toHaveBeenCalled();
    expect(deps.toss.charge).not.toHaveBeenCalled();
    expect(deps.kakao.approve).not.toHaveBeenCalled();
  });
  it('competing claim returns no dispatch even after a stale pre-read', async () => {
    db.claim.mockResolvedValue(
      good(
        row({
          state: 'processing',
          public_status: 'processing',
          dispatch: false,
        }),
      ),
    );
    await confirmEnrollment(deps, actor, input);
    expect(deps.toss.exchange).not.toHaveBeenCalled();
    expect(deps.toss.charge).not.toHaveBeenCalled();
  });
  it.each([
    { accepted: false },
    { amountKrw: 6500 },
    { policyVersion: id(99) },
    { extra: 'secret' },
  ])(
    'rejects missing/changed consent %j before provider I/O',
    async (change) => {
      expect(
        (await confirmEnrollment(deps, actor, { ...input, ...change })).ok,
      ).toBe(false);
      expect(db.claim).not.toHaveBeenCalled();
    },
  );
  it('does not charge when credential persistence response is lost', async () => {
    db.recordCredential.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    await confirmEnrollment(deps, actor, input);
    expect(deps.toss.exchange).toHaveBeenCalledOnce();
    expect(deps.toss.charge).not.toHaveBeenCalled();
  });
  it('does not reissue an already persisted credential', async () => {
    db.read.mockResolvedValue(
      good(row({ credential_ciphertext: envelope, callback_ciphertext: null })),
    );
    await confirmEnrollment(deps, actor, input);
    expect(deps.toss.exchange).not.toHaveBeenCalled();
    expect(deps.toss.charge).toHaveBeenCalledOnce();
  });
  it.each(['exchange', 'charge'] as const)(
    'lost Toss %s response stays unknown, never retries',
    async (method) => {
      vi.mocked(deps.toss[method]).mockResolvedValue({
        ok: false,
        code: 'OUTCOME_UNKNOWN',
        outcome: 'unknown',
        retryAllowed: false,
      });
      await confirmEnrollment(deps, actor, input);
      expect(deps.toss[method]).toHaveBeenCalledOnce();
      expect(db.recordOutcome).toHaveBeenCalledWith(
        actor.actorId,
        id(2),
        id(10),
        'unknown',
        id(12),
      );
      expect(db.finalize).not.toHaveBeenCalled();
    },
  );
  it.each(['amountKrw', 'merchantAccount', 'orderId', 'customerRef'] as const)(
    'rejects normalized provider mismatch %s before finalization',
    async (field) => {
      vi.mocked(deps.toss.charge).mockResolvedValue({
        ok: true,
        data: { ...charge, [field]: field === 'amountKrw' ? 999 : 'mismatch' },
      });
      await confirmEnrollment(deps, actor, input);
      expect(db.finalize).not.toHaveBeenCalled();
      expect(db.recordOutcome).toHaveBeenCalled();
    },
  );
  it('capture only encrypts authorization with purpose/actor/artist/mandate AAD, never calls provider', async () => {
    expect(
      (
        await captureEnrollment(deps, actor, id(2), 'c'.repeat(64), {
          provider: 'toss',
          authKey: 'fictional_auth',
          customerKey: id(7),
        })
      ).ok,
    ).toBe(true);
    expect(deps.vault.seal).toHaveBeenCalledWith(expect.any(String), {
      actorId: id(1),
      artistId: id(3),
      provider: 'toss_card_billing',
      environment: 'test',
      mandateId: id(5),
      purpose: 'callback',
    });
    expect(deps.toss.exchange).not.toHaveBeenCalled();
    expect(deps.kakao.approve).not.toHaveBeenCalled();
  });
  it.each([
    { provider: 'toss', authKey: 'fixture', customerKey: id(99) },
    { provider: 'kakaopay', pgToken: 'fixture' },
    { provider: 'toss', authKey: 'fixture', customerKey: id(7), amount: 1 },
  ])('denies mixed/foreign callback %j', async (callback) => {
    expect(
      (await captureEnrollment(deps, actor, id(2), 'c'.repeat(64), callback))
        .ok,
    ).toBe(false);
    expect(db.capture).not.toHaveBeenCalled();
  });
  it('start Toss only returns public client descriptor, never an auth or charge request', async () => {
    db.start.mockResolvedValue(
      good(
        row({
          state: 'awaiting_authorization',
          public_status: 'awaiting_authorization',
        }),
      ),
    );
    const result = await startEnrollment(
      deps,
      actor,
      { sessionId: id(2) },
      's'.repeat(43),
      'c'.repeat(64),
    );
    expect(result).toMatchObject({
      ok: true,
      data: { launch: { kind: 'toss_billing_auth' } },
    });
    expect(JSON.stringify(result)).not.toContain('credential_ref');
    expect(deps.toss.exchange).not.toHaveBeenCalled();
  });
  it('Kakao ready is claimed once and encrypted result persists before handoff', async () => {
    const initial = row({
      provider: 'kakaopay',
      state: 'ready',
      public_status: 'processing',
    });
    db.start.mockResolvedValue(good(initial));
    db.claim.mockResolvedValue(
      good({ ...initial, stage: 'ready', dispatch: true, lease_token: id(10) }),
    );
    db.recordReady.mockResolvedValue(
      good({
        ...initial,
        state: 'awaiting_authorization',
        public_status: 'awaiting_authorization',
        redirects: envelope,
      }),
    );
    expect(
      await startEnrollment(
        deps,
        actor,
        { sessionId: id(2) },
        's'.repeat(43),
        'c'.repeat(64),
      ),
    ).toMatchObject({
      ok: true,
      data: { launch: { kind: 'kakaopay_redirect' } },
    });
    expect(db.recordReady).toHaveBeenCalledWith(
      actor.actorId,
      id(2),
      id(10),
      'fictional_tid',
      envelope,
    );
    expect(deps.kakao.approve).not.toHaveBeenCalled();
  });
  it('ready persistence failure never returns redirect', async () => {
    const initial = row({
      provider: 'kakaopay',
      state: 'ready',
      public_status: 'processing',
    });
    db.start.mockResolvedValue(good(initial));
    db.claim.mockResolvedValue(
      good({ ...initial, stage: 'ready', dispatch: true, lease_token: id(10) }),
    );
    db.recordReady.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect(
      await startEnrollment(
        deps,
        actor,
        { sessionId: id(2) },
        's'.repeat(43),
        'c'.repeat(64),
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('unknown Toss charge recovers by query+same finalization only', async () => {
    db.read.mockResolvedValue(
      good(
        row({
          state: 'unknown',
          public_status: 'unknown',
          stage: 'charge',
          credential_ciphertext: envelope,
        }),
      ),
    );
    expect(
      await reconcileEnrollment(deps, actor, { sessionId: id(2) }),
    ).toMatchObject({ ok: true, data: { status: 'succeeded' } });
    expect(deps.toss.query).toHaveBeenCalledOnce();
    expect(deps.toss.charge).not.toHaveBeenCalled();
    expect(deps.toss.exchange).not.toHaveBeenCalled();
  });
  it('Kakao query-proved payment without SID remains manual review, never approve again', async () => {
    db.read.mockResolvedValue(
      good(
        row({
          provider: 'kakaopay',
          state: 'unknown',
          public_status: 'unknown',
          stage: 'approve',
          tid: 'fictional_tid',
        }),
      ),
    );
    db.recordReconciliation.mockResolvedValue(
      good(row({ state: 'manual_review', public_status: 'manual_review' })),
    );
    expect(
      await reconcileEnrollment(deps, actor, { sessionId: id(2) }),
    ).toMatchObject({ ok: true, data: { status: 'manual_review' } });
    expect(db.finalize).not.toHaveBeenCalled();
    expect(deps.kakao.approve).not.toHaveBeenCalled();
    expect(db.recordReconciliation).toHaveBeenCalledOnce();
  });
  it('query not-found/transport failure never proves failed or permits re-charge', async () => {
    db.read.mockResolvedValue(
      good(
        row({ state: 'unknown', public_status: 'unknown', stage: 'charge' }),
      ),
    );
    vi.mocked(deps.toss.query).mockResolvedValue({
      ok: false,
      code: 'OUTCOME_UNKNOWN',
      outcome: 'unknown',
      retryAllowed: false,
    });
    expect(
      await reconcileEnrollment(deps, actor, { sessionId: id(2) }),
    ).toMatchObject({ ok: true, data: { status: 'unknown' } });
    expect(db.recordOutcome).not.toHaveBeenCalled();
    expect(db.finalize).not.toHaveBeenCalled();
  });
  it('known Kakao approval survives DB rollback with an exact DB-only finalization replay', async () => {
    const kakao = row({ provider: 'kakaopay', tid: 'fictional_tid' });
    db.read.mockResolvedValueOnce(good(kakao)).mockResolvedValueOnce(
      good({
        ...kakao,
        state: 'processing',
        public_status: 'processing',
        stage: 'approve',
      }),
    );
    db.claim.mockResolvedValue(
      good({
        ...kakao,
        state: 'processing',
        public_status: 'processing',
        stage: 'approve',
        dispatch: true,
        lease_token: id(10),
      }),
    );
    vi.mocked(deps.vault.open).mockReturnValue(
      JSON.stringify({ provider: 'kakaopay', pgToken: 'fictional_token' }),
    );
    db.finalize.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    expect(await confirmEnrollment(deps, actor, input)).toMatchObject({
      ok: true,
      data: { status: 'succeeded' },
    });
    expect(deps.kakao.approve).toHaveBeenCalledOnce();
    expect(db.finalize).toHaveBeenCalledTimes(2);
    expect(db.finalize.mock.calls[0]).toEqual(db.finalize.mock.calls[1]);
  });
  it('lost DB commit reply observes success without replaying provider or database finalization', async () => {
    db.read
      .mockResolvedValueOnce(good(row()))
      .mockResolvedValueOnce(
        good(row({ state: 'succeeded', public_status: 'succeeded' })),
      );
    db.finalize.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    expect(await confirmEnrollment(deps, actor, input)).toMatchObject({
      ok: true,
      data: { status: 'succeeded' },
    });
    expect(db.finalize).toHaveBeenCalledOnce();
    expect(deps.toss.charge).toHaveBeenCalledOnce();
  });
  it.each(['observe', 'replay', 'outcome'] as const)(
    'sanitizes rejected %s promise after provider I/O',
    async (mode) => {
      if (mode === 'outcome') {
        vi.mocked(deps.toss.charge).mockResolvedValue({
          ok: false,
          code: 'OUTCOME_UNKNOWN',
          outcome: 'unknown',
          retryAllowed: false,
        });
        db.recordOutcome.mockRejectedValue(new Error('secret_sid'));
      } else {
        db.finalize.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
        if (mode === 'observe')
          db.read
            .mockResolvedValueOnce(good(row()))
            .mockRejectedValueOnce(new Error('secret_sid'));
        else {
          db.read
            .mockResolvedValueOnce(good(row()))
            .mockResolvedValueOnce(
              good(row({ state: 'processing', public_status: 'processing' })),
            );
          db.finalize.mockRejectedValueOnce(new Error('secret_sid'));
        }
      }
      expect(await confirmEnrollment(deps, actor, input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
      expect(deps.toss.charge).toHaveBeenCalledOnce();
    },
  );
  it('reads and cancellation project no private fields', async () => {
    const result = await readEnrollment(deps, actor, { sessionId: id(2) });
    const serialized = JSON.stringify(result);
    for (const key of [
      'customer_ref',
      'order_id',
      'mandate_id',
      'ciphertext',
      'fictional_mid',
      'auth_session_hash',
    ])
      expect(serialized).not.toContain(key);
    await cancelEnrollment(deps, actor, { sessionId: id(2) });
    expect(db.cancel).toHaveBeenCalledWith(actor, id(2));
    expect(deps.toss.charge).not.toHaveBeenCalled();
  });
  it.each(['test', 'merchant'])(
    'configuration %s rotation fails closed before dispatch',
    async (field) => {
      vi.mocked(deps.configuration).mockReturnValue(
        field === 'test'
          ? { environment: 'live', merchant: 'fictional_mid' }
          : { environment: 'test', merchant: 'new_mid' },
      );
      expect(await confirmEnrollment(deps, actor, input)).toEqual({
        ok: false,
        code: 'PROVIDER_NOT_READY',
      });
      expect(db.claim).not.toHaveBeenCalled();
    },
  );
  it.each(['callback', 'credential'] as const)(
    'vault %s key/version failure never acquires a dispatch claim',
    async (purpose) => {
      if (purpose === 'credential')
        db.read.mockResolvedValue(
          good(
            row({ credential_ciphertext: envelope, callback_ciphertext: null }),
          ),
        );
      vi.mocked(deps.vault.open).mockImplementation(() => {
        throw new Error('private_fixture_key');
      });
      expect(await confirmEnrollment(deps, actor, input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
      expect(db.claim).not.toHaveBeenCalled();
      expect(deps.toss.exchange).not.toHaveBeenCalled();
      expect(deps.toss.charge).not.toHaveBeenCalled();
    },
  );
  it('invalid actor never enters DB', async () => {
    await confirmEnrollment(deps, { ...actor, authSessionHash: 'bad' }, input);
    expect(db.read).not.toHaveBeenCalled();
  });
  it('unknown exceptions are sanitized and never trigger fallback', async () => {
    db.read.mockRejectedValue(new Error('SID-secret-token'));
    expect(await confirmEnrollment(deps, actor, input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(deps.kakao.approve).not.toHaveBeenCalled();
  });
  it('cannot reconcile unidentifiable ready/exchange or known manual cases', () => {
    for (const stage of ['ready', 'exchange'] as const)
      expect(
        publicEnrollment(
          row({
            state: 'manual_review',
            public_status: 'manual_review',
            stage,
          }),
        ).canReconcile,
      ).toBe(false);
  });
});
describe('monthly billing boundaries', () => {
  it.each([
    ['2026-01-31T15:04:05.006Z', '2026-02-28T15:04:05.006Z'],
    ['2028-01-31T00:00:00.000Z', '2028-02-29T00:00:00.000Z'],
    ['2026-12-31T00:00:00.000Z', '2027-01-31T00:00:00.000Z'],
    ['2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'],
  ])('clamps %s to %s without host timezone', (start, end) =>
    expect(
      initialBillingPeriod(new Date(start), 'utc_monthly_clamped'),
    ).toEqual({ start, end }),
  );
  it('requires an explicit calendar and distinguishes Seoul March 1 from UTC February 28', () => {
    const start = new Date('2026-02-28T15:00:00.000Z');
    expect(initialBillingPeriod(start, 'utc_monthly_clamped').end).toBe(
      '2026-03-28T15:00:00.000Z',
    );
    expect(initialBillingPeriod(start, 'seoul_monthly_clamped').end).toBe(
      '2026-03-31T15:00:00.000Z',
    );
    expect(() => initialBillingPeriod(start, undefined as never)).toThrow(
      'INVALID_BILLING_PERIOD',
    );
  });
  it('rejects invalid time', () =>
    expect(() =>
      initialBillingPeriod(new Date('invalid'), 'utc_monthly_clamped'),
    ).toThrow('INVALID_BILLING_PERIOD'));
});

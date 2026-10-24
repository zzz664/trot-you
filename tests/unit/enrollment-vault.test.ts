// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseServerEnv, type ServerEnv } from '@/config/env.server';
import { publicEnvSchema } from '@/config/env';
import { PAYMENT_VAULT_PLAINTEXT_MAX_BYTES } from '@/config/enrollment-provider';
import {
  createPaymentVault,
  paymentVaultEnvelopeSchema,
  type PaymentVaultBinding,
  type PaymentVaultEnvelope,
} from '@/server/adapters/payment/vault';

// Fixed, public unit-test bytes only. Never generated/provisioned as a real key.
const fixtureKey = Buffer.alloc(32, 41).toString('base64');
const fixtureEnv = {
  PAYMENTS_VAULT_KEY: fixtureKey,
  PAYMENTS_VAULT_KEY_VERSION: 'unit-fixture-v1',
};
const binding: PaymentVaultBinding = {
  actorId: 'a1400000-0000-4000-8000-000000000001',
  artistId: 'a1400000-0000-4000-8000-000000000002',
  mandateId: 'a1400000-0000-4000-8000-000000000003',
  provider: 'toss_card_billing',
  environment: 'test',
  purpose: 'credential',
};
function env(overrides: Record<string, string> = {}): ServerEnv {
  const parsed = parseServerEnv({ ...fixtureEnv, ...overrides });
  if (!parsed.ok) throw new Error('Invalid fixture environment');
  return parsed.data;
}
function vault() {
  const result = createPaymentVault(env());
  if (!result) throw new Error('Expected unit fixture vault');
  return result;
}

describe('dedicated vault key configuration', () => {
  it('allows keyless builds, but returns no usable vault', () => {
    const parsed = parseServerEnv({});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(createPaymentVault(parsed.data)).toBeNull();
  });
  it('never exports vault key or version through the public environment', () => {
    const result = publicEnvSchema.parse(fixtureEnv);
    expect(result).not.toHaveProperty('PAYMENTS_VAULT_KEY');
    expect(result).not.toHaveProperty('PAYMENTS_VAULT_KEY_VERSION');
    expect(JSON.stringify(result)).not.toContain(fixtureKey);
  });
  it.each([
    { PAYMENTS_VAULT_KEY: '' },
    { PAYMENTS_VAULT_KEY_VERSION: '' },
    { PAYMENTS_VAULT_KEY: Buffer.alloc(31, 41).toString('base64') },
    { PAYMENTS_VAULT_KEY: Buffer.alloc(33, 41).toString('base64') },
    { PAYMENTS_VAULT_KEY: fixtureKey.replace(/=$/, '') },
    { PAYMENTS_VAULT_KEY: `${fixtureKey}\n` },
    { PAYMENTS_VAULT_KEY: 'test_sk_not_an_encryption_key' },
    { PAYMENTS_VAULT_KEY: `${fixtureKey.slice(0, -2)}B=` },
    { PAYMENTS_VAULT_KEY_VERSION: '../bad' },
    { PAYMENTS_VAULT_KEY_VERSION: 'a'.repeat(65) },
    { NEXT_PUBLIC_PAYMENTS_VAULT_KEY: fixtureKey },
  ])(
    'rejects malformed, incomplete or accidentally public setup %#',
    (override) => {
      const result = parseServerEnv({ ...fixtureEnv, ...override });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(fixtureKey);
    },
  );
  it('revalidates a forged runtime environment before using a key', () => {
    expect(
      createPaymentVault({ ...env(), PAYMENTS_VAULT_KEY: 'private' }),
    ).toBeNull();
  });
});

describe('AES-256-GCM private credential envelope', () => {
  it.each(['callback', 'credential', 'ready'] as const)(
    'roundtrips a %s payload with independently randomized IVs',
    (purpose) => {
      const subject = vault();
      const context = { ...binding, purpose };
      const plaintext = 'fictional-sensitive-payload';
      const first = subject.seal(plaintext, context);
      const second = subject.seal(plaintext, context);
      expect(Object.keys(first).sort()).toEqual([
        'ciphertext',
        'iv',
        'tag',
        'version',
      ]);
      expect(paymentVaultEnvelopeSchema.safeParse(first).success).toBe(true);
      expect(first.version).toBe('unit-fixture-v1');
      expect(Buffer.from(first.iv, 'base64url')).toHaveLength(12);
      expect(Buffer.from(first.tag, 'base64url')).toHaveLength(16);
      expect(first.iv).not.toBe(second.iv);
      expect(first.ciphertext).not.toBe(second.ciphertext);
      expect(JSON.stringify(first)).not.toContain(plaintext);
      expect(JSON.stringify(first)).not.toContain(fixtureKey);
      expect(subject.open(first, context)).toBe(plaintext);
      expect(subject.open(second, context)).toBe(plaintext);
    },
  );
  it.each([
    { actorId: 'a1400000-0000-4000-8000-000000000011' },
    { artistId: 'a1400000-0000-4000-8000-000000000012' },
    { mandateId: 'a1400000-0000-4000-8000-000000000013' },
    { provider: 'kakaopay_subscription' as const },
    { environment: 'live' as const },
    { purpose: 'callback' as const },
  ])(
    'rejects ciphertext transplanted to another AAD binding %#',
    (override) => {
      const subject = vault();
      const envelope = subject.seal('fictional-billing-key', binding);
      expect(() =>
        subject.open(envelope, { ...binding, ...override }),
      ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
    },
  );
  it.each(['iv', 'ciphertext', 'tag'] as const)(
    'authenticates %s and rejects byte tampering',
    (field) => {
      const subject = vault();
      const envelope = subject.seal('fictional-billing-key', binding);
      const bytes = Buffer.from(envelope[field], 'base64url');
      bytes[0] = bytes[0]! ^ 1;
      expect(() =>
        subject.open(
          { ...envelope, [field]: bytes.toString('base64url') },
          binding,
        ),
      ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
    },
  );
  it('rejects a different configured key even under the same version label', () => {
    const envelope = vault().seal('fictional-key', binding);
    const other = createPaymentVault(
      env({ PAYMENTS_VAULT_KEY: Buffer.alloc(32, 42).toString('base64') }),
    );
    expect(() => other!.open(envelope, binding)).toThrowError(
      /^PAYMENT_VAULT_INVALID$/,
    );
  });
  it('fails closed on unknown key versions without trying fallback keys', () => {
    const envelope = vault().seal('fictional-key', binding);
    const next = createPaymentVault(
      env({ PAYMENTS_VAULT_KEY_VERSION: 'unit-fixture-v2' }),
    );
    expect(() => next!.open(envelope, binding)).toThrowError(
      /^PAYMENT_VAULT_INVALID$/,
    );
    expect(() =>
      vault().open({ ...envelope, version: 'different' }, binding),
    ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
  });
  it.each([
    { iv: '' },
    { tag: '' },
    { ciphertext: '' },
    { version: '' },
    { iv: 'a'.repeat(15) },
    { tag: 'a'.repeat(21) },
    { iv: 'a'.repeat(17) },
    { tag: 'a'.repeat(23) },
    { ciphertext: 'a'.repeat(10924) },
    { plaintext: 'must-not-accept-extra-fields' },
    { algorithm: 'aes-128-cbc' },
    { ciphertext: 'AA==' },
  ])('rejects malformed or noncanonical envelopes %#', (override) => {
    const subject = vault();
    const envelope = subject.seal('fictional-key', binding);
    expect(() =>
      subject.open(
        { ...envelope, ...override } as PaymentVaultEnvelope,
        binding,
      ),
    ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
  });
  it('rejects a valid-length noncanonical base64url tag before decryption', () => {
    const subject = vault();
    const envelope = subject.seal('fictional-key', binding);
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(envelope.tag.at(-1)!);
    const alias = envelope.tag.slice(0, -1) + alphabet[last + 1];
    expect(Buffer.from(alias, 'base64url')).toEqual(
      Buffer.from(envelope.tag, 'base64url'),
    );
    expect(() =>
      subject.open({ ...envelope, tag: alias }, binding),
    ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
  });
  it('enforces byte bounds rather than UTF-16 character counts', () => {
    const subject = vault();
    expect(() => subject.seal('', binding)).toThrowError(
      /^PAYMENT_VAULT_INVALID$/,
    );
    expect(() =>
      subject.seal('a'.repeat(PAYMENT_VAULT_PLAINTEXT_MAX_BYTES + 1), binding),
    ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
    expect(() =>
      subject.seal('가'.repeat(PAYMENT_VAULT_PLAINTEXT_MAX_BYTES), binding),
    ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
    const max = 'a'.repeat(PAYMENT_VAULT_PLAINTEXT_MAX_BYTES);
    expect(subject.open(subject.seal(max, binding), binding)).toBe(max);
  });
  it('sanitizes invalid binding errors and never includes plaintext', () => {
    const subject = vault();
    expect(() =>
      subject.seal('fictional-secret', {
        ...binding,
        actorId: 'fictional-PII',
      }),
    ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
    expect(() =>
      subject.seal('fictional-secret', {
        ...binding,
        extra: 'private',
      } as PaymentVaultBinding),
    ).toThrowError(/^PAYMENT_VAULT_INVALID$/);
  });
});

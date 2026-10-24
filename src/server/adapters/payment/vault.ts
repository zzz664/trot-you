import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ServerEnv } from '@/config/env.server';
import { checkoutProviderSchema } from '@/config/checkout';
import {
  PAYMENT_VAULT_AAD_DOMAIN,
  PAYMENT_VAULT_IV_ENCODED_LENGTH,
  PAYMENT_VAULT_TAG_ENCODED_LENGTH,
  PAYMENT_VAULT_CIPHERTEXT_MAX_LENGTH,
  PAYMENT_VAULT_ALGORITHM,
  PAYMENT_VAULT_IV_BYTES,
  PAYMENT_VAULT_KEY_BYTES,
  PAYMENT_VAULT_KEY_VERSION_MAX_LENGTH,
  PAYMENT_VAULT_KEY_VERSION_PATTERN,
  PAYMENT_VAULT_PLAINTEXT_MAX_BYTES,
  PAYMENT_VAULT_TAG_BYTES,
} from '@/config/enrollment-provider';
import { parsePreparationEnvironment } from './preparation';

const bindingSchema = z.strictObject({
  actorId: z.uuid(),
  artistId: z.uuid(),
  provider: checkoutProviderSchema,
  environment: z.enum(['test', 'live']),
  mandateId: z.uuid(),
  purpose: z.enum(['callback', 'credential', 'ready']),
});
export type PaymentVaultBinding = z.output<typeof bindingSchema>;
export type PaymentVault = {
  seal(plaintext: string, binding: PaymentVaultBinding): PaymentVaultEnvelope;
  open(envelope: PaymentVaultEnvelope, binding: PaymentVaultBinding): string;
};
const base64url = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);
export const paymentVaultEnvelopeSchema = z.strictObject({
  version: z
    .string()
    .min(1)
    .max(PAYMENT_VAULT_KEY_VERSION_MAX_LENGTH)
    .regex(PAYMENT_VAULT_KEY_VERSION_PATTERN),
  iv: base64url.length(PAYMENT_VAULT_IV_ENCODED_LENGTH),
  ciphertext: base64url.max(PAYMENT_VAULT_CIPHERTEXT_MAX_LENGTH),
  tag: base64url.length(PAYMENT_VAULT_TAG_ENCODED_LENGTH),
});
export type PaymentVaultEnvelope = z.output<typeof paymentVaultEnvelopeSchema>;
function decode(value: string, exactLength?: number) {
  const bytes = Buffer.from(value, 'base64url');
  if (
    bytes.toString('base64url') !== value ||
    (exactLength !== undefined && bytes.length !== exactLength)
  )
    throw new Error('PAYMENT_VAULT_INVALID');
  return bytes;
}
function aad(binding: PaymentVaultBinding, keyVersion: string) {
  const value = bindingSchema.parse(binding);
  return Buffer.from(
    JSON.stringify([
      PAYMENT_VAULT_AAD_DOMAIN,
      keyVersion,
      value.actorId,
      value.artistId,
      value.provider,
      value.environment,
      value.mandateId,
      value.purpose,
    ]),
    'utf8',
  );
}

// This adapter encrypts only; it neither generates nor persists a key. The
// caller must store ciphertext in a server-private table, never client props.
// Standard Node/OpenSSL AEAD handles encryption and tag verification; no custom
// cryptographic construction or unauthenticated compatibility mode exists.
export function createPaymentVault(env: ServerEnv): PaymentVault | null {
  const parsed = parsePreparationEnvironment(env);
  if (!parsed.ok) return null;
  const {
    PAYMENTS_VAULT_KEY: configuredKey,
    PAYMENTS_VAULT_KEY_VERSION: version,
  } = parsed.data;
  if (!configuredKey || !version) return null;
  const key = Buffer.from(configuredKey, 'base64');
  if (key.length !== PAYMENT_VAULT_KEY_BYTES) return null;
  return {
    seal(plaintext, binding) {
      try {
        const bytes = Buffer.from(plaintext, 'utf8');
        if (!bytes.length || bytes.length > PAYMENT_VAULT_PLAINTEXT_MAX_BYTES)
          throw new Error('PAYMENT_VAULT_INVALID');
        const iv = randomBytes(PAYMENT_VAULT_IV_BYTES);
        const cipher = createCipheriv(PAYMENT_VAULT_ALGORITHM, key, iv, {
          authTagLength: PAYMENT_VAULT_TAG_BYTES,
        });
        cipher.setAAD(aad(binding, version));
        const ciphertext = Buffer.concat([
          cipher.update(bytes),
          cipher.final(),
        ]);
        return {
          version,
          iv: iv.toString('base64url'),
          ciphertext: ciphertext.toString('base64url'),
          tag: cipher.getAuthTag().toString('base64url'),
        };
      } catch {
        throw new Error('PAYMENT_VAULT_INVALID');
      }
    },
    open(envelope, binding) {
      try {
        const parsedEnvelope = paymentVaultEnvelopeSchema.parse(envelope);
        if (parsedEnvelope.version !== version)
          throw new Error('PAYMENT_VAULT_INVALID');
        const iv = decode(parsedEnvelope.iv, PAYMENT_VAULT_IV_BYTES);
        const ciphertext = decode(parsedEnvelope.ciphertext);
        const tag = decode(parsedEnvelope.tag, PAYMENT_VAULT_TAG_BYTES);
        if (ciphertext.length > PAYMENT_VAULT_PLAINTEXT_MAX_BYTES)
          throw new Error('PAYMENT_VAULT_INVALID');
        const decipher = createDecipheriv(PAYMENT_VAULT_ALGORITHM, key, iv, {
          authTagLength: PAYMENT_VAULT_TAG_BYTES,
        });
        decipher.setAAD(aad(binding, version));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      } catch {
        throw new Error('PAYMENT_VAULT_INVALID');
      }
    },
  };
}

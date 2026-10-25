import 'server-only';
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { WEBPUSH_PROTOCOL as P } from '@/config/webpush-protocol';
import type { WebPushConfiguration, WebPushSubscription } from './types';

export function createVapidSigningKey(configuration: WebPushConfiguration) {
  const publicKey = Buffer.from(configuration.publicKey, 'base64url');
  return createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: publicKey.subarray(1, 1 + P.scalarBytes).toString('base64url'),
      y: publicKey.subarray(1 + P.scalarBytes).toString('base64url'),
      d: configuration.privateKey,
    },
  });
}

export function vapidAuthorization(
  configuration: WebPushConfiguration,
  key: KeyObject,
  endpoint: string,
  now: number,
) {
  const header = Buffer.from(
    JSON.stringify({ typ: 'JWT', alg: 'ES256' }),
  ).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now / P.millisecondsPerSecond) + P.vapidLifetimeSeconds,
      sub: configuration.subject,
    }),
  ).toString('base64url');
  const input = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(input), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `vapid t=${input}.${signature}, k=${configuration.publicKey}`;
}

/** RFC8291: one AES128GCM record. No persistent keys are generated here. */
export function encryptWebPushPayload(
  subscription: Pick<WebPushSubscription, 'p256dh' | 'auth'>,
  payload: Buffer,
  // Injection is confined to the protocol helper for published vector tests;
  // the production channel never supplies deterministic salt or ephemeral key.
  vector?: { salt: Buffer; ephemeralPrivateKey: Buffer },
) {
  const receiverKey = Buffer.from(subscription.p256dh, 'base64url');
  const auth = Buffer.from(subscription.auth, 'base64url');
  const salt = vector?.salt ?? randomBytes(P.saltBytes);
  const ephemeral = createECDH(P.curve);
  if (vector) ephemeral.setPrivateKey(vector.ephemeralPrivateKey);
  else ephemeral.generateKeys();
  const senderKey = ephemeral.getPublicKey();
  const sharedSecret = ephemeral.computeSecret(receiverKey);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    receiverKey,
    senderKey,
  ]);
  const ikm = Buffer.from(
    hkdfSync('sha256', sharedSecret, auth, keyInfo, P.scalarBytes),
  );
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      ikm,
      salt,
      Buffer.from('Content-Encoding: aes128gcm\0'),
      P.aesKeyBytes,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync(
      'sha256',
      ikm,
      salt,
      Buffer.from('Content-Encoding: nonce\0'),
      P.nonceBytes,
    ),
  );
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(
      Buffer.concat([payload, Buffer.from([P.finalRecordDelimiter])]),
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const size = Buffer.alloc(P.recordSizeBytes);
  size.writeUInt32BE(P.recordSize);
  return Buffer.concat([
    salt,
    size,
    Buffer.from([senderKey.length]),
    senderKey,
    encrypted,
  ]);
}

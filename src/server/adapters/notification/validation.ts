import 'server-only';
import { ECDH, createECDH } from 'node:crypto';
import { isIP } from 'node:net';
import { WEBPUSH_PROTOCOL as P } from '@/config/webpush-protocol';
import type { WebPushConfiguration, WebPushSubscription } from './types';

export function decodeCanonicalKey(value: unknown, bytes: number) {
  if (
    typeof value !== 'string' ||
    value.length !==
      Math.ceil((bytes * P.base64OutputCharacters) / P.base64InputBytes) ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === bytes && decoded.toString('base64url') === value
    ? decoded
    : null;
}

export function validP256PublicKey(value: unknown) {
  const decoded = decodeCanonicalKey(value, P.keyBytes);
  if (!decoded || decoded[0] !== P.p256PointPrefix) return false;
  try {
    return Buffer.from(ECDH.convertKey(decoded, P.curve)).equals(decoded);
  } catch {
    return false;
  }
}

/** Independent endpoint boundary, checked at registration AND each send. */
export function isAllowedWebPushEndpoint(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > P.endpointMaxLength ||
    !/^https:\/\/[A-Za-z0-9.-]+(?::443)?\/[^\s\\#@]+$/.test(value) ||
    /[\x00-\x20\x7f-\uffff]/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== P.https ||
      url.username ||
      url.password ||
      url.hash ||
      url.port ||
      url.pathname.length <= 1 ||
      isIP(url.hostname) ||
      url.hostname.endsWith('.') ||
      // Reject normalization tricks rather than silently changing the endpoint.
      url.href !== value.replace(':443/', '/') ||
      /%(?:0[0-9a-f]|1[0-9a-f]|7f|2e|2f|5c)/i.test(url.pathname)
    )
      return false;
    if (url.hostname === P.fcmHost)
      return P.fcmPaths.some(
        (prefix) =>
          url.pathname.startsWith(prefix) &&
          url.pathname.length > prefix.length,
      );
    if (url.hostname === P.mozillaHost)
      return (
        url.pathname.startsWith(P.mozillaPath) &&
        url.pathname.length > P.mozillaPath.length
      );
    // Apple documents the domain wildcard but no stable path prefix. Preserve
    // the opaque nonempty path; do not invent an undocumented Apple route.
    return (
      url.hostname.endsWith(P.appleSuffix) &&
      url.hostname
        .slice(0, -P.appleSuffix.length)
        .split('.')
        .every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    );
  } catch {
    return false;
  }
}

export function validateWebPushSubscription(
  value: unknown,
): value is WebPushSubscription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const input = value as Record<string, unknown>;
    return (
      isAllowedWebPushEndpoint(input.endpoint) &&
      validP256PublicKey(input.p256dh) &&
      decodeCanonicalKey(input.auth, P.authBytes) !== null
    );
  } catch {
    return false;
  }
}

export function validWebPushSubject(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > P.subjectMaxLength ||
    !/^[\x21-\x7e]+$/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'mailto:')
      return (
        !url.search &&
        !url.hash &&
        /^[^@/?#]+@[^@/?#]+\.[^@/?#]+$/.test(url.pathname)
      );
    return (
      url.protocol === P.https &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !isIP(url.hostname) &&
      url.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

export function validateWebPushConfiguration(input: WebPushConfiguration) {
  try {
    if (
      !validP256PublicKey(input.publicKey) ||
      !validWebPushSubject(input.subject)
    )
      return false;
    const scalar = decodeCanonicalKey(input.privateKey, P.scalarBytes);
    if (!scalar) return false;
    const ecdh = createECDH(P.curve);
    ecdh.setPrivateKey(scalar);
    if (ecdh.getPublicKey().toString('base64url') !== input.publicKey)
      return false;
    const timeout = input.timeoutMs ?? P.timeoutMs;
    return (
      Number.isInteger(timeout) &&
      timeout >= P.timeoutMinMs &&
      timeout <= P.timeoutMaxMs
    );
  } catch {
    return false;
  }
}

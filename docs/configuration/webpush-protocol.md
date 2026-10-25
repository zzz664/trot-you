# Web Push transport and protocol boundary

Reviewed against official references on 2026-10-25. This is implementation
documentation, not evidence of live delivery or authorization to enable it.

## Configuration and public contract

`createWebPushChannel` receives the existing VAPID public/private keys and a
`VAPID_SUBJECT` contact URI (`mailto:` or HTTPS). It validates canonical
base64url encoding, actual P-256 point membership and that the supplied public
and private keys match. Invalid configuration returns no adapter. Nothing
creates or saves an application/account key. Key rotation requires new browser
subscriptions rather than silently reusing subscriptions bound to an old key.
[VAPID specification](https://www.rfc-editor.org/rfc/rfc8292.html)

Production construction cannot override the transport or destination origin.
The explicit `notification/testing.ts` factory is a dependency seam for isolated
tests, never an environment-controlled production mode.

The only accepted payload is version 1, an opaque notification-job UUID and the
internal subscription-list route. Unknown fields fail. The adapter re-encodes
the parsed allowlist, so discarded duplicate JSON members cannot retain private
data. No message text, artist name, calling name, fan ID, source ID, media URL,
contact information or payment details are sent. The service worker supplies
fixed local notification copy. The transport does not log endpoint, keys, JWT,
payload, response body or raw network errors.

## Deliberately limited provider support

Endpoints remain opaque strings; the adapter does not reconstruct tokens or
probe providers. Only HTTPS, default port 443, canonical URLs and nonempty
paths are accepted. Credentials, fragments, IP literals, normalization tricks
and control characters are rejected at registration and again before send.

- Chromium production constants currently identify exact `fcm.googleapis.com`
  with `/wp/` and `/fcm/send/` prefixes. Its preproduction URLs and Firebase's
  unrelated project-send API are not accepted.
  [Chromium source](https://chromium.googlesource.com/chromium/src/+/refs/tags/148.0.7734.4/components/push_messaging/push_messaging_constants.cc)
- Mozilla documents exact `updates.push.services.mozilla.com` with `/wpush/`.
  Mozilla explicitly reserves endpoint changes; future changes require a
  reviewed allowlist update, not a universal-domain fallback.
  [Mozilla Autopush HTTP API](https://mozilla-services.github.io/autopush-rs/http.html)
- Apple documents `*.push.apple.com`. The hostname must have valid DNS labels
  under that exact suffix. Apple does not document a stable Web Push path
  prefix; the adapter preserves its structurally safe, nonempty opaque path
  instead of inventing one. This is not an APNs-native-token implementation.
  [WebKit platform guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

Other browsers/providers are intentionally unsupported until their official
endpoint contract is verified. This allowlist is not proof of browser endpoint
ownership; authenticated session/device registration is a separate DB boundary.

## Network and cryptographic limits

Every production request resolves the approved hostname once. Empty or mixed
public/private DNS results fail closed. A direct fresh TLS socket is pinned to
one checked address while retaining the provider hostname for certificate
verification/SNI. No proxy override, redirect following, cookie jar or adapter
retry exists. IPv4 special-purpose ranges and non-global/mapped IPv6 are denied;
the policy is deliberately more restrictive than registry exceptions.
[IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry/),
[IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry/)

The total request deadline is at most 4 seconds, including DNS, TCP, TLS and
response headers. A late DNS answer cannot initiate a timed-out request.
In-flight timeout destroys the socket and reports uncertainty. Response headers
are capped at 8 KiB and response bodies are immediately discarded.
[Node HTTPS API](https://nodejs.org/api/https.html)

Node's cryptographic primitives implement RFC8291 single-record `aes128gcm`
with a new ephemeral ECDH key and random salt for each message. The ephemeral
encryption key differs from the VAPID signing key. Payloads are capped at 2 KiB;
protocol TTL is a conservative 300 seconds. These are transport safety limits,
not a promised delivery latency. The stable Topic can replace pending copies;
it cannot provide exactly-once device display.
[Message encryption](https://www.rfc-editor.org/rfc/rfc8291.html),
[Web Push delivery protocol](https://www.rfc-editor.org/rfc/rfc8030.html)

## Outcome semantics and evidence

- 201/202 means **accepted by the push service**, never displayed or read.
- 404/410 marks a dead endpoint. 429/503 permits policy-owned retry, preserving
  bounded Retry-After metadata. A valid requested delay over 24 hours terminates
  the attempt rather than shortening the minimum wait. Missing/malformed values
  leave the database's bounded exponential backoff in control.
- Redirects and other definite client refusals are permanent failures.
- Lost response, request timeout, gateway failure and unrecognized responses
  remain unknown. DNS/egress rejection before a request is not sent.

The database worker owns bounded backoff and recovery. Recovery after an
unknown response is at-least-once; duplicates remain possible after acceptance.
The HTTP Retry-After contract is a minimum delay, not permission to retry sooner.
[HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)

Unit evidence includes the published RFC8291 ciphertext vector, independent
HMAC-based decryption and ES256 JWT verification over actual bytes sent to a
fixed disposable loopback HTTP receiver. The receiver is not a provider; its
transport is test-only. Separate mocked production-transport contracts verify
DNS pinning, TLS options, private-address rejection, late-DNS suppression,
redirect refusal and hard abort. These checks are not live TLS/provider/device
verification. Only public RFC test keys are used. No real endpoint, browser
permission, customer data, production key, deployment or scheduler is touched.

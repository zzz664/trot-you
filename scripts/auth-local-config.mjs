import assert from 'node:assert/strict';

// Pure transformation for the disposable test job; does not read credentials,
// run Docker, alter a hosted project, or mutate the checked-in default config.
export function prepareLocalAuthConfig(config) {
  assert.match(config, /^project_id = "trot-you"$/m);
  const auth = config.match(/(?:^|\n)\[auth\]\n([\s\S]*?)(?=\n\[|$)/)?.[1];
  assert.ok(auth && /^enable_signup = false$/m.test(auth));
  assert.match(config, /^\[local_smtp\]\nenabled = false$/m);
  assert.doesNotMatch(config, /^\[auth\.(email|rate_limit)\]$/m);
  return (
    config
      .replace(/^site_url = .*$/m, 'site_url = "http://127.0.0.1:3100"')
      .replace(
        /^additional_redirect_urls = .*$/m,
        'additional_redirect_urls = ["http://127.0.0.1:3100/api/auth/callback"]',
      )
      .replace(
        '[local_smtp]\nenabled = false',
        '[local_smtp]\nenabled = true\nport = 54324',
      ) +
    `
# Disposable authentication test overrides; never committed or pushed.
[auth.email]
# CLI 2.122 maps this legacy name to GOTRUE_EXTERNAL_EMAIL_ENABLED.
# Global auth.enable_signup=false still sets GOTRUE_DISABLE_SIGNUP=true.
enable_signup = true
enable_confirmations = true
max_frequency = "1s"

[auth.rate_limit]
email_sent = 1000
sign_in_sign_ups = 1000
token_verifications = 1000
token_refresh = 1000
`
  );
}

export function assertLocalAuthSettings(settings) {
  assert.equal(
    settings?.external?.email,
    true,
    'Local email provider is disabled.',
  );
  assert.equal(
    settings?.disable_signup,
    true,
    'Public signup must stay disabled.',
  );
}

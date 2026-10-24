import 'server-only';
import { CHECKOUT_PROVIDERS, type CheckoutProvider } from '@/config/checkout';
import { getServerEnv } from '@/config/env.server';
import { requireIntegrationConfiguration } from '@/server/configuration';

export function checkoutProviderConfiguration() {
  const env = getServerEnv();
  return CHECKOUT_PROVIDERS.map((provider) => ({
    provider,
    configured: requireIntegrationConfiguration(provider, env).ok,
  }));
}
export function checkoutEnvironment(
  provider: CheckoutProvider,
): 'test' | 'live' | null {
  const configuration = requireIntegrationConfiguration(provider);
  if (!configuration.ok || configuration.data.mode === 'disabled') return null;
  return configuration.data.mode;
}

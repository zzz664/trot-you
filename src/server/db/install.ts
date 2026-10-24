import 'server-only';
import { z } from 'zod';
import {
  INSTALL_CHOICES,
  type InstallError,
  type InstallResult,
} from '@/config/install';
import type { InstallPort } from '@/server/services/onboarding/install';
import type { ActorClient } from './client';

function databaseError(message: string): InstallResult<never> {
  const errors: Record<string, InstallError> = {
    ONBOARDING_INSTALL_INVALID: 'INVALID_INPUT',
    ONBOARDING_INSTALL_REQUIRED: 'GUIDANCE_REQUIRED',
    ONBOARDING_ARTIST_REQUIRED: 'INTEREST_REQUIRED',
    ONBOARDING_ALREADY_COMPLETED: 'FORBIDDEN',
    DISCOVERY_SETUP_NOT_READY: 'SETUP_NOT_READY',
    DISCOVERY_PROFILE_REQUIRED: 'PROFILE_REQUIRED',
    DISCOVERY_FORBIDDEN: 'FORBIDDEN',
  };
  return {
    ok: false,
    code: Object.hasOwn(errors, message) ? errors[message]! : 'UNAVAILABLE',
  };
}
const timestamp = z.string().datetime({ offset: true });
const stateSchema = z.object({
  choice: z.enum(INSTALL_CHOICES).nullable(),
  acknowledged_at: timestamp.nullable(),
  installation_self_reported_at: timestamp.nullable(),
  onboarding_completed_at: timestamp.nullable(),
});

export function createInstallPort(client: ActorClient): InstallPort {
  return {
    async read() {
      const { data, error } = await client
        .rpc('onboarding_get_install_state')
        .single();
      if (error) return databaseError(error.message);
      const parsed = stateSchema.safeParse(data);
      if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
      return {
        ok: true,
        data: {
          choice: parsed.data.choice,
          acknowledgedAt: parsed.data.acknowledged_at,
          installationSelfReportedAt: parsed.data.installation_self_reported_at,
          completedAt: parsed.data.onboarding_completed_at,
        },
      };
    },
    async acknowledge(choice) {
      const { error } = await client.rpc('onboarding_acknowledge_install', {
        p_choice: choice,
      });
      return error ? databaseError(error.message) : { ok: true, data: null };
    },
    async complete() {
      const { data, error } = await client.rpc('onboarding_complete');
      if (error) return databaseError(error.message);
      const parsed = timestamp.safeParse(data);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}

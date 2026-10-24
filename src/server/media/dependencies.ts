import 'server-only';
import { getServerEnv } from '@/config/env.server';
import { createMediaServiceClient } from '@/server/db/media-client';
import { createMediaDbPort } from '@/server/db/media';
import { createSupabaseStorageAdapter } from '@/server/adapters/storage/supabase';
import { verifyMedia } from '@/server/adapters/storage/verify';
import type { MediaDependencies } from '@/server/services/media/access';

export function createMediaDependencies(): MediaDependencies | null {
  const parsed = getServerEnv();
  const client = createMediaServiceClient();
  if (
    !parsed.ok ||
    !client ||
    !parsed.data.NEXT_PUBLIC_SUPABASE_URL ||
    !parsed.data.SUPABASE_SERVICE_ROLE_KEY
  )
    return null;
  return {
    db: createMediaDbPort(client),
    storage: createSupabaseStorageAdapter({
      url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    }),
    verify: verifyMedia,
    now: Date.now,
  };
}

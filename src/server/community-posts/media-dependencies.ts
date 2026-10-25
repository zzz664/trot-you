import 'server-only';
import { getServerEnv } from '@/config/env.server';
import { createMediaServiceClient } from '@/server/db/media-client';
import { createCommunityMediaPort } from '@/server/db/community-media';
import { createSupabaseStorageAdapter } from '@/server/adapters/storage/supabase';
import { verifyMedia } from '@/server/adapters/storage/verify';
import type { CommunityMediaDependencies } from '@/server/services/community-posts/media';

export function createCommunityMediaDependencies(): CommunityMediaDependencies | null {
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
    db: createCommunityMediaPort(client),
    storage: createSupabaseStorageAdapter({
      url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
      area: 'board',
    }),
    verify: verifyMedia,
    now: Date.now,
  };
}

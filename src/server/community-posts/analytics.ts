import 'server-only';
import { createMediaServiceClient } from '@/server/db/media-client';
import { createCommunityPostAnalyticsPort } from '@/server/db/community-post-analytics';
import type { CommunityPostAnalyticsPort } from '@/server/services/community-posts/analytics';

export function getCommunityPostAnalyticsPort(): CommunityPostAnalyticsPort | null {
  try {
    const client = createMediaServiceClient();
    return client ? createCommunityPostAnalyticsPort(client) : null;
  } catch {
    // Optional analytics configuration cannot undo an already committed post.
    return null;
  }
}

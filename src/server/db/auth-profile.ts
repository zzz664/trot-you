import 'server-only';
import type { ActorClient } from './client';
import type { Tables } from '@/types/database';

export type AuthProfile = Pick<
  Tables<'profiles'>,
  | 'id'
  | 'role'
  | 'onboarding_completed_at'
  | 'is_restricted'
  | 'restricted_until'
>;

export async function readAuthProfile(client: ActorClient, actorId: string) {
  // Explicit subject predicate even for admin actors, whose RLS can read more.
  // Never SELECT *: nickname, demographics and contacts are not needed here.
  return client
    .from('profiles')
    .select(
      'id, role, onboarding_completed_at, is_restricted, restricted_until',
    )
    .eq('id', actorId)
    .maybeSingle();
}

import 'server-only';
import type { AuthProfile } from '@/server/db/auth-profile';
import { failure, success, type Result } from '@/lib/result';

export type AuthPort = {
  verifySubject(): Promise<Result<string | null, 'INTERNAL'>>;
  readProfile(subject: string): Promise<Result<AuthProfile, 'INTERNAL'>>;
  beginLogin(callback: string): Promise<Result<string, 'INTERNAL'>>;
  exchangeCode(code: string): Promise<Result<null, 'UNAUTHENTICATED'>>;
  signOut(): Promise<Result<null, 'INTERNAL'>>;
};
export type AuthState =
  | { status: 'unconfigured' | 'anonymous' | 'unavailable' }
  | { status: 'authenticated'; profile: AuthProfile };

export async function readSession(port: AuthPort | null): Promise<AuthState> {
  if (!port) return { status: 'unconfigured' };
  const subject = await port.verifySubject();
  if (!subject.ok) return { status: 'unavailable' };
  if (!subject.data) return { status: 'anonymous' };
  const profile = await port.readProfile(subject.data);
  if (!profile.ok || profile.data.id !== subject.data)
    return { status: 'unavailable' };
  return { status: 'authenticated', profile: profile.data };
}

export async function completeLogin(port: AuthPort, code: string) {
  const exchanged = await port.exchangeCode(code);
  if (!exchanged.ok) return exchanged;
  const state = await readSession(port);
  return state.status === 'authenticated'
    ? success(state)
    : failure('UNAUTHENTICATED');
}

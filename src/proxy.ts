import { NextResponse, type NextRequest } from 'next/server';
import { createAuthContext } from '@/server/auth/context';
import { AUTH_DOCUMENT_REFERRER_POLICY } from '@/config/auth';

export async function proxy(request: NextRequest) {
  const context = createAuthContext(
    request.cookies.getAll(),
    ({ name, value }) => {
      request.cookies.set(name, value);
    },
  );
  // Verification triggers refresh before rendering. The page DAL remains the
  // authorization boundary and fails closed if Auth or the profile read fails.
  try {
    await context.client?.auth.getClaims();
  } catch {
    // No auth decision is inferred from this transport failure.
  }
  const response = context.apply(
    NextResponse.next({ request: { headers: request.headers } }),
  );
  response.headers.set('Referrer-Policy', AUTH_DOCUMENT_REFERRER_POLICY);
  return response;
}

export const config = {
  // Static literal required by Next.js. Auth handlers own their cookie writes.
  matcher: [
    '/((?!_next/static|_next/image|api/auth|api/onboarding|api/checkout|favicon.ico|ui-preview|sw\\.js$|offline\\.html$|manifest\\.webmanifest$|icons/).*)',
  ],
};

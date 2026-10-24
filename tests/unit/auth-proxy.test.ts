// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { proxy } from '@/proxy';

const { createContext } = vi.hoisted(() => ({ createContext: vi.fn() }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: createContext }));

beforeEach(() => vi.clearAllMocks());

describe('Next 16 proxy refresh transport', () => {
  it('propagates refreshed cookies to both downstream server request and final browser response', async () => {
    const getClaims = vi.fn();
    createContext.mockImplementation(
      (
        _incoming,
        onWrite: (cookie: { name: string; value: string }) => void,
      ) => {
        getClaims.mockImplementation(async () => {
          onWrite({ name: 'sb-project-auth-token.0', value: 'fresh-token' });
          return { data: { claims: { sub: 'fixture' } }, error: null };
        });
        return {
          client: { auth: { getClaims } },
          apply: (response: NextResponse) => {
            response.cookies.set('sb-project-auth-token.0', 'fresh-token', {
              httpOnly: true,
              sameSite: 'lax',
              path: '/',
            });
            response.headers.set('cache-control', 'private, no-store');
            return response;
          },
        };
      },
    );
    const request = new NextRequest('https://app.example/', {
      headers: {
        cookie: 'sb-project-auth-token.0=expired-token; preference=large',
      },
    });
    const response = await proxy(request);
    expect(getClaims).toHaveBeenCalledOnce();
    expect(request.cookies.get('sb-project-auth-token.0')?.value).toBe(
      'fresh-token',
    );
    expect(response.headers.get('x-middleware-request-cookie')).toContain(
      'sb-project-auth-token.0=fresh-token',
    );
    expect(response.headers.get('x-middleware-request-cookie')).toContain(
      'preference=large',
    );
    expect(response.cookies.get('sb-project-auth-token.0')?.value).toBe(
      'fresh-token',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(response.headers.get('location')).toBeNull();
  });
  it('does not grant authorization or synthesize a session on refresh failure', async () => {
    createContext.mockReturnValue({
      client: {
        auth: {
          getClaims: vi.fn().mockRejectedValue(new Error('network failed')),
        },
      },
      apply: (response: NextResponse) => response,
    });
    const response = await proxy(new NextRequest('https://app.example/admin'));
    expect(response.cookies.getAll()).toEqual([]);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
  });
  it('allows keyless rendering without constructing or reading a session', async () => {
    createContext.mockReturnValue({
      client: null,
      apply: (response: NextResponse) => response,
    });
    const response = await proxy(new NextRequest('https://app.example/start'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(response.cookies.getAll()).toEqual([]);
  });
});

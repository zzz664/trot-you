import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaRegistration } from '@/components/pwa/PwaRegistration';
import { PWA } from '@/config/pwa';

const { production } = vi.hoisted(() => ({ production: vi.fn() }));
vi.mock('@/config/env', () => ({ isProductionBuild: production }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  production.mockReturnValue(true);
});

describe('safe worker registration', () => {
  it('registers a same-origin root worker without requesting permissions', async () => {
    const register = vi.fn().mockResolvedValue({});
    const requestPermission = vi.fn();
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    vi.stubGlobal('Notification', { requestPermission });
    render(<PwaRegistration />);
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(PWA.workerUrl, {
        scope: PWA.scope,
        updateViaCache: 'none',
      }),
    );
    expect(requestPermission).not.toHaveBeenCalled();
  });
  it('does not register a development worker', () => {
    production.mockReturnValue(false);
    const register = vi.fn();
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    render(<PwaRegistration />);
    expect(register).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'works with unsupported or insecure browser (secure=%s)',
    (secure) => {
      vi.stubGlobal('isSecureContext', secure);
      vi.stubGlobal('navigator', {});
      expect(() => render(<PwaRegistration />)).not.toThrow();
    },
  );
  it('does not register on an insecure origin even if API exists', () => {
    const register = vi.fn();
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    render(<PwaRegistration />);
    expect(register).not.toHaveBeenCalled();
  });
  it('contains a registration failure without presenting a fake success', async () => {
    vi.stubGlobal('isSecureContext', true);
    const register = vi.fn().mockRejectedValue(new Error('worker blocked'));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    const { container } = render(<PwaRegistration />);
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(container).toBeEmptyDOMElement();
  });
});

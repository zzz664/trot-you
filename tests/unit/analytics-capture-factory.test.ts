// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnalyticsCapturePort } from '@/server/analytics/capture';
const mock = vi.hoisted(() => ({ client: vi.fn(), port: vi.fn() }));
vi.mock('@/server/db/media-client', () => ({
  createMediaServiceClient: mock.client,
}));
vi.mock('@/server/db/analytics-capture', () => ({
  createAnalyticsCapturePort: mock.port,
}));
beforeEach(() => vi.resetAllMocks());
describe('optional prospective capture composition', () => {
  it('constructs only a server-side capability without provider dispatch', () => {
    const client = { private: true };
    const port = { server: vi.fn() };
    mock.client.mockReturnValue(client);
    mock.port.mockReturnValue(port);
    expect(getAnalyticsCapturePort()).toBe(port);
    expect(mock.port).toHaveBeenCalledExactlyOnceWith(client);
  });
  it('returns unavailable without private configuration', () => {
    mock.client.mockReturnValue(null);
    expect(getAnalyticsCapturePort()).toBeNull();
    expect(mock.port).not.toHaveBeenCalled();
  });
  it.each(['client', 'port'] as const)(
    'isolates %s setup failure after a committed source operation',
    (kind) => {
      mock.client.mockReturnValue({ private: true });
      mock[kind].mockImplementation(() => {
        throw new Error('private configuration');
      });
      expect(getAnalyticsCapturePort()).toBeNull();
    },
  );
});

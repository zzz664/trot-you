import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewObservations } from '@/components/artists/usePreviewObservations';
import { ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE } from '@/config/analytics';
import type { ArtistPreviewData } from '@/config/artists';
const mock = vi.hoisted(() => ({ record: vi.fn(), uuid: vi.fn() }));
vi.mock('@/client/analytics', () => ({ recordPreviewRender: mock.record }));
const actor = 'a3900000-0000-4000-8000-000000000001';
const source = 'a3900000-0000-4000-8000-000000000002';
const other = 'a3900000-0000-4000-8000-000000000003';
const key = 'a3900000-0000-4000-8000-000000000004';
function data(patch: Partial<ArtistPreviewData> = {}): ArtistPreviewData {
  return {
    artist: { slug: 'fictional-star', name: 'Fictional', description: null },
    messages: [
      {
        id: source,
        kind: 'text',
        text: 'Preview',
        sentAt: '2026-10-26T00:00:00Z',
        media: [],
      },
    ],
    selectedSlug: null,
    onboarding: false,
    observationActorId: actor,
    ...patch,
  };
}
function Harness({ value = data() }: { value?: ArtistPreviewData }) {
  const root = usePreviewObservations(value);
  return (
    <main ref={root}>
      {value.messages.map((message) => (
        <div
          key={message.id}
          data-testid={message.id}
          {...{ [ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE]: message.id }}
        >
          Preview
        </div>
      ))}
    </main>
  );
}
type Observer = {
  callback: IntersectionObserverCallback;
  targets: Element[];
  disconnect: () => void;
};
let observers: Observer[] = [];
function intersection(
  observer = observers.at(-1)!,
  target = screen.getByTestId(source),
  isIntersecting = true,
) {
  act(() =>
    observer.callback(
      [
        {
          target,
          isIntersecting,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          intersectionRatio: isIntersecting ? 1 : 0,
          rootBounds: null,
          time: 0,
        },
      ],
      {} as IntersectionObserver,
    ),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  observers = [];
  mock.uuid.mockReturnValue(key);
  mock.record.mockResolvedValue(undefined);
  vi.stubGlobal('crypto', { randomUUID: mock.uuid });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      record: Observer;
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, targets: [], disconnect: vi.fn() };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.targets.push(target);
      }
      disconnect() {
        this.record.disconnect();
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
describe('committed preview observation lifecycle', () => {
  it('does not emit for server rendering/prefetch or mere mounting', () => {
    expect(renderToString(<Harness />)).toContain('Preview');
    expect(mock.record).not.toHaveBeenCalled();
    render(<Harness />);
    expect(observers).toHaveLength(1);
    expect(mock.record).not.toHaveBeenCalled();
    intersection(observers[0], screen.getByTestId(source), false);
    expect(mock.record).not.toHaveBeenCalled();
  });
  it('emits one visible observation with stable UUID and rendered own actor only', () => {
    render(<Harness />);
    intersection();
    intersection();
    expect(mock.uuid).toHaveBeenCalledOnce();
    expect(mock.record).toHaveBeenCalledExactlyOnceWith(
      source,
      key,
      actor,
      expect.any(AbortSignal),
    );
  });
  it('does not retry on same-target rerender, reintersection or uncertain transport outcome', async () => {
    mock.record.mockRejectedValue(new Error('unknown'));
    const view = render(<Harness />);
    intersection();
    await act(async () => {});
    view.rerender(<Harness value={data()} />);
    intersection();
    expect(mock.record).toHaveBeenCalledOnce();
  });
  it('does not resurrect an old strict-mode effect or duplicate current setup', () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(observers.length).toBeGreaterThan(1);
    intersection(observers[0]);
    expect(mock.record).not.toHaveBeenCalled();
    intersection();
    intersection();
    expect(mock.record).toHaveBeenCalledOnce();
  });
  it('skips pre-onboarding renders', () => {
    render(<Harness value={data({ onboarding: true })} />);
    expect(observers).toHaveLength(0);
    expect(mock.record).not.toHaveBeenCalled();
  });
  it('skips renders without their own actor identity', () => {
    const value = data();
    delete value.observationActorId;
    render(<Harness value={value} />);
    expect(observers).toHaveLength(0);
    expect(mock.record).not.toHaveBeenCalled();
  });
  it('does not approximate viewport visibility when observer is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Harness />);
    expect(mock.record).not.toHaveBeenCalled();
  });
  it('never sends from initially hidden document', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    render(<Harness />);
    expect(observers).toHaveLength(0);
    expect(mock.record).not.toHaveBeenCalled();
  });
  it.each(['pagehide', 'popstate'])(
    'aborts in-flight observation and suppresses stale target after %s',
    (event) => {
      mock.record.mockReturnValue(new Promise(() => {}));
      render(<Harness />);
      intersection();
      const signal = mock.record.mock.calls[0]![3] as AbortSignal;
      fireEvent(window, new Event(event));
      expect(signal.aborted).toBe(true);
      intersection();
      expect(mock.record).toHaveBeenCalledOnce();
      expect(observers[0]!.disconnect).toHaveBeenCalled();
    },
  );
  it('hidden document permanently suspends old targets instead of attributing return to a potentially replaced actor', () => {
    mock.record.mockReturnValue(new Promise(() => {}));
    render(<Harness />);
    intersection();
    const signal = mock.record.mock.calls[0]![3] as AbortSignal;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(signal.aborted).toBe(true);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));
    intersection();
    expect(mock.record).toHaveBeenCalledOnce();
  });
  it('actor replacement aborts A, ignores its queued callbacks and binds new observation to B', () => {
    mock.record.mockReturnValue(new Promise(() => {}));
    const view = render(<Harness />);
    const old = observers[0]!;
    intersection(old);
    const signal = mock.record.mock.calls[0]![3] as AbortSignal;
    view.rerender(<Harness value={data({ observationActorId: other })} />);
    expect(signal.aborted).toBe(true);
    intersection(old);
    expect(mock.record).toHaveBeenCalledOnce();
    intersection();
    expect(mock.record).toHaveBeenCalledTimes(2);
    expect(mock.record.mock.calls[1]![2]).toBe(other);
  });
  it('target/navigation replacement cancels the old target before observing the new one', () => {
    mock.record.mockReturnValue(new Promise(() => {}));
    const view = render(<Harness />);
    const old = observers[0]!;
    intersection(old);
    const signal = mock.record.mock.calls[0]![3] as AbortSignal;
    const value = data({
      artist: { slug: 'other-star', name: 'Other', description: null },
      messages: [{ ...data().messages[0]!, id: other }],
    });
    view.rerender(<Harness value={value} />);
    expect(signal.aborted).toBe(true);
    intersection(old, screen.getByTestId(other));
    expect(mock.record).toHaveBeenCalledOnce();
    intersection(observers.at(-1), screen.getByTestId(other));
    expect(mock.record.mock.calls[1]![0]).toBe(other);
  });
  it('cleanup aborts pending transport and ignores queued observations', () => {
    mock.record.mockReturnValue(new Promise(() => {}));
    const view = render(<Harness />);
    const target = screen.getByTestId(source);
    intersection();
    const signal = mock.record.mock.calls[0]![3] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    intersection(observers[0], target);
    expect(mock.record).toHaveBeenCalledOnce();
  });
  it('refuses detached, foreign-root and unlisted source targets', () => {
    render(<Harness />);
    const foreign = document.createElement('div');
    foreign.setAttribute(ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE, source);
    intersection(observers[0], foreign);
    document.body.append(foreign);
    intersection(observers[0], foreign);
    foreign.remove();
    const target = screen.getByTestId(source);
    target.setAttribute(ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE, other);
    intersection(observers[0], target);
    expect(mock.record).not.toHaveBeenCalled();
  });
  it('does not substitute a weak event key or retry if UUID creation fails', () => {
    mock.uuid.mockImplementation(() => {
      throw new Error('unavailable');
    });
    render(<Harness />);
    intersection();
    intersection();
    expect(mock.record).not.toHaveBeenCalled();
    expect(mock.uuid).toHaveBeenCalledOnce();
  });
});

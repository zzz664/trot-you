// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { captureSettledSchedulePage } from '../e2e/schedules/screenshot-capture';

function fixture(present = true) {
  const preference = { waitFor: vi.fn(async (): Promise<void> => undefined) };
  const loading = { waitFor: vi.fn(async (): Promise<void> => undefined) };
  const controls = {
    count: vi.fn(async () => (present ? 1 : 0)),
    locator: vi.fn(() => preference),
    getByRole: vi.fn(() => loading),
  };
  const main = { getByTestId: vi.fn(() => controls) };
  const screenshot = vi.fn(async () => Buffer.alloc(0));
  const getByRole = vi.fn(() => main);
  return {
    page: { getByRole, screenshot } as unknown as Pick<
      Page,
      'getByRole' | 'screenshot'
    >,
    getByRole,
    main,
    controls,
    preference,
    loading,
    screenshot,
  };
}

it('waits for actual notice state and loading removal before full-page measurement', async () => {
  const f = fixture();
  let release!: () => void;
  let releaseLoading!: () => void;
  f.preference.waitFor.mockImplementationOnce(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  f.loading.waitFor.mockImplementationOnce(
    () => new Promise<void>((resolve) => (releaseLoading = resolve)),
  );
  const capture = captureSettledSchedulePage(f.page, 'settled.png');
  await vi.waitFor(() => expect(f.preference.waitFor).toHaveBeenCalledOnce());
  expect(f.screenshot).not.toHaveBeenCalled();
  expect(f.loading.waitFor).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(f.loading.waitFor).toHaveBeenCalledOnce());
  expect(f.screenshot).not.toHaveBeenCalled();
  releaseLoading();
  await capture;
  expect(f.getByRole).toHaveBeenCalledExactlyOnceWith('main');
  expect(f.main.getByTestId).toHaveBeenCalledExactlyOnceWith(
    'schedule-notice-controls',
  );
  expect(f.controls.locator).toHaveBeenCalledExactlyOnceWith(
    '[data-schedule-preference]',
  );
  expect(f.preference.waitFor).toHaveBeenCalledExactlyOnceWith({
    state: 'visible',
  });
  expect(f.controls.getByRole).toHaveBeenCalledExactlyOnceWith('status');
  expect(f.loading.waitFor).toHaveBeenCalledExactlyOnceWith({
    state: 'hidden',
  });
  expect(f.screenshot).toHaveBeenCalledExactlyOnceWith({
    path: 'settled.png',
    fullPage: true,
  });
});

it('preserves already-asserted admin, loading and revoked pages without a notice panel', async () => {
  const f = fixture(false);
  await captureSettledSchedulePage(f.page, 'no-panel.png');
  expect(f.controls.locator).not.toHaveBeenCalled();
  expect(f.controls.getByRole).not.toHaveBeenCalled();
  expect(f.screenshot).toHaveBeenCalledExactlyOnceWith({
    path: 'no-panel.png',
    fullPage: true,
  });
});

it('fails an unsettled panel instead of saving misleading partial evidence', async () => {
  const f = fixture();
  const error = new Error('notice state never became visible');
  f.preference.waitFor.mockRejectedValueOnce(error);
  await expect(
    captureSettledSchedulePage(f.page, 'must-not-exist.png'),
  ).rejects.toBe(error);
  expect(f.screenshot).not.toHaveBeenCalled();
});

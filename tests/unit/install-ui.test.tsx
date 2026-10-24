import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallOnboarding } from '@/components/onboarding/InstallOnboarding';
import { InstallPromptCapture } from '@/components/onboarding/InstallPromptCapture';
import {
  INITIAL_INSTALL_BROWSER_STATE,
  INSTALL_CHOICES,
  type InstallBrowserState,
  type InstallData,
  type InstallSubmitResult,
} from '@/config/install';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  submit: vi.fn(),
  prompt: vi.fn(),
  permission: vi.fn(),
  snapshot: {} as InstallBrowserState,
  listeners: new Set<() => void>(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@/client/install', () => ({ submitInstall: mocks.submit }));
vi.mock('@/client/install-browser', () => ({
  getInstallBrowserSnapshot: () => mocks.snapshot,
  getInstallBrowserServerSnapshot: () => mocks.snapshot,
  subscribeInstallBrowser: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
  promptInstall: mocks.prompt,
  requestInstallNotificationPermission: mocks.permission,
}));
const base: InstallData = {
  selectedName: '가상 가수',
  choice: null,
  acknowledgedAt: null,
  installationSelfReportedAt: null,
  completedAt: null,
};
function subject(data = base, key = 'initial') {
  return (
    <NextIntlClientProvider locale="ko" messages={messages}>
      <InstallOnboarding key={key} data={data} />
    </NextIntlClientProvider>
  );
}
function browserState(patch: Partial<InstallBrowserState>) {
  act(() => {
    mocks.snapshot = { ...mocks.snapshot, ...patch };
    mocks.listeners.forEach((listener) => listener());
  });
}
const button = (
  key: 'saveChoice' | 'complete' | 'installAction' | 'notificationAction',
) => screen.getByRole('button', { name: messages.install[key] });
async function choose(choice: (typeof INSTALL_CHOICES)[number]) {
  await userEvent.click(
    screen.getByRole('radio', { name: messages.install.choices[choice] }),
  );
}
async function saveChoice() {
  await userEvent.click(button('saveChoice'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.snapshot = {
    ...INITIAL_INSTALL_BROWSER_STATE,
    platform: 'android',
    secure: true,
    notification: 'default',
  };
  mocks.submit.mockResolvedValue({ ok: true, next: routes.onboardingInstall });
});

describe('explicit install guidance choices', () => {
  it('starts with no choice or automatic permission/install/save', () => {
    render(subject());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      messages.install.title,
    );
    expect(screen.getByText(messages.install.installNotRequired)).toBeVisible();
    expect(
      screen.getByText(messages.install.notificationNotEnabled),
    ).toBeVisible();
    for (const option of screen.getAllByRole('radio'))
      expect(option).not.toBeChecked();
    expect(button('saveChoice')).toBeDisabled();
    expect(button('complete')).toBeDisabled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it.each(INSTALL_CHOICES)(
    'saves %s distinctly before completing',
    async (choice) => {
      render(subject());
      await choose(choice);
      expect(button('complete')).toBeDisabled();
      await saveChoice();
      expect(mocks.submit).toHaveBeenCalledWith({
        action: 'acknowledge',
        choice,
      });
      expect(screen.getByText(messages.install.savedChoice)).toBeVisible();
      expect(button('complete')).toBeEnabled();
      expect(mocks.replace).not.toHaveBeenCalled();
      mocks.submit.mockResolvedValueOnce({ ok: true, next: routes.home });
      await userEvent.click(button('complete'));
      expect(mocks.submit).toHaveBeenLastCalledWith({ action: 'complete' });
      expect(mocks.replace).toHaveBeenCalledWith(routes.home);
      expect(mocks.permission).not.toHaveBeenCalled();
    },
  );
  it('resumes a saved acknowledgment without asking for installation or permission', () => {
    render(
      subject({
        ...base,
        choice: 'skipped',
        acknowledgedAt: '2026-10-24T00:00:00Z',
      }),
    );
    expect(
      screen.getByRole('radio', { name: messages.install.choices.skipped }),
    ).toBeChecked();
    expect(button('saveChoice')).toBeDisabled();
    expect(button('complete')).toBeEnabled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('requires a changed choice to be saved before completion', async () => {
    render(
      subject({
        ...base,
        choice: 'acknowledged',
        acknowledgedAt: '2026-10-24T00:00:00Z',
      }),
    );
    await choose('installed_self_reported');
    expect(button('complete')).toBeDisabled();
    expect(button('saveChoice')).toBeEnabled();
    await saveChoice();
    expect(mocks.submit).toHaveBeenCalledWith({
      action: 'acknowledge',
      choice: 'installed_self_reported',
    });
    expect(button('complete')).toBeEnabled();
  });
  it('serializes repeated save clicks and disables competing choices while pending', async () => {
    let finish: (value: InstallSubmitResult) => void = () => {};
    mocks.submit.mockImplementation(
      () =>
        new Promise<InstallSubmitResult>((resolve) => {
          finish = resolve;
        }),
    );
    render(subject());
    await choose('acknowledged');
    fireEvent.click(button('saveChoice'));
    fireEvent.click(
      screen.getByRole('button', { name: messages.install.savingChoice }),
    );
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    for (const option of screen.getAllByRole('radio'))
      expect(option).toBeDisabled();
    expect(button('complete')).toBeDisabled();
    await act(async () => finish({ ok: true, next: routes.onboardingInstall }));
    expect(button('complete')).toBeEnabled();
  });
  it('keeps an uncertain choice and retries the identical save without fake success', async () => {
    mocks.submit.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(subject());
    await choose('skipped');
    await saveChoice();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.install.errors.UNAVAILABLE,
    );
    expect(
      screen.getByRole('radio', { name: messages.install.choices.skipped }),
    ).toBeChecked();
    expect(button('complete')).toBeDisabled();
    expect(mocks.replace).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.submit).toHaveBeenNthCalledWith(2, {
      action: 'acknowledge',
      choice: 'skipped',
    });
    expect(button('complete')).toBeEnabled();
  });
  it('retries completion after a lost response without altering the saved choice', async () => {
    mocks.submit.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(
      subject({
        ...base,
        choice: 'acknowledged',
        acknowledgedAt: '2026-10-24T00:00:00Z',
      }),
    );
    await userEvent.click(button('complete'));
    expect(mocks.replace).not.toHaveBeenCalled();
    mocks.submit.mockResolvedValueOnce({ ok: true, next: routes.home });
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.submit.mock.calls).toEqual([
      [{ action: 'complete' }],
      [{ action: 'complete' }],
    ]);
    expect(mocks.replace).toHaveBeenCalledWith(routes.home);
  });
  it('does not navigate from a stale completion response after unmount', async () => {
    let finish: (value: InstallSubmitResult) => void = () => {};
    mocks.submit.mockImplementation(
      () =>
        new Promise<InstallSubmitResult>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(subject({ ...base, choice: 'skipped' }));
    await userEvent.click(button('complete'));
    view.unmount();
    await act(async () => finish({ ok: true, next: routes.home }));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('does not let a delayed completion override a newer Back click before unmount', async () => {
    let finish: (value: InstallSubmitResult) => void = () => {};
    mocks.submit.mockImplementation(
      () =>
        new Promise<InstallSubmitResult>((resolve) => {
          finish = resolve;
        }),
    );
    render(subject({ ...base, choice: 'skipped' }));
    await userEvent.click(button('complete'));
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.back }),
    );
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      routes.onboardingArtists,
    );
    await act(async () => finish({ ok: true, next: routes.home }));
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      routes.onboardingArtists,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('invalidates browser Back responses without making a restored form permanently inactive', async () => {
    const finishes: Array<(value: InstallSubmitResult) => void> = [];
    mocks.submit.mockImplementation(
      () =>
        new Promise<InstallSubmitResult>((resolve) => {
          finishes.push(resolve);
        }),
    );
    render(subject({ ...base, choice: 'skipped' }));
    await userEvent.click(button('complete'));
    fireEvent.popState(window);
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.install.errors.UNAVAILABLE,
    );
    expect(button('complete')).toBeEnabled();
    await userEvent.click(button('complete'));
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    await act(async () => finishes[0]!({ ok: true, next: routes.home }));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: messages.install.completing }),
    ).toBeDisabled();
    await act(async () => finishes[1]!({ ok: true, next: routes.home }));
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(routes.home);
  });
  it('remounts from a new authoritative RSC key and ignores the old pending save', async () => {
    let finish: (value: InstallSubmitResult) => void = () => {};
    mocks.submit.mockImplementation(
      () =>
        new Promise<InstallSubmitResult>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(subject());
    await choose('installed_self_reported');
    fireEvent.click(button('saveChoice'));
    view.rerender(
      subject(
        { ...base, choice: 'skipped', acknowledgedAt: '2026-10-24T01:00:00Z' },
        'server-new-choice',
      ),
    );
    expect(
      screen.getByRole('radio', { name: messages.install.choices.skipped }),
    ).toBeChecked();
    await act(async () => finish({ ok: true, next: routes.onboardingInstall }));
    expect(
      screen.getByRole('radio', { name: messages.install.choices.skipped }),
    ).toBeChecked();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(button('complete')).toBeEnabled();
  });
  it.each([
    ['PROFILE_REQUIRED', routes.onboarding],
    ['INTEREST_REQUIRED', routes.onboardingArtists],
    ['UNAUTHENTICATED', routes.start],
  ] as const)(
    'returns to authoritative recovery for %s',
    async (code, path) => {
      mocks.submit.mockResolvedValueOnce({ ok: false, code });
      render(subject({ ...base, choice: 'skipped' }));
      await userEvent.click(button('complete'));
      expect(mocks.replace).toHaveBeenCalledWith(path);
      expect(mocks.refresh).toHaveBeenCalled();
    },
  );
  it('clears a locally saved flag when the server requires guidance again', async () => {
    mocks.submit.mockResolvedValueOnce({
      ok: false,
      code: 'GUIDANCE_REQUIRED',
    });
    render(subject({ ...base, choice: 'skipped' }));
    await userEvent.click(button('complete'));
    expect(button('complete')).toBeDisabled();
    expect(button('saveChoice')).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.install.errors.GUIDANCE_REQUIRED,
    );
    mocks.submit.mockResolvedValueOnce({
      ok: true,
      next: routes.onboardingInstall,
    });
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.submit).toHaveBeenLastCalledWith({
      action: 'acknowledge',
      choice: 'skipped',
    });
    expect(button('complete')).toBeEnabled();
  });
  it.each(['SETUP_NOT_READY', 'FORBIDDEN'] as const)(
    'refreshes instead of replaying a blocked %s request',
    async (code) => {
      mocks.submit.mockResolvedValueOnce({ ok: false, code });
      render(subject({ ...base, choice: 'skipped' }));
      await userEvent.click(button('complete'));
      await userEvent.click(
        screen.getByRole('button', { name: messages.ui.retry }),
      );
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      expect(mocks.submit).toHaveBeenCalledTimes(1);
    },
  );
  it('offers known Back, change-artist and real logout paths without clearing saved state', async () => {
    render(subject({ ...base, choice: 'skipped' }));
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.back }),
    );
    expect(mocks.replace).toHaveBeenCalledWith(routes.onboardingArtists);
    await userEvent.click(
      screen.getByRole('button', { name: messages.artists.changeSelection }),
    );
    expect(mocks.push).toHaveBeenCalledWith(routes.onboardingArtists);
    const logout = screen
      .getByRole('button', { name: messages.onboarding.cancel })
      .closest('form');
    expect(logout).toHaveAttribute('method', 'post');
    expect(logout).toHaveAttribute('action', routes.authLogout);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

describe('browser-specific guidance without fake capability', () => {
  it.each(['ios', 'android', 'desktop', 'unknown'] as const)(
    'shows honest %s manual instructions',
    (platform) => {
      mocks.snapshot = { ...mocks.snapshot, platform };
      render(subject());
      expect(
        screen.getByText(messages.install.platforms[platform].intro),
      ).toBeVisible();
      expect(
        screen.getByText(messages.install.platforms[platform].step1),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: messages.install.installAction }),
      ).not.toBeInTheDocument();
    },
  );
  it('uses only a user click to consume an available browser install event', async () => {
    mocks.snapshot = { ...mocks.snapshot, canPrompt: true };
    render(subject());
    expect(mocks.prompt).not.toHaveBeenCalled();
    await userEvent.click(button('installAction'));
    expect(mocks.prompt).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
    for (const option of screen.getAllByRole('radio'))
      expect(option).not.toBeChecked();
  });
  it.each(['accepted', 'dismissed', 'unavailable'] as const)(
    'explains %s without automatically choosing or completing',
    (promptState) => {
      mocks.snapshot = { ...mocks.snapshot, promptState };
      render(subject());
      expect(
        screen.getByText(messages.install.promptStates[promptState]),
      ).toBeVisible();
      expect(button('complete')).toBeDisabled();
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it('does not save installation based on standalone or appinstalled observations', () => {
    mocks.snapshot = {
      ...mocks.snapshot,
      standalone: true,
      installedEventObserved: true,
    };
    render(subject());
    expect(screen.getByText(messages.install.standalone)).toBeVisible();
    expect(
      screen.getByText(messages.install.installedEventObserved),
    ).toBeVisible();
    for (const option of screen.getAllByRole('radio'))
      expect(option).not.toBeChecked();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('changes the explanation when the browser display mode updates', () => {
    render(subject());
    expect(
      screen.getByText(messages.install.platforms.android.intro),
    ).toBeVisible();
    browserState({ standalone: true });
    expect(screen.getByText(messages.install.standalone)).toBeVisible();
    expect(
      screen.queryByText(messages.install.platforms.android.intro),
    ).not.toBeInTheDocument();
  });
  it('does not show permission action before standalone', () => {
    render(subject());
    expect(
      screen.getByText(messages.install.notificationAfterInstall),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: messages.install.notificationAction,
      }),
    ).not.toBeInTheDocument();
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it('requests optional permission only on its dedicated click, never on choice or complete', async () => {
    mocks.snapshot = { ...mocks.snapshot, standalone: true };
    render(subject());
    expect(mocks.permission).not.toHaveBeenCalled();
    await userEvent.click(button('notificationAction'));
    expect(mocks.permission).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(button('complete')).toBeDisabled();
  });
  it.each(['denied', 'granted', 'unsupported'] as const)(
    'allows saved completion with %s notifications and no request control',
    (notification) => {
      mocks.snapshot = { ...mocks.snapshot, standalone: true, notification };
      render(subject({ ...base, choice: 'skipped' }));
      expect(
        screen.getByText(messages.install.notificationStates[notification]),
      ).toBeVisible();
      expect(
        screen.getByText(messages.install.notificationNotEnabled),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', {
          name: messages.install.notificationAction,
        }),
      ).not.toBeInTheDocument();
      expect(button('complete')).toBeEnabled();
      expect(mocks.permission).not.toHaveBeenCalled();
    },
  );
  it('does not block completion when optional permission fails or stays pending', () => {
    mocks.snapshot = {
      ...mocks.snapshot,
      standalone: true,
      notificationFailed: true,
      notificationPending: true,
    };
    render(subject({ ...base, choice: 'acknowledged' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.install.notificationFailed,
    );
    expect(button('complete')).toBeEnabled();
  });
  it('global capture observes only, without prompting, saving or changing navigation', () => {
    const view = render(<InstallPromptCapture />);
    expect(mocks.listeners.size).toBe(1);
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    view.unmount();
    expect(mocks.listeners.size).toBe(0);
  });
});

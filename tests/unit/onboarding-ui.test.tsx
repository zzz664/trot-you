import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen';
import { ProfileOnboarding } from '@/components/onboarding/ProfileOnboarding';
import { Checkbox, RadioGroup } from '@/components/ui/Checkbox';
import type {
  OnboardingData,
  OnboardingStep,
  OnboardingSubmitResult,
} from '@/config/onboarding';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  submit: vi.fn(),
  page: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@/server/onboarding/page', () => ({ getOnboardingPage: mocks.page }));
vi.mock('@/client/onboarding', () => ({
  submitOnboarding: mocks.submit,
}));

const policy = (kind: string, version: string) => ({
  version,
  title: `Fictional ${kind} policy for isolated UI tests`,
  body: `Fictional ${kind} body. Not a real legal policy.`,
});
const base: OnboardingData = {
  fontScale: 'large',
  fontSelected: true,
  callName: '테스트팬',
  nameMin: 2,
  nameMax: 10,
  nameReady: true,
  profileCompleted: false,
  terms: policy('terms', '11111111-1111-4111-8111-111111111111'),
  privacy: policy('privacy', '22222222-2222-4222-8222-222222222222'),
  analytics: policy('analytics', '33333333-3333-4333-8333-333333333333'),
};
function subject(step: OnboardingStep, data = base) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages}>
      <ProfileOnboarding step={step} data={data} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submit.mockResolvedValue({
    ok: true,
    next: routes.onboardingName,
  });
  document.documentElement.dataset.fontScale = 'large';
});

describe('profile onboarding controls', () => {
  it('only resets consent choices, not name drafts, when policy versions change', async () => {
    mocks.page.mockResolvedValue({ ok: true, data: base });
    const nameBefore = await OnboardingScreen({ step: 'name' });
    const consentBefore = await OnboardingScreen({ step: 'consent' });
    mocks.page.mockResolvedValue({
      ok: true,
      data: {
        ...base,
        terms: policy('new terms', '44444444-4444-4444-8444-444444444444'),
      },
    });
    const nameAfter = await OnboardingScreen({ step: 'name' });
    const consentAfter = await OnboardingScreen({ step: 'consent' });
    expect(nameAfter.key).toBe(nameBefore.key);
    expect(consentAfter.key).not.toBe(consentBefore.key);
  });

  it('resynchronizes a reused root layout with persisted font on re-entry', () => {
    document.documentElement.dataset.fontScale = 'normal';
    render(subject('font', { ...base, fontScale: 'xlarge' }));
    expect(document.documentElement.dataset.fontScale).toBe('xlarge');
    expect(
      screen.getByRole('radio', {
        name: messages.onboarding.fontOptions.xlarge,
      }),
    ).toBeChecked();
  });
  it('previews all scales immediately without a write and restores unsaved preview', async () => {
    const user = userEvent.setup();
    const view = render(subject('font'));
    for (const scale of ['normal', 'large', 'xlarge'] as const) {
      await user.click(
        screen.getByRole('radio', {
          name: messages.onboarding.fontOptions[scale],
        }),
      );
      expect(document.documentElement.dataset.fontScale).toBe(scale);
      expect(
        screen.getByRole('radio', {
          name: messages.onboarding.fontOptions[scale],
        }),
      ).toBeChecked();
    }
    expect(mocks.submit).not.toHaveBeenCalled();
    view.unmount();
    expect(document.documentElement.dataset.fontScale).toBe('large');
  });

  it('serializes repeated submissions and keeps the saved font after navigation', async () => {
    const user = userEvent.setup();
    let finish: (value: OnboardingSubmitResult) => void = () => {};
    mocks.submit.mockImplementation(
      () =>
        new Promise<OnboardingSubmitResult>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(subject('font'));
    await user.click(
      screen.getByRole('radio', {
        name: messages.onboarding.fontOptions.xlarge,
      }),
    );
    const button = screen.getByRole('button', {
      name: messages.onboarding.continue,
    });
    fireEvent.submit(button.closest('form')!);
    fireEvent.submit(button.closest('form')!);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, next: routes.onboardingName }));
    expect(mocks.submit).toHaveBeenCalledWith({
      step: 'font',
      fontScale: 'xlarge',
    });
    expect(mocks.push).toHaveBeenCalledWith(routes.onboardingName);
    view.unmount();
    expect(document.documentElement.dataset.fontScale).toBe('xlarge');
  });

  it('does not navigate after a pending page has been left', async () => {
    let finish: (value: OnboardingSubmitResult) => void = () => {};
    mocks.submit.mockImplementation(
      () =>
        new Promise<OnboardingSubmitResult>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(subject('name'));
    fireEvent.submit(
      screen
        .getByRole('button', { name: messages.onboarding.continue })
        .closest('form')!,
    );
    view.unmount();
    await act(async () => finish({ ok: true, next: routes.onboardingConsent }));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('keeps the name after a failed save and offers a large inline retry', async () => {
    mocks.submit.mockResolvedValueOnce({ ok: false, code: 'NAME_INVALID' });
    mocks.submit.mockResolvedValueOnce({
      ok: true,
      next: routes.onboardingConsent,
    });
    const user = userEvent.setup();
    render(subject('name'));
    const input = screen.getByRole('textbox', {
      name: messages.onboarding.nameLabel,
    });
    await user.clear(input);
    await user.type(input, '새로운팬');
    await user.click(
      screen.getByRole('button', { name: messages.onboarding.continue }),
    );
    expect(input).toHaveValue('새로운팬');
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.onboarding.errors.NAME_INVALID,
    );
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: messages.ui.retry }));
    expect(mocks.submit).toHaveBeenLastCalledWith({
      step: 'name',
      callName: '새로운팬',
    });
    expect(mocks.push).toHaveBeenCalledWith(routes.onboardingConsent);
  });

  it('fails closed without name rules or approved required policy bodies', async () => {
    const user = userEvent.setup();
    const view = render(subject('name', { ...base, nameReady: false }));
    expect(
      screen.getByRole('button', { name: messages.onboarding.continue }),
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.onboarding.setupNotReady,
    );
    await user.click(screen.getByRole('button', { name: messages.ui.retry }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    view.rerender(subject('consent', { ...base, nameReady: false }));
    expect(
      screen.getByRole('button', { name: messages.onboarding.continue }),
    ).toBeDisabled();
    view.rerender(subject('consent', { ...base, terms: null }));
    expect(
      screen.getByRole('checkbox', { name: messages.onboarding.ageLabel }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: messages.onboarding.ageLabel }),
    );
    expect(
      screen.getByRole('checkbox', { name: messages.onboarding.ageLabel }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: messages.onboarding.continue }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('checkbox', { name: messages.onboarding.termsLabel }),
    ).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('requires explicit independent choices and keeps optional analytics off', async () => {
    const user = userEvent.setup();
    mocks.submit.mockResolvedValue({
      ok: true,
      next: routes.onboardingArtists,
    });
    render(subject('consent'));
    for (const control of screen.getAllByRole('checkbox')) {
      expect(control).not.toBeChecked();
    }
    expect(screen.getByText(base.terms!.body)).toBeVisible();
    expect(screen.getByText(base.privacy!.body)).toBeVisible();
    for (const name of [
      messages.onboarding.ageLabel,
      messages.onboarding.termsLabel,
      messages.onboarding.privacyLabel,
    ]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    await user.click(
      screen.getByRole('button', { name: messages.onboarding.continue }),
    );
    expect(mocks.submit).toHaveBeenCalledWith({
      step: 'consent',
      ageConfirmed: true,
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: base.terms!.version,
      privacyVersion: base.privacy!.version,
      analyticsAccepted: false,
      analyticsVersion: base.analytics!.version,
    });
    expect(mocks.push).toHaveBeenCalledWith(routes.onboardingArtists);
  });

  it('never transfers a checkbox acceptance to a newly displayed version', async () => {
    const user = userEvent.setup();
    const view = render(subject('consent'));
    await user.click(
      screen.getByRole('checkbox', { name: messages.onboarding.termsLabel }),
    );
    expect(
      screen.getByRole('checkbox', { name: messages.onboarding.termsLabel }),
    ).toBeChecked();
    view.rerender(
      subject('consent', {
        ...base,
        terms: policy('revised terms', '44444444-4444-4444-8444-444444444444'),
      }),
    );
    expect(
      screen.getByRole('checkbox', { name: messages.onboarding.termsLabel }),
    ).not.toBeChecked();
  });

  it('refreshes changed policy instead of retrying stale consent', async () => {
    const user = userEvent.setup();
    mocks.submit.mockResolvedValue({ ok: false, code: 'POLICY_CHANGED' });
    render(subject('consent'));
    await user.click(
      screen.getByRole('button', { name: messages.onboarding.continue }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.onboarding.errors.POLICY_CHANGED,
    );
    await user.click(screen.getByRole('button', { name: messages.ui.retry }));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('uses a real logout POST for cancel and does not invent artist completion', () => {
    render(subject('artists', { ...base, profileCompleted: true }));
    const cancel = screen.getByRole('button', {
      name: messages.onboarding.cancel,
    });
    expect(cancel.closest('form')).toHaveAttribute('method', 'post');
    expect(cancel.closest('form')).toHaveAttribute('action', routes.authLogout);
    expect(
      screen.getByText(messages.onboarding.profileSavedDescription),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: messages.onboarding.continue }),
    ).not.toBeInTheDocument();
  });

  it('uses keyboard-operable native checkboxes and radio groups', async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn();
    const onSelect = vi.fn();
    render(
      <>
        <Checkbox label="Fictional option" checked={false} onChange={onCheck} />
        <RadioGroup
          label="Fictional size"
          options={[
            { value: 'small', label: 'Small test choice' },
            { value: 'large', label: 'Large test choice' },
          ]}
          value="small"
          onChange={onSelect}
        />
      </>,
    );
    await user.tab();
    expect(screen.getByRole('checkbox')).toHaveFocus();
    await user.keyboard(' ');
    expect(onCheck).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(
      screen.getByRole('radio', { name: 'Small test choice' }),
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('large'));
  });
});

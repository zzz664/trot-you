import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutTerms } from '@/components/checkout/CheckoutTerms';
import { CheckoutErrorScreen } from '@/components/checkout/CheckoutErrorScreen';
import {
  CHECKOUT_ERROR_STATUS,
  CHECKOUT_INTENT_TTL_MS,
  CHECKOUT_PROVIDERS,
  type CheckoutError,
  type CheckoutIntent,
  type CheckoutPageData,
  type CheckoutResult,
} from '@/config/checkout';
import { artistPreviewPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prepare: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@/client/checkout', () => ({
  prepareCheckout: mocks.prepare,
  cancelCheckout: mocks.cancel,
  checkoutExpiryDelay: (expiresAt: string) =>
    Math.max(0, Date.parse(expiresAt) - Date.now()),
}));
const data: CheckoutPageData = {
  offer: {
    artist: { slug: 'fictional-star', name: '가상 가수' },
    policy: {
      version: 'ae3f06df-e2b1-4c57-838b-c472bc460ab7',
      title: '허구의 테스트 승인 약관',
      body: '테스트에만 쓰는 약관 전문입니다.\n실제 서비스의 약관이 아닙니다.',
      regularPriceKrw: 6500,
      introPriceKrw: 1000,
    },
    introEligible: true,
  },
  providers: CHECKOUT_PROVIDERS.map((provider) => ({
    provider,
    configured: true,
  })),
  launchAvailable: false,
};
const intent: CheckoutIntent = {
  id: 'ec3f74d6-0745-4a1f-ad46-42eac6fb9713',
  status: 'pending_intent',
  provider: 'toss_card_billing',
  expiresAt: new Date(Date.now() + CHECKOUT_INTENT_TTL_MS).toISOString(),
  initialPriceKrw: 1000,
  regularPriceKrw: 6500,
  introEligible: true,
};
function subject(child: ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      {child}
    </NextIntlClientProvider>
  );
}
function terms(current = data) {
  return subject(<CheckoutTerms data={current} />);
}
function button(key: 'prepare' | 'preparing' | 'cancelIntent' | 'canceling') {
  return screen.getByRole('button', { name: messages.checkout[key] });
}
async function choose(provider = 'toss_card_billing') {
  const name =
    messages.checkout.providers[
      provider as keyof typeof messages.checkout.providers
    ];
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));
}
async function accept() {
  await userEvent.click(
    screen.getByRole('checkbox', { name: messages.checkout.consent }),
  );
}
async function prepare() {
  await choose();
  await accept();
  await userEvent.click(button('prepare'));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({ ok: true, data: intent });
  mocks.cancel.mockResolvedValue({
    ok: true,
    data: { ...intent, status: 'canceled' },
  });
});

afterEach(() => vi.useRealTimers());

describe('checkout terms are preparation only', () => {
  it('shows the full approved text and prices without preselecting consent/provider', () => {
    render(terms());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      data.offer.artist.name,
    );
    expect(
      screen.getByRole('heading', { name: data.offer.policy.title }),
    ).toBeVisible();
    expect(
      screen.getByText(/테스트에만 쓰는 약관 전문입니다/),
    ).toHaveTextContent('실제 서비스의 약관이 아닙니다.');
    expect(screen.getByText('매월 구독료 6,500원')).toBeVisible();
    expect(screen.getByText(/첫 구독 적용 가격 1,000원/)).toBeVisible();
    expect(screen.getByText(messages.checkout.preparationOnly)).toBeVisible();
    for (const option of screen.getAllByRole('radio'))
      expect(option).not.toBeChecked();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(button('prepare')).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: messages.checkout.completionUnavailable,
      }),
    ).toBeDisabled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(document.querySelector('script')).toBeNull();
  });
  it('never claims introduction eligibility after it was used', () => {
    render(terms({ ...data, offer: { ...data.offer, introEligible: false } }));
    expect(screen.getByText(messages.checkout.introUsed)).toBeVisible();
    expect(screen.queryByText(/첫 구독 적용 가격/)).not.toBeInTheDocument();
  });
  it('requires both current explicit consent and a configured provider', async () => {
    render(terms());
    await accept();
    expect(button('prepare')).toBeDisabled();
    await choose();
    expect(button('prepare')).toBeEnabled();
    await accept();
    expect(button('prepare')).toBeDisabled();
  });
  it('does not allow unconfigured provider preparation or present it as merchant approval', async () => {
    render(
      terms({
        ...data,
        providers: [
          { provider: 'toss_card_billing', configured: false },
          { provider: 'kakaopay_subscription', configured: true },
        ],
      }),
    );
    await choose();
    await accept();
    expect(button('prepare')).toBeDisabled();
    expect(
      screen.getByText(messages.checkout.configurationNotApproval),
    ).toBeVisible();
    await choose('kakaopay_subscription');
    expect(button('prepare')).toBeEnabled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each(CHECKOUT_PROVIDERS)(
    'saves %s intent with exact policy/actor-free input, not a paid subscription',
    async (provider) => {
      mocks.prepare.mockResolvedValueOnce({
        ok: true,
        data: { ...intent, provider },
      });
      render(terms());
      await choose(provider);
      await accept();
      await userEvent.click(button('prepare'));
      expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({
        artistSlug: data.offer.artist.slug,
        provider,
        policyVersion: data.offer.policy.version,
        accepted: true,
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        messages.checkout.intentStatuses.pending_intent,
      );
      expect(
        screen.getByText(messages.checkout.intentNotPayment),
      ).toBeVisible();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
      expect(button('prepare')).toBeDisabled();
    },
  );
  it('shows the authoritative prepared price/intro eligibility rather than the stale offer', async () => {
    mocks.prepare.mockResolvedValueOnce({
      ok: true,
      data: { ...intent, initialPriceKrw: 6500, introEligible: false },
    });
    render(terms());
    await prepare();
    expect(
      screen.getByText('준비 요청에 저장된 적용 가격 6,500원'),
    ).toBeVisible();
    expect(screen.getByText(messages.checkout.introUsed)).toBeVisible();
    expect(
      screen.queryByText(/첫 구독 적용 가격 1,000원/),
    ).not.toBeInTheDocument();
  });
  it('locally expires a pending intent and disables cancellation without a mutation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T13:00:00Z'));
    mocks.prepare.mockResolvedValueOnce({
      ok: true,
      data: { ...intent, expiresAt: '2026-10-24T13:15:00Z' },
    });
    render(terms());
    fireEvent.click(
      screen.getByRole('radio', {
        name: new RegExp(messages.checkout.providers.toss_card_billing),
      }),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(button('prepare'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.checkout.intentStatuses.pending_intent,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKOUT_INTENT_TTL_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.checkout.intentStatuses.expired,
    );
    expect(
      screen.queryByRole('button', { name: messages.checkout.cancelIntent }),
    ).not.toBeInTheDocument();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it('cancels only the saved intent without changing a subscription', async () => {
    render(terms());
    await prepare();
    await userEvent.click(button('cancelIntent'));
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({
      sessionId: intent.id,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.checkout.intentStatuses.canceled,
    );
    expect(
      screen.queryByRole('button', { name: messages.checkout.cancelIntent }),
    ).not.toBeInTheDocument();
    expect(button('prepare')).toBeDisabled();
    expect(screen.getByText(messages.checkout.intentNotPayment)).toBeVisible();
  });
  it('serializes double-clicks and locks consent and competing provider choices', async () => {
    let finish: (result: CheckoutResult<CheckoutIntent>) => void = () => {};
    mocks.prepare.mockImplementation(
      () =>
        new Promise<CheckoutResult<CheckoutIntent>>((resolve) => {
          finish = resolve;
        }),
    );
    render(terms());
    await choose();
    await accept();
    fireEvent.click(button('prepare'));
    fireEvent.click(button('preparing'));
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    for (const option of screen.getAllByRole('radio'))
      expect(option).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await act(async () => finish({ ok: true, data: intent }));
    expect(button('prepare')).toBeDisabled();
  });
  it('never blindly retries an uncertain save; retry only refreshes', async () => {
    mocks.prepare.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(terms());
    await prepare();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.checkout.errors.UNAVAILABLE,
    );
    expect(screen.getByText(messages.checkout.unknownNotice)).toBeVisible();
    expect(button('prepare')).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('keeps cancellation uncertain rather than falsely declaring cancellation', async () => {
    mocks.cancel.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(terms());
    await prepare();
    await userEvent.click(button('cancelIntent'));
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.checkout.intentStatuses.pending_intent,
    );
    expect(button('cancelIntent')).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it('clears old consent when policy changed and requires an authoritative refresh', async () => {
    mocks.prepare.mockResolvedValueOnce({ ok: false, code: 'POLICY_CHANGED' });
    render(terms());
    await prepare();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(button('prepare')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.checkout.errors.POLICY_CHANGED,
    );
  });
  it('handles thrown transport errors without retrying or claiming success', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('private detail'));
    render(terms());
    await prepare();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.checkout.errors.UNAVAILABLE,
    );
    expect(screen.queryByText('private detail')).not.toBeInTheDocument();
    expect(button('prepare')).toBeDisabled();
  });
  it('routes an expired login to the fixed login page', async () => {
    mocks.prepare.mockResolvedValueOnce({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    render(terms());
    await prepare();
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(routes.start);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it.each(['back', 'popstate', 'unmount'] as const)(
    'ignores late results after %s without navigating or claiming saved intent',
    async (interruption) => {
      let finish: (result: CheckoutResult<CheckoutIntent>) => void = () => {};
      mocks.prepare.mockImplementation(
        () =>
          new Promise<CheckoutResult<CheckoutIntent>>((resolve) => {
            finish = resolve;
          }),
      );
      const view = render(terms());
      await choose();
      await accept();
      fireEvent.click(button('prepare'));
      if (interruption === 'back')
        await userEvent.click(
          screen.getByRole('button', { name: messages.ui.back }),
        );
      else if (interruption === 'popstate')
        act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      else view.unmount();
      await act(async () => finish({ ok: true, data: intent }));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(mocks.refresh).not.toHaveBeenCalled();
      if (interruption === 'back')
        expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
          artistPreviewPath(data.offer.artist.slug),
        );
      else expect(mocks.replace).not.toHaveBeenCalled();
    },
  );
});

describe('missing/current policy failures stay closed', () => {
  it.each(Object.keys(CHECKOUT_ERROR_STATUS) as CheckoutError[])(
    'shows controlled %s without fictional price, consent or provider form',
    (code) => {
      render(subject(<CheckoutErrorScreen code={code} />));
      expect(screen.getByRole('alert')).toHaveTextContent(
        messages.checkout.errors[code],
      );
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByText(/6,500원/)).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: messages.checkout.completionUnavailable,
        }),
      ).toBeDisabled();
    },
  );
  it('refreshes a failed policy read and uses fixed internal back navigation', async () => {
    render(subject(<CheckoutErrorScreen code="SETUP_NOT_READY" />));
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.back }),
    );
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(routes.artists);
  });
});

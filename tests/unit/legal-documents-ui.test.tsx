import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { LegalDocumentScreen } from '@/components/legal-documents/LegalDocumentScreen';
import { ProfileOnboarding } from '@/components/onboarding/ProfileOnboarding';
import type { LegalDocumentResult } from '@/config/legal-documents';
import { legalDocumentPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';

const mock = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
const router = { refresh: mock.refresh, replace: mock.replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const document = {
  kind: 'terms' as const,
  version: 'abcd0000-0000-4000-8000-000000000001',
  title: 'Fictional test terms',
  body: '<script>window.fake=1</script>\n<a href="https://outside.invalid">not a link</a>',
  approvedAt: '2026-10-01T00:00:00Z',
  publishedAt: '2026-10-02T00:00:00Z',
};
const subject = (result: LegalDocumentResult, exact = false) => (
  <NextIntlClientProvider locale="ko" messages={messages}>
    <LegalDocumentScreen result={result} exact={exact} from="onboarding" />
  </NextIntlClientProvider>
);
beforeEach(() => vi.clearAllMocks());
it('renders immutable text escaped, explicit version mode and exact/current links', () => {
  const view = render(subject({ ok: true, document }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    document.title,
  );
  expect(view.container.querySelector('article script')).toBeNull();
  expect(
    view.container.querySelector('a[href="https://outside.invalid"]'),
  ).toBeNull();
  expect(view.container.querySelector('article')).toHaveTextContent(
    '<script>window.fake=1</script>',
  );
  expect(
    screen.getByRole('link', { name: messages.legalDocuments.openVersion }),
  ).toHaveAttribute(
    'href',
    legalDocumentPath('terms', document.version, 'onboarding'),
  );
  view.rerender(subject({ ok: true, document }, true));
  expect(
    screen.getByText(messages.legalDocuments.exactDescription),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: messages.legalDocuments.current }),
  ).toHaveAttribute(
    'href',
    legalDocumentPath('terms', undefined, 'onboarding'),
  );
});
it.each([
  ['UNCONFIGURED', 'unconfigured'],
  ['NOT_CONFIGURED', 'notConfigured'],
  ['NOT_FOUND', 'notFound'],
  ['UNAVAILABLE', 'unavailable'],
] as const)(
  'shows honest %s state with retry and known-parent Back',
  (code, key) => {
    render(subject({ ok: false, code }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.legalDocuments[key],
    );
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: messages.ui.back }));
    expect(mock.replace).toHaveBeenCalledExactlyOnceWith(
      routes.onboardingConsent,
    );
  },
);
it('restoration refreshes public data without accepting anything and cleans listeners after interruption', () => {
  const view = render(subject({ ok: true, document }));
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  act(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    ),
  );
  expect(mock.refresh).toHaveBeenCalledTimes(2);
  view.unmount();
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});
it('onboarding links exactly the displayed required versions and does not check consent', () => {
  const privacy = {
    ...document,
    version: 'abcd0000-0000-4000-8000-000000000002',
    title: 'Test privacy',
  };
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <ProfileOnboarding
        step="consent"
        data={{
          fontScale: 'normal',
          fontSelected: true,
          callName: '테스트',
          nameMin: 2,
          nameMax: 10,
          nameReady: true,
          profileCompleted: false,
          terms: document,
          privacy,
          analytics: null,
        }}
      />
    </NextIntlClientProvider>,
  );
  const links = screen.getAllByRole('link', {
    name: messages.legalDocuments.openVersion,
  });
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    legalDocumentPath('terms', document.version, 'onboarding'),
    legalDocumentPath('privacy', privacy.version, 'onboarding'),
  ]);
  for (const box of screen.getAllByRole('checkbox'))
    expect(box).not.toBeChecked();
});

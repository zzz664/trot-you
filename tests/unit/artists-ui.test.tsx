import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistCatalog } from '@/components/artists/ArtistCatalog';
import { ArtistCatalogEntry } from '@/components/artists/ArtistCatalogEntry';
import { ArtistErrorScreen } from '@/components/artists/ArtistErrorScreen';
import { InstallOnboarding } from '@/components/onboarding/InstallOnboarding';
import { ArtistLoading } from '@/components/artists/ArtistLoading';
import { ArtistPreview } from '@/components/artists/ArtistPreview';
import { DialogProvider } from '@/components/ui/DialogProvider';
import type {
  ArtistCatalogData,
  ArtistPreviewData,
  ArtistSelectionResult,
} from '@/config/artists';
import { artistCatalogPath, artistPreviewPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  submit: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@/client/artists', () => ({ submitArtistSelection: mocks.submit }));

const artist = {
  slug: 'fictional-star',
  name: '가상 가수',
  description: '허구의 테스트 소개입니다.',
};
const catalog: ArtistCatalogData = {
  artists: [artist],
  page: 1,
  hasNext: false,
  selectedSlug: null,
  selectedName: null,
  onboarding: true,
};
const preview: ArtistPreviewData = {
  artist,
  selectedSlug: null,
  onboarding: true,
  messages: [
    {
      id: 'fictional-message',
      kind: 'text',
      text: '테스트팬 님, 반가워요.',
      sentAt: '2026-10-24T00:00:00Z',
      media: [],
    },
  ],
};
function subject(child: ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <DialogProvider>{child}</DialogProvider>
    </NextIntlClientProvider>
  );
}
const selectLabel = messages.artists.selectAction.replace(
  '{name}',
  artist.name,
);
const previewLabel = messages.artists.previewAction.replace(
  '{name}',
  artist.name,
);
async function confirmSelection() {
  await userEvent.click(screen.getByRole('button', { name: selectLabel }));
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: messages.artists.selectionConfirm,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submit.mockResolvedValue({ ok: true, next: routes.onboardingInstall });
});

describe('artist discovery and interest controls', () => {
  it('offers public preview navigation without a paid or interest action', async () => {
    render(subject(<ArtistCatalog data={{ ...catalog, onboarding: false }} />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      messages.artists.catalogTitle,
    );
    expect(screen.getByText(messages.artists.interestNotice)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: selectLabel }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: previewLabel }));
    expect(mocks.push).toHaveBeenCalledWith(artistPreviewPath(artist.slug));
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('uses bounded server-provided numbered pagination and preserves onboarding scope', async () => {
    render(
      subject(<ArtistCatalog data={{ ...catalog, page: 2, hasNext: true }} />),
    );
    await userEvent.click(
      screen.getByRole('button', { name: messages.artists.nextPage }),
    );
    expect(mocks.push).toHaveBeenLastCalledWith(artistCatalogPath(3, true));
    await userEvent.click(
      screen.getByRole('button', { name: messages.artists.previousPage }),
    );
    expect(mocks.push).toHaveBeenLastCalledWith(artistCatalogPath(1, true));
  });

  it('explains an empty list and disables out-of-range navigation', async () => {
    render(subject(<ArtistCatalog data={{ ...catalog, artists: [] }} />));
    expect(
      screen.getByRole('heading', { name: messages.artists.emptyTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: messages.artists.nextPage }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: messages.artists.previousPage }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: messages.artists.refreshCatalog }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'close', 'escape'] as const)(
    'dismisses confirmation with %s without saving',
    async (method) => {
      render(subject(<ArtistCatalog data={catalog} />));
      await userEvent.click(screen.getByRole('button', { name: selectLabel }));
      const dialog = screen.getByRole('dialog', {
        name: messages.artists.selectionDialogTitle,
      });
      expect(dialog).toHaveAccessibleDescription(
        messages.artists.selectionDialogDescription.replace(
          '{name}',
          artist.name,
        ),
      );
      if (method === 'escape') await userEvent.keyboard('{Escape}');
      else
        await userEvent.click(
          within(dialog).getByRole('button', { name: messages.ui[method] }),
        );
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
    },
  );

  it('serializes repeated taps and waits for durable success before navigating', async () => {
    let finish: (result: ArtistSelectionResult) => void = () => {};
    mocks.submit.mockImplementation(
      () =>
        new Promise<ArtistSelectionResult>((resolve) => {
          finish = resolve;
        }),
    );
    render(subject(<ArtistCatalog data={catalog} />));
    const opener = screen.getByRole('button', { name: selectLabel });
    fireEvent.click(opener);
    fireEvent.click(opener);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: messages.artists.selectionConfirm,
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit).toHaveBeenCalledWith({ slug: artist.slug });
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.artists.selectionSaving,
    );
    expect(opener).toBeDisabled();
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, next: routes.onboardingInstall }));
    expect(mocks.push).toHaveBeenCalledWith(routes.onboardingInstall);
  });

  it('cancels a screen-owned modal when query pagination replaces the screen', async () => {
    const view = render(
      subject(<ArtistCatalog key={2} data={{ ...catalog, page: 2 }} />),
    );
    await userEvent.click(screen.getByRole('button', { name: selectLabel }));
    expect(screen.getByRole('dialog')).toBeVisible();
    // Keep DialogProvider mounted with the same pathname scope, as with
    // browser Back from ?page=2 to page 1 while the modal is open.
    view.rerender(subject(<ArtistCatalog key={1} data={catalog} />));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    await confirmSelection();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith(routes.onboardingInstall);
  });

  it('does not navigate when a pending save returns after leaving the page', async () => {
    let finish: (result: ArtistSelectionResult) => void = () => {};
    mocks.submit.mockImplementation(
      () =>
        new Promise<ArtistSelectionResult>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(subject(<ArtistCatalog data={catalog} />));
    await confirmSelection();
    view.unmount();
    await act(async () => finish({ ok: true, next: routes.onboardingInstall }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('keeps the same choice available for an idempotent uncertain-result retry', async () => {
    mocks.submit.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(subject(<ArtistCatalog data={catalog} />));
    await confirmSelection();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.artists.selectionUncertain,
    );
    expect(mocks.push).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit).toHaveBeenLastCalledWith({ slug: artist.slug });
    expect(mocks.push).toHaveBeenCalledWith(routes.onboardingInstall);
  });

  it('refreshes the catalog rather than repeating selection of a newly inactive artist', async () => {
    mocks.submit.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    render(subject(<ArtistCatalog data={catalog} />));
    await confirmSelection();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.artists.errors.NOT_FOUND,
    );
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('returns changed profile requirements to the authoritative onboarding entry', async () => {
    mocks.submit.mockResolvedValue({ ok: false, code: 'PROFILE_REQUIRED' });
    render(subject(<ArtistCatalog data={catalog} />));
    await confirmSelection();
    await userEvent.click(
      screen.getByRole('button', { name: messages.onboarding.resume }),
    );
    expect(mocks.push).toHaveBeenCalledWith(routes.onboarding);
  });

  it('uses the persisted selection and a real logout POST without claiming subscription', () => {
    render(
      subject(
        <ArtistCatalog
          data={{
            ...catalog,
            selectedSlug: artist.slug,
            selectedName: artist.name,
          }}
        />,
      ),
    );
    expect(screen.getByText(messages.artists.selected)).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: messages.artists.selectAgainAction.replace('{name}', artist.name),
      }),
    ).toBeEnabled();
    const logout = screen
      .getByRole('button', { name: messages.onboarding.cancel })
      .closest('form');
    expect(logout).toHaveAttribute('method', 'post');
    expect(logout).toHaveAttribute('action', routes.authLogout);
  });
});

describe('safe preview and next-stage boundaries', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'renders server text safely without client name replacement at %s scale',
    (scale) => {
      document.documentElement.dataset.fontScale = scale;
      const text = '<img src=x onerror=alert(1)> {이름}';
      const view = render(
        subject(
          <ArtistPreview
            data={{ ...preview, messages: [{ ...preview.messages[0]!, text }] }}
          />,
        ),
      );
      expect(screen.getByText(text)).toBeVisible();
      expect(view.container.querySelector('img, script')).toBeNull();
      expect(document.documentElement.dataset.fontScale).toBe(scale);
    },
  );

  it('shows typed unavailable media without URLs, audio, image or video elements', () => {
    const view = render(
      subject(
        <ArtistPreview
          data={{
            ...preview,
            messages: [
              {
                ...preview.messages[0]!,
                kind: 'photo',
                media: [
                  { kind: 'photo', availability: 'unavailable' },
                  { kind: 'voice', availability: 'unavailable' },
                  { kind: 'video', availability: 'unavailable' },
                ],
              },
            ],
          }}
        />,
      ),
    );
    for (const kind of ['photo', 'voice', 'video'] as const) {
      expect(
        screen.getByText(
          messages.artists.mediaUnavailable.replace(
            '{kind}',
            messages.artists.messageKinds[kind],
          ),
        ),
      ).toBeVisible();
    }
    expect(
      view.container.querySelector('img, audio, video, source'),
    ).toBeNull();
  });

  it('shows an empty preview without fabricating artist content', () => {
    render(
      subject(
        <ArtistPreview
          data={{ ...preview, messages: [], onboarding: false }}
        />,
      ),
    );
    expect(
      screen.getByRole('heading', { name: messages.artists.previewEmptyTitle }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: selectLabel }),
    ).not.toBeInTheDocument();
  });

  it('keeps completion disabled until real guidance is saved', async () => {
    render(
      subject(
        <InstallOnboarding
          data={{
            selectedName: artist.name,
            choice: null,
            acknowledgedAt: null,
            installationSelfReportedAt: null,
            completedAt: null,
          }}
        />,
      ),
    );
    expect(screen.getByText(messages.install.description)).toBeVisible();
    expect(
      screen.getByRole('button', { name: messages.install.complete }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: messages.artists.changeSelection }),
    );
    expect(mocks.push).toHaveBeenCalledWith(routes.onboardingArtists);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('exposes inline retry and a safe profile recovery path', async () => {
    render(subject(<ArtistErrorScreen code="PROFILE_REQUIRED" onboarding />));
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.artists.errors.PROFILE_REQUIRED,
    );
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole('button', { name: messages.onboarding.resume }),
    );
    expect(mocks.push).toHaveBeenCalledWith(routes.onboarding);
  });

  it('provides human-readable loading and catalog entry navigation', async () => {
    const view = render(subject(<ArtistLoading />));
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.artists.loading,
    );
    view.rerender(subject(<ArtistCatalogEntry />));
    await userEvent.click(
      screen.getByRole('button', { name: messages.artists.catalogTitle }),
    );
    expect(mocks.push).toHaveBeenCalledWith(routes.artists);
  });
});

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
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminArtistsScreen } from '@/components/admin-artists/AdminArtistsScreen';
import { AdminArtistDetailScreen } from '@/components/admin-artists/AdminArtistDetailScreen';
import { AdminArtistCreateScreen } from '@/components/admin-artists/AdminArtistCreateScreen';
import { ArtistAccessScreen } from '@/components/admin-artists/ArtistAccessScreen';
import { AdminArtistsErrorScreen } from '@/components/admin-artists/AdminArtistsErrorScreen';
import { AdminArtistsLoading } from '@/components/admin-artists/AdminArtistsLoading';
import {
  ADMIN_ARTIST_ERROR_STATUS,
  type AdminArtistDetail,
  type AdminArtistResult,
} from '@/config/admin-artists';
import { adminArtistPath, artistAccessPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  artist,
  artistId,
  artistInput,
  detail,
  invitation,
  targetId,
} from './admin-artists-fixtures';
const mock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  save: vi.fn(),
  previews: vi.fn(),
  invite: vi.fn(),
  cancel: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
  respond: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/admin-artists', () => ({
  fetchAdminArtists: mock.list,
  fetchAdminArtist: mock.detail,
  saveAdminArtist: mock.save,
  saveAdminPreviews: mock.previews,
  inviteArtistAccount: mock.invite,
  cancelArtistInvitation: mock.cancel,
  unlinkArtistAccount: mock.unlink,
  fetchArtistAccess: mock.access,
  respondArtistInvitation: mock.respond,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh, push: mock.navigate }),
}));
vi.mock('@/components/media/SecureMedia', () => ({
  SecureMedia: ({
    mediaId,
    preview,
  }: {
    mediaId: string;
    preview: boolean;
  }) => (
    <span
      data-testid="secure-media"
      data-media-id={mediaId}
      data-preview={String(preview)}
    />
  ),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    onNavigate,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
    onNavigate?: () => void;
  }) => (
    <a
      {...props}
      href={href}
      data-prefetch={String(prefetch)}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
        mock.navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));
const copy = messages.adminArtists;
const main = () => within(screen.getByRole('main'));
const ok = <T,>(data: T) => ({ ok: true as const, data });
function wrapper(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mountDetail(data: AdminArtistDetail = detail) {
  mock.detail.mockResolvedValue(ok(data));
  window.history.replaceState({}, '', adminArtistPath(artistId));
  render(wrapper(<AdminArtistDetailScreen id={artistId} />));
}
async function editor() {
  return main().findByRole('textbox', { name: copy.name });
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', routes.adminArtists);
  mock.list.mockResolvedValue(ok({ artists: [artist], has_more: false }));
  mock.detail.mockResolvedValue(ok(detail));
  mock.save.mockResolvedValue(ok(artist));
  mock.previews.mockResolvedValue(ok(artist));
  mock.invite.mockResolvedValue(ok(invitation));
  mock.cancel.mockResolvedValue(ok({ ...invitation, state: 'canceled' }));
  mock.unlink.mockResolvedValue(ok(artist));
  mock.access.mockResolvedValue(
    ok({
      user_id: targetId,
      invitations: [invitation],
      account_link_ready: true,
      has_more: false,
    }),
  );
  mock.respond.mockResolvedValue(ok({ ...invitation, state: 'accepted' }));
});

describe('admin artist current-actor UI', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'renders list without finance controls at %s',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      render(wrapper(<AdminArtistsScreen page={1} />));
      expect(
        await main().findByRole('heading', { name: artist.name }),
      ).toBeVisible();
      expect(main().getByText(copy.status.active)).toBeVisible();
      expect(main().queryByText(/6,500|billing_key/)).not.toBeInTheDocument();
      expect(mock.save).not.toHaveBeenCalled();
      delete document.documentElement.dataset.fontScale;
    },
  );
  it('supports explicit page one and lists only current safe navigation', async () => {
    window.history.replaceState({}, '', `${routes.adminArtists}?page=1`);
    render(wrapper(<AdminArtistsScreen page={1} />));
    await main().findByRole('heading', { name: artist.name });
    const link = main().getByRole('link', { name: copy.edit });
    expect(link).toHaveAttribute('href', adminArtistPath(artistId));
    expect(link).toHaveAttribute('data-prefetch', 'false');
    await userEvent.click(link);
    expect(main().queryByText(artist.name)).not.toBeInTheDocument();
    expect(mock.navigate).toHaveBeenCalledWith(adminArtistPath(artistId));
  });
  it('renders bounded next and first links only from real list state', async () => {
    window.history.replaceState({}, '', `${routes.adminArtists}?page=2`);
    mock.list.mockResolvedValue(ok({ artists: [artist], has_more: true }));
    render(wrapper(<AdminArtistsScreen page={2} />));
    await main().findByRole('heading', { name: artist.name });
    expect(main().getByRole('link', { name: copy.first })).toHaveAttribute(
      'href',
      routes.adminArtists,
    );
    expect(main().getByRole('link', { name: copy.next })).toHaveAttribute(
      'href',
      `${routes.adminArtists}?page=3`,
    );
  });
  it('shows an honest empty list and create entry', async () => {
    mock.list.mockResolvedValue(ok({ artists: [], has_more: false }));
    render(wrapper(<AdminArtistsScreen page={1} />));
    expect(await main().findByText(copy.emptyDescription)).toBeVisible();
    expect(main().getByRole('link', { name: copy.create })).toHaveAttribute(
      'href',
      adminArtistPath('new'),
    );
  });
  it('blocks edits until explicit confirmation and submits only editable fields', async () => {
    mountDetail();
    const name = await editor();
    await userEvent.clear(name);
    await userEvent.type(name, '가상 수정 가수');
    expect(main().getByRole('button', { name: copy.save })).toBeDisabled();
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.changeConfirm }),
    );
    await userEvent.click(main().getByRole('button', { name: copy.save }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    expect(mock.save.mock.calls[0]![0]).toMatchObject({
      artist_id: artistId,
      expected_revision: 1,
      input: { ...artistInput, name: '가상 수정 가수' },
    });
    expect(mock.save.mock.calls[0]![0].input).not.toHaveProperty('revision');
    await editor();
    expect(mock.detail).toHaveBeenCalledTimes(2);
  });
  it('validates numeric order without calling backend', async () => {
    mountDetail();
    await editor();
    const order = main().getByRole('textbox', { name: copy.sortOrder });
    await userEvent.clear(order);
    await userEvent.type(order, '-3');
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.changeConfirm }),
    );
    await userEvent.click(main().getByRole('button', { name: copy.save }));
    expect(main().getByRole('alert')).toHaveTextContent(
      copy.errors.INVALID_INPUT,
    );
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('cancels unsaved edits by reading fresh state without writing', async () => {
    mountDetail();
    const name = await editor();
    await userEvent.clear(name);
    await userEvent.type(name, '저장하지 않음');
    await userEvent.click(
      main().getAllByRole('button', { name: copy.cancel })[0]!,
    );
    expect(await editor()).toHaveValue(artist.name);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('shows archive semantics rather than deleting financial history', async () => {
    mountDetail();
    await editor();
    expect(main().getByText(copy.statusNote)).toBeVisible();
    expect(main().getByText(copy.contractNote)).toBeVisible();
    expect(
      main().queryByRole('button', { name: /삭제/ }),
    ).not.toBeInTheDocument();
  });
  it('uses current revision and a single pending write', async () => {
    const pending = deferred<AdminArtistResult<typeof artist>>();
    mock.save.mockReturnValue(pending.promise);
    mountDetail();
    await editor();
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.changeConfirm }),
    );
    const save = main().getByRole('button', { name: copy.save });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mock.save).toHaveBeenCalledOnce();
    expect(
      main().queryByRole('textbox', { name: copy.name }),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve(ok(artist)));
    await editor();
  });
  it('clears all stale detail on role-loss and retry reads, never replays mutation', async () => {
    mock.save.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    mountDetail();
    await editor();
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.changeConfirm }),
    );
    await userEvent.click(main().getByRole('button', { name: copy.save }));
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.FORBIDDEN,
    );
    expect(
      main().queryByText(invitation.target_user_id, { exact: false }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      main().getByRole('button', { name: messages.ui.retry }),
    );
    await editor();
    expect(mock.save).toHaveBeenCalledOnce();
  });
  it('hides late reads after back navigation', async () => {
    const pending = deferred<AdminArtistResult<AdminArtistDetail>>();
    mock.detail.mockReturnValue(pending.promise);
    window.history.replaceState({}, '', adminArtistPath(artistId));
    render(wrapper(<AdminArtistDetailScreen id={artistId} />));
    await waitFor(() => expect(mock.detail).toHaveBeenCalledOnce());
    await userEvent.click(main().getByRole('link', { name: copy.backList }));
    await act(async () => pending.resolve(ok(detail)));
    expect(
      main().queryByRole('textbox', { name: copy.name }),
    ).not.toBeInTheDocument();
  });
  it('clears detail on pagehide and rechecks on persisted restore', async () => {
    mountDetail();
    await editor();
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(
      main().queryByRole('textbox', { name: copy.name }),
    ).not.toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    );
    await editor();
    expect(mock.detail).toHaveBeenCalledTimes(2);
  });
  it('stops displaying detail when browser history leaves the route', async () => {
    mountDetail();
    await editor();
    act(() => {
      window.history.pushState({}, '', routes.admin);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(
      main().queryByRole('textbox', { name: copy.name }),
    ).not.toBeInTheDocument();
  });
  it('preserves selected older previews, reorders and saves exact selected IDs', async () => {
    const older = {
      id: '00000000-0000-4000-8000-000000000011',
      kind: 'text' as const,
      body: '이전 맛보기',
      sent_at: '2026-10-20T00:00:00Z',
      is_preview: true,
      preview_order: 1,
      media: [],
    };
    const newer = {
      ...older,
      id: '00000000-0000-4000-8000-000000000012',
      body: '새 맛보기',
      is_preview: false,
      preview_order: null,
    };
    mountDetail({
      ...detail,
      previews: [older],
      messages: [newer],
      messages_has_more: true,
    });
    await editor();
    const section = main().getByRole('region', { name: copy.previewTitle });
    expect(within(section).getByText(copy.boundedMessages)).toBeVisible();
    const checks = within(section).getAllByRole('checkbox', {
      name: copy.previewCheck,
    });
    await userEvent.click(checks[1]!);
    await userEvent.click(
      within(section).getAllByRole('button', { name: copy.previewUp })[1]!,
    );
    await userEvent.click(
      within(section).getByRole('button', { name: copy.previewSave }),
    );
    expect(mock.previews.mock.calls[0]![0]).toMatchObject({
      artist_id: artistId,
      expected_revision: 1,
      message_ids: [newer.id, older.id],
    });
  });
  it('does not treat accepted media as an arbitrary public URL', async () => {
    const message = {
      id: '00000000-0000-4000-8000-000000000011',
      kind: 'photo' as const,
      body: null,
      sent_at: '2026-10-20T00:00:00Z',
      is_preview: false,
      preview_order: null,
      media: [
        {
          id: '00000000-0000-4000-8000-000000000012',
          kind: 'photo' as const,
          width: 10,
          height: 10,
          duration_ms: null,
        },
      ],
    };
    mountDetail({ ...detail, messages: [message] });
    await editor();
    expect(main().getByTestId('secure-media')).toHaveAttribute(
      'data-media-id',
      message.media[0]!.id,
    );
    expect(main().getByTestId('secure-media')).toHaveAttribute(
      'data-preview',
      'false',
    );
  });
  it('fails closed when preview policy is missing', async () => {
    mountDetail({ ...detail, preview_max_count: 0 });
    await editor();
    expect(main().getByText(copy.previewUnavailable)).toBeVisible();
    expect(
      main().getByRole('button', { name: copy.previewSave }),
    ).toBeDisabled();
  });
  it('requires exact UUID and separate verification confirmation for linking', async () => {
    mountDetail();
    await editor();
    await userEvent.type(
      main().getByRole('textbox', { name: copy.targetUserId }),
      'name@example.invalid',
    );
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.linkConfirm }),
    );
    await userEvent.click(
      main().getByRole('button', { name: copy.linkRequest }),
    );
    expect(mock.invite).not.toHaveBeenCalled();
    expect(main().getByRole('alert')).toHaveTextContent(
      copy.errors.INVALID_INPUT,
    );
    await userEvent.clear(
      main().getByRole('textbox', { name: copy.targetUserId }),
    );
    await userEvent.type(
      main().getByRole('textbox', { name: copy.targetUserId }),
      targetId,
    );
    await userEvent.click(main().getByRole('checkbox', { name: copy.manager }));
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.linkConfirm }),
    );
    await userEvent.click(
      main().getByRole('button', { name: copy.linkRequest }),
    );
    expect(mock.invite.mock.calls[0]![0]).toMatchObject({
      artist_id: artistId,
      target_user_id: targetId,
      is_manager: true,
      confirmed: true,
      expected_revision: 1,
    });
  });
  it('does not expose a fake invite button when onboarding is unapproved', async () => {
    mountDetail({ ...detail, account_link_ready: false });
    await editor();
    expect(main().getByText(copy.linkDisabled)).toBeVisible();
    expect(
      main().queryByRole('button', { name: copy.linkRequest }),
    ).not.toBeInTheDocument();
  });
  it('cancels a pending request only after explicit confirmation', async () => {
    mountDetail();
    await editor();
    expect(
      main().getByRole('button', { name: copy.linkCancel }),
    ).toBeDisabled();
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.cancelInviteConfirm }),
    );
    await userEvent.click(
      main().getByRole('button', { name: copy.linkCancel }),
    );
    expect(mock.cancel.mock.calls[0]![0]).toMatchObject({
      invitation_id: invitation.id,
      expected_revision: 1,
      confirmed: true,
    });
  });
  it('unlinks only the confirmed target membership and current artist version', async () => {
    mountDetail({
      ...detail,
      members: [{ user_id: targetId, is_manager: true }],
    });
    await editor();
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.unlinkConfirm }),
    );
    await userEvent.click(main().getByRole('button', { name: copy.unlink }));
    expect(mock.unlink.mock.calls[0]![0]).toMatchObject({
      artist_id: artistId,
      target_user_id: targetId,
      expected_revision: 1,
      confirmed: true,
    });
  });
});

describe('recipient and new artist UI', () => {
  it('creates a draft only after confirmation and navigates after fresh read', async () => {
    window.history.replaceState({}, '', adminArtistPath('new'));
    render(wrapper(<AdminArtistCreateScreen />));
    await editor();
    await userEvent.type(
      main().getByRole('textbox', { name: copy.name }),
      '허구 새 가수',
    );
    await userEvent.type(
      main().getByRole('textbox', { name: copy.slug }),
      'fictional-new',
    );
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.changeConfirm }),
    );
    await userEvent.click(
      main().getByRole('button', { name: copy.createSave }),
    );
    await waitFor(() => expect(mock.navigate).toHaveBeenCalledOnce());
    const body = mock.save.mock.calls[0]![0];
    expect(body).toMatchObject({
      expected_revision: 0,
      input: { status: 'draft', name: '허구 새 가수', slug: 'fictional-new' },
    });
    expect(mock.navigate).toHaveBeenCalledWith(adminArtistPath(body.artist_id));
  });
  it('keeps a result-check destination for uncertain create without auto-replay', async () => {
    mock.save.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    window.history.replaceState({}, '', adminArtistPath('new'));
    render(wrapper(<AdminArtistCreateScreen />));
    await editor();
    await userEvent.type(
      main().getByRole('textbox', { name: copy.name }),
      '허구 새 가수',
    );
    await userEvent.type(
      main().getByRole('textbox', { name: copy.slug }),
      'fictional-new',
    );
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.changeConfirm }),
    );
    await userEvent.click(
      main().getByRole('button', { name: copy.createSave }),
    );
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.UNAVAILABLE,
    );
    expect(
      main().getByRole('link', { name: copy.creationCheck }),
    ).toHaveAttribute(
      'href',
      adminArtistPath(mock.save.mock.calls[0]![0].artist_id),
    );
    expect(mock.save).toHaveBeenCalledOnce();
  });
  it.each([true, false])(
    'requires current recipient confirmation for accept=%s',
    async (accept) => {
      window.history.replaceState({}, '', routes.artistAccess);
      render(wrapper(<ArtistAccessScreen identityId={targetId} />));
      await main().findByRole('heading', { name: artist.name });
      expect(main().getByText(targetId)).toBeVisible();
      const button = main().getByRole('button', {
        name: accept ? copy.accept : copy.decline,
      });
      expect(button).toBeDisabled();
      await userEvent.click(
        main().getByRole('checkbox', { name: copy.accessConfirm }),
      );
      await userEvent.click(button);
      expect(mock.respond.mock.calls[0]![0]).toMatchObject({
        invitation_id: invitation.id,
        expected_revision: 1,
        accept,
        confirmed: true,
      });
    },
  );
  it('does not offer acceptance on a closed invitation', async () => {
    mock.access.mockResolvedValue(
      ok({
        user_id: targetId,
        invitations: [{ ...invitation, state: 'expired' }],
        account_link_ready: true,
        has_more: false,
      }),
    );
    window.history.replaceState({}, '', routes.artistAccess);
    render(wrapper(<ArtistAccessScreen identityId={targetId} />));
    await main().findByRole('heading', { name: artist.name });
    expect(main().getByText(copy.linkState.expired)).toBeVisible();
    expect(
      main().queryByRole('button', { name: copy.accept }),
    ).not.toBeInTheDocument();
  });
  it('shows bounded access list and no setup fiction', async () => {
    mock.access.mockResolvedValue(
      ok({
        user_id: targetId,
        invitations: [invitation],
        account_link_ready: false,
        has_more: true,
      }),
    );
    window.history.replaceState({}, '', routes.artistAccess);
    render(wrapper(<ArtistAccessScreen identityId={targetId} />));
    await main().findByRole('heading', { name: artist.name });
    expect(main().getByText(copy.boundedInvitations)).toBeVisible();
    expect(main().getByText(copy.linkDisabled)).toBeVisible();
    await userEvent.click(
      main().getByRole('checkbox', { name: copy.accessConfirm }),
    );
    expect(main().getByRole('button', { name: copy.accept })).toBeDisabled();
  });
  it('treats acceptance as history rather than current membership authority', async () => {
    mock.access.mockResolvedValue(
      ok({
        user_id: targetId,
        invitations: [{ ...invitation, state: 'accepted' }],
        account_link_ready: true,
        has_more: false,
      }),
    );
    window.history.replaceState({}, '', routes.artistAccess);
    render(wrapper(<ArtistAccessScreen identityId={targetId} />));
    await main().findByRole('heading', { name: artist.name });
    expect(
      main().queryByRole('link', { name: copy.artistHome }),
    ).not.toBeInTheDocument();
    expect(main().getByText(copy.acceptedHistoryNote)).toBeVisible();
    await userEvent.click(main().getByRole('link', { name: copy.backHome }));
    expect(main().queryByText(targetId)).not.toBeInTheDocument();
  });
  it.each(
    Object.keys(
      ADMIN_ARTIST_ERROR_STATUS,
    ) as (keyof typeof ADMIN_ARTIST_ERROR_STATUS)[],
  )('renders scoped recoverable %s error', async (code) => {
    render(wrapper(<AdminArtistsErrorScreen code={code} />));
    expect(main().getByRole('alert')).toHaveTextContent(copy.errors[code]);
    await userEvent.click(
      main().getByRole('button', { name: messages.ui.retry }),
    );
    expect(mock.refresh).toHaveBeenCalledOnce();
  });
  it('provides readable loading not blank skeletons', () => {
    render(wrapper(<AdminArtistsLoading access />));
    expect(
      main().getByRole('heading', { name: copy.accessTitle }),
    ).toBeVisible();
    expect(main().getByText(copy.loading)).toBeVisible();
  });
});

it('permits clearing old previews when new preview selection is disabled', async () => {
  const message = {
    id: '00000000-0000-4000-8000-000000000021',
    kind: 'text' as const,
    body: '기존 공개 맛보기',
    sent_at: '2026-10-20T00:00:00Z',
    is_preview: true,
    preview_order: 1,
    media: [],
  };
  mountDetail({ ...detail, previews: [message], preview_max_count: 0 });
  await editor();
  await userEvent.click(
    main().getByRole('button', { name: copy.previewRemove }),
  );
  expect(main().getByRole('button', { name: copy.previewSave })).toBeEnabled();
  await userEvent.click(main().getByRole('button', { name: copy.previewSave }));
  expect(mock.previews.mock.calls[0]![0].message_ids).toEqual([]);
});

it('requires a new account confirmation when exact target or manager permission changes', async () => {
  mountDetail();
  await editor();
  const target = main().getByRole('textbox', { name: copy.targetUserId });
  const confirmation = main().getByRole('checkbox', { name: copy.linkConfirm });
  const submit = main().getByRole('button', { name: copy.linkRequest });
  await userEvent.type(target, targetId);
  await userEvent.click(confirmation);
  expect(submit).toBeEnabled();
  fireEvent.change(target, { target: { value: artistId } });
  expect(confirmation).not.toBeChecked();
  expect(submit).toBeDisabled();
  await userEvent.click(confirmation);
  await userEvent.click(main().getByRole('checkbox', { name: copy.manager }));
  expect(confirmation).not.toBeChecked();
  expect(submit).toBeDisabled();
  expect(mock.invite).not.toHaveBeenCalled();
  await userEvent.click(confirmation);
  await userEvent.click(submit);
  expect(mock.invite.mock.calls[0]![0]).toMatchObject({
    target_user_id: artistId,
    is_manager: true,
    confirmed: true,
  });
});

it.each(['text', 'status', 'grade', 'order'] as const)(
  'requires renewed reviewed-input confirmation after changing %s',
  async (kind) => {
    mountDetail();
    await editor();
    const confirmation = main().getByRole('checkbox', {
      name: copy.changeConfirm,
    });
    const submit = main().getByRole('button', { name: copy.save });
    await userEvent.click(confirmation);
    expect(submit).toBeEnabled();
    if (kind === 'text')
      fireEvent.change(main().getByRole('textbox', { name: copy.name }), {
        target: { value: '허구 재확인 가수' },
      });
    if (kind === 'status')
      await userEvent.click(
        main().getByRole('radio', { name: copy.status.paused }),
      );
    if (kind === 'grade')
      await userEvent.click(main().getByRole('radio', { name: copy.gradeC }));
    if (kind === 'order')
      fireEvent.change(main().getByRole('textbox', { name: copy.sortOrder }), {
        target: { value: '12' },
      });
    expect(confirmation).not.toBeChecked();
    expect(submit).toBeDisabled();
    expect(mock.save).not.toHaveBeenCalled();
    await userEvent.click(confirmation);
    await userEvent.click(submit);
    expect(mock.save).toHaveBeenCalledOnce();
  },
);

it('pages shared detail sections while retaining persisted selected previews', async () => {
  const selected = {
    id: '00000000-0000-4000-8000-000000000022',
    kind: 'text' as const,
    body: '다른 쪽에서도 보이는 선택',
    sent_at: '2026-10-20T00:00:00Z',
    is_preview: true,
    preview_order: 1,
    media: [],
  };
  mock.detail.mockResolvedValue(
    ok({ ...detail, previews: [selected], invitations_has_more: true }),
  );
  window.history.replaceState({}, '', adminArtistPath(artistId, 2));
  render(wrapper(<AdminArtistDetailScreen id={artistId} page={2} />));
  await editor();
  expect(mock.detail).toHaveBeenCalledWith(
    artistId,
    expect.any(AbortSignal),
    2,
  );
  expect(main().getByText(copy.sharedPageNote)).toBeVisible();
  expect(main().getByText(copy.pageSaveNote)).toBeVisible();
  expect(main().getAllByText(selected.body)).not.toHaveLength(0);
  expect(main().getByRole('link', { name: copy.previousPage })).toHaveAttribute(
    'href',
    adminArtistPath(artistId),
  );
  expect(main().getByRole('link', { name: copy.nextPage })).toHaveAttribute(
    'href',
    adminArtistPath(artistId, 3),
  );
  await userEvent.click(main().getByRole('link', { name: copy.previousPage }));
  expect(main().queryByText(selected.body)).not.toBeInTheDocument();
  expect(mock.previews).not.toHaveBeenCalled();
});
it('shows honest empty page slices and can return to earlier recipient requests', async () => {
  mock.access.mockResolvedValue(
    ok({
      user_id: targetId,
      invitations: [],
      account_link_ready: true,
      has_more: false,
    }),
  );
  window.history.replaceState({}, '', artistAccessPath(2));
  render(wrapper(<ArtistAccessScreen identityId={targetId} page={2} />));
  expect(await main().findByText(copy.accessEmpty)).toBeVisible();
  expect(mock.access).toHaveBeenCalledWith(expect.any(AbortSignal), 2);
  expect(main().getByRole('link', { name: copy.previousPage })).toHaveAttribute(
    'href',
    artistAccessPath(),
  );
  expect(
    main().queryByRole('link', { name: copy.nextPage }),
  ).not.toBeInTheDocument();
});
it('does not advertise detail or recipient pages beyond the configured transport cap', async () => {
  mock.detail.mockResolvedValue(ok({ ...detail, messages_has_more: true }));
  window.history.replaceState({}, '', adminArtistPath(artistId, 1000));
  render(wrapper(<AdminArtistDetailScreen id={artistId} page={1000} />));
  await editor();
  expect(
    main().queryByRole('link', { name: copy.nextPage }),
  ).not.toBeInTheDocument();
  expect(main().getByRole('link', { name: copy.previousPage })).toHaveAttribute(
    'href',
    adminArtistPath(artistId, 999),
  );
});

it('does not link the artist list beyond the maximum accepted page', async () => {
  mock.list.mockResolvedValue(ok({ artists: [artist], has_more: true }));
  window.history.replaceState({}, '', `${routes.adminArtists}?page=1000`);
  render(wrapper(<AdminArtistsScreen page={1000} />));
  await main().findByRole('heading', { name: artist.name });
  expect(
    main().queryByRole('link', { name: copy.next }),
  ).not.toBeInTheDocument();
  expect(main().getByRole('link', { name: copy.first })).toHaveAttribute(
    'href',
    routes.adminArtists,
  );
});

it('loads exact detail on explicit page=1 just like the canonical page', async () => {
  window.history.replaceState({}, '', `${adminArtistPath(artistId)}?page=1`);
  render(wrapper(<AdminArtistDetailScreen id={artistId} page={1} />));
  await editor();
  expect(mock.detail).toHaveBeenCalledWith(
    artistId,
    expect.any(AbortSignal),
    1,
  );
});
it('loads recipient requests on explicit page=1 just like the canonical page', async () => {
  window.history.replaceState({}, '', `${routes.artistAccess}?page=1`);
  render(wrapper(<ArtistAccessScreen identityId={targetId} page={1} />));
  await main().findByRole('heading', { name: artist.name });
  expect(mock.access).toHaveBeenCalledWith(expect.any(AbortSignal), 1);
});

it('renders only fresh API identity after restoring an old account RSC screen', async () => {
  mock.access.mockResolvedValue(
    ok({
      user_id: artistId,
      invitations: [],
      account_link_ready: true,
      has_more: false,
    }),
  );
  window.history.replaceState({}, '', routes.artistAccess);
  render(wrapper(<ArtistAccessScreen identityId={artistId} />));
  expect(await main().findByText(artistId)).toBeVisible();
  mock.access.mockResolvedValue(
    ok({
      user_id: targetId,
      invitations: [invitation],
      account_link_ready: true,
      has_more: false,
    }),
  );
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(main().queryByText(artistId)).not.toBeInTheDocument();
  act(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    ),
  );
  const identity = await main().findByRole('region', {
    name: copy.identityLabel,
  });
  expect(within(identity).getByText(targetId)).toBeVisible();
  expect(main().queryByText(artistId)).not.toBeInTheDocument();
  expect(mock.access).toHaveBeenCalledTimes(2);
});

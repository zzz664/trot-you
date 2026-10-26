import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSettingsScreen } from '@/components/admin-settings/AdminSettingsScreen';
import { AdminSettingsPoliciesScreen } from '@/components/admin-settings/AdminSettingsPoliciesScreen';
import { AdminSettingsErrorScreen } from '@/components/admin-settings/AdminSettingsErrorScreen';
import { AdminSettingsLoading } from '@/components/admin-settings/AdminSettingsLoading';
import { AdminSettingsEntry } from '@/components/admin-settings/AdminSettingsEntry';
import { SettingsEditor } from '@/components/admin-settings/SettingsEditor';
import {
  ADMIN_SETTINGS_ERROR_STATUS,
  adminSettingsFields,
  type AdminSettingsList,
  type AdminSettingsResult,
} from '@/config/admin-settings';
import { ADMIN_SETTINGS_CATALOG } from '@/config/admin-settings-catalog';
import { adminSettingsPolicyPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  displayGroup,
  settingsActor,
  settingsDecision,
  settingsInstant,
  settingsList,
  settingsOperation,
} from './admin-settings-fixtures';

const mock = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/admin-settings', () => ({
  fetchAdminSettings: mock.list,
  saveAdminSettings: mock.save,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh }),
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
const copy = messages.adminSettings;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrapper = (children: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    {children}
  </NextIntlClientProvider>
);
const main = () => within(screen.getByRole('main'));
function group(key = 'display') {
  const element = document.querySelector(
    `[data-admin-settings-group="${key}"]`,
  );
  if (!(element instanceof HTMLElement)) throw new Error('group missing');
  return within(element);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function openEditor(key = 'display') {
  await main().findByRole('heading', {
    name: copy.groups[key as keyof typeof copy.groups].title,
  });
  fireEvent.click(group(key).getByRole('button', { name: copy.edit }));
}
async function reviewDisplay(value = '31') {
  await openEditor();
  fireEvent.change(
    group().getByRole('textbox', { name: copy.fields.page_size }),
    { target: { value } },
  );
  fireEvent.change(
    group().getByRole('textbox', { name: copy.decisionReference }),
    { target: { value: settingsDecision } },
  );
  fireEvent.click(group().getByRole('button', { name: copy.review }));
}
function confirmAndSave() {
  fireEvent.click(group().getByRole('checkbox', { name: copy.confirm }));
  fireEvent.click(group().getByRole('button', { name: copy.save }));
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.list.mockResolvedValue(ok(structuredClone(settingsList)));
  mock.save.mockResolvedValue(
    ok({ ...displayGroup, revision: 1, values: { page_size: 31 } }),
  );
  window.history.replaceState({}, '', routes.adminSettings);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  document.documentElement.dataset.fontScale = 'large';
});

describe('current-actor operational settings UI', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'renders real values, boundaries and actual missing policies at %s',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      render(wrapper(<AdminSettingsScreen />));
      await main().findByRole('heading', { name: copy.groups.display.title });
      expect(group().getByText(copy.displayCompatibility)).toBeVisible();
      expect(group('community').getByText(copy.unconfigured)).toBeVisible();
      expect(
        group('community').queryByRole('button', { name: copy.edit }),
      ).not.toBeInTheDocument();
      expect(
        group('community').getByRole('link', { name: copy.groupPolicy }),
      ).toHaveAttribute('href', adminSettingsPolicyPath('community-policy'));
      expect(main().getByText(copy.boundary)).toBeVisible();
      expect(
        main().getByRole('link', { name: copy.policiesOpen }),
      ).toHaveAttribute('href', routes.adminSettingsPolicies);
      expect(mock.save).not.toHaveBeenCalled();
    },
  );
  it.each(['', '-1', '0', '101', '1.2', 'NaN', '1e1', '9007199254740992'])(
    'shows a scoped field error for invalid page size %j and never saves',
    async (value) => {
      render(wrapper(<AdminSettingsScreen />));
      await reviewDisplay(value);
      expect(
        group().getByRole('textbox', { name: copy.fields.page_size }),
      ).toHaveAttribute('aria-invalid', 'true');
      expect(group().getByRole('alert')).toBeVisible();
      expect(
        document.querySelector('[data-admin-settings-review]'),
      ).not.toBeInTheDocument();
      expect(mock.save).not.toHaveBeenCalled();
    },
  );
  it('requires a real-formatted decision reference without creating one', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await openEditor();
    fireEvent.change(
      group().getByRole('textbox', { name: copy.fields.page_size }),
      { target: { value: '31' } },
    );
    fireEvent.change(
      group().getByRole('textbox', { name: copy.decisionReference }),
      { target: { value: 'not-an-approval' } },
    );
    fireEvent.click(group().getByRole('button', { name: copy.review }));
    expect(group().getByRole('alert')).toHaveTextContent(copy.invalidReference);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('does not create meaningless unchanged saves', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay('30');
    expect(group().getByRole('alert')).toHaveTextContent(copy.noChanges);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('shows before-after review and explicit confirmation before any mutation', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    expect(group().getByText('이전: 30 → 변경: 31')).toBeVisible();
    expect(
      group().getByRole('heading', { name: copy.reviewTitle }),
    ).toHaveFocus();
    expect(
      group().getByText(`승인 근거 ID: ${settingsDecision}`),
    ).toBeVisible();
    expect(mock.save).not.toHaveBeenCalled();
    fireEvent.click(group().getByRole('button', { name: copy.save }));
    expect(group().getByRole('alert')).toHaveTextContent(
      copy.confirmationMissing,
    );
    expect(mock.save).not.toHaveBeenCalled();
    confirmAndSave();
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(1));
    expect(mock.save.mock.calls[0]?.[0]).toEqual({
      group: 'display',
      operation_id: expect.any(String),
      expected_revision: 0,
      values: { page_size: 31 },
      confirmed: true,
      decision_reference: settingsDecision,
    });
    expect(mock.save.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });
  it('returning to edit preserves draft but requires a new confirmation', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    fireEvent.click(group().getByRole('checkbox', { name: copy.confirm }));
    fireEvent.click(group().getByRole('button', { name: copy.backToEdit }));
    expect(
      group().getByRole('textbox', { name: copy.fields.page_size }),
    ).toHaveValue('31');
    fireEvent.change(
      group().getByRole('textbox', { name: copy.fields.page_size }),
      { target: { value: '32' } },
    );
    fireEvent.click(group().getByRole('button', { name: copy.review }));
    expect(
      group().getByRole('checkbox', { name: copy.confirm }),
    ).not.toBeChecked();
    expect(group().getByText('이전: 30 → 변경: 32')).toBeVisible();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('reset restores only loaded values and clears approval evidence', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await openEditor();
    fireEvent.change(
      group().getByRole('textbox', { name: copy.fields.page_size }),
      { target: { value: '99' } },
    );
    fireEvent.change(
      group().getByRole('textbox', { name: copy.decisionReference }),
      { target: { value: settingsDecision } },
    );
    fireEvent.click(group().getByRole('button', { name: copy.reset }));
    expect(
      group().getByRole('textbox', { name: copy.fields.page_size }),
    ).toHaveValue('30');
    expect(
      group().getByRole('textbox', { name: copy.decisionReference }),
    ).toHaveValue('');
    expect(mock.save).not.toHaveBeenCalled();
  });
  it.each(['edit', 'review'])(
    'cancel from %s discards draft without a request',
    async (phase) => {
      render(wrapper(<AdminSettingsScreen />));
      if (phase === 'review') await reviewDisplay();
      else await openEditor();
      fireEvent.click(group().getByRole('button', { name: copy.cancel }));
      expect(group().queryByRole('textbox')).not.toBeInTheDocument();
      await openEditor();
      expect(
        group().getByRole('textbox', { name: copy.fields.page_size }),
      ).toHaveValue('30');
      expect(
        group().getByRole('textbox', { name: copy.decisionReference }),
      ).toHaveValue('');
      expect(mock.save).not.toHaveBeenCalled();
    },
  );
  it('keeps the same inert review through pending save and verification read without duplicate intent', async () => {
    const write = deferred<AdminSettingsResult<typeof displayGroup>>();
    const read = deferred<AdminSettingsResult<AdminSettingsList>>();
    mock.save.mockReturnValue(write.promise);
    mock.list
      .mockResolvedValueOnce(ok(settingsList))
      .mockReturnValueOnce(read.promise);
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    fireEvent.click(group().getByRole('checkbox', { name: copy.confirm }));
    const review = document.querySelector(
      '[data-admin-settings-review="display"]',
    );
    const save = group().getByRole('button', { name: copy.save });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mock.save).toHaveBeenCalledTimes(1);
    expect(review).toBeInTheDocument();
    expect(
      document.querySelector('[data-admin-settings-content]'),
    ).toHaveAttribute('inert');
    expect(save).toBeDisabled();
    expect(mock.navigate).not.toHaveBeenCalled();
    await act(async () =>
      write.resolve(
        ok({ ...displayGroup, revision: 1, values: { page_size: 31 } }),
      ),
    );
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    expect(
      document.querySelector('[data-admin-settings-review="display"]'),
    ).toBe(review);
    expect(
      document.querySelector('[data-admin-settings-content]'),
    ).toHaveAttribute('inert');
    expect(save).toBeDisabled();
    await act(async () => read.resolve(ok(settingsList)));
    expect(await main().findByText(copy.saved)).toBeVisible();
    expect(
      document.querySelector('[data-admin-settings-content]'),
    ).not.toHaveAttribute('inert');
    expect(review).not.toBeInTheDocument();
    expect(mock.save).toHaveBeenCalledTimes(1);
    expect(mock.navigate).not.toHaveBeenCalled();
  });
  it('sends once for repeated save clicks and reloads rather than replays the write', async () => {
    const write = deferred<AdminSettingsResult<typeof displayGroup>>();
    mock.save.mockReturnValue(write.promise);
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    fireEvent.click(group().getByRole('checkbox', { name: copy.confirm }));
    const button = group().getByRole('button', { name: copy.save });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock.save).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-admin-settings-content]'),
    ).toHaveAttribute('inert');
    expect(button).toBeDisabled();
    await act(async () =>
      write.resolve(
        ok({ ...displayGroup, revision: 1, values: { page_size: 31 } }),
      ),
    );
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    expect(mock.save).toHaveBeenCalledTimes(1);
    expect(await main().findByText(copy.saved)).toBeVisible();
  });
  it.each([0, 1])(
    'blocks a post-save continuation click but allows a fresh detail %i navigation',
    async (detail) => {
      render(wrapper(<AdminSettingsScreen />));
      await reviewDisplay();
      confirmAndSave();
      expect(await main().findByText(copy.saved)).toBeVisible();
      const policies = main().getByRole('link', { name: copy.policiesOpen });
      fireEvent.click(policies, { detail: 2 });
      expect(mock.navigate).not.toHaveBeenCalled();
      expect(main().getByText(copy.saved)).toBeVisible();
      fireEvent.click(policies, { detail });
      expect(mock.navigate).toHaveBeenCalledExactlyOnceWith(
        routes.adminSettingsPolicies,
      );
      expect(
        document.querySelector('[data-admin-settings-group]'),
      ).not.toBeInTheDocument();
    },
  );
  it.each(['UNAUTHENTICATED', 'FORBIDDEN', 'UNAVAILABLE'] as const)(
    'purges a retained pending review when verification returns %s',
    async (code) => {
      const read = deferred<AdminSettingsResult<AdminSettingsList>>();
      mock.list
        .mockResolvedValueOnce(ok(settingsList))
        .mockReturnValueOnce(read.promise);
      render(wrapper(<AdminSettingsScreen />));
      await reviewDisplay();
      confirmAndSave();
      await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
      expect(
        document.querySelector('[data-admin-settings-content]'),
      ).toHaveAttribute('inert');
      await act(async () => read.resolve({ ok: false, code }));
      expect(await main().findByRole('alert')).toHaveTextContent(
        copy.errors[code],
      );
      expect(
        document.querySelector('[data-admin-settings-group]'),
      ).not.toBeInTheDocument();
      expect(
        document.querySelector('[data-admin-settings-audit]'),
      ).not.toBeInTheDocument();
      expect(main().queryByText(copy.saved)).not.toBeInTheDocument();
    },
  );
  it.each(Object.keys(ADMIN_SETTINGS_ERROR_STATUS))(
    'hides stale values after %s and retry only reads',
    async (code) => {
      mock.save.mockResolvedValue({ ok: false, code });
      render(wrapper(<AdminSettingsScreen />));
      await reviewDisplay();
      confirmAndSave();
      expect(await main().findByRole('alert')).toHaveTextContent(
        copy.errors[code as keyof typeof copy.errors],
      );
      expect(
        document.querySelector('[data-admin-settings-group]'),
      ).not.toBeInTheDocument();
      if (code === 'UNAUTHENTICATED')
        expect(main().getByRole('link', { name: copy.signIn })).toHaveAttribute(
          'href',
          routes.start,
        );
      fireEvent.click(main().getByRole('button', { name: messages.ui.retry }));
      await main().findByRole('heading', { name: copy.groups.display.title });
      expect(mock.list).toHaveBeenCalledTimes(2);
      expect(mock.save).toHaveBeenCalledTimes(1);
      expect(
        group().queryByRole('checkbox', { name: copy.confirm }),
      ).not.toBeInTheDocument();
    },
  );
  it('does not claim verified save when post-write read failed', async () => {
    mock.list
      .mockResolvedValueOnce(ok(settingsList))
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    confirmAndSave();
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.UNAVAILABLE,
    );
    expect(main().queryByText(copy.saved)).not.toBeInTheDocument();
    expect(mock.save).toHaveBeenCalledTimes(1);
  });
  it('a failed initial read exposes a read-only retry', async () => {
    mock.list.mockRejectedValueOnce(new Error('private-error-text'));
    render(wrapper(<AdminSettingsScreen />));
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.UNAVAILABLE,
    );
    expect(main().queryByText('private-error-text')).not.toBeInTheDocument();
    fireEvent.click(main().getByRole('button', { name: messages.ui.retry }));
    await main().findByRole('heading', { name: copy.groups.display.title });
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('clears editor on hidden tab and rechecks lost role before showing values', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(
      document.querySelector('[data-admin-settings-group]'),
    ).not.toBeInTheDocument();
    mock.list.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.FORBIDDEN,
    );
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('navigation cancels pending loads and late replies cannot restore private state', async () => {
    const read = deferred<AdminSettingsResult<AdminSettingsList>>();
    mock.list.mockReturnValue(read.promise);
    render(wrapper(<AdminSettingsScreen />));
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(1));
    const signal = mock.list.mock.calls[0]?.[0] as AbortSignal;
    window.history.replaceState({}, '', routes.adminSettingsPolicies);
    fireEvent(window, new PopStateEvent('popstate'));
    expect(signal.aborted).toBe(true);
    await act(async () => read.resolve(ok(settingsList)));
    expect(
      document.querySelector('[data-admin-settings-group]'),
    ).not.toBeInTheDocument();
    expect(mock.list).toHaveBeenCalledTimes(1);
  });
  it('an intentional navigation purges an inert pending review and ignores its late write', async () => {
    const write = deferred<AdminSettingsResult<typeof displayGroup>>();
    mock.save.mockReturnValue(write.promise);
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    confirmAndSave();
    const signal = mock.save.mock.calls[0]?.[1] as AbortSignal;
    expect(
      document.querySelector('[data-admin-settings-content]'),
    ).toHaveAttribute('inert');
    fireEvent.click(main().getByRole('link', { name: copy.policiesOpen }), {
      detail: 1,
    });
    expect(signal.aborted).toBe(true);
    expect(
      document.querySelector('[data-admin-settings-group]'),
    ).not.toBeInTheDocument();
    await act(async () => write.resolve(ok(displayGroup)));
    expect(mock.list).toHaveBeenCalledTimes(1);
    expect(main().queryByText(copy.saved)).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-admin-settings-group]'),
    ).not.toBeInTheDocument();
  });
  it('hiding the document purges an inert pending review before a late response', async () => {
    const write = deferred<AdminSettingsResult<typeof displayGroup>>();
    mock.save.mockReturnValue(write.promise);
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    confirmAndSave();
    const signal = mock.save.mock.calls[0]?.[1] as AbortSignal;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(signal.aborted).toBe(true);
    expect(
      document.querySelector('[data-admin-settings-group]'),
    ).not.toBeInTheDocument();
    await act(async () => write.resolve(ok(displayGroup)));
    expect(
      document.querySelector('[data-admin-settings-group]'),
    ).not.toBeInTheDocument();
    expect(main().queryByText(copy.saved)).not.toBeInTheDocument();
  });
  it('history restore rechecks session and rejects stale pending mutations', async () => {
    const write = deferred<AdminSettingsResult<typeof displayGroup>>();
    mock.save.mockReturnValue(write.promise);
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    confirmAndSave();
    const signal = mock.save.mock.calls[0]?.[1] as AbortSignal;
    fireEvent(window, new Event('pagehide'));
    expect(signal.aborted).toBe(true);
    expect(
      document.querySelector('[data-admin-settings-group]'),
    ).not.toBeInTheDocument();
    mock.list.mockResolvedValue({ ok: false, code: 'UNAUTHENTICATED' });
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.UNAUTHENTICATED,
    );
    await act(async () => write.resolve(ok(displayGroup)));
    expect(main().getByRole('alert')).toHaveTextContent(
      copy.errors.UNAUTHENTICATED,
    );
    expect(main().queryByText(copy.saved)).not.toBeInTheDocument();
  });
  it('unmount aborts the active request without replay', async () => {
    const read = deferred<AdminSettingsResult<AdminSettingsList>>();
    mock.list.mockReturnValue(read.promise);
    const view = render(wrapper(<AdminSettingsScreen />));
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(1));
    const signal = mock.list.mock.calls[0]?.[0] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => read.resolve(ok(settingsList)));
    expect(mock.list).toHaveBeenCalledTimes(1);
  });
  it('does not load behind an unexpected query string', async () => {
    window.history.replaceState({}, '', `${routes.adminSettings}?unexpected=1`);
    render(wrapper(<AdminSettingsScreen />));
    await act(async () => {});
    expect(mock.list).not.toHaveBeenCalled();
  });
  it('refresh discards an edit and fetches fresh values, never writes', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    fireEvent.click(main().getByRole('button', { name: copy.refresh }));
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    await main().findByRole('heading', { name: copy.groups.display.title });
    expect(group().queryByRole('textbox')).not.toBeInTheDocument();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('shows sanitized numeric before-after audit with actor and timestamp', async () => {
    mock.list.mockResolvedValue(
      ok({
        ...settingsList,
        audit: [
          {
            id: settingsOperation,
            group_key: 'display',
            revision: 1,
            actor_id: settingsActor,
            source: 'admin',
            decision_reference: settingsDecision,
            operation_id: settingsOperation,
            before_value: { page_size: 30 },
            after_value: { page_size: 31 },
            created_at: settingsInstant,
          },
        ],
      }),
    );
    render(wrapper(<AdminSettingsScreen />));
    await main().findByRole('heading', { name: copy.groups.display.title });
    const audit = within(
      document.querySelector('[data-admin-settings-audit]') as HTMLElement,
    );
    expect(audit.getByText('이전: 30 → 변경: 31')).toBeVisible();
    expect(audit.getByText(`변경한 사용자 ID: ${settingsActor}`)).toBeVisible();
    expect(audit.getByText(/2026.*10.*25.*9:00/)).toBeVisible();
  });
  it('labels operator-only projection changes without implying no change', async () => {
    mock.list.mockResolvedValue(
      ok({
        ...settingsList,
        audit: [
          {
            id: settingsOperation,
            group_key: 'display',
            revision: 2,
            actor_id: null,
            source: 'operator',
            decision_reference: null,
            operation_id: null,
            before_value: { page_size: 30 },
            after_value: { page_size: 30 },
            created_at: settingsInstant,
          },
        ],
      }),
    );
    render(wrapper(<AdminSettingsScreen />));
    expect(await main().findByText(copy.auditProjectionOnly)).toBeVisible();
    expect(main().getByText(copy.operatorIdentity)).toBeVisible();
    expect(main().queryByText('이전: 30 → 변경: 30')).not.toBeInTheDocument();
  });
  it('visibility revalidation returns to read-only summary with no stale decision', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await reviewDisplay();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    fireEvent(document, new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));
    await main().findByRole('heading', { name: copy.groups.display.title });
    expect(group().queryByRole('textbox')).not.toBeInTheDocument();
    expect(group().queryByRole('checkbox')).not.toBeInTheDocument();
    expect(group().getByRole('button', { name: copy.edit })).toBeVisible();
    await openEditor();
    expect(
      group().getByRole('textbox', { name: copy.decisionReference }),
    ).toHaveValue('');
  });
  it('navigation links clear visible private snapshots before route transition', async () => {
    render(wrapper(<AdminSettingsScreen />));
    await main().findByRole('heading', { name: copy.groups.display.title });
    fireEvent.click(main().getByRole('link', { name: copy.policiesOpen }));
    expect(mock.navigate).toHaveBeenCalledWith(routes.adminSettingsPolicies);
    expect(
      document.querySelector('[data-admin-settings-group]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-admin-settings-audit]'),
    ).not.toBeInTheDocument();
  });
  it.each(['message', 'community', 'display'] as const)(
    'shows every numeric field with explicit bounds for %s',
    (key) => {
      const values = Object.fromEntries(
        adminSettingsFields[key].map(({ key: field, min }) => [field, min]),
      );
      render(
        wrapper(
          <SettingsEditor
            group={{ ...displayGroup, key, values }}
            onSave={mock.save}
            onCancel={mock.navigate}
          />,
        ),
      );
      for (const field of adminSettingsFields[key]) {
        expect(
          screen.getByRole('textbox', { name: copy.fields[field.key] }),
        ).toHaveValue(String(field.min));
      }
      expect(mock.save).not.toHaveBeenCalled();
    },
  );
});

describe('settings policy guidance and outer states', () => {
  it('covers every catalog entry and every live in-app runbook anchor without any write control', () => {
    render(wrapper(<AdminSettingsPoliciesScreen />));
    for (const entry of ADMIN_SETTINGS_CATALOG) {
      expect(main().getByText(entry.key, { exact: true })).toBeVisible();
      expect(document.getElementById(entry.section)).toBeInTheDocument();
      expect(
        document.querySelector(
          `a[href="${adminSettingsPolicyPath(entry.section)}"]`,
        ),
      ).toBeInTheDocument();
    }
    expect(main().queryByRole('textbox')).not.toBeInTheDocument();
    expect(main().queryByRole('button')).not.toBeInTheDocument();
    expect(
      main().getByText(copy.policies['activity-grades'].scope),
    ).toBeVisible();
    expect(
      main().getByText(copy.policies['schedule-notice-policy'].scope),
    ).toBeVisible();
    expect(
      main().getByText(copy.policies['points-policy'].limit),
    ).toBeVisible();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it.each(Object.keys(ADMIN_SETTINGS_ERROR_STATUS))(
    'error shell renders %s safely with read-only refresh',
    (code) => {
      render(
        wrapper(
          <AdminSettingsErrorScreen
            code={code as keyof typeof ADMIN_SETTINGS_ERROR_STATUS}
          />,
        ),
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        copy.errors[code as keyof typeof copy.errors],
      );
      fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
      expect(mock.refresh).toHaveBeenCalledTimes(1);
      expect(mock.save).not.toHaveBeenCalled();
    },
  );
  it('uses supplied route-boundary reset', () => {
    render(
      wrapper(
        <AdminSettingsErrorScreen code="UNAVAILABLE" onRetry={mock.navigate} />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
    expect(mock.navigate).toHaveBeenCalledTimes(1);
    expect(mock.refresh).not.toHaveBeenCalled();
  });
  it('loading shell exposes understandable text', () => {
    render(wrapper(<AdminSettingsLoading />));
    expect(screen.getByRole('heading', { name: copy.title })).toBeVisible();
    expect(screen.getByText(copy.loading)).toBeVisible();
  });
  it('admin entry points to the private settings route without prefetch', () => {
    render(
      wrapper(
        <AdminSettingsEntry
          title={copy.entryTitle}
          description={copy.entryDescription}
          label={copy.entryOpen}
        />,
      ),
    );
    expect(screen.getByRole('link', { name: copy.entryOpen })).toHaveAttribute(
      'href',
      routes.adminSettings,
    );
    expect(screen.getByRole('link', { name: copy.entryOpen })).toHaveAttribute(
      'data-prefetch',
      'false',
    );
  });
});

'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { MicButton } from '@/components/ui/MicButton';
import { useDialog } from '@/components/ui/DialogProvider';
import { SecureMedia } from '@/components/media/SecureMedia';
import {
  composeKindSchema,
  type ComposePageData,
} from '@/config/artist-compose';
import { MESSAGE_NAME_TOKEN } from '@/config/artists';
import { routes } from '@/config/routes';
import {
  captureSpeechDraft,
  insertSpeechDraft,
  speechDraftCapacity,
  type SpeechDraft,
} from '@/lib/speech-draft';
import { chatDate } from '@/components/fan/chat/format';
import { useArtistCompose } from './useArtistCompose';
import { ComposeMedia } from './ComposeMedia';
import { ArtistDispatch } from '@/components/artist-dispatch/ArtistDispatch';
import styles from './artist-compose.module.css';

export function ArtistComposer({
  initial,
  initialDispatchedId,
}: {
  initial: ComposePageData;
  initialDispatchedId?: string;
}) {
  return (
    <ComposeScreen
      key={`${initial.artist.id}:${initial.selectedDraft?.id ?? ''}`}
      initial={initial}
      {...(initialDispatchedId ? { initialDispatchedId } : {})}
    />
  );
}
function ComposeScreen({
  initial,
  initialDispatchedId,
}: {
  initial: ComposePageData;
  initialDispatchedId?: string;
}) {
  const t = useTranslations('artistCompose');
  const router = useRouter();
  const { showDialog } = useDialog();
  const state = useArtistCompose(initial);
  const editor = useRef<HTMLTextAreaElement>(null);
  const speechDraft = useRef<SpeechDraft | null>(null);
  const caret = useRef<{ value: string; cursor: number } | null>(null);
  const speechActive = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [dispatchLocked, setDispatchLocked] = useState(false);
  const composeBusy = state.busy !== null || state.mediaBusy || speaking;
  const busy = composeBusy || dispatchLocked;
  const blocked = busy || state.uncertain;
  const policy = state.data?.policy;
  useLayoutEffect(() => {
    const next = caret.current;
    const field = editor.current;
    if (!next || !field || field.value !== next.value) return;
    caret.current = null;
    field.focus();
    field.setSelectionRange(next.cursor, next.cursor);
  }, [state.body, speaking]);
  async function mayDiscard() {
    if (!state.dirty && !state.uncertain) return true;
    return (
      (await showDialog({
        key: 'artist-compose-discard',
        title: t('discardTitle'),
        description: t('discardDescription'),
        confirmLabel: t('discard'),
        cancelLabel: t('stay'),
      })) === 'confirmed'
    );
  }
  async function chooseDraft(id: string | null) {
    if (busy || !(await mayDiscard())) return;
    await state.load(id);
  }
  function insertName() {
    const field = editor.current;
    if (!field || !policy || blocked) return;
    const snapshot = captureSpeechDraft(
      field.value,
      field.selectionStart,
      field.selectionEnd,
    );
    const next = insertSpeechDraft(
      snapshot,
      MESSAGE_NAME_TOKEN,
      policy.maxTextLength,
    );
    if (!next) return;
    caret.current = next;
    state.edit(next.value);
  }
  return (
    <main className={`app-shell ${styles.screen}`}>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          if (await mayDiscard()) router.replace(routes.artist);
        }}
      >
        {t('back')}
      </Button>
      <h1>{t('title', { artist: initial.artist.name })}</h1>
      <p className={styles.notice}>{t('draftOnly')}</p>
      {state.accessLost ? (
        <p role="alert">{t('accessLost')}</p>
      ) : !state.data || !policy ? (
        state.error ? (
          <section>
            <p className="ui-error-text" role="alert">
              {t(`errors.${state.error}`)}
            </p>
            <Button
              variant="secondary"
              disabled={state.busy !== null}
              onClick={() =>
                void state.load(
                  new URL(window.location.href).searchParams.get('draft'),
                  false,
                  true,
                )
              }
            >
              {t('reload')}
            </Button>
          </section>
        ) : (
          <p role="status">{t('loading')}</p>
        )
      ) : (
        <>
          <p className="ui-hint">{t('privacy')}</p>
          <section className={styles.editor} aria-busy={busy || undefined}>
            <fieldset
              className={styles.kind}
              disabled={
                blocked ||
                (state.selected?.media.length !== 0 &&
                  state.selected !== null) ||
                Boolean(state.selected?.pendingUploadIds.length)
              }
            >
              <legend>{t('kind')}</legend>
              <div className={styles.actions}>
                {composeKindSchema.options.map((kind) => (
                  <Button
                    key={kind}
                    variant={state.kind === kind ? 'primary' : 'secondary'}
                    onClick={() => state.chooseKind(kind)}
                  >
                    {t(`kinds.${kind}`)}
                  </Button>
                ))}
              </div>
              <p className="ui-hint">
                {t('selectedKind', { kind: t(`kinds.${state.kind}`) })}
              </p>
            </fieldset>
            <Textarea
              ref={editor}
              label={t('body')}
              value={state.body}
              onChange={(event) => state.edit(event.target.value)}
              disabled={
                state.busy !== null || state.mediaBusy || dispatchLocked
              }
              readOnly={state.uncertain || speaking}
              hint={t('bodyHint', {
                count: Array.from(state.body).length,
                max: policy.maxTextLength,
                token: MESSAGE_NAME_TOKEN,
              })}
              error={
                state.error === 'TOO_LONG' || state.error === 'INVALID_INPUT'
                  ? t(`errors.${state.error}`)
                  : undefined
              }
            />
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={blocked}
                onClick={insertName}
              >
                {t('insertName')}
              </Button>
              <MicButton
                maxLength={policy.maxTextLength}
                disabled={
                  state.busy !== null ||
                  state.mediaBusy ||
                  state.uncertain ||
                  dispatchLocked
                }
                onPrepare={() => {
                  const field = editor.current;
                  if (!field) return 0;
                  speechDraft.current = captureSpeechDraft(
                    field.value,
                    field.selectionStart,
                    field.selectionEnd,
                  );
                  return speechDraftCapacity(
                    speechDraft.current,
                    policy.maxTextLength,
                  );
                }}
                onActiveChange={(active) => {
                  speechActive.current = active;
                  setSpeaking(active);
                }}
                onResult={(text) => {
                  const snapshot = speechDraft.current;
                  const field = editor.current;
                  if (
                    !snapshot ||
                    !field ||
                    field.value !== snapshot.value ||
                    state.busy !== null ||
                    state.mediaBusy ||
                    state.uncertain ||
                    dispatchLocked
                  )
                    return false;
                  const next = insertSpeechDraft(
                    snapshot,
                    text,
                    policy.maxTextLength,
                  );
                  if (!next) return false;
                  caret.current = next;
                  state.edit(next.value);
                  return true;
                }}
              />
            </div>
            {state.error &&
              state.error !== 'TOO_LONG' &&
              state.error !== 'INVALID_INPUT' &&
              state.error !== 'NAME_INVALID' && (
                <p className="ui-error-text" role="alert">
                  {t(`errors.${state.error}`)}
                </p>
              )}
            {state.uncertain && (
              <p role="status">
                {t(state.refreshRequired ? 'refreshRequired' : 'uncertain')}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                disabled={busy}
                isLoading={state.busy === 'save' || state.busy === 'remove'}
                onClick={() => {
                  if (!speechActive.current) void state.save();
                }}
              >
                {t(
                  state.busy === 'save'
                    ? 'saving'
                    : state.refreshRequired
                      ? 'reload'
                      : state.uncertain
                        ? 'retrySave'
                        : 'save',
                )}
              </Button>
              {(state.error === 'CONFLICT' ||
                state.error === 'IDEMPOTENCY_CONFLICT' ||
                state.uncertain) &&
                !state.refreshRequired && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void chooseDraft(
                        state.selected?.id ??
                          new URL(window.location.href).searchParams.get(
                            'draft',
                          ),
                      )
                    }
                  >
                    {t('reload')}
                  </Button>
                )}
            </div>
            {state.saved && <p role="status">{t('saved')}</p>}
          </section>
          {state.kind !== 'text' &&
            (state.selected && state.selected.kind === state.kind ? (
              <ComposeMedia
                key={state.selected.id}
                draft={state.selected}
                policy={policy}
                disabled={
                  state.busy !== null ||
                  state.dirty ||
                  state.uncertain ||
                  speaking ||
                  dispatchLocked
                }
                onBusy={state.setMediaBusy}
                onChanged={state.mediaChanged}
                onAccessLost={state.mediaAccessLost}
                onRemove={(id) => void state.remove(id)}
              />
            ) : (
              <p className="ui-hint">{t('saveBeforeUpload')}</p>
            ))}
          <section className={styles.preview}>
            <Input
              label={t('sampleName')}
              value={state.sampleName}
              onChange={(event) => state.editName(event.target.value)}
              autoComplete="off"
              disabled={blocked}
              hint={t('sampleHint', {
                min: policy.callNameMinLength,
                max: policy.callNameMaxLength,
              })}
              {...(state.error === 'NAME_INVALID'
                ? { error: t('errors.NAME_INVALID') }
                : {})}
            />
            <Button
              variant="secondary"
              disabled={blocked}
              isLoading={state.busy === 'preview'}
              onClick={() => void state.showPreview()}
            >
              {t('preview')}
            </Button>
            {state.preview && (
              <section
                className="ui-card"
                aria-label={t('previewTitle', {
                  name: state.preview.sampleName,
                })}
              >
                <h2>{t('previewTitle', { name: state.preview.sampleName })}</h2>
                <p className={styles.message}>
                  {state.preview.text ?? t('previewEmpty')}
                </p>
                <p className="ui-hint">{t('previewNotice')}</p>
                {state.selected?.media.map((item) => (
                  <SecureMedia
                    key={item.id}
                    mediaId={item.id}
                    kind={item.kind}
                    preview={false}
                  />
                ))}
              </section>
            )}
          </section>
          <ArtistDispatch
            slug={initial.artist.slug}
            draft={state.selected}
            disabled={composeBusy || state.dirty || state.uncertain}
            {...(state.recoveredDispatchedId || initialDispatchedId
              ? {
                  initialDispatchedId:
                    state.recoveredDispatchedId ?? initialDispatchedId!,
                }
              : {})}
            onLock={setDispatchLocked}
            onPublished={() => state.load(null, false, true)}
            onAccessLost={state.mediaAccessLost}
          />
          <section className={styles.drafts} aria-label={t('drafts')}>
            <h2>{t('drafts')}</h2>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={busy || state.uncertain}
                onClick={() => void chooseDraft(null)}
              >
                {t('new')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || state.uncertain}
                onClick={() => void chooseDraft(state.selected?.id ?? null)}
              >
                {t('refresh')}
              </Button>
            </div>
            {state.data.drafts.length === 0 ? (
              <p>{t('empty')}</p>
            ) : (
              <ol className={styles.draftList}>
                {state.data.drafts.map((draft) => (
                  <li key={draft.id} data-message-id={draft.id}>
                    <Button
                      variant="secondary"
                      disabled={busy || state.uncertain}
                      onClick={() => void chooseDraft(draft.id)}
                    >
                      {t('openDraft', {
                        kind: t(`kinds.${draft.kind}`),
                        date: chatDate(draft.updatedAt),
                      })}
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {state.data.nextCursor && (
              <Button
                variant="secondary"
                disabled={busy || state.uncertain}
                onClick={() =>
                  void state.load(state.selected?.id ?? null, true)
                }
              >
                {t('older')}
              </Button>
            )}
          </section>
        </>
      )}
    </main>
  );
}

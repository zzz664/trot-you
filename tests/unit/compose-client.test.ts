import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  previewComposeDraft,
  readComposePage,
  removeComposeMedia,
  saveComposeDraft,
} from '@/client/compose';
import {
  COMPOSE_ERROR_STATUS,
  COMPOSE_RESPONSE_MAX_BYTES,
  type ComposeSaveInput,
} from '@/config/artist-compose';
import { artistComposeApiPath } from '@/config/routes';
import {
  composeUiDraft,
  composeUiIds as ids,
  composeUiPage,
} from './compose-ui-fixtures';
const fetchMock = vi.fn();
const slug = composeUiPage().artist.slug;
const input: ComposeSaveInput = {
  slug,
  messageId: ids.message,
  operationId: ids.other,
  expectedRevision: 1,
  kind: 'text',
  body: '저장할 초안',
  mediaIds: [],
};
const success = () => ({
  ok: true,
  data: composeUiDraft({ revision: 2, body: input.body }),
});
function respond(body: unknown, status = 200, type = 'application/json') {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': type },
    }),
  );
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  respond(success());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('artist compose browser transport', () => {
  it('uses same-origin no-store POST and strips routing slug from private JSON body', async () => {
    expect(await saveComposeDraft(input)).toEqual(success());
    const [path, options] = fetchMock.mock.calls[0]!;
    expect(path).toBe(artistComposeApiPath(slug, 'save'));
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(JSON.parse(options.body)).toEqual({
      messageId: ids.message,
      operationId: ids.other,
      expectedRevision: 1,
      kind: 'text',
      body: input.body,
      mediaIds: [],
    });
  });
  it.each([
    { id: ids.other },
    { kind: 'photo' },
    { body: '다른 결과' },
    { revision: 1 },
    { revision: 3 },
    { body: null },
  ])('rejects mismatched historical save receipt %j', async (override) => {
    respond({ ok: true, data: { ...success().data, ...override } });
    expect(await saveComposeDraft(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('does not manufacture retries when a save response disappears', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    expect(await saveComposeDraft(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each(Object.entries(COMPOSE_ERROR_STATUS))(
    'accepts matching error %s only at its defined status',
    async (code, status) => {
      respond({ ok: false, code }, status);
      expect(await saveComposeDraft(input)).toEqual({ ok: false, code });
      respond({ ok: false, code }, 200);
      expect(await saveComposeDraft(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it.each(['text/html', 'text/plain'])(
    'rejects non-JSON %s before interpreting private data',
    async (mime) => {
      respond(success(), 200, mime);
      expect(await saveComposeDraft(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('rejects malformed and extra-field responses', async () => {
    respond({ ...success(), debug: 'private raw data' });
    expect(await saveComposeDraft(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    fetchMock.mockResolvedValue(
      new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    );
    expect(await saveComposeDraft(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('cancels an oversized streamed response', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(COMPOSE_RESPONSE_MAX_BYTES + 1));
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    expect(await saveComposeDraft(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    { slug: '../../other' },
    { operationId: 'bad' },
    { expectedRevision: -1 },
    { mediaIds: [ids.media, ids.media] },
    { actorId: ids.other },
  ])('rejects invalid/forged input %j locally', async (override) => {
    expect(await saveComposeDraft({ ...input, ...override })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not send an already-aborted operation', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await saveComposeDraft(input, controller.signal)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('binds current context to route and selected resource', async () => {
    respond({
      ok: true,
      data: composeUiPage({ selectedDraft: composeUiDraft() }),
    });
    expect((await readComposePage({ slug, messageId: ids.message })).ok).toBe(
      true,
    );
    expect(await readComposePage({ slug, messageId: ids.other })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await readComposePage({ slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('rejects cross-artist context and repeated pagination cursor', async () => {
    respond({
      ok: true,
      data: composeUiPage({
        artist: { ...composeUiPage().artist, slug: 'another-artist' },
      }),
    });
    expect(await readComposePage({ slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    respond({
      ok: true,
      data: composeUiPage({ hasMore: true, nextCursor: 'same' }),
    });
    expect(
      await readComposePage({ slug, messageId: null, cursor: 'same' }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('rejects inconsistent page flags and duplicate draft IDs', async () => {
    respond({ ok: true, data: composeUiPage({ hasMore: true }) });
    expect(await readComposePage({ slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    respond({
      ok: true,
      data: composeUiPage({ drafts: [composeUiDraft(), composeUiDraft()] }),
    });
    expect(await readComposePage({ slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('binds remove to revision, resource and absent attachment', async () => {
    const remove = {
      slug,
      messageId: ids.message,
      mediaId: ids.media,
      operationId: ids.other,
      expectedRevision: 1,
    };
    respond(success());
    expect((await removeComposeMedia(remove)).ok).toBe(true);
    respond({
      ok: true,
      data: composeUiDraft({
        kind: 'photo',
        revision: 2,
        media: [
          {
            id: ids.media,
            kind: 'photo',
            width: 2,
            height: 2,
            durationMs: null,
          },
        ],
      }),
    });
    expect(await removeComposeMedia(remove)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('passes template and sample name to server instead of replacing tokens locally', async () => {
    respond({
      ok: true,
      data: { sampleName: '순자', text: '<script> literal output' },
    });
    const result = await previewComposeDraft({
      slug,
      messageId: null,
      kind: 'text',
      body: '{이름}',
      sampleName: '순자',
    });
    expect(result).toEqual({
      ok: true,
      data: { sampleName: '순자', text: '<script> literal output' },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).body).toBe('{이름}');
  });
});

it('rejects a personalized preview addressed to a different submitted sample name', async () => {
  respond({ ok: true, data: { sampleName: '다른 이름', text: '개인화 결과' } });
  expect(
    await previewComposeDraft({
      slug,
      messageId: null,
      kind: 'text',
      body: '{이름}',
      sampleName: '순자',
    }),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});

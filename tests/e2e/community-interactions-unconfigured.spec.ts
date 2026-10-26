import { test, expect } from '@playwright/test';
import {
  communityCommentsPath,
  communityCommentActionPath,
  communityLikePath,
} from '../../src/config/routes';
const slug = 'fictional-community-interactions';
const postId = 'e868be86-54d1-41c8-b805-574c34010de1';
const commentId = '3e77a198-d42c-4a68-96f9-f2de0dd9bade';

test('keyless comments and likes report setup readiness instead of invented counts, comments or successful writes', async ({
  request,
}) => {
  const read = await request.get(communityCommentsPath(slug, postId));
  expect(read.status()).toBe(503);
  expect(read.headers()['cache-control']).toContain('no-store');
  expect(await read.json()).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
  for (const path of [
    communityCommentsPath(slug, postId),
    communityCommentActionPath(slug, postId, commentId, 'edit'),
    communityCommentActionPath(slug, postId, commentId, 'delete'),
    communityLikePath(slug, postId),
  ]) {
    const response = await request.post(path, { data: {} });
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
  }
});

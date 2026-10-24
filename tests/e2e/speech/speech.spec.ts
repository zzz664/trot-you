import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import {
  test,
  expect,
  appOrigin,
  preparePolicies,
  completeProfile,
  subscribe,
  seedMessages,
  replyRows,
  replyQuota,
  localSql,
  uuid,
  restrict,
  loseProfile,
  blockExternal,
  expectNoExternal,
  screenshot,
  type World,
} from '../replies/fixtures';
import {
  artistPreviewPath,
  fanRepliesPath,
  routes,
} from '../../../src/config/routes';
import { onboardingFixtures } from '../authenticated/onboarding-fixtures';
import {
  SPEECH_START_TIMEOUT_MS,
  SPEECH_SESSION_TIMEOUT_MS,
  SPEECH_STOP_TIMEOUT_MS,
} from '../../../src/config/speech';
import {
  installSpeech,
  speechSnapshot,
  speechResult,
  speechEnd,
  speechError,
  lateSpeechResult,
} from './recognition';

// Runtime JSON imports stay out of Playwright's NodeNext loader.
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const textInput = (page: Page) =>
  page.getByRole('textbox', { name: messages.replies.label, exact: true });
const speechButton = (page: Page, name: string) =>
  page.locator('.speech-input').getByRole('button', { name, exact: true });
const sendButton = (page: Page) =>
  page.getByRole('button', { name: messages.replies.send, exact: true });
async function openRoom(
  page: Page,
  context: BrowserContext,
  world: World,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
) {
  await completeProfile(world.fan, world.artist, scale);
  subscribe(world);
  seedMessages(world, 1);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(textInput(page)).toBeVisible();
  await expect(speechButton(page, messages.speech.open)).toBeVisible();
}
async function beginSpeech(page: Page) {
  await speechButton(page, messages.speech.open).click();
  await expect(
    page.getByText(messages.speech.privacy, { exact: true }),
  ).toBeVisible();
  await speechButton(page, messages.speech.start).click();
}
async function finishSpeech(page: Page, text: string) {
  await speechResult(page, [{ text, final: true }]);
  await speechEnd(page);
}

test.beforeEach(async ({ context }) => {
  preparePolicies();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test('notice and a second explicit click precede all native capture, and stop applies final text only once without sending', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  const input = textInput(page);
  await input.fill('허구 초안: 오래 함께해요.');
  await input.evaluate((field: HTMLTextAreaElement) =>
    field.setSelectionRange(7, 9),
  );
  await speechButton(page, messages.speech.open).click();
  expect((await speechSnapshot(page)).constructed).toBe(0);
  expect((await speechSnapshot(page)).starts).toBe(0);
  await expect(input).toHaveAttribute('readonly', '');
  await expect(sendButton(page)).toBeDisabled();
  await speechButton(page, messages.speech.start).click();
  await expect(speechButton(page, messages.speech.stop)).toBeVisible();
  expect((await speechSnapshot(page)).options).toEqual([
    {
      lang: 'ko-KR',
      continuous: false,
      interimResults: true,
      maxAlternatives: 1,
    },
  ]);
  await speechResult(page, [{ text: '늘', final: false }]);
  await expect(input).toHaveValue('허구 초안: 오래 함께해요.');
  await speechResult(page, [
    { text: '언제나', final: true },
    { text: ' 응', final: false },
  ]);
  await speechResult(
    page,
    [
      { text: '언제나', final: true },
      { text: ' 응원', final: false },
    ],
    1,
  );
  await speechResult(
    page,
    [
      { text: '언제나', final: true },
      { text: ' 응원', final: true },
    ],
    1,
  );
  await speechResult(
    page,
    [
      { text: '언제나', final: true },
      { text: ' 응원', final: true },
    ],
    1,
  );
  await speechButton(page, messages.speech.stop).click();
  expect((await speechSnapshot(page)).stops).toBe(1);
  await expect(input).toHaveValue('허구 초안: 오래 함께해요.');
  await expect(sendButton(page)).toBeDisabled();
  expect(replyRows(world)).toHaveLength(0);
  await speechEnd(page);
  await expect(input).toHaveValue('허구 초안: 언제나 응원 함께해요.');
  await expect(input).not.toHaveAttribute('readonly', '');
  await expect(sendButton(page)).toBeEnabled();
  await lateSpeechResult(page, '다시 들어온 무시할 허구 결과');
  await expect(input).toHaveValue('허구 초안: 언제나 응원 함께해요.');
  expect(replyRows(world)).toHaveLength(0);
  expect(replyQuota(world)).toBe(0);
  await sendButton(page).click();
  await expect(
    page.getByText(messages.replies.sent, { exact: true }),
  ).toBeVisible();
  expect(replyRows(world)).toHaveLength(1);
  expect(replyRows(world)[0]!.body).toBe('허구 초안: 언제나 응원 함께해요.');
});

test('webkit-only capability uses the same explicit Korean draft flow', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page, { capability: 'webkit' });
  await openRoom(page, context, world);
  await beginSpeech(page);
  await finishSpeech(page, '허구 한국어 음성 초안');
  await expect(textInput(page)).toHaveValue('허구 한국어 음성 초안');
  expect((await speechSnapshot(page)).starts).toBe(1);
  expect(replyRows(world)).toHaveLength(0);
});

test('interim shrink and final transition replace snapshots, not append duplicate speech chunks', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  await beginSpeech(page);
  await speechResult(page, [
    { text: '잘못된 임시 문장', final: false },
    { text: ' 사라질 말', final: false },
  ]);
  await speechResult(page, [{ text: '정확한 허구 인사', final: false }]);
  await speechResult(page, [{ text: '정확한 허구 인사', final: true }]);
  await speechResult(page, [{ text: '정확한 허구 인사', final: true }]);
  await speechEnd(page);
  await expect(textInput(page)).toHaveValue('정확한 허구 인사');
  expect(replyRows(world)).toHaveLength(0);
});

test('a final result is applied once on natural end but unfinished interim text is never committed', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  await beginSpeech(page);
  await speechResult(page, [
    { text: '확정한 허구 인사', final: true },
    { text: ' 미확정 문장', final: false },
  ]);
  await speechEnd(page);
  await expect(textInput(page)).toHaveValue('확정한 허구 인사');
  expect((await speechSnapshot(page)).starts).toBe(1);
  expect(replyRows(world)).toHaveLength(0);
});

for (const stage of ['notice', 'starting', 'listening', 'stopping'] as const) {
  test(`cancel during ${stage} preserves the original draft and ignores stale callback results`, async ({
    world,
    page,
    context,
  }) => {
    await installSpeech(page, { delayStart: stage === 'starting' });
    await openRoom(page, context, world);
    await textInput(page).fill('취소해도 보존할 허구 초안');
    await speechButton(page, messages.speech.open).click();
    if (stage !== 'notice') {
      await speechButton(page, messages.speech.start).click();
      if (stage !== 'starting') {
        await expect(speechButton(page, messages.speech.stop)).toBeVisible();
        await speechResult(page, [
          { text: '취소하면 버릴 허구 결과', final: true },
        ]);
      }
      if (stage === 'stopping')
        await speechButton(page, messages.speech.stop).click();
    }
    await speechButton(page, messages.speech.cancel).click();
    if (stage !== 'notice')
      await lateSpeechResult(page, '취소 뒤 늦게 온 허구 결과');
    await expect(textInput(page)).toHaveValue('취소해도 보존할 허구 초안');
    await expect(textInput(page)).not.toHaveAttribute('readonly', '');
    await expect(speechButton(page, messages.speech.open)).toBeVisible();
    expect((await speechSnapshot(page)).starts).toBe(
      stage === 'notice' ? 0 : 1,
    );
    expect((await speechSnapshot(page)).aborts).toBe(
      stage === 'notice' ? 0 : 1,
    );
    expect(replyRows(world)).toHaveLength(0);
  });
}

test('rapid start and stop clicks never construct a second capture or auto-restart', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page, { delayStart: true });
  await openRoom(page, context, world);
  await speechButton(page, messages.speech.open).click();
  await speechButton(page, messages.speech.start).evaluate(
    (button: HTMLButtonElement) => {
      button.click();
      button.click();
      button.click();
    },
  );
  expect((await speechSnapshot(page)).starts).toBe(1);
  await page.evaluate(() => window.__speechFixture.started());
  await speechButton(page, messages.speech.stop).evaluate(
    (button: HTMLButtonElement) => {
      button.click();
      button.click();
    },
  );
  expect((await speechSnapshot(page)).stops).toBe(1);
  await finishSpeech(page, '허구 한 번의 음성');
  await expect(textInput(page)).toHaveValue('허구 한 번의 음성');
  expect((await speechSnapshot(page)).starts).toBe(1);
  expect(replyRows(world)).toHaveLength(0);
});

for (const [code, key] of [
  ['not-allowed', 'permission'],
  ['service-not-allowed', 'permission'],
  ['no-speech', 'noSpeech'],
  ['network', 'network'],
  ['audio-capture', 'audio'],
  ['language-not-supported', 'language'],
  ['bad-grammar', 'unavailable'],
  ['aborted', 'unavailable'],
] as const) {
  test(`simulated ${code} error discards session text, preserves manual input and does not leak browser diagnostics`, async ({
    world,
    page,
    context,
  }, info) => {
    await installSpeech(page);
    await openRoom(page, context, world);
    await textInput(page).fill('오류에도 보존할 허구 초안');
    await beginSpeech(page);
    await speechResult(page, [
      { text: '오류가 나면 버릴 허구 결과', final: true },
    ]);
    await speechError(page, code);
    await lateSpeechResult(page, '늦게 온 허구 결과');
    await expect(
      page.getByText(messages.speech.errors[key], { exact: true }),
    ).toBeVisible();
    await expect(textInput(page)).toHaveValue('오류에도 보존할 허구 초안');
    await expect(textInput(page)).not.toHaveAttribute('readonly', '');
    await expect(
      page.getByText('Untrusted diagnostic must not be displayed', {
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await speechSnapshot(page)).starts).toBe(1);
    expect(replyRows(world)).toHaveLength(0);
    await screenshot(page, info, `speech-error-${code}`);
  });
}

for (const error of ['NotAllowedError', 'InvalidStateError']) {
  test(`synchronous ${error} start failure remains an editable draft without automatic retry`, async ({
    world,
    page,
    context,
  }) => {
    await installSpeech(page, { startError: error });
    await openRoom(page, context, world);
    await textInput(page).fill('시작 실패에도 남는 허구 초안');
    await beginSpeech(page);
    await expect(textInput(page)).not.toHaveAttribute('readonly', '');
    await expect(textInput(page)).toHaveValue('시작 실패에도 남는 허구 초안');
    await expect(speechButton(page, messages.speech.open)).toBeVisible();
    expect((await speechSnapshot(page)).starts).toBe(1);
    expect(replyRows(world)).toHaveLength(0);
  });
}

test('Unicode length limit rejects the whole combined draft, then a selected replacement at the exact bound succeeds', async ({
  world,
  page,
  context,
}, info) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  const original = '🎵'.repeat(99);
  await textInput(page).fill(original);
  await textInput(page).evaluate((field: HTMLTextAreaElement) =>
    field.setSelectionRange(field.value.length, field.value.length),
  );
  await beginSpeech(page);
  await finishSpeech(page, '가나');
  await expect(
    page.getByText(messages.speech.errors.tooLong, { exact: true }),
  ).toBeVisible();
  await expect(textInput(page)).toHaveValue(original);
  await screenshot(page, info, 'speech-unicode-limit');
  await textInput(page).evaluate((field: HTMLTextAreaElement) =>
    field.setSelectionRange(0, 2),
  );
  await beginSpeech(page);
  await finishSpeech(page, '가나');
  await expect(textInput(page)).toHaveValue(`가나${'🎵'.repeat(98)}`);
  expect(replyRows(world)).toHaveLength(0);
});

test('closing the disclosure before native start leaves a reopened composer editable and sendable', async ({
  world,
  page,
  context,
}, info) => {
  await installSpeech(page);
  await page.setViewportSize({ width: 360, height: 900 });
  await openRoom(page, context, world);
  await textInput(page).fill('안내만 열고 보존할 허구 초안');
  await speechButton(page, messages.speech.open).click();
  await expect(
    page.getByText(messages.speech.privacy, { exact: true }),
  ).toBeVisible();
  await expect(textInput(page)).toHaveAttribute('readonly', '');
  await expect(sendButton(page)).toBeDisabled();
  expect((await speechSnapshot(page)).constructed).toBe(0);
  await page
    .getByRole('button', { name: messages.replies.close, exact: true })
    .click();
  await expect(textInput(page)).toHaveCount(0);
  await page
    .getByRole('button', { name: messages.replies.open, exact: true })
    .click();
  await expect(textInput(page)).toHaveValue('안내만 열고 보존할 허구 초안');
  await expect(textInput(page)).not.toHaveAttribute('readonly', '');
  await expect(sendButton(page)).toBeEnabled();
  await expect(speechButton(page, messages.speech.open)).toBeEnabled();
  expect(await speechSnapshot(page)).toMatchObject({
    constructed: 0,
    starts: 0,
    stops: 0,
    aborts: 0,
  });
  await screenshot(page, info, 'speech-notice-close-reopen');
  await textInput(page).fill('안내를 닫은 뒤 직접 고친 허구 답장');
  await sendButton(page).click();
  await expect(
    page.getByText(messages.replies.sent, { exact: true }),
  ).toBeVisible();
  expect(replyRows(world)).toHaveLength(1);
  expect(replyRows(world)[0]!.body).toBe('안내를 닫은 뒤 직접 고친 허구 답장');
  expect((await speechSnapshot(page)).constructed).toBe(0);
});

test('an identical selected recognition result still restores editor focus and collapses the caret after its text', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  const original = '허구 응원 🎵 끝';
  await textInput(page).fill(original);
  await textInput(page).evaluate((field: HTMLTextAreaElement) =>
    field.setSelectionRange(3, 8),
  );
  await beginSpeech(page);
  await finishSpeech(page, '응원 🎵');
  await expect(textInput(page)).toHaveValue(original);
  await expect(textInput(page)).toBeFocused();
  await expect(textInput(page)).not.toHaveAttribute('readonly', '');
  expect(
    await textInput(page).evaluate((field: HTMLTextAreaElement) => ({
      start: field.selectionStart,
      end: field.selectionEnd,
    })),
  ).toEqual({ start: 8, end: 8 });
  await page.keyboard.type('!');
  await expect(textInput(page)).toHaveValue('허구 응원 🎵! 끝');
  await expect(sendButton(page)).toBeEnabled();
  expect(replyRows(world)).toHaveLength(0);
});

test('closing and reopening the composer aborts capture, preserving only the pre-capture draft', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  await textInput(page).fill('닫았다 열어도 남는 허구 초안');
  await beginSpeech(page);
  await speechResult(page, [{ text: '닫으면 버릴 허구 음성', final: true }]);
  await page
    .getByRole('button', { name: messages.replies.close, exact: true })
    .click();
  await expect(textInput(page)).toHaveCount(0);
  expect((await speechSnapshot(page)).aborts).toBe(1);
  await lateSpeechResult(page, '닫은 뒤 늦게 온 허구 결과');
  await page
    .getByRole('button', { name: messages.replies.open, exact: true })
    .click();
  await expect(textInput(page)).toHaveValue('닫았다 열어도 남는 허구 초안');
  await expect(speechButton(page, messages.speech.open)).toBeVisible();
  expect(replyRows(world)).toHaveLength(0);
});

for (const lost of [
  'session',
  'subscription',
  'restriction',
  'profile',
] as const) {
  test(`real ${lost} access loss aborts simulated speech and clears all private composer state`, async ({
    world,
    page,
    context,
  }, info) => {
    await installSpeech(page);
    // Keep this explicit refresh boundary independent of automatic readmarks.
    // Real auth/subscription checks still run in the unmocked local API/RPC.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'IntersectionObserver', {
        configurable: true,
        value: undefined,
      });
    });
    await openRoom(page, context, world);
    await textInput(page).fill('권한이 사라지면 지울 허구 초안');
    await beginSpeech(page);
    await speechResult(page, [
      { text: '권한이 사라지면 버릴 허구 음성', final: true },
    ]);
    if (lost === 'session') await context.clearCookies();
    else if (lost === 'subscription') subscribe(world, 'expired');
    else if (lost === 'restriction') restrict(world);
    else loseProfile(world);
    await page
      .getByRole('button', { name: messages.chat.refresh, exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: messages.chat.errorTitle,
        exact: true,
      }),
    ).toBeVisible();
    expect((await speechSnapshot(page)).aborts).toBe(1);
    await lateSpeechResult(page, '권한을 잃은 뒤 늦게 온 허구 결과');
    await expect(textInput(page)).toHaveCount(0);
    await expect(page.locator('.speech-input')).toHaveCount(0);
    await expect(page.locator('[data-message-id]')).toHaveCount(0);
    expect(replyRows(world)).toHaveLength(0);
    await screenshot(page, info, `speech-${lost}-access-loss`);
  });
}

test('navigation aborts active capture and Back/Forward cannot restore a draft or restart speech', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  await textInput(page).fill('이동하면 지울 허구 초안');
  await beginSpeech(page);
  await speechResult(page, [{ text: '이동하면 버릴 허구 음성', final: true }]);
  await page
    .getByRole('link', { name: messages.chat.subscriptions, exact: true })
    .click();
  await expect(page).toHaveURL(new URL(routes.subscriptions, appOrigin).href);
  expect((await speechSnapshot(page)).aborts).toBe(1);
  await lateSpeechResult(page, '이동 뒤 늦게 온 허구 결과');
  await expect(textInput(page)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(
    new URL(artistPreviewPath(world.artist.slug), appOrigin).href,
  );
  await expect(textInput(page)).toHaveValue('');
  await expect(speechButton(page, messages.speech.open)).toBeVisible();
  expect((await speechSnapshot(page)).starts).toBe(1);
  await page.goForward();
  await expect(page).toHaveURL(new URL(routes.subscriptions, appOrigin).href);
  await expect(textInput(page)).toHaveCount(0);
  expect(replyRows(world)).toHaveLength(0);
});

test('an uncertain reply outcome makes the immutable operation read-only and prevents speech changes', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  await textInput(page).fill('확인 중인 허구 답장');
  await page.route(
    `${appOrigin}${fanRepliesPath(world.artist.slug)}`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, code: 'UNAVAILABLE' }),
      });
    },
  );
  await sendButton(page).click();
  await expect(
    page.getByText(messages.replies.uncertain, { exact: true }),
  ).toBeVisible();
  await expect(textInput(page)).toHaveAttribute('readonly', '');
  await expect(speechButton(page, messages.speech.open)).toBeDisabled();
  expect((await speechSnapshot(page)).starts).toBe(0);
  await expect(textInput(page)).toHaveValue('확인 중인 허구 답장');
  expect(replyRows(world)).toHaveLength(0);
});

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  for (const width of [360, 1024]) {
    test(`all speech controls and interrupted states fit ${scale} text at ${width}px without capturing real audio`, async ({
      world,
      page,
      context,
    }, info) => {
      await installSpeech(page, { delayStart: true });
      await page.setViewportSize({ width, height: 900 });
      await openRoom(page, context, world, scale);
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await textInput(page).fill('허구 응원 초안. ');
      await textInput(page).evaluate((field: HTMLTextAreaElement) =>
        field.setSelectionRange(field.value.length, field.value.length),
      );
      await speechButton(page, messages.speech.open).click();
      await screenshot(page, info, `speech-notice-${scale}-${width}`);
      await speechButton(page, messages.speech.start).click();
      await expect(
        page.getByText(messages.speech.starting, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `speech-starting-${scale}-${width}`);
      await page.evaluate(() => window.__speechFixture.started());
      await speechResult(page, [
        {
          text: '늘 좋은 노래 고마워요. <strong>문자 그대로</strong>',
          final: false,
        },
      ]);
      await expect(speechButton(page, messages.speech.stop)).toBeVisible();
      await expect(page.locator('.speech-preview strong')).toHaveCount(0);
      await screenshot(page, info, `speech-listening-${scale}-${width}`);
      for (const control of await page.locator('.speech-input button').all()) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(48);
        expect(
          await control.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
      }
      await speechButton(page, messages.speech.stop).click();
      await expect(
        page.getByText(messages.speech.stopping, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `speech-stopping-${scale}-${width}`);
      await finishSpeech(page, '늘 좋은 노래 고마워요. 🎵');
      await expect(textInput(page)).toHaveValue(
        '허구 응원 초안. 늘 좋은 노래 고마워요. 🎵',
      );
      await expect(
        page.getByText(messages.speech.applied, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `speech-applied-${scale}-${width}`);
      await beginSpeech(page);
      await speechError(page, 'not-allowed');
      await expect(
        page.getByText(messages.speech.errors.permission, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `speech-permission-${scale}-${width}`);
      await speechButton(page, messages.speech.open).click();
      await speechButton(page, messages.speech.cancel).click();
      await expect(
        page.getByText(messages.speech.canceled, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `speech-canceled-${scale}-${width}`);
      expect(replyRows(world)).toHaveLength(0);
    });
    test(`unsupported capability keeps keyboard input usable at ${scale} text and ${width}px`, async ({
      world,
      page,
      context,
    }, info) => {
      await installSpeech(page, { capability: 'none' });
      await page.setViewportSize({ width, height: 900 });
      await completeProfile(world.fan, world.artist, scale);
      subscribe(world);
      await world.fan.signIn(context);
      await page.goto(artistPreviewPath(world.artist.slug));
      await expect(textInput(page)).toBeVisible();
      await expect(
        page.getByText(messages.speech.unsupported, { exact: true }),
      ).toBeVisible();
      await textInput(page).fill('키보드로 쓴 허구 응원');
      await expect(sendButton(page)).toBeEnabled();
      expect((await speechSnapshot(page)).starts).toBe(0);
      await screenshot(page, info, `speech-unsupported-${scale}-${width}`);
      await sendButton(page).click();
      await expect(
        page.getByText(messages.replies.sent, { exact: true }),
      ).toBeVisible();
      expect(replyRows(world)[0]!.body).toBe('키보드로 쓴 허구 응원');
    });
  }
}

for (const outcome of ['empty', 'interim', 'nomatch'] as const) {
  test(`${outcome} capture does not manufacture a successful draft or send`, async ({
    world,
    page,
    context,
  }) => {
    await installSpeech(page);
    await openRoom(page, context, world);
    await textInput(page).fill('보존할 허구 초안');
    await beginSpeech(page);
    if (outcome === 'interim')
      await speechResult(page, [
        { text: '확정하지 않은 허구 말', final: false },
      ]);
    if (outcome === 'nomatch')
      await page.evaluate(() => window.__speechFixture.noMatch());
    else await speechEnd(page);
    await expect(
      page.getByText(messages.speech.errors.noSpeech, { exact: true }),
    ).toBeVisible();
    await expect(textInput(page)).toHaveValue('보존할 허구 초안');
    expect(replyRows(world)).toHaveLength(0);
  });
}

for (const phase of ['starting', 'listening', 'stopping'] as const) {
  test(`bounded ${phase} timeout aborts capture, preserves draft and never restarts`, async ({
    world,
    page,
    context,
  }, info) => {
    await installSpeech(page, { delayStart: phase === 'starting' });
    await openRoom(page, context, world);
    await textInput(page).fill('시간이 지나도 보존할 허구 초안');
    await page.clock.install();
    await beginSpeech(page);
    if (phase === 'stopping')
      await speechButton(page, messages.speech.stop).click();
    const duration =
      phase === 'starting'
        ? SPEECH_START_TIMEOUT_MS
        : phase === 'listening'
          ? SPEECH_SESSION_TIMEOUT_MS
          : SPEECH_STOP_TIMEOUT_MS;
    await page.clock.runFor(duration + 1);
    await expect(
      page.getByText(messages.speech.errors.timeout, { exact: true }),
    ).toBeVisible();
    await expect(textInput(page)).toHaveValue('시간이 지나도 보존할 허구 초안');
    await lateSpeechResult(page, '기한 뒤 늦게 온 허구 결과');
    expect((await speechSnapshot(page)).aborts).toBe(1);
    expect((await speechSnapshot(page)).starts).toBe(1);
    expect(replyRows(world)).toHaveLength(0);
    await screenshot(page, info, `speech-${phase}-timeout`);
  });
}

test('Escape and pagehide cancel without adopting finalized but not-yet-ended speech', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  await textInput(page).fill('중단해도 보존할 허구 초안');
  await beginSpeech(page);
  await speechResult(page, [{ text: '중단하면 버릴 허구 결과', final: true }]);
  await page.keyboard.press('Escape');
  await expect(textInput(page)).toHaveValue('중단해도 보존할 허구 초안');
  await expect(speechButton(page, messages.speech.open)).toBeFocused();
  expect((await speechSnapshot(page)).aborts).toBe(1);
  await beginSpeech(page);
  await speechResult(page, [
    { text: '페이지가 숨겨지면 버릴 허구 결과', final: true },
  ]);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  expect((await speechSnapshot(page)).aborts).toBe(2);
  await lateSpeechResult(page, '페이지가 숨겨진 뒤 허구 결과');
  await expect(textInput(page)).toHaveCount(0);
  expect(replyRows(world)).toHaveLength(0);
});

function voiceEvents(world: World) {
  return JSON.parse(
    localSql(
      `select coalesce(jsonb_agg(jsonb_build_object('event_key',event_key,'name',name,'origin',origin,'source_id',source_id,'font_scale',font_scale,'voice_context',voice_context)),'[]') from private.analytics_events where user_id='${uuid(world.fan.id)}' and name='voice_input_used';`,
    ),
  ) as {
    event_key: string;
    name: string;
    origin: string;
    source_id: string | null;
    font_scale: string | null;
    voice_context: string;
  }[];
}

test('microphone permission does not grant optional analytics consent; a completed synthetic utterance remains only a draft', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  await beginSpeech(page);
  const denied = page.waitForResponse(
    (response) =>
      response.url() === `${appOrigin}${routes.analytics}` &&
      response.request().method() === 'POST',
  );
  await finishSpeech(page, '분석 동의 없이 넣는 허구 초안');
  expect((await denied).status()).toBe(403);
  await expect(textInput(page)).toHaveValue('분석 동의 없이 넣는 허구 초안');
  expect(voiceEvents(world)).toEqual([]);
  expect(replyRows(world)).toHaveLength(0);
});

test('approved current optional consent records one typed nonsensitive event per accepted session, never audio or transcript', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  const client = await world.fan.actorClient();
  expect(
    (
      await client.rpc('analytics_set_consent', {
        p_granted: true,
        p_consent_version: onboardingFixtures.analytics,
      })
    ).error,
  ).toBeNull();
  const payloads: unknown[] = [];
  page.on('request', (request) => {
    if (
      request.url() === `${appOrigin}${routes.analytics}` &&
      request.method() === 'POST'
    )
      payloads.push(request.postDataJSON());
  });
  await beginSpeech(page);
  await speechResult(page, [
    { text: '분석에 보내면 안 되는 허구 초안', final: true },
  ]);
  expect(payloads).toEqual([]);
  await speechEnd(page);
  await expect.poll(() => voiceEvents(world).length).toBe(1);
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toEqual({
    event_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    name: 'voice_input_used',
    properties: { voice_context: 'reply' },
  });
  expect(voiceEvents(world)[0]).toEqual({
    event_key: (payloads[0] as { event_key: string }).event_key,
    name: 'voice_input_used',
    origin: 'client',
    voice_context: 'reply',
    source_id: null,
    font_scale: null,
  });
  await lateSpeechResult(page, '중복 콜백의 허구 초안');
  await expect(textInput(page)).toHaveValue('분석에 보내면 안 되는 허구 초안');
  await beginSpeech(page);
  await speechResult(page, [{ text: '취소할 허구 음성', final: true }]);
  await speechButton(page, messages.speech.cancel).click();
  expect(payloads).toHaveLength(1);
  expect(voiceEvents(world)).toHaveLength(1);
  expect(replyRows(world)).toHaveLength(0);
});

test('withdrawing optional consent during speech blocks telemetry but cannot erase the accepted draft', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  const client = await world.fan.actorClient();
  expect(
    (
      await client.rpc('analytics_set_consent', {
        p_granted: true,
        p_consent_version: onboardingFixtures.analytics,
      })
    ).error,
  ).toBeNull();
  await beginSpeech(page);
  expect(
    (
      await client.rpc('analytics_set_consent', {
        p_granted: false,
        p_consent_version: onboardingFixtures.analytics,
      })
    ).error,
  ).toBeNull();
  const denied = page.waitForResponse(
    (response) =>
      response.url() === `${appOrigin}${routes.analytics}` &&
      response.request().method() === 'POST',
  );
  await finishSpeech(page, '동의 철회 뒤에도 내가 쓴 허구 초안');
  expect((await denied).status()).toBe(403);
  await expect(textInput(page)).toHaveValue(
    '동의 철회 뒤에도 내가 쓴 허구 초안',
  );
  expect(voiceEvents(world)).toHaveLength(0);
  expect(replyRows(world)).toHaveLength(0);
});

test('a hidden document aborts capture without persisting or inserting unfinished text', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openRoom(page, context, world);
  await textInput(page).fill('화면을 가려도 남는 허구 초안');
  await beginSpeech(page);
  await speechResult(page, [{ text: '숨기면 버릴 허구 음성', final: true }]);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await speechSnapshot(page)).aborts).toBe(1);
  await lateSpeechResult(page, '숨겨진 화면에 늦게 온 허구 결과');
  await expect(textInput(page)).toHaveValue('화면을 가려도 남는 허구 초안');
  await expect(textInput(page)).not.toHaveAttribute('readonly', '');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(speechButton(page, messages.speech.open)).toBeVisible();
  expect((await speechSnapshot(page)).starts).toBe(1);
  expect(replyRows(world)).toHaveLength(0);
});

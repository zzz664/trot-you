import { describe, expect, it } from 'vitest';
import {
  captureSpeechDraft,
  insertSpeechDraft,
  speechDraftCapacity,
} from '@/lib/speech-draft';
describe('speech selection and Unicode policy', () => {
  it('preserves exactly the unselected text and newlines', () => {
    const draft = captureSpeechDraft('  앞\n기존 뒤  ', 4, 6);
    expect(insertSpeechDraft(draft, '새 글', 20)).toEqual({
      value: '  앞\n새 글 뒤  ',
      cursor: 7,
    });
  });
  it('counts scalars but restores a DOM UTF-16 cursor', () => {
    const draft = captureSpeechDraft('가😀나', 1, 3);
    expect(speechDraftCapacity(draft, 3)).toBe(1);
    expect(insertSpeechDraft(draft, '🌸', 3)).toEqual({
      value: '가🌸나',
      cursor: 3,
    });
    expect(insertSpeechDraft(draft, '🌸🌸', 3)).toBeNull();
  });
  it.each([
    [2, 2],
    [1, 2],
    [2, 3],
  ])(
    'expands half-surrogate range %s,%s instead of making broken Unicode',
    (start, end) => {
      const draft = captureSpeechDraft('가😀나', start, end);
      expect(draft).toEqual({ value: '가😀나', start: 1, end: 3 });
      expect(insertSpeechDraft(draft, '꽃', 3)?.value).toBe('가꽃나');
    },
  );
  it('clamps out-of-bounds DOM ranges', () => {
    expect(captureSpeechDraft('초안', -1, 99)).toEqual({
      value: '초안',
      start: 0,
      end: 2,
    });
    expect(captureSpeechDraft('초안', NaN, NaN)).toEqual({
      value: '초안',
      start: 2,
      end: 2,
    });
  });
});

export type SpeechDraft = { value: string; start: number; end: number };

// DOM selection offsets are UTF-16, whereas reply policy counts Unicode scalars.
// Expand an unusual half-surrogate selection rather than create invalid text.
function scalarBoundary(value: string, offset: number, end: boolean): number {
  const safe = Number.isInteger(offset)
    ? Math.max(0, Math.min(offset, value.length))
    : value.length;
  let cursor = 0;
  for (const scalar of value) {
    const next = cursor + scalar.length;
    if (safe > cursor && safe < next) return end ? next : cursor;
    cursor = next;
  }
  return safe;
}
export function captureSpeechDraft(
  value: string,
  start: number,
  end: number,
): SpeechDraft {
  return {
    value,
    start: scalarBoundary(value, start, false),
    end: scalarBoundary(value, Math.max(start, end), true),
  };
}
export function speechDraftCapacity(
  draft: SpeechDraft,
  maxLength: number,
): number {
  return (
    maxLength -
    Array.from(draft.value.slice(0, draft.start) + draft.value.slice(draft.end))
      .length
  );
}
export function insertSpeechDraft(
  draft: SpeechDraft,
  transcript: string,
  maxLength: number,
): { value: string; cursor: number } | null {
  const value =
    draft.value.slice(0, draft.start) +
    transcript +
    draft.value.slice(draft.end);
  if (Array.from(value).length > maxLength) return null;
  return { value, cursor: draft.start + transcript.length };
}

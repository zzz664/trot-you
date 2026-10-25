import 'server-only';
import {
  contentCalendarSaveSchema,
  contentCalendarDeleteSchema,
  contentCalendarEntrySchema,
  contentCalendarDeletedSchema,
  type ContentCalendarResult,
  type ContentCalendarEntry,
  type ContentCalendarSaveInput,
  type ContentCalendarDeleteInput,
  type ContentCalendarDeleted,
} from '@/config/content-calendar';

export type ContentCalendarWritePort = {
  save(
    input: ContentCalendarSaveInput,
  ): Promise<ContentCalendarResult<ContentCalendarEntry>>;
  delete(
    input: ContentCalendarDeleteInput,
  ): Promise<ContentCalendarResult<ContentCalendarDeleted>>;
};
export async function saveContentCalendar(
  port: ContentCalendarWritePort,
  input: unknown,
): Promise<ContentCalendarResult<ContentCalendarEntry>> {
  const parsed = contentCalendarSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.save(parsed.data);
    if (!result.ok) return result;
    const row = contentCalendarEntrySchema.safeParse(result.data);
    const value = parsed.data;
    // A replay may return the original successful revision even after a later
    // update. Bind it to this exact intent, never reinterpret a different row.
    return row.success &&
      (value.entry_id === null || row.data.id === value.entry_id) &&
      row.data.artist_id === value.input.artist_id &&
      row.data.date === value.input.date &&
      row.data.topic === value.input.topic &&
      row.data.example_text === value.input.example_text &&
      (value.expected_revision === null
        ? row.data.revision === 1
        : row.data.revision === value.expected_revision ||
          row.data.revision === value.expected_revision + 1)
      ? { ok: true, data: row.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function deleteContentCalendar(
  port: ContentCalendarWritePort,
  input: unknown,
): Promise<ContentCalendarResult<ContentCalendarDeleted>> {
  const parsed = contentCalendarDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.delete(parsed.data);
    if (!result.ok) return result;
    const receipt = contentCalendarDeletedSchema.safeParse(result.data);
    return receipt.success && receipt.data.id === parsed.data.entry_id
      ? { ok: true, data: receipt.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

import 'server-only';
import {
  legalDocumentSchema,
  legalDocumentSelectorSchema,
  type LegalDocumentResult,
  type LegalDocumentSelector,
} from '@/config/legal-documents';

export type LegalDocumentPort = {
  read(selector: LegalDocumentSelector): Promise<unknown | null>;
};

export async function readLegalDocument(
  port: LegalDocumentPort | null,
  input: unknown,
  now = Date.now(),
): Promise<LegalDocumentResult> {
  const selector = legalDocumentSelectorSchema.safeParse(input);
  if (!selector.success) return { ok: false, code: 'NOT_FOUND' };
  if (!port) return { ok: false, code: 'UNCONFIGURED' };
  try {
    const value = await port.read(selector.data);
    if (value === null)
      return {
        ok: false,
        code: selector.data.version ? 'NOT_FOUND' : 'NOT_CONFIGURED',
      };
    const parsed = legalDocumentSchema.safeParse(value);
    if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
    const document = parsed.data;
    if (
      document.kind !== selector.data.kind ||
      (selector.data.version && document.version !== selector.data.version) ||
      Date.parse(document.approvedAt) > now ||
      Date.parse(document.publishedAt) > now ||
      Date.parse(document.publishedAt) < Date.parse(document.approvedAt)
    )
      return { ok: false, code: 'UNAVAILABLE' };
    return { ok: true, document };
  } catch {
    // No upstream error, draft ID, private configuration or SQL crosses the UI.
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

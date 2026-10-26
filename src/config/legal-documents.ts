import { z } from 'zod';
import { routes } from './routes';

export const LEGAL_DOCUMENT_KINDS = ['terms', 'privacy'] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];
export const legalDocumentSelectorSchema = z.strictObject({
  kind: z.enum(LEGAL_DOCUMENT_KINDS),
  version: z
    .uuid()
    .transform((value) => value.toLowerCase())
    .optional(),
});
export type LegalDocumentSelector = z.output<
  typeof legalDocumentSelectorSchema
>;
export const legalDocumentSchema = z.strictObject({
  kind: z.enum(LEGAL_DOCUMENT_KINDS),
  version: z.uuid(),
  title: z.string().refine((value) => value.trim().length > 0),
  // Validate whitespace without changing the immutable approved text.
  body: z.string().refine((value) => value.trim().length > 0),
  approvedAt: z.iso.datetime({ offset: true }),
  publishedAt: z.iso.datetime({ offset: true }),
});
export type LegalDocument = z.output<typeof legalDocumentSchema>;
export type LegalDocumentError =
  'UNCONFIGURED' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'UNAVAILABLE';
export type LegalDocumentResult =
  | { ok: true; document: LegalDocument }
  | { ok: false; code: LegalDocumentError };
export const LEGAL_DOCUMENT_ERRORS = {
  UNCONFIGURED: 'unconfigured',
  NOT_CONFIGURED: 'notConfigured',
  NOT_FOUND: 'notFound',
  UNAVAILABLE: 'unavailable',
} as const;
export const LEGAL_DOCUMENT_RETURN_PATHS = {
  start: routes.start,
  onboarding: routes.onboardingConsent,
  account: routes.home,
} as const;
export type LegalDocumentSource = keyof typeof LEGAL_DOCUMENT_RETURN_PATHS;
export function legalDocumentSource(value: unknown): LegalDocumentSource {
  return typeof value === 'string' &&
    Object.hasOwn(LEGAL_DOCUMENT_RETURN_PATHS, value)
    ? (value as LegalDocumentSource)
    : 'start';
}

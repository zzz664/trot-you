import { renewalCron } from '@/server/renewal/http';

export const runtime = 'nodejs';
// Next.js requires a statically analyzable route literal. The host must honor
// this budget; exporting it does not enable a scheduler or deploy anything.
export const maxDuration = 300;
export const GET = renewalCron;
export const POST = renewalCron;

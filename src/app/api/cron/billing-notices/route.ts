import { billingNoticeCron } from '@/server/billing-notices/cron';
export const runtime = 'nodejs';
// Finite invocation budget only. No recurring schedule or activation.
export const maxDuration = 90;
export const GET = billingNoticeCron;
export const POST = billingNoticeCron;

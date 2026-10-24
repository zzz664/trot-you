import { reconciliationCron } from '@/server/reconciliation/http';

export const runtime = 'nodejs';
// Bounded query recovery only; this neither enables Cron nor deploys a job.
export const maxDuration = 300;
export const GET = reconciliationCron;
export const POST = reconciliationCron;

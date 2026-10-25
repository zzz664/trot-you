import { scheduleNoticeCron } from '@/server/schedule-notices/cron';
export const runtime = 'nodejs';
// Finite invocation budget only. No recurring schedule or activation.
export const maxDuration = 90;
export const GET = scheduleNoticeCron;
export const POST = scheduleNoticeCron;

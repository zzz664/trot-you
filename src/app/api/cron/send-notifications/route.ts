import { webPushCron } from '@/server/webpush/cron';
export const runtime = 'nodejs';
// Finite invocation budget only. No recurring schedule or activation.
export const maxDuration = 90;
export const GET = webPushCron;
export const POST = webPushCron;

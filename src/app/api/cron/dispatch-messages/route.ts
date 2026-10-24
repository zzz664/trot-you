import { dispatchCron } from '@/server/message-dispatch/cron';
export const runtime = 'nodejs';
// A route budget is not a scheduler or deployment activation.
export const maxDuration = 60;
export const GET = dispatchCron;
export const POST = dispatchCron;

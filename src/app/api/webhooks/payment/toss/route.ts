import { tossPaymentWebhook } from '@/server/provider-events/http';
export const runtime = 'nodejs';
export const maxDuration = 10;
export const POST = tossPaymentWebhook;

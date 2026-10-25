import { webPushHttp } from '@/server/webpush/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = webPushHttp;
export const POST = webPushHttp;
export const DELETE = webPushHttp;

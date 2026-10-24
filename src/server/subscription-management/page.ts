import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type { ManagementResult } from '@/config/subscription-management';
import { createAuthContext } from '@/server/auth/context';
import { createManagementDbPort } from '@/server/db/subscription-management';
import { isRestricted, landingPath } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  listSubscriptions,
  readSubscription,
  listAdminRefunds,
  readAdminRefund,
} from '@/server/services/subscription/manage';
import type { ManagementDbPort } from '@/server/services/subscription/management-model';
import { refundExecutionEnabled } from './dependencies';

async function pagePort(
  admin: boolean,
): Promise<ManagementResult<ManagementDbPort>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  // An owner can always inspect/cancel existing billing even when restricted,
  // not onboarded, or assigned a different role. Refund administration cannot.
  if (admin && (isRestricted(state.profile) || state.profile.role !== 'admin'))
    redirect(landingPath(state.profile));
  return { ok: true, data: createManagementDbPort(context.client) };
}
export async function getSubscriptionsPage(page: unknown = 1) {
  const db = await pagePort(false);
  return db.ok ? listSubscriptions(db.data, page) : db;
}
export async function getSubscriptionPage(id: unknown, page: unknown = 1) {
  const db = await pagePort(false);
  return db.ok ? readSubscription(db.data, { subscriptionId: id }, page) : db;
}
export async function getAdminRefundsPage(page: unknown = 1) {
  const db = await pagePort(true);
  return db.ok ? listAdminRefunds(db.data, page) : db;
}
export async function getAdminRefundPage(id: unknown) {
  const db = await pagePort(true);
  return db.ok
    ? readAdminRefund(db.data, { requestId: id }, refundExecutionEnabled())
    : db;
}

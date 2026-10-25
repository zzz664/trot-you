import 'server-only';
import {
  adminScheduleSaveSchema,
  adminScheduleDeleteSchema,
  type ScheduleResult,
  type AdminSchedule,
  type AdminScheduleSaveInput,
  type AdminScheduleDeleteInput,
  type AdminScheduleDeleted,
} from '@/config/schedules';
export type ScheduleWritePort = {
  save(input: AdminScheduleSaveInput): Promise<ScheduleResult<AdminSchedule>>;
  delete(
    input: AdminScheduleDeleteInput,
  ): Promise<ScheduleResult<AdminScheduleDeleted>>;
};
export async function saveAdminSchedule(
  port: ScheduleWritePort,
  input: unknown,
): Promise<ScheduleResult<AdminSchedule>> {
  const parsed = adminScheduleSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (parsed.data.input.status === 'published' && !parsed.data.confirmed)
    return { ok: false, code: 'CONFIRMATION_REQUIRED' };
  try {
    return await port.save(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function deleteAdminSchedule(
  port: ScheduleWritePort,
  input: unknown,
): Promise<ScheduleResult<AdminScheduleDeleted>> {
  const parsed = adminScheduleDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return await port.delete(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

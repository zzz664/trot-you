import 'server-only';
import {
  installInputSchema,
  type InstallChoice,
  type InstallData,
  type InstallResult,
  type InstallSubmitResult,
} from '@/config/install';
import { routes } from '@/config/routes';

export type InstallPort = {
  read(): Promise<InstallResult<Omit<InstallData, 'selectedName'>>>;
  acknowledge(choice: InstallChoice): Promise<InstallResult<null>>;
  complete(): Promise<InstallResult<string>>;
};

export async function readInstallState(port: InstallPort) {
  try {
    return await port.read();
  } catch {
    return { ok: false, code: 'UNAVAILABLE' } as const;
  }
}

// The transaction, not a browser's claimed platform/permission/installation,
// decides eligibility. Acknowledgement is not installation or paid access.
export async function submitInstall(
  port: InstallPort,
  input: unknown,
): Promise<InstallSubmitResult> {
  const parsed = installInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result =
      parsed.data.action === 'acknowledge'
        ? await port.acknowledge(parsed.data.choice)
        : await port.complete();
    if (!result.ok) return result;
    return {
      ok: true,
      next:
        parsed.data.action === 'acknowledge'
          ? routes.onboardingInstall
          : routes.home,
    };
  } catch {
    // Outcome unknown, not a promise that the transaction never committed.
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

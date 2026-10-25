import { AdminSettingsPoliciesScreen } from '@/components/admin-settings/AdminSettingsPoliciesScreen';
import { AdminSettingsErrorScreen } from '@/components/admin-settings/AdminSettingsErrorScreen';
import { getAdminSettingsPage } from '@/server/admin-settings/page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getAdminSettingsPage();
  if (!result.ok) return <AdminSettingsErrorScreen code={result.code} />;
  if (Object.keys(await searchParams).length)
    return <AdminSettingsErrorScreen code="INVALID_INPUT" />;
  return <AdminSettingsPoliciesScreen key={result.data.key} />;
}

import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { getInstallStatus } from '@/server/install/page';

export async function InstallStatusCard() {
  const [state, t] = await Promise.all([
    getInstallStatus(),
    getTranslations('install'),
  ]);
  const confirmed = state.ok && state.data.completedAt && state.data.choice;
  return (
    <Card title={t(confirmed ? 'homeTitle' : 'homeStatusTitle')}>
      {state.ok && state.data.completedAt && state.data.choice ? (
        <>
          <p>{t('homeDescription')}</p>
          <p>{t(`guidanceLabels.${state.data.choice}`)}</p>
          {state.data.installationSelfReportedAt && (
            <p>{t('selfReportNotice')}</p>
          )}
        </>
      ) : (
        <p>{t('homeUnavailable')}</p>
      )}
      <p>{t('homeNoPaidAccess')}</p>
    </Card>
  );
}

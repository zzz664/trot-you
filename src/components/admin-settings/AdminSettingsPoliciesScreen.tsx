'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { ADMIN_SETTINGS_CATALOG } from '@/config/admin-settings-catalog';
import { adminSettingsPolicyPath, routes } from '@/config/routes';
import styles from './admin-settings.module.css';

export function AdminSettingsPoliciesScreen() {
  const t = useTranslations('adminSettings');
  const sections = [
    ...new Set(ADMIN_SETTINGS_CATALOG.map((entry) => entry.section)),
  ];
  return (
    <main className={`app-shell onboarding-shell ${styles.screen}`}>
      <Link
        href={routes.adminSettings}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('backSettings')}
      </Link>
      <header>
        <h1>{t('policiesTitle')}</h1>
        <p>{t('policiesDescription')}</p>
      </header>
      <p className={styles.notice}>{t('policyBoundary')}</p>
      <Card title={t('procedureTitle')}>
        <ol>
          <li>{t('procedureApproval')}</li>
          <li>{t('procedureSnapshot')}</li>
          <li>{t('procedureValidate')}</li>
          <li>{t('procedureCommit')}</li>
          <li>{t('procedureVerify')}</li>
        </ol>
        <p>{t('operatorRunbook')}</p>
      </Card>
      <section
        data-admin-settings-catalog
        className={styles.stack}
        aria-label={t('catalogTitle')}
      >
        <h2>{t('catalogTitle')}</h2>
        <p className="ui-hint">{t('catalogHint')}</p>
        <ul className={styles.list}>
          {ADMIN_SETTINGS_CATALOG.map((entry) => (
            <li key={entry.key}>
              <code className={styles.key}>{entry.key}</code>
              <p>{t(`management.${entry.kind}`)}</p>
              <Link
                href={adminSettingsPolicyPath(entry.section)}
                prefetch={false}
                className="ui-button ui-button--secondary"
              >
                {t(`policies.${entry.section}.title`)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <div className={styles.stack}>
        {sections.map((section) => (
          <div
            key={section}
            id={section}
            data-admin-settings-policy={section}
            className={styles.policy}
          >
            <Card title={t(`policies.${section}.title`)}>
              <p>{t(`policies.${section}.scope`)}</p>
              <ol>
                <li>{t(`policies.${section}.inputs`)}</li>
                <li>{t(`policies.${section}.change`)}</li>
                <li>{t(`policies.${section}.verify`)}</li>
              </ol>
              <p className="ui-hint">{t(`policies.${section}.limit`)}</p>
            </Card>
          </div>
        ))}
      </div>
      <Link
        href={routes.adminSettings}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('backSettings')}
      </Link>
    </main>
  );
}

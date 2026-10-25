'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  ADMIN_SETTINGS_TIME_ZONE,
  adminSettingsFields,
  type AdminSettingsGroup,
} from '@/config/admin-settings';
import { fetchAdminSettings, saveAdminSettings } from '@/client/admin-settings';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { adminSettingsPolicyPath, routes } from '@/config/routes';
import { SettingsEditor } from './SettingsEditor';
import { useAdminSettingsResource } from './useAdminSettingsResource';
import styles from './admin-settings.module.css';

export function AdminSettingsScreen() {
  const t = useTranslations('adminSettings');
  const format = useFormatter();
  const load = useCallback(
    (signal: AbortSignal) => fetchAdminSettings(signal),
    [],
  );
  const state = useAdminSettingsResource(routes.adminSettings, load);
  const [editing, setEditing] = useState<{
    key: AdminSettingsGroup['key'];
    epoch: number;
  } | null>(null);
  const date = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: ADMIN_SETTINGS_TIME_ZONE,
    });
  return (
    <main className={`app-shell onboarding-shell ${styles.screen}`}>
      <Link
        href={routes.admin}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
      <header>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </header>
      <p className={styles.notice}>{t('boundary')}</p>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={state.busy}
          onClick={() => {
            state.dismissSaved();
            setEditing(null);
            void state.refresh();
          }}
        >
          {t('refresh')}
        </Button>
        <Link
          href={routes.adminSettingsPolicies}
          prefetch={false}
          onNavigate={state.clear}
          className="ui-button ui-button--secondary"
        >
          {t('policiesOpen')}
        </Link>
      </div>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <>
          <InlineError
            message={t(`errors.${state.error}`)}
            onRetry={async () => {
              setEditing(null);
              await state.refresh();
            }}
          />
          <p className="ui-hint">{t('uncertain')}</p>
        </>
      )}
      {state.error === 'UNAUTHENTICATED' && (
        <Link
          href={routes.start}
          prefetch={false}
          onNavigate={state.clear}
          className="ui-button ui-button--primary"
        >
          {t('signIn')}
        </Link>
      )}
      {state.data && (
        <>
          {state.saved && (
            <p role="status" className={styles.notice}>
              {t('saved')}
            </p>
          )}
          <ul className={styles.list}>
            {state.data.groups.map((group) => (
              <li
                key={`${group.key}:${group.revision}`}
                data-admin-settings-group={group.key}
              >
                <Card title={t(`groups.${group.key}.title`)}>
                  <p>{t(`groups.${group.key}.description`)}</p>
                  <p>{t('revision', { revision: group.revision })}</p>
                  {group.updated_at && (
                    <p>{t('updatedAt', { date: date(group.updated_at) })}</p>
                  )}
                  {group.updated_by && (
                    <p>{t('updatedBy', { id: group.updated_by })}</p>
                  )}
                  {group.configured && group.values ? (
                    editing?.key === group.key &&
                    editing.epoch === state.epoch ? (
                      <SettingsEditor
                        group={group}
                        onCancel={() => setEditing(null)}
                        onSave={async (input) => {
                          setEditing(null);
                          state.dismissSaved();
                          const success = await state.mutate((signal) =>
                            saveAdminSettings(input, signal),
                          );
                          if (success) {
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      <>
                        <dl className={styles.details}>
                          {adminSettingsFields[group.key].map(({ key }) => (
                            <div key={key}>
                              <dt>{t(`fields.${key}`)}</dt>
                              <dd>{group.values?.[key]}</dd>
                            </div>
                          ))}
                        </dl>
                        {group.key === 'display' && group.revision === 0 && (
                          <p className="ui-hint">{t('displayCompatibility')}</p>
                        )}
                        <Button
                          onClick={() => {
                            setEditing({ key: group.key, epoch: state.epoch });
                            state.dismissSaved();
                          }}
                        >
                          {t('edit')}
                        </Button>
                      </>
                    )
                  ) : (
                    <p>{t('unconfigured')}</p>
                  )}
                  <Link
                    href={adminSettingsPolicyPath(`${group.key}-policy`)}
                    prefetch={false}
                    onNavigate={state.clear}
                    className="ui-button ui-button--secondary"
                  >
                    {t('groupPolicy')}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
          <section
            data-admin-settings-audit
            className={styles.stack}
            aria-label={t('auditTitle')}
          >
            <h2>{t('auditTitle')}</h2>
            <p className="ui-hint">{t('auditNote')}</p>
            {state.data.audit.length ? (
              <ul className={styles.audit}>
                {state.data.audit.map((entry) => (
                  <li key={entry.id} data-admin-settings-audit-id={entry.id}>
                    <Card
                      title={t('auditEntry', {
                        group: t(`groups.${entry.group_key}.title`),
                        revision: entry.revision,
                      })}
                    >
                      <p>
                        {t('auditSource', {
                          source: t(`sources.${entry.source}`),
                        })}
                      </p>
                      <p>
                        {entry.actor_id
                          ? t('updatedBy', { id: entry.actor_id })
                          : t('operatorIdentity')}
                      </p>
                      <p>{t('updatedAt', { date: date(entry.created_at) })}</p>
                      {entry.decision_reference && (
                        <p>
                          {t('decisionValue', { id: entry.decision_reference })}
                        </p>
                      )}
                      {entry.source === 'operator' &&
                        adminSettingsFields[entry.group_key].every(
                          ({ key }) =>
                            entry.before_value?.[key] ===
                            entry.after_value?.[key],
                        ) && <p>{t('auditProjectionOnly')}</p>}
                      <dl className={styles.changes}>
                        {adminSettingsFields[entry.group_key]
                          .filter(
                            ({ key }) =>
                              entry.before_value?.[key] !==
                              entry.after_value?.[key],
                          )
                          .map(({ key }) => (
                            <div key={key}>
                              <dt>{t(`fields.${key}`)}</dt>
                              <dd>
                                {t('changeValue', {
                                  before:
                                    entry.before_value?.[key] ??
                                    t('unsetValue'),
                                  after:
                                    entry.after_value?.[key] ?? t('unsetValue'),
                                })}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t('auditEmpty')}</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

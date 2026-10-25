'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import {
  adminSettingsFields,
  adminSettingsSaveSchema,
  type AdminSettingsGroup,
  type AdminSettingsSaveInput,
} from '@/config/admin-settings';
import styles from './admin-settings.module.css';

type Review = { values: Record<string, number>; decision_reference: string };
export function SettingsEditor({
  group,
  onSave,
  onCancel,
}: {
  group: AdminSettingsGroup;
  onSave: (input: AdminSettingsSaveInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const t = useTranslations('adminSettings');
  const initial = () =>
    Object.fromEntries(
      adminSettingsFields[group.key].map(({ key }) => [
        key,
        String(group.values?.[key] ?? ''),
      ]),
    );
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [decisionReference, setDecisionReference] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const [noChanges, setNoChanges] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationMissing, setConfirmationMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const fields = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => {
    if (review) reviewHeading.current?.focus();
  }, [review]);
  function reset() {
    setDraft(initial());
    setDecisionReference('');
    setInvalid([]);
    setNoChanges(false);
    setReview(null);
    setConfirmed(false);
    setConfirmationMissing(false);
  }
  function prepareReview() {
    const issues: string[] = [];
    const values: Record<string, number> = {};
    for (const field of adminSettingsFields[group.key]) {
      const raw = draft[field.key]?.trim() ?? '';
      const value = /^(0|[1-9][0-9]*)$/.test(raw) ? Number(raw) : NaN;
      if (
        !Number.isSafeInteger(value) ||
        value < field.min ||
        value > field.max
      )
        issues.push(field.key);
      values[field.key] = value;
    }
    const reference = decisionReference.trim();
    if (!z.uuid().safeParse(reference).success)
      issues.push('decision_reference');
    setInvalid(issues);
    if (issues[0]) fields.current[issues[0]]?.focus();
    const unchanged = Object.entries(values).every(
      ([key, value]) => group.values?.[key] === value,
    );
    setNoChanges(issues.length === 0 && unchanged);
    if (issues.length || unchanged || !group.configured || !group.values)
      return;
    setReview({ values, decision_reference: reference });
    setConfirmed(false);
    setConfirmationMissing(false);
  }
  async function save() {
    if (pending.current || !review) return;
    if (!confirmed) {
      setConfirmationMissing(true);
      return;
    }
    const parsed = adminSettingsSaveSchema.safeParse({
      group: group.key,
      operation_id: crypto.randomUUID(),
      expected_revision: group.revision,
      values: review.values,
      decision_reference: review.decision_reference,
      confirmed: true,
    });
    if (!parsed.success) {
      setInvalid(['form']);
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      await onSave(parsed.data);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      noValidate
      data-admin-settings-form={group.key}
      data-admin-settings-editor={group.key}
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        if (review) void save();
        else prepareReview();
      }}
    >
      <p className="ui-hint">{t(`groups.${group.key}.impact`)}</p>
      {review ? (
        <section
          data-admin-settings-review={group.key}
          className={styles.review}
          aria-label={t('reviewTitle')}
        >
          <h3 ref={reviewHeading} tabIndex={-1}>
            {t('reviewTitle')}
          </h3>
          <p>{t('reviewDescription')}</p>
          <dl className={styles.changes}>
            {adminSettingsFields[group.key]
              .filter(({ key }) => group.values?.[key] !== review.values[key])
              .map(({ key }) => (
                <div key={key}>
                  <dt>{t(`fields.${key}`)}</dt>
                  <dd>
                    {t('changeValue', {
                      before: group.values?.[key] ?? '',
                      after: review.values[key] ?? '',
                    })}
                  </dd>
                </div>
              ))}
          </dl>
          <p>{t('revision', { revision: group.revision })}</p>
          <p>{t('decisionValue', { id: review.decision_reference })}</p>
          <Checkbox
            label={t('confirm')}
            hint={t('confirmHint')}
            checked={confirmed}
            disabled={saving}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              setConfirmationMissing(false);
            }}
          />
          {confirmationMissing && (
            <p className="ui-error-text" role="alert">
              {t('confirmationMissing')}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit" isLoading={saving}>
              {t('save')}
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setReview(null);
                setConfirmed(false);
                setConfirmationMissing(false);
              }}
            >
              {t('backToEdit')}
            </Button>
            <Button variant="secondary" disabled={saving} onClick={onCancel}>
              {t('cancel')}
            </Button>
          </div>
        </section>
      ) : (
        <>
          <div className={styles.fields}>
            {adminSettingsFields[group.key].map(({ key, min, max }) => (
              <Input
                key={key}
                label={t(`fields.${key}`)}
                name={key}
                ref={(node) => {
                  fields.current[key] = node;
                }}
                value={draft[key] ?? ''}
                hint={t('integerBounds', { min, max })}
                {...(invalid.includes(key)
                  ? { error: t('invalidInteger', { min, max }) }
                  : {})}
                autoComplete="off"
                required
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }));
                  setInvalid((current) =>
                    current.filter((item) => item !== key),
                  );
                  setNoChanges(false);
                }}
              />
            ))}
          </div>
          <Input
            label={t('decisionReference')}
            name="decision_reference"
            ref={(node) => {
              fields.current.decision_reference = node;
            }}
            value={decisionReference}
            hint={t('decisionHint')}
            {...(invalid.includes('decision_reference')
              ? { error: t('invalidReference') }
              : {})}
            autoComplete="off"
            required
            onChange={(event) => {
              setDecisionReference(event.target.value);
              setInvalid((current) =>
                current.filter((item) => item !== 'decision_reference'),
              );
            }}
          />
          {noChanges && (
            <p className="ui-error-text" role="alert">
              {t('noChanges')}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit">{t('review')}</Button>
            <Button variant="secondary" onClick={reset}>
              {t('reset')}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              {t('cancel')}
            </Button>
          </div>
        </>
      )}
      {invalid.includes('form') && (
        <p className="ui-error-text" role="alert">
          {t('errors.INVALID_INPUT')}
        </p>
      )}
    </form>
  );
}

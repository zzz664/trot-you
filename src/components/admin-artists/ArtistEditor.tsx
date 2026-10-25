'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Checkbox, RadioGroup } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import {
  adminArtistInputSchema,
  adminArtistStatusSchema,
  adminArtistGradeSchema,
  type AdminArtistInput,
} from '@/config/admin-artists';
import styles from './admin-artists.module.css';

export function ArtistEditor({
  initial,
  create,
  onSave,
  onCancel,
}: {
  initial: AdminArtistInput;
  create: boolean;
  onSave: (input: AdminArtistInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const t = useTranslations('adminArtists');
  const [input, setInput] = useState<AdminArtistInput>(() => ({
    slug: initial.slug,
    name: initial.name,
    intro: initial.intro,
    status: initial.status,
    grade: initial.grade,
    agency_name: initial.agency_name,
    contract_started_at: initial.contract_started_at,
    contract_ended_at: initial.contract_ended_at,
    display_order: initial.display_order,
  }));
  const [displayOrder, setDisplayOrder] = useState(
    String(initial.display_order),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [invalid, setInvalid] = useState(false);
  function field<K extends keyof AdminArtistInput>(
    key: K,
    value: AdminArtistInput[K],
  ) {
    setInput((current) => ({ ...current, [key]: value }));
    setConfirmed(false);
    setInvalid(false);
  }
  async function save() {
    const parsed = adminArtistInputSchema.safeParse({
      ...input,
      display_order: /^\d+$/.test(displayOrder) ? Number(displayOrder) : NaN,
    });
    if (!parsed.success || !confirmed) {
      setInvalid(true);
      return;
    }
    await onSave(parsed.data);
  }
  return (
    <form
      data-admin-artist-form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Input
        label={t('name')}
        value={input.name}
        onChange={(event) => field('name', event.target.value)}
        required
        autoComplete="off"
      />
      <Input
        label={t('slug')}
        hint={t('slugHint')}
        value={input.slug}
        onChange={(event) => field('slug', event.target.value)}
        required
        autoComplete="off"
      />
      <Textarea
        label={t('intro')}
        value={input.intro ?? ''}
        onChange={(event) => field('intro', event.target.value || null)}
      />
      <RadioGroup
        label={t('statusLabel')}
        options={adminArtistStatusSchema.options.map((value) => ({
          value,
          label: t(`status.${value}`),
        }))}
        value={input.status}
        onChange={(value) => field('status', value)}
      />
      <p className="ui-hint">{t('statusNote')}</p>
      <Input
        label={t('sortOrder')}
        hint={t('sortOrderHint')}
        value={displayOrder}
        onChange={(event) => {
          setDisplayOrder(event.target.value);
          setConfirmed(false);
          setInvalid(false);
        }}
        required
      />
      <RadioGroup
        label={t('grade')}
        options={adminArtistGradeSchema.options.map((value) => ({
          value,
          label: t(value === 'B' ? 'gradeB' : 'gradeC'),
        }))}
        value={input.grade}
        onChange={(value) => field('grade', value)}
      />
      <Input
        label={t('agencyName')}
        value={input.agency_name ?? ''}
        onChange={(event) => field('agency_name', event.target.value || null)}
        autoComplete="off"
      />
      <Input
        label={t('contractStartedAt')}
        type="date"
        value={input.contract_started_at ?? ''}
        onChange={(event) =>
          field('contract_started_at', event.target.value || null)
        }
      />
      <Input
        label={t('contractEndedAt')}
        type="date"
        value={input.contract_ended_at ?? ''}
        onChange={(event) =>
          field('contract_ended_at', event.target.value || null)
        }
      />
      <p className="ui-hint">{t('contractNote')}</p>
      <Checkbox
        label={t('changeConfirm')}
        checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)}
      />
      {invalid && <p role="alert">{t('errors.INVALID_INPUT')}</p>}
      <div className={styles.actions}>
        <Button type="submit" disabled={!confirmed}>
          {t(create ? 'createSave' : 'save')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

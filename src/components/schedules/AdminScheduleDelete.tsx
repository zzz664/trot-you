'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import type {
  AdminSchedule,
  AdminScheduleDeleteInput,
  AdminScheduleDeleted,
  ScheduleResult,
} from '@/config/schedules';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { useDialog } from '@/components/ui/DialogProvider';
import styles from './schedules.module.css';
export function AdminScheduleDelete({
  event,
  busy,
  onDelete,
  pendingOperation,
}: {
  event: Pick<AdminSchedule, 'id' | 'revision'>;
  pendingOperation: RefObject<AdminScheduleDeleteInput | null>;
  busy: boolean;
  onDelete: (
    input: AdminScheduleDeleteInput,
  ) => Promise<ScheduleResult<AdminScheduleDeleted> | null>;
}) {
  const t = useTranslations('schedules');
  const { showDialog, cancelDialog } = useDialog();
  const [confirmed, setConfirmed] = useState(pendingOperation.current !== null);
  const [uncertain, setUncertain] = useState(pendingOperation.current !== null);
  const [conflict, setConflict] = useState(false);
  const operation = pendingOperation;
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelDialog('schedule-delete');
    };
  }, [cancelDialog]);
  async function remove() {
    if (running.current || busy || conflict || !confirmed) return;
    running.current = true;
    try {
      if (!operation.current) {
        const decision = await showDialog({
          key: 'schedule-delete',
          title: t('deleteDialogTitle'),
          description: t('deleteDialogDescription'),
          confirmLabel: t('deleteDialogConfirm'),
          cancelLabel: t('deleteDialogCancel'),
        });
        if (decision !== 'confirmed' || !mounted.current) return;
        operation.current = {
          operation_id: crypto.randomUUID(),
          schedule_id: event.id,
          expected_revision: event.revision,
          confirmed: true,
        };
      }
      const result = await onDelete(operation.current);
      if (!mounted.current || !result) return;
      if (!result.ok && result.code === 'UNAVAILABLE') setUncertain(true);
      else {
        operation.current = null;
        setUncertain(false);
        if (!result.ok) setConflict(result.code === 'CONFLICT');
      }
    } finally {
      running.current = false;
    }
  }
  return (
    <section
      className={`${styles.stack} ${styles.delete}`}
      data-testid="admin-schedule-delete"
    >
      <h2>{t('deleteTitle')}</h2>
      <p>{t('deleteDescription')}</p>
      <Checkbox
        label={t('deleteConfirm')}
        checked={confirmed}
        disabled={busy || uncertain || conflict}
        onChange={(e) => setConfirmed(e.target.checked)}
      />
      {uncertain && <p role="alert">{t('uncertain')}</p>}
      {conflict && <p>{t('conflictHint')}</p>}
      <Button
        disabled={busy || conflict || !confirmed}
        variant="secondary"
        onClick={() => void remove()}
      >
        {t(uncertain ? 'retryOperation' : 'deleteAction')}
      </Button>
    </section>
  );
}

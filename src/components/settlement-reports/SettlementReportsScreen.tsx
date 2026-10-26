'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  settlementReportQuerySchema,
  type SettlementReport,
  type SettlementReportEnvelope,
  type SettlementReportMode,
  type SettlementReportQuery,
} from '@/config/settlement-reports';
import { SETTLEMENT_CALCULATION } from '@/config/settlement-calculation';
import { routes, settlementReportsPath } from '@/config/routes';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { useSettlementReports } from './useSettlementReports';
import styles from './settlement-reports.module.css';

type Props = {
  actorKey: string;
  mode: SettlementReportMode;
  query: SettlementReportQuery | null;
  artistId: string;
  month: string;
  path: string;
};
export function SettlementReportsScreen(props: Props) {
  return (
    <SettlementReportsSession
      key={`${props.actorKey}:${props.mode}:${props.path}:${props.artistId}:${props.month}`}
      {...props}
    />
  );
}
function SettlementReportsSession({
  actorKey,
  mode,
  query,
  artistId,
  month,
  path,
}: Props) {
  const t = useTranslations('settlementReports');
  const router = useRouter();
  const state = useSettlementReports(actorKey, mode, query, path);
  const [selectedArtist, setSelectedArtist] = useState(artistId);
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [invalid, setInvalid] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const navigation = useRef(false);
  const actionClickSequence = useRef(false);
  const artist = mode === 'artist';
  return (
    <main
      className={`app-shell ${styles.screen}`}
      aria-busy={state.busy}
      onClickCapture={(event) => {
        if (actionClickSequence.current && event.detail > 1) {
          event.preventDefault();
          event.stopPropagation();
        } else if (event.detail <= 1) actionClickSequence.current = false;
      }}
    >
      <Link
        href={artist ? routes.artist : routes.admin}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
      <h1>{t(artist ? 'artistTitle' : 'title')}</h1>
      <p>{t(artist ? 'artistDescription' : 'description')}</p>
      <form
        className={styles.stack}
        aria-label={t('filterTitle')}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (navigation.current || state.busy) return;
          const parsed = settlementReportQuerySchema.safeParse({
            artistId: selectedArtist,
            month: selectedMonth,
          });
          if (!parsed.success) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          if (
            parsed.data.artistId === query?.artistId &&
            parsed.data.month === query.month
          )
            void state.refresh();
          else {
            navigation.current = true;
            setNavigating(true);
            state.clear();
            router.push(settlementReportsPath(parsed.data, artist));
          }
        }}
      >
        <h2>{t('filterTitle')}</h2>
        <Input
          label={t('artistId')}
          hint={t('artistIdHint')}
          value={selectedArtist}
          required
          autoComplete="off"
          disabled={state.busy || navigating}
          onChange={(event) => {
            setSelectedArtist(event.currentTarget.value);
            setInvalid(false);
            state.clear();
          }}
        />
        <Input
          label={t('month')}
          hint={t('monthHint')}
          type="date"
          value={selectedMonth}
          required
          disabled={state.busy || navigating}
          onChange={(event) => {
            setSelectedMonth(event.currentTarget.value);
            setInvalid(false);
            state.clear();
          }}
        />
        {invalid && (
          <p role="alert" className="ui-error-text">
            {t('formError')}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={state.busy || navigating}>
            {t('apply')}
          </Button>
          <Button
            variant="secondary"
            disabled={state.busy || navigating || !query}
            onClick={() => void state.refresh()}
          >
            {t('refresh')}
          </Button>
        </div>
      </form>
      {!query && <p>{t('selectFirst')}</p>}
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <>
          <InlineError
            message={t(`errors.${state.error}`)}
            onRetry={state.refresh}
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
        <div data-testid="settlement-report-content" className={styles.stack}>
          <h2>{state.data.artist.name}</h2>
          <p>{state.data.month}</p>
          <p>{t('privacy')}</p>
          {state.data.report ? (
            <ReportSnapshot
              key={`snapshot:${state.epoch}:${state.data.report.revision}`}
              data={state.data}
            />
          ) : (
            <p>{t(artist ? 'emptyArtist' : 'empty')}</p>
          )}
          {!artist && (
            <ReportActions
              key={`actions:${state.epoch}:${state.data.report?.revision ?? ''}`}
              report={state.data.report}
              onIntent={() => {
                actionClickSequence.current = true;
              }}
              busy={state.busy || navigating}
              onCalculate={async () => {
                actionClickSequence.current = true;
                await state.calculate();
              }}
              onConfirm={async () => {
                actionClickSequence.current = true;
                await state.confirm();
              }}
              onExport={async () => {
                actionClickSequence.current = true;
                await state.prepareExport();
              }}
            />
          )}
          {state.workbook && (
            <div className={styles.notice}>
              <p role="status">{t('exportReady')}</p>
              <Link
                href={state.workbook.url}
                download={state.workbook.filename}
                prefetch={false}
                className="ui-button ui-button--primary"
              >
                {t('download')}
              </Link>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
function ReportActions({
  report,
  busy,
  onCalculate,
  onConfirm,
  onExport,
  onIntent,
}: {
  report: SettlementReport | null;
  busy: boolean;
  onCalculate: () => Promise<void>;
  onConfirm: () => Promise<void>;
  onExport: () => Promise<void>;
  onIntent: () => void;
}) {
  const t = useTranslations('settlementReports');
  const [reviewing, setReviewing] = useState(false);
  const [checked, setChecked] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const confirmOnce = useRef(false);
  useEffect(() => {
    if (reviewing) heading.current?.focus();
  }, [reviewing]);
  return (
    <section className={styles.stack}>
      {report?.status !== 'confirmed' && (
        <Button disabled={busy || reviewing} onClick={() => void onCalculate()}>
          {t(report ? 'recalculate' : 'calculate')}
        </Button>
      )}
      {report?.status === 'draft' &&
        (reviewing ? (
          <section
            className={styles.notice}
            data-testid="settlement-report-review"
          >
            <h2 ref={heading} tabIndex={-1}>
              {t('reviewTitle')}
            </h2>
            <p>{t('reviewDescription')}</p>
            <dl className={styles.details}>
              <div>
                <dt>{t('revision')}</dt>
                <dd>{report.revision}</dd>
              </div>
              <div>
                <dt>{t('finalAmountKrw')}</dt>
                <dd>{report.finalAmountKrw}</dd>
              </div>
            </dl>
            <Checkbox
              label={t('reviewCheck')}
              checked={checked}
              disabled={busy}
              onChange={(event) => setChecked(event.currentTarget.checked)}
            />
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  onIntent();
                  setReviewing(false);
                  setChecked(false);
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                disabled={busy || !checked}
                onClick={() => {
                  if (!checked || busy || confirmOnce.current) return;
                  confirmOnce.current = true;
                  void onConfirm();
                }}
              >
                {t('confirm')}
              </Button>
            </div>
          </section>
        ) : (
          <Button
            disabled={busy}
            onClick={() => {
              onIntent();
              setReviewing(true);
              setChecked(false);
            }}
          >
            {t('review')}
          </Button>
        ))}
      {report && (
        <>
          <p>{t('exportHint')}</p>
          <p>{t('exportPrecision')}</p>
          <Button
            variant="secondary"
            disabled={busy || reviewing}
            onClick={() => void onExport()}
          >
            {t('export')}
          </Button>
        </>
      )}
    </section>
  );
}
function ReportSnapshot({ data }: { data: SettlementReportEnvelope }) {
  const t = useTranslations('settlementReports');
  const format = useFormatter();
  const report = data.report;
  if (!report) return null;
  const date = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: SETTLEMENT_CALCULATION.timeZone,
    });
  const financial = [
    ['grossKrw', null],
    ['currentGrossKrw', null],
    ['adjustmentGrossKrw', null],
    ['vatKrw', 'vat'],
    ['pgFeeKrw', 'pg_fee'],
    ['baseAmountKrw', 'base'],
    ['rate', null],
    ['activityRatio', 'activity_ratio'],
    ['deductionKrw', 'deduction'],
    ['unroundedFinalKrw', 'final'],
    ['finalAmountKrw', null],
  ] as const;
  const policy = report.policySnapshot;
  return (
    <div className={styles.stack} data-settlement-status={report.status}>
      <section className={styles.notice}>
        <h2>{t(report.status === 'confirmed' ? 'confirmed' : 'draft')}</h2>
        <p>{t(report.status === 'confirmed' ? 'locked' : 'draftWarning')}</p>
      </section>
      <Card title={t('summaryTitle')}>
        <p>{t('precisionHint')}</p>
        <dl className={styles.details}>
          <div>
            <dt>{t('reportId')}</dt>
            <dd>{report.id}</dd>
          </div>
          <div>
            <dt>{t('revision')}</dt>
            <dd>{report.revision}</dd>
          </div>
          <div>
            <dt>{t('calculatedAt')}</dt>
            <dd>{date(report.calculatedAt)}</dd>
          </div>
          {report.confirmedAt && (
            <div>
              <dt>{t('confirmedAt')}</dt>
              <dd>{date(report.confirmedAt)}</dd>
            </div>
          )}
          <div>
            <dt>{t('sourceEventCount')}</dt>
            <dd>{report.sourceEventCount}</dd>
          </div>
          <div>
            <dt>{t('sourceMessageCount')}</dt>
            <dd>{report.sourceMessageCount}</dd>
          </div>
          {financial.map(([key, exact]) => (
            <div key={key}>
              <dt>{t(key)}</dt>
              <dd data-settlement-value={key}>
                {report[key]}
                {exact && (
                  <p className={styles.exact}>
                    {t('exactFraction', {
                      numerator: report.exactComponents[exact][0],
                      denominator: report.exactComponents[exact][1],
                    })}
                  </p>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title={t('activityTitle')}>
        <ul className={styles.list}>
          {report.weeklyStats.map((week) => (
            <li key={week.weekStart}>
              <h3>{week.weekStart}</h3>
              <p>
                {t('weekWindow', {
                  from: week.windowStart,
                  to: week.windowEnd,
                })}
              </p>
              <p>{t('messageCount', { count: week.messageCount })}</p>
              <p>{t('photoCount', { count: week.photoCount })}</p>
              <p>{t('messageRequired', { count: week.messageRequired })}</p>
              <p>{t('photoRequired', { count: week.photoRequired })}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('policyTitle')}>
        <p>{t('policyHint')}</p>
        <p>
          {t('contractRange', {
            from: policy.contractFrom,
            to: policy.contractUntil,
          })}
        </p>
        <p>{t('performanceUnused')}</p>
        <dl className={styles.details}>
          {(['baseRate', 'vatRate', 'pgFeeRate'] as const).map((key) => (
            <div key={key}>
              <dt>{t(key)}</dt>
              <dd>{policy[key]}</dd>
            </div>
          ))}
          <div>
            <dt>{t('activityEnabled')}</dt>
            <dd>{t(policy.activityEnabled ? 'yes' : 'no')}</dd>
          </div>
          <div>
            <dt>{t('partialWeekPolicy')}</dt>
            <dd>{t(`partialWeeks.${policy.partialWeekPolicy}`)}</dd>
          </div>
          <div>
            <dt>{t('lateEventPolicy')}</dt>
            <dd>{t(`lateEvents.${policy.lateEventPolicy}`)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

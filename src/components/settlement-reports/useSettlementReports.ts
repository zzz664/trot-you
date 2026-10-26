'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  calculateSettlementReport,
  confirmSettlementReport,
  exportSettlementReport,
  fetchSettlementReport,
} from '@/client/settlement-reports';
import type {
  SettlementReportEnvelope,
  SettlementReportError,
  SettlementReportMode,
  SettlementReportQuery,
  SettlementReportResult,
} from '@/config/settlement-reports';
import { scheduleRouteMatches } from '@/lib/schedule-navigation';
export function useSettlementReports(
  actorKey: string,
  mode: SettlementReportMode,
  query: SettlementReportQuery | null,
  path: string,
) {
  const [data, setData] = useState<SettlementReportEnvelope | null>(null);
  const [error, setError] = useState<SettlementReportError | null>(null);
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [workbook, setWorkbook] = useState<{
    url: string;
    filename: string;
  } | null>(null);
  const workbookUrl = useRef<string | null>(null);
  const alive = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const matches = useCallback(
    () => scheduleRouteMatches(path, window.location.href),
    [path],
  );
  const visible = () => document.visibilityState !== 'hidden';
  const revokeWorkbook = useCallback(() => {
    if (workbookUrl.current) URL.revokeObjectURL(workbookUrl.current);
    workbookUrl.current = null;
  }, []);
  const clear = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    pending.current = false;
    revokeWorkbook();
    setWorkbook(null);
    setData(null);
    setError(null);
    setBusy(false);
    setEpoch(generation.current);
  }, [revokeWorkbook]);
  const accepts = useCallback(
    (value: SettlementReportEnvelope) =>
      value.actorId === actorKey &&
      value.actorRole === mode &&
      value.artist.id === query?.artistId &&
      value.month === query?.month &&
      value.sources === null &&
      (mode !== 'artist' || value.report?.status !== 'draft'),
    [actorKey, mode, query],
  );
  const run = useCallback(
    async (
      operation: (
        signal: AbortSignal,
      ) => Promise<SettlementReportResult<SettlementReportEnvelope>>,
      mutation = false,
    ) => {
      if (
        !alive.current ||
        !query ||
        !matches() ||
        !visible() ||
        (mutation && pending.current)
      )
        return;
      clear();
      const owner = generation.current;
      const request = new AbortController();
      controller.current = request;
      pending.current = true;
      setBusy(true);
      const current = () =>
        alive.current &&
        owner === generation.current &&
        !request.signal.aborted &&
        matches() &&
        visible();
      try {
        const result = await operation(request.signal);
        if (!current()) return;
        if (!result.ok) setError(result.code);
        else if (!accepts(result.data)) setError('FORBIDDEN');
        else setData(result.data);
      } catch {
        if (current()) setError('UNAVAILABLE');
      } finally {
        if (alive.current && owner === generation.current) {
          controller.current = null;
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [accepts, clear, matches, query],
  );
  const refresh = useCallback(async () => {
    if (!query) return;
    await run((signal) => fetchSettlementReport(query, mode, signal, actorKey));
  }, [actorKey, mode, query, run]);
  const calculate = useCallback(async () => {
    if (
      mode !== 'admin' ||
      !query ||
      !data ||
      data.report?.status === 'confirmed'
    )
      return;
    const input = { ...query, expectedRevision: data.report?.revision ?? null };
    await run(
      (signal) => calculateSettlementReport(input, signal, actorKey),
      true,
    );
  }, [actorKey, data, mode, query, run]);
  const confirm = useCallback(async () => {
    if (mode !== 'admin' || data?.report?.status !== 'draft') return;
    const input = {
      reportId: data.report.id,
      expectedRevision: data.report.revision,
    };
    await run(
      (signal) => confirmSettlementReport(input, signal, actorKey),
      true,
    );
  }, [actorKey, data, mode, run]);
  const prepareExport = useCallback(async () => {
    if (
      mode !== 'admin' ||
      !data?.report ||
      !alive.current ||
      !matches() ||
      !visible() ||
      pending.current
    )
      return;
    const snapshot = data;
    const input = {
      reportId: data.report.id,
      expectedRevision: data.report.revision,
    };
    clear();
    const owner = generation.current;
    const request = new AbortController();
    controller.current = request;
    pending.current = true;
    setBusy(true);
    const current = () =>
      alive.current &&
      owner === generation.current &&
      !request.signal.aborted &&
      matches() &&
      visible();
    try {
      const result = await exportSettlementReport(
        input,
        request.signal,
        actorKey,
      );
      if (!current()) return;
      if (!result.ok) setError(result.code);
      else {
        const url = URL.createObjectURL(result.data.blob);
        workbookUrl.current = url;
        setWorkbook({ url, filename: result.data.filename });
        setData(snapshot);
      }
    } catch {
      if (current()) setError('UNAVAILABLE');
    } finally {
      if (alive.current && owner === generation.current) {
        controller.current = null;
        pending.current = false;
        setBusy(false);
      }
    }
  }, [actorKey, clear, data, matches, mode]);
  useEffect(() => {
    alive.current = true;
    const owner = generation.current;
    queueMicrotask(() => {
      if (alive.current && owner === generation.current) void refresh();
    });
    const restore = () => {
      clear();
      if (matches()) void refresh();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) restore();
    };
    const visibility = () => {
      if (visible()) restore();
      else clear();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('popstate', restore);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      generation.current += 1;
      controller.current?.abort();
      revokeWorkbook();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('popstate', restore);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clear, matches, refresh, revokeWorkbook]);
  return {
    data,
    error,
    busy,
    epoch,
    workbook,
    clear,
    refresh,
    calculate,
    confirm,
    prepareExport,
  };
}

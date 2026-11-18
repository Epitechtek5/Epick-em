import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError } from '@/lib/api';
import {
  fileErrorKey,
  pickImportFile,
  type ImportFile,
} from '@/features/games/files';
import { tournamentErrorKey } from './errors';
import {
  applyTournamentImport,
  previewTournamentImport,
  type ImportPreview,
} from './import-preview';
import type { TournamentImportReport } from './types';

export type ImportStage =
  | 'file'
  | 'loading'
  | 'preview'
  | 'applying'
  | 'success'
  | 'expired'
  | 'stale'
  | 'unknown'
  | 'error';

// Mounted per authenticated account by TournamentTransferScreen. File bytes and
// preview identifiers never outlive that screen/session or reach persistent storage.
export function useImportPreview(token: string) {
  const [stage, setStage] = useState<ImportStage>('file');
  const [file, setFile] = useState<ImportFile | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<TournamentImportReport | null>(null);
  const operation = useRef<AbortController | null>(null);
  const submitted = useRef(false);
  const busy = stage === 'loading' || stage === 'applying';

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    if (stage !== 'preview' || !preview?.valid) return;
    const expire = () => {
      if (Date.now() >= expiresAt) {
        setConsent(false);
        setStage('expired');
      }
    };
    const timer = setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') expire();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [stage, expiresAt, preview?.valid]);

  async function analyze(choose: boolean) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const previousStage = stage;
    setStage('loading');
    try {
      const selected = choose ? await pickImportFile('tournaments') : file;
      if (controller.signal.aborted) return;
      if (!selected) {
        setStage(previousStage);
        return;
      }
      setFile(selected);
      setError('');
      setPreview(null);
      setReport(null);
      setConsent(false);
      submitted.current = false;
      // Start the local deadline before the request, conservatively accounting for transit time.
      const started = Date.now();
      const result = await previewTournamentImport(
        token,
        selected,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const deadline = started + (result.expires_in ?? 0) * 1000;
      setPreview(result);
      setExpiresAt(deadline);
      setStage(result.valid && deadline <= Date.now() ? 'expired' : 'preview');
    } catch (caught) {
      if (controller.signal.aborted) return;
      setPreview(null);
      if (choose && fileErrorKey(caught)) setFile(null);
      setError(fileErrorKey(caught) ?? tournamentErrorKey(caught));
      setStage('error');
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }

  async function confirm() {
    if (
      operation.current ||
      submitted.current ||
      stage !== 'preview' ||
      !preview?.valid ||
      !preview.preview_id ||
      preview.errors.length > 0 ||
      (preview.requires_confirmation && !consent)
    )
      return;
    if (Date.now() >= expiresAt) {
      setStage('expired');
      setConsent(false);
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    submitted.current = true;
    setStage('applying');
    setError('');
    try {
      const result = await applyTournamentImport(
        token,
        preview.preview_id,
        consent,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setReport(result);
      setPreview(null);
      setFile(null);
      setStage('success');
    } catch (caught) {
      if (controller.signal.aborted) return;
      setConsent(false);
      setPreview(null);
      if (
        caught instanceof ApiError &&
        caught.code === 'import_preview_stale'
      ) {
        setStage('stale');
      } else if (caught instanceof ApiError && caught.status === 410) {
        setStage('expired');
      } else if (
        caught instanceof ApiError &&
        caught.status >= 400 &&
        caught.status < 500
      ) {
        setError(tournamentErrorKey(caught));
        setStage('error');
      } else {
        // The server may have committed before the connection failed. Never replay
        // the confirmation or silently prepare a second potentially destructive import.
        setFile(null);
        setStage('unknown');
      }
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }

  function cancel() {
    if (operation.current) return;
    setPreview(null);
    setFile(null);
    setReport(null);
    setError('');
    setConsent(false);
    setStage('file');
  }

  return {
    stage,
    file,
    preview,
    report,
    error,
    busy,
    consent,
    setConsent,
    choose: () => analyze(true),
    refresh: () => analyze(false),
    confirm,
    cancel,
  };
}

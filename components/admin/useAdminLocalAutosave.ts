'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type FormEvent } from 'react';
import type { AdminFormValuesState } from '@/lib/admin/form-state';
import {
  createAdminLocalAutosave,
  EMPTY_LOCAL_AUTOSAVE_SNAPSHOT,
  type AdminLocalDraftScope,
} from '@/lib/admin/local-autosave';

type SaveResult = AdminFormValuesState & { message?: string; errors?: Record<string, unknown> };

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

/** Supply a stable, explicit allowlist of public catalog fields; never attach this to customer or account forms. */
export function useAdminLocalAutosave({ scope, fields, serverState }: {
  scope: AdminLocalDraftScope;
  fields: readonly string[];
  serverState: SaveResult;
}) {
  const { accountId, formId, recordId } = scope;
  const store = useMemo(() => createAdminLocalAutosave({
    scope: { accountId, formId, recordId }, fields, storage: browserStorage(),
  }), [accountId, formId, recordId, fields]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_LOCAL_AUTOSAVE_SNAPSHOT);
  const submission = useRef<{ store: typeof store; result: SaveResult } | null>(null);

  useEffect(() => {
    const submitted = submission.current;
    // A success left in useActionState from another record must never clear this record's draft.
    if (!submitted || submitted.result === serverState) return;
    submitted.store.completeSubmission(Boolean(serverState.message) && !serverState.errors);
    submission.current = null;
  }, [serverState]);

  const formRef = useCallback((form: HTMLFormElement | null, onCapture?: (data: FormData) => void) => {
    if (!form) return;
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    // Native events can reach this form before React's delegated change handler.
    // Read once after that event finishes, including the committed option hidden input.
    const capture = () => {
      if (captureTimer !== undefined) return;
      captureTimer = setTimeout(() => {
        captureTimer = undefined;
        const data = new FormData(form);
        store.capture(data);
        onCapture?.(data);
      }, 0);
    };
    const flush = () => {
      if (captureTimer !== undefined) {
        clearTimeout(captureTimer);
        captureTimer = undefined;
        store.capture(new FormData(form));
      }
      store.flush();
    };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    form.addEventListener('input', capture);
    form.addEventListener('change', capture);
    // Artwork upload commits a verified path to a hidden input without a native change event.
    const observer = new MutationObserver((changes) => {
      if (changes.some(({ target }) => target instanceof HTMLInputElement && target.type === 'hidden')) capture();
    });
    observer.observe(form, { attributes: true, attributeFilter: ['value'], subtree: true });
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    if (store.getSnapshot().restoredValues) {
      form.querySelector<HTMLElement>('input:not([type="hidden"]):not([readonly]), select, textarea')?.focus();
    }
    return () => {
      observer.disconnect();
      form.removeEventListener('input', capture);
      form.removeEventListener('change', capture);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
      flush();
    };
  }, [store]);

  const onSubmitCapture = useCallback((event: FormEvent<HTMLFormElement>) => {
    store.capture(new FormData(event.currentTarget));
    store.beginSubmission();
    submission.current = { store, result: serverState };
  }, [store, serverState]);

  return { snapshot, formRef, onSubmitCapture, restore: store.restore, discard: store.discard, scopeKey: store.key };
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type FormEvent } from 'react';
import type { AdminFormValuesState } from '@/lib/admin/form-state';
import { readAdminFormData } from '@/lib/admin/form-capture';
import {
  createAdminLocalAutosave,
  EMPTY_LOCAL_AUTOSAVE_SNAPSHOT,
  type AdminLocalDraftScope,
} from '@/lib/admin/local-autosave';

type SaveResult = AdminFormValuesState & { message?: string; errors?: Record<string, unknown> };
const NO_PASSIVE_FIELDS: readonly string[] = [];

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

/** Supply a stable, explicit allowlist of public catalog fields; never attach this to customer or account forms. */
export function useAdminLocalAutosave({ scope, fields, serverState, passiveInitializationFields = NO_PASSIVE_FIELDS }: {
  scope: AdminLocalDraftScope;
  fields: readonly string[];
  serverState: SaveResult;
  /** Hidden fields populated by a read on mount, without a user edit. Other hidden changes remain edits. */
  passiveInitializationFields?: readonly string[];
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
    let explicitEdit = false;
    const readForm = (notify = true) => {
      const data = readAdminFormData(form);
      if (!data) return;
      store.capture(data, { preserveRecovery: !explicitEdit });
      explicitEdit = false;
      if (notify) onCapture?.(data);
    };
    // Native events can reach this form before React's delegated change handler.
    // Read once after that event finishes, including the committed option hidden input.
    const scheduleCapture = (explicit: boolean) => {
      explicitEdit ||= explicit;
      if (captureTimer !== undefined) return;
      captureTimer = setTimeout(() => {
        captureTimer = undefined;
        readForm();
      }, 0);
    };
    const capture = () => scheduleCapture(true);
    const flush = () => {
      if (captureTimer !== undefined) {
        clearTimeout(captureTimer);
        captureTimer = undefined;
        readForm(false);
      }
      store.flush();
    };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    form.addEventListener('input', capture);
    form.addEventListener('change', capture);
    const externalFieldsets = new Set<Element>();
    for (let fieldset = form.closest('fieldset'); fieldset; fieldset = fieldset.parentElement?.closest('fieldset') ?? null) {
      externalFieldsets.add(fieldset);
    }
    // Only declared read-initialized fields are passive. Photo picks, option buttons and other hidden-only edits still capture.
    const observer = new MutationObserver((changes) => {
      const hidden = changes.map(({ target }) => target).filter((target): target is HTMLInputElement => target instanceof HTMLInputElement && target.type === 'hidden');
      if (hidden.length) scheduleCapture(!hidden.every(input => passiveInitializationFields.includes(input.name)));
      // Preserve both values and recovery while another workflow owns the lock.
      // Unlocking reads the complete, current DOM without inventing a user edit.
      if (changes.some(change => change.attributeName === 'disabled' && externalFieldsets.has(change.target as Element))) scheduleCapture(false);
    });
    observer.observe(form, { attributes: true, attributeFilter: ['value'], subtree: true });
    for (const fieldset of externalFieldsets) observer.observe(fieldset, { attributes: true, attributeFilter: ['disabled'] });
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
  }, [store, passiveInitializationFields]);

  const onSubmitCapture = useCallback((event: FormEvent<HTMLFormElement>) => {
    const data = readAdminFormData(event.currentTarget);
    if (!data) { event.preventDefault(); return; }
    store.capture(data);
    store.beginSubmission();
    submission.current = { store, result: serverState };
  }, [store, serverState]);

  const saveDraft = useCallback((form: HTMLFormElement) => {
    const data = readAdminFormData(form);
    if (!data) return false;
    store.capture(data);
    store.flush();
    return !store.getSnapshot().unavailable;
  }, [store]);

  return { snapshot, formRef, onSubmitCapture, saveDraft, restore: store.restore, discard: store.discard, scopeKey: store.key };
}

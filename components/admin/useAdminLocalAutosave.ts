'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type FormEvent } from 'react';
import type { AdminFormValuesState } from '@/lib/admin/form-state';
import { readAdminFormData } from '@/lib/admin/form-capture';
import {
  createAdminLocalAutosave,
  EMPTY_LOCAL_AUTOSAVE_SNAPSHOT,
  type AdminLocalDraftLinkedFields,
  type AdminLocalDraftScope,
} from '@/lib/admin/local-autosave';

type SaveResult = AdminFormValuesState & { message?: string; errors?: Record<string, unknown> };
const NO_PASSIVE_FIELDS: readonly string[] = [];

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

/** Supply a stable, explicit allowlist of public catalog fields; never attach this to customer or account forms. */
export function useAdminLocalAutosave({ scope, fields, serverState, passiveInitializationFields = NO_PASSIVE_FIELDS, ignoreEditsWithin, linkedFields }: {
  scope: AdminLocalDraftScope;
  fields: readonly string[];
  serverState: SaveResult;
  /** Hidden fields populated by a read on mount, without a user edit. Other hidden changes remain edits. */
  passiveInitializationFields?: readonly string[];
  /** 이 선택자 안의 입력은 사용자 수정으로 세지 않는다(복구 대상이 아닌 묶음). */
  ignoreEditsWithin?: string;
  /** 복구 안내가 떠 있는 동안 기준 칸을 고치면 이전 기록 대신 화면 값을 함께 쓸 칸. 모듈 상수로 넘긴다. */
  linkedFields?: AdminLocalDraftLinkedFields;
}) {
  const { accountId, formId, recordId } = scope;
  const store = useMemo(() => createAdminLocalAutosave({
    scope: { accountId, formId, recordId }, fields, storage: browserStorage(), linkedFields,
  }), [accountId, formId, recordId, fields, linkedFields]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_LOCAL_AUTOSAVE_SNAPSHOT);
  const submission = useRef<{ store: typeof store; result: SaveResult } | null>(null);
  const readScheduledInput = useRef<(() => void) | null>(null);

  useEffect(() => {
    const submitted = submission.current;
    // A success left in useActionState from another record must never clear this record's draft.
    if (!submitted || submitted.result === serverState) return;
    submitted.store.completeSubmission(Boolean(serverState.message) && !serverState.errors);
    submission.current = null;
  }, [serverState]);

  const formRef = useCallback((form: HTMLFormElement | null, onCapture?: (data: FormData) => void) => {
    if (!form) return;
    // 복구 안내가 떠 있으면 입력 전의 값을 잡아 둔다. 안내를 닫지 않고 고친 칸만 이전 기록에 합치는 기준이다.
    if (store.getSnapshot().recovery) {
      const entry = readAdminFormData(form);
      if (entry) store.setEditBaseline(entry);
    }
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
    /* 복구 대상이 아닌 입력(name 없는 칸 등)은 사용자 수정으로 세지 않는다. 복구 안내를 지우거나 유령 기록을 만들지 않는다. */
    const capture = (event: Event) => {
      if (ignoreEditsWithin && event.target instanceof Element && event.target.closest(ignoreEditsWithin)) return;
      scheduleCapture(true);
    };
    const readScheduled = () => {
      if (captureTimer === undefined) return;
      clearTimeout(captureTimer);
      captureTimer = undefined;
      readForm(false);
    };
    readScheduledInput.current = readScheduled;
    const flush = () => {
      readScheduled();
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
      if (readScheduledInput.current === readScheduled) readScheduledInput.current = null;
    };
  }, [store, passiveInitializationFields, ignoreEditsWithin]);

  const restore = useCallback(() => {
    // 입력 직후에 눌러도 그 입력이 합쳐지도록 예약된 읽기를 먼저 끝낸다. 남겨 두면 복구로 폼이 내려갈 때 옛 화면 값을 기록에 쓴다.
    readScheduledInput.current?.();
    store.restore();
  }, [store]);

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

  return { snapshot, formRef, onSubmitCapture, saveDraft, restore, discard: store.discard, discardRecovery: store.discardRecovery, scopeKey: store.key };
}

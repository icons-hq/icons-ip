import { preservedFormValues, type AdminFormValuesState } from './form-state';

/** Browser recovery is separate from a server draft. Only allowlisted catalog fields belong here. */
export const ADMIN_LOCAL_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 500;
const KEY_PREFIX = 'icons:admin:local-draft:v1:';
const MAX_STORED_LENGTH = 128 * 1024;
const SENSITIVE_FIELD = /password|passcode|secret|token|authorization|email|phone|mobile|address|recipient|customer|buyer|bankaccount|accountnumber|cardnumber|cvc|cvv|birth|resident|contact/i;

export interface AdminLocalDraftScope {
  accountId: string;
  formId: string;
  recordId: string | null;
}

export interface AdminLocalDraft {
  savedAt: number;
  values: Record<string, string>;
}

export interface AdminLocalAutosaveSnapshot {
  recovery: AdminLocalDraft | null;
  restoredValues: Record<string, string> | null;
  revision: number;
  unavailable: boolean;
}

export const EMPTY_LOCAL_AUTOSAVE_SNAPSHOT: AdminLocalAutosaveSnapshot = {
  recovery: null, restoredValues: null, revision: 0, unavailable: false,
};

export function localDraftKey(scope: AdminLocalDraftScope): string {
  return `${KEY_PREFIX}${JSON.stringify([scope.accountId, scope.formId, scope.recordId])}`;
}

export function withLocalRecoveryValues<T extends AdminFormValuesState>(
  state: T,
  recordId: string | null,
  restoredValues: Record<string, string> | null,
): T & AdminFormValuesState {
  if (!restoredValues || preservedFormValues(state, recordId)) return state;
  return { ...state, values: { ...restoredValues, previousId: recordId ?? '' } };
}

export function createAdminLocalAutosave({
  scope,
  fields,
  storage,
  now = Date.now,
}: {
  scope: AdminLocalDraftScope;
  fields: readonly string[];
  storage: (Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'length' | 'key'>>) | null;
  now?: () => number;
}) {
  const key = localDraftKey(scope);
  const allowed = new Set(fields.filter((field) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(field)
    && (!SENSITIVE_FIELD.test(field) || (scope.formId === 'good' && field === 'noticeAsContact')) && !Object.hasOwn(Object.prototype, field)));
  const availableStorage = scope.accountId && scope.formId ? storage : null;
  const listeners = new Set<() => void>();
  let snapshot: AdminLocalAutosaveSnapshot = { ...EMPTY_LOCAL_AUTOSAVE_SNAPSHOT, unavailable: !availableStorage };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Record<string, string> | null = null;
  let submitting = false;

  function update(change: Partial<AdminLocalAutosaveSnapshot>) {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  }

  function removeStored() {
    try { availableStorage?.removeItem(key); }
    catch { update({ unavailable: true }); }
  }

  function pickValues(entries: Iterable<readonly [string, unknown]>): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [name, value] of entries) {
      if (!allowed.has(name) || typeof value !== 'string' || Object.hasOwn(values, name)) continue;
      // Browser-only upload previews cannot be recovered after navigation. Persist the verified path instead.
      if (/^(blob:|data:)/i.test(value.trim())) continue;
      values[name] = value;
    }
    return values;
  }

  function read(): AdminLocalDraft | null {
    if (!availableStorage) return null;
    let raw: string | null;
    try { raw = availableStorage.getItem(key); }
    catch { update({ unavailable: true }); return null; }
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (raw.length > MAX_STORED_LENGTH || !parsed || typeof parsed !== 'object') throw new Error('Invalid draft');
      const draft = parsed as { version?: unknown; savedAt?: unknown; values?: unknown };
      if (draft.version !== 1 || typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt)
        || draft.savedAt > now() || now() - draft.savedAt >= ADMIN_LOCAL_DRAFT_TTL_MS
        || !draft.values || typeof draft.values !== 'object' || Array.isArray(draft.values)) throw new Error('Invalid draft');
      const values = pickValues(Object.entries(draft.values));
      if (!Object.keys(values).length) throw new Error('Empty draft');
      return { savedAt: draft.savedAt, values };
    } catch {
      removeStored();
      return null;
    }
  }

  // localStorage has no native expiry. Sweep our namespace on form entry, including older record/account keys.
  if (availableStorage?.key) {
    try {
      for (let index = (availableStorage.length ?? 0) - 1; index >= 0; index--) {
        const storedKey = availableStorage.key(index);
        if (!storedKey?.startsWith(KEY_PREFIX)) continue;
        let valid = false;
        try {
          const raw = availableStorage.getItem(storedKey);
          const draft = raw && raw.length <= MAX_STORED_LENGTH ? JSON.parse(raw) as Partial<AdminLocalDraft> | null : null;
          valid = typeof draft?.savedAt === 'number' && Number.isFinite(draft.savedAt)
            && draft.savedAt <= now() && now() - draft.savedAt < ADMIN_LOCAL_DRAFT_TTL_MS;
        } catch { /* Malformed drafts are removed just like expired ones. */ }
        if (!valid) availableStorage.removeItem(storedKey);
      }
    } catch { update({ unavailable: true }); }
  }
  snapshot.recovery = read();

  function flush() {
    clearTimeout(timer);
    if (!pending || !availableStorage) return;
    const serialized = JSON.stringify({ version: 1, savedAt: now(), values: pending });
    if (serialized.length > MAX_STORED_LENGTH) { update({ unavailable: true }); return; }
    try {
      availableStorage.setItem(key, serialized);
      pending = null;
      if (snapshot.unavailable) update({ unavailable: false });
    } catch { update({ unavailable: true }); }
  }

  function discard() {
    clearTimeout(timer);
    pending = null;
    removeStored();
    update({ recovery: null, restoredValues: null, revision: snapshot.revision + Number(snapshot.restoredValues !== null) });
  }

  return {
    key,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    capture(entries: Iterable<readonly [string, unknown]>) {
      pending = pickValues(entries);
      if (!Object.keys(pending).length) { pending = null; return; }
      // Starting a new edit dismisses an older recovery offer; it never replaces the current inputs.
      if (snapshot.recovery) update({ recovery: null });
      clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    },
    flush,
    restore() {
      const draft = read();
      update({ recovery: null, restoredValues: draft?.values ?? null, revision: snapshot.revision + 1 });
    },
    discard,
    beginSubmission() {
      submitting = true;
      flush();
    },
    completeSubmission(success: boolean) {
      if (!submitting) return;
      submitting = false;
      if (success) discard();
    },
  };
}

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

type FieldValues = Readonly<Record<string, string>>;

/** 기준 칸 → 그 칸을 고치면 이전 기록 대신 화면 값을 함께 쓸 칸. 따로 섞이면 서로 맞지 않는 칸을 묶는다. */
export type AdminLocalDraftLinkedFields = Readonly<Record<string, readonly string[]>>;

function changedFields(before: FieldValues, after: FieldValues): Set<string> {
  return new Set([...Object.keys(before), ...Object.keys(after)].filter((name) => before[name] !== after[name]));
}

function withFieldsFrom(target: FieldValues, names: Iterable<string>, source: FieldValues): Record<string, string> {
  const next = { ...target };
  for (const name of names) {
    if (Object.hasOwn(source, name)) next[name] = source[name];
    else delete next[name];
  }
  return next;
}

/**
 * 복구 안내가 떠 있는 동안의 입력을 이전 기록에 합친다. 화면에서 고친 칸만 얹으므로
 * 나머지 칸의 이전 입력은 남고, 복구를 먼저 누른 뒤 같은 칸을 고친 것과 결과가 같다.
 */
export function overlayLocalEdits(
  recovered: FieldValues,
  baseline: FieldValues,
  current: FieldValues,
  linkedFields: AdminLocalDraftLinkedFields = {},
): Record<string, string> {
  const changed = changedFields(baseline, current);
  for (const [leader, followers] of Object.entries(linkedFields)) {
    if (changed.has(leader)) followers.forEach((name) => changed.add(name));
  }
  return withFieldsFrom(recovered, changed, current);
}

/** 사람이 고치지 않은 변경(비동기 초기화·잠금 해제 재읽기)은 기준값을 함께 옮겨 입력으로 세지 않는다. */
export function rebaseLocalEditBaseline(baseline: FieldValues, previous: FieldValues, current: FieldValues): Record<string, string> {
  return withFieldsFrom(baseline, changedFields(previous, current), current);
}

export function createAdminLocalAutosave({
  scope,
  fields,
  storage,
  now = Date.now,
  linkedFields,
}: {
  scope: AdminLocalDraftScope;
  fields: readonly string[];
  storage: (Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'length' | 'key'>>) | null;
  now?: () => number;
  linkedFields?: AdminLocalDraftLinkedFields;
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
  let edited = false;
  /* 복구 안내가 떠 있는 동안만 쓴다. 입력 전의 폼 값과 마지막으로 읽은 폼 값. */
  let editBaseline: Record<string, string> | null = null;
  let lastRead: Record<string, string> | null = null;

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
    edited = false;
    editBaseline = lastRead = null;
    removeStored();
    update({ recovery: null, restoredValues: null, revision: snapshot.revision + Number(snapshot.restoredValues !== null) });
  }

  /** 안내가 떠 있으면 새 입력을 이전 기록에 합친 값을 돌려준다. 합칠 수 없으면 null이다. */
  function mergeIntoOffer(values: Record<string, string>): Record<string, string> | null {
    const { recovery } = snapshot;
    // 열어 둔 안내가 보관 기한을 넘겼으면 합치지 않는다. 합치면 만료된 입력이 새 저장 시각으로 되살아난다.
    if (!recovery || !editBaseline || now() - recovery.savedAt >= ADMIN_LOCAL_DRAFT_TTL_MS) return null;
    lastRead = values;
    return overlayLocalEdits(recovery.values, editBaseline, values, linkedFields);
  }

  return {
    key,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** 복구 안내가 떠 있을 때 입력 전의 폼 값을 잡아 둔다. 저장 실패로 폼이 다시 그려져도 처음 기준을 유지한다. */
    setEditBaseline(entries: Iterable<readonly [string, unknown]>) {
      if (!editBaseline) editBaseline = lastRead = pickValues(entries);
    },
    capture(entries: Iterable<readonly [string, unknown]>, options: { preserveRecovery?: boolean } = {}) {
      const values = pickValues(entries);
      // Async field initialization is not an edit. It must not replace a pending recovery offer with server defaults.
      if (options.preserveRecovery) {
        if (snapshot.recovery) {
          editBaseline = editBaseline && lastRead ? rebaseLocalEditBaseline(editBaseline, lastRead, values) : values;
          lastRead = values;
        }
        if (snapshot.recovery || !edited) return;
      }
      const merged = mergeIntoOffer(values);
      pending = merged ?? values;
      if (!Object.keys(pending).length) { pending = null; return; }
      edited = true;
      // 입력 전 값을 모르면(표 전체를 한 칸으로 보관하는 화면) 고친 칸을 가릴 수 없어 새 입력이 안내를 대신한다.
      if (snapshot.recovery && !merged) update({ recovery: null });
      clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    },
    flush,
    restore() {
      // 안내가 떠 있는 동안 친 입력이 아직 쓰이지 않았으면 먼저 기록에 합친다.
      flush();
      const draft = read();
      edited = Boolean(draft);
      editBaseline = lastRead = null;
      update({ recovery: null, restoredValues: draft?.values ?? null, revision: snapshot.revision + 1 });
    },
    discard,
    /** 복구 안내의 버리기. 이전 기록만 버리고, 안내가 떠 있는 동안 화면에서 고친 입력은 계속 보관한다. */
    discardRecovery() {
      const kept = editBaseline && lastRead && changedFields(editBaseline, lastRead).size ? lastRead : null;
      if (!kept || !Object.keys(kept).length) { discard(); return; }
      pending = kept;
      editBaseline = lastRead = null;
      update({ recovery: null });
      flush();
    },
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

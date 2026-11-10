import { isUuid } from '@/lib/uuid';
import { CS_REPLY_TEMPLATE_CATEGORIES, type CsReplySurface, type CsReplyTemplateCategory } from './cs-reply-tools';
import { parseInquiryTemplateMutation, type InquiryTemplateMutation } from './inquiry-reply-templates';
import { parseCsReplyOperation, type CsReplyOperation } from './cs-reply-mutations';

export const CS_EDITOR_DRAFT_PREFIX = 'icons:admin:cs-editor-draft:v1:';
export const CS_EDITOR_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const CS_TEMPLATE_DRAFT_LIMIT = 50;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// Several record dialogs can use the same shared-template workspace in one tab.
// An older closed editor must not later replace a newer editor's stored drafts.
const storageChanges = new Set<(key: string, origin: symbol) => void>();

export interface CsReplyDraft { body: string; sourceVersion: string; pending?: CsReplyOperation }
function replyDraft(value: unknown, limit: number): CsReplyDraft | null {
  if (!record(value) || typeof value.body !== 'string' || [...value.body].length > limit
    || typeof value.sourceVersion !== 'string' || value.sourceVersion.length > 300) return null;
  const pending = value.pending === undefined ? undefined : parseCsReplyOperation(value.pending);
  if (pending === null || (pending && (pending.body !== value.body.trim() || pending.surface !== (limit === 1000 ? 'review' : 'product_question')
    || value.sourceVersion !== `reply:${pending.expectedRevision}`))) return null;
  return { body: value.body, sourceVersion: value.sourceVersion, ...(pending ? { pending } : {}) };
}
export const parseQuestionReplyDraft = (value: unknown) => replyDraft(value, 2000);
export const parseReviewReplyDraft = (value: unknown) => replyDraft(value, 1000);

/** Only operator-authored text and revision markers are stored, never customer records. */
export interface CsTemplateDraft {
  id: string; category: CsReplyTemplateCategory; title: string; body: string; revision: number;
}
export type CsTemplatePending = { kind: 'inquiry'; operation: InquiryTemplateMutation }
  | { kind: 'public'; surface: CsReplySurface; draft: CsTemplateDraft };
export interface CsTemplateWorkspace {
  drafts: Record<string, CsTemplateDraft>; selected: string | null; pending: CsTemplatePending | null;
}
export const EMPTY_CS_TEMPLATE_WORKSPACE: CsTemplateWorkspace = { drafts: {}, selected: null, pending: null };

function templateDraft(value: unknown, surface: 'inquiry' | CsReplySurface): CsTemplateDraft | null {
  if (!record(value) || typeof value.id !== 'string' || !isUuid(value.id)
    || !CS_REPLY_TEMPLATE_CATEGORIES.some(option => option.value === value.category)
    || typeof value.title !== 'string' || typeof value.body !== 'string'
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return null;
  const titleLength = surface === 'inquiry' ? value.title.length : [...value.title].length;
  const bodyLength = surface === 'inquiry' ? value.body.length : [...value.body].length;
  if (titleLength > (surface === 'inquiry' ? 40 : 35) || bodyLength > (surface === 'review' ? 1000 : 2000)) return null;
  return { id: value.id, category: value.category as CsReplyTemplateCategory, title: value.title, body: value.body, revision: Number(value.revision) };
}
function templateWorkspace(value: unknown, surface: 'inquiry' | CsReplySurface): CsTemplateWorkspace | null {
  if (!record(value) || !record(value.drafts) || Object.keys(value.drafts).length > CS_TEMPLATE_DRAFT_LIMIT
    || (value.selected !== null && (typeof value.selected !== 'string' || !isUuid(value.selected)))) return null;
  const drafts: Record<string, CsTemplateDraft> = {};
  for (const [id, raw] of Object.entries(value.drafts)) {
    const draft = templateDraft(raw, surface);
    if (!draft || draft.id !== id) return null;
    drafts[id] = draft;
  }
  if (value.selected !== null && !drafts[value.selected as string]) return null;
  let pending: CsTemplatePending | null = null;
  if (value.pending !== null) {
    if (!record(value.pending)) return null;
    if (surface === 'inquiry' && value.pending.kind === 'inquiry') {
      const operation = parseInquiryTemplateMutation(value.pending.operation);
      if (!operation) return null;
      pending = { kind: 'inquiry', operation };
    } else if (surface !== 'inquiry' && value.pending.kind === 'public' && value.pending.surface === surface) {
      const draft = templateDraft(value.pending.draft, surface);
      if (!draft) return null;
      pending = { kind: 'public', surface, draft };
    } else return null;
  }
  return { drafts, selected: value.selected as string | null, pending };
}
export const parseInquiryTemplateWorkspace = (value: unknown) => templateWorkspace(value, 'inquiry');
export const parseQuestionTemplateWorkspace = (value: unknown) => templateWorkspace(value, 'product_question');
export const parseReviewTemplateWorkspace = (value: unknown) => templateWorkspace(value, 'review');

export interface CsEditorDraftSnapshot<T> {
  value: T | null; recovery: T | null; ready: boolean; blocked: boolean; unavailable: boolean; saved: boolean;
}
export function createCsEditorDraftStore<T>({ accountId, scope, recordId, storage, parse, retainUntilResolved, now = Date.now }: {
  accountId: string; scope: string; recordId: string; storage: StorageLike | null;
  parse: (value: unknown) => T | null; retainUntilResolved?: (value: T) => boolean; now?: () => number;
}) {
  const initial: CsEditorDraftSnapshot<T> = { value: null, recovery: null, ready: false, blocked: false, unavailable: false, saved: false };
  let snapshot = initial, key: string | null = null, session: string | null = null;
  const origin = Symbol('cs-editor-draft');
  const listeners = new Set<() => void>();
  function update(change: Partial<CsEditorDraftSnapshot<T>>) {
    snapshot = { ...snapshot, ...change }; listeners.forEach(listener => listener());
  }
  function remove(target: string) {
    try { storage?.removeItem(target); } catch { update({ unavailable: true }); }
  }
  function envelope(target: string): { value: unknown; savedAt: number } | null {
    try {
      const raw = storage?.getItem(target); if (!raw) return null;
      if (raw.length > 350000) throw new Error('invalid');
      const value: unknown = JSON.parse(raw);
      if (!record(value) || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)
        || value.savedAt > now() || (now() - value.savedAt >= CS_EDITOR_DRAFT_TTL_MS && value.retainUntilResolved !== true)) throw new Error('invalid');
      return { value: value.value, savedAt: value.savedAt };
    } catch { remove(target); return null; }
  }
  function read(target: string) {
    const raw = envelope(target); if (!raw) return null;
    const value = parse(raw.value); if (!value) remove(target); return value;
  }
  function sweep(activePrefix: string | null) {
    try {
      for (let index = (storage?.length ?? 0) - 1; index >= 0; index--) {
        const storedKey = storage?.key(index);
        if (!storedKey?.startsWith(CS_EDITOR_DRAFT_PREFIX)) continue;
        // Other editor scopes have their own parser; only their envelope is shared.
        if (!activePrefix || !storedKey.startsWith(activePrefix) || !envelope(storedKey)) remove(storedKey);
      }
    } catch { update({ unavailable: true }); }
  }
  function notifyOtherEditors() { if (key) storageChanges.forEach(notify => notify(key!, origin)); }
  function externalChange(changedKey: string, changedOrigin: symbol) {
    if (key !== changedKey || origin === changedOrigin || snapshot.blocked) return;
    update({ value: null, recovery: read(changedKey), saved: false });
  }
  return {
    getSnapshot: () => snapshot, getServerSnapshot: () => initial,
    isActive: () => snapshot.ready && !snapshot.blocked,
    subscribe(listener: () => void) {
      listeners.add(listener); storageChanges.add(externalChange);
      return () => { listeners.delete(listener); if (!listeners.size) storageChanges.delete(externalChange); };
    },
    authenticate(userId: string | null, sessionId: string | null) {
      if (!accountId || userId !== accountId || !sessionId || (session && session !== sessionId)) {
        sweep(null); key = null; update({ value: null, recovery: null, ready: true, blocked: true, saved: false }); return;
      }
      if (snapshot.blocked || session === sessionId) return;
      session = sessionId;
      const prefix = `${CS_EDITOR_DRAFT_PREFIX}${JSON.stringify([accountId, sessionId])}:`;
      sweep(prefix); key = `${prefix}${JSON.stringify([scope, recordId])}`;
      update({ ready: true, unavailable: !storage, recovery: read(key) });
    },
    change(input: T | null) {
      if (!snapshot.ready || snapshot.blocked) return false;
      const value = input === null ? null : parse(input); if (input !== null && value === null) return false;
      update({ value, recovery: null, saved: false });
      if (!key || !storage) return true;
      if (value === null) { remove(key); notifyOtherEditors(); return true; }
      try {
        const serialized = JSON.stringify({ value, savedAt: now(), ...(retainUntilResolved?.(value) ? { retainUntilResolved: true } : {}) });
        if (serialized.length > 350000) throw new Error('draft_storage_limit');
        storage.setItem(key, serialized); update({ saved: true, unavailable: false }); notifyOtherEditors();
      }
      catch { update({ unavailable: true }); }
      return true;
    },
    restore() {
      if (!key || snapshot.blocked) return null;
      const value = read(key); update({ value, recovery: null, saved: value !== null }); return value;
    },
    discard() {
      if (key) remove(key); update({ value: null, recovery: null, saved: false }); notifyOtherEditors();
    },
  };
}

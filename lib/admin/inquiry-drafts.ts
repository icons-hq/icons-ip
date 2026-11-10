import { MAX_INQUIRY_BODY_LENGTH } from '@/lib/inquiries';

/** Customer text never enters the catalog localStorage store. Recovery is tab/session scoped. */
export const INQUIRY_DRAFT_PREFIX = 'icons:admin:inquiry-draft:v1:';
export const INQUIRY_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export interface InquiryDraftSnapshot {
  body: string;
  recovery: string | null;
  ready: boolean;
  blocked: boolean;
  unavailable: boolean;
  saved: boolean;
}
export const EMPTY_INQUIRY_DRAFT: InquiryDraftSnapshot = {
  body: '', recovery: null, ready: false, blocked: false, unavailable: false, saved: false,
};

/** The session claim is only a local isolation key, never an authorization decision. */
export function inquiryDraftSessionId(accessToken: string): string | null {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: unknown };
    return typeof payload.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(payload.session_id) ? payload.session_id : null;
  } catch { return null; }
}

export function createInquiryDraftStore({ accountId, inquiryId, field, storage, now = Date.now }: {
  accountId: string; inquiryId: string; field: 'reply' | 'note'; storage: StorageLike | null; now?: () => number;
}) {
  let snapshot = { ...EMPTY_INQUIRY_DRAFT };
  let key: string | null = null;
  let session: string | null = null;
  const listeners = new Set<() => void>();
  function update(change: Partial<InquiryDraftSnapshot>) {
    snapshot = { ...snapshot, ...change };
    listeners.forEach((listener) => listener());
  }
  function remove(target: string) {
    try { storage?.removeItem(target); } catch { update({ unavailable: true }); }
  }
  function read(target: string): { body: string; savedAt: number } | null {
    try {
      const raw = storage?.getItem(target);
      if (!raw) return null;
      if (raw.length > 20000) throw new Error('invalid');
      const value = JSON.parse(raw) as { body?: unknown; savedAt?: unknown };
      if (typeof value.body !== 'string' || !value.body.trim() || [...value.body].length > MAX_INQUIRY_BODY_LENGTH
        || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || value.savedAt > now()
        || now() - value.savedAt >= INQUIRY_DRAFT_TTL_MS) throw new Error('invalid');
      return { body: value.body, savedAt: value.savedAt };
    } catch { remove(target); return null; }
  }
  function sweep(activePrefix: string | null) {
    try {
      for (let index = (storage?.length ?? 0) - 1; index >= 0; index--) {
        const storedKey = storage?.key(index);
        if (!storedKey?.startsWith(INQUIRY_DRAFT_PREFIX)) continue;
        if (!activePrefix || !storedKey.startsWith(activePrefix) || !read(storedKey)) remove(storedKey);
      }
    } catch { update({ unavailable: true }); }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    authenticate(userId: string | null, sessionId: string | null) {
      if (!accountId || userId !== accountId || !sessionId || (session && session !== sessionId)) {
        sweep(null); key = null;
        update({ body: '', recovery: null, ready: true, blocked: true, saved: false });
        return;
      }
      // A stale page cannot become active again after a sign-out or account/session switch.
      if (snapshot.blocked || session === sessionId) return;
      session = sessionId;
      const prefix = `${INQUIRY_DRAFT_PREFIX}${JSON.stringify([accountId, sessionId])}:`;
      sweep(prefix);
      key = `${prefix}${JSON.stringify([inquiryId, field])}`;
      update({ ready: true, unavailable: !storage, recovery: read(key)?.body ?? null });
    },
    change(body: string) {
      if (!snapshot.ready || snapshot.blocked) return;
      const value = [...body].slice(0, MAX_INQUIRY_BODY_LENGTH).join('');
      update({ body: value, recovery: null, saved: false });
      if (!key || !storage) return;
      if (!value.trim()) { remove(key); return; }
      try { storage.setItem(key, JSON.stringify({ body: value, savedAt: now() })); update({ saved: true, unavailable: false }); }
      catch { update({ unavailable: true }); }
    },
    restore() {
      if (!key || snapshot.blocked) return;
      const draft = read(key);
      update({ body: draft?.body ?? '', recovery: null, saved: !!draft });
    },
    discard() {
      if (key) remove(key);
      update({ body: '', recovery: null, saved: false });
    },
  };
}

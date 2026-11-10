import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInquiryDraftStore, INQUIRY_DRAFT_PREFIX } from './inquiry-drafts';
import { createCsEditorDraftStore, CS_EDITOR_DRAFT_PREFIX, parseReviewReplyDraft } from './cs-editor-drafts';
import { clearInquiryDraftsForSignOut, observeInquiryDraftSignOut, INQUIRY_DRAFT_SIGN_OUT_EVENT } from './inquiry-draft-lifecycle';

function tab() {
  const rows = new Map<string, string>();
  const sessionStorage = { get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); } };
  return Object.assign(new EventTarget(), { sessionStorage, localStorage: sessionStorage, rows });
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('inquiry draft logout lifecycle', () => {
  it('clears plaintext and freezes the editor before server-action logout without an SDK auth callback', () => {
    const window = tab(); vi.stubGlobal('window', window); vi.stubGlobal('BroadcastChannel', undefined);
    const store = createInquiryDraftStore({ accountId: 'actor', inquiryId: 'inquiry', field: 'reply', storage: window.sessionStorage });
    const publicReply = createCsEditorDraftStore({ accountId: 'actor', scope: 'review', recordId: 'review', storage: window.sessionStorage, parse: parseReviewReplyDraft });
    store.authenticate('actor', '11111111-1111-4111-8111-111111111111'); store.change('unsent sensitive text');
    publicReply.authenticate('actor', '11111111-1111-4111-8111-111111111111'); publicReply.change({ body: 'unsent review reply', sourceVersion: 'v1' });
    window.rows.set('unrelated', 'keep');
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, () => store.authenticate(null, null));
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, () => publicReply.authenticate(null, null));
    clearInquiryDraftsForSignOut();
    expect([...window.rows]).toEqual([['unrelated', 'keep']]);
    expect(store.getSnapshot()).toMatchObject({ body: '', blocked: true });
    expect(publicReply.getSnapshot()).toMatchObject({ value: null, blocked: true });
    store.change('late write'); expect(window.rows.size).toBe(1);
  });
  it('purges an idle tab on an origin-scoped broadcast carrying no identity or text', () => {
    const window = tab(); vi.stubGlobal('window', window);
    const listener = vi.fn();
    const close = vi.fn();
    vi.stubGlobal('BroadcastChannel', class {
      close = close;
      addEventListener = listener;
    });
    window.rows.set(`${INQUIRY_DRAFT_PREFIX}old`, 'customer draft'); window.rows.set(`${CS_EDITOR_DRAFT_PREFIX}old`, 'template draft'); window.rows.set('other', 'keep');
    const notify = vi.fn(); window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, notify);
    const cleanup = observeInquiryDraftSignOut();
    const receive = listener.mock.calls[0][1] as (event: { data: string }) => void;
    receive({ data: 'unrelated' }); expect(window.rows.size).toBe(3);
    receive({ data: 'signed-out' }); expect([...window.rows]).toEqual([['other', 'keep']]); expect(notify).toHaveBeenCalledOnce();
    cleanup(); expect(close).toHaveBeenCalledOnce();
  });
});

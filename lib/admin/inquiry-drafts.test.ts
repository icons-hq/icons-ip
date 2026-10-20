import { describe, expect, it } from 'vitest';
import { createInquiryDraftStore, INQUIRY_DRAFT_PREFIX, INQUIRY_DRAFT_TTL_MS, inquiryDraftSessionId } from './inquiry-drafts';

function storage() {
  const rows = new Map<string, string>();
  return { get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); }, rows };
}
const SESSION = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';
describe('private inquiry drafts', () => {
  it('requires an explicit recovery and isolates records and reply/note fields', () => {
    const tab = storage();
    const make = (inquiryId = 'a', field: 'reply' | 'note' = 'reply') => createInquiryDraftStore({ accountId: 'staff', inquiryId, field, storage: tab });
    const first = make(); first.authenticate('staff', SESSION); first.change('unsent reply');
    const second = make('b'); second.authenticate('staff', SESSION); expect(second.getSnapshot().recovery).toBeNull();
    const note = make('a', 'note'); note.authenticate('staff', SESSION); note.change('private note');
    const reload = make(); reload.authenticate('staff', SESSION);
    expect(reload.getSnapshot()).toMatchObject({ body: '', recovery: 'unsent reply' });
    reload.restore(); expect(reload.getSnapshot().body).toBe('unsent reply');
    reload.discard(); expect(tab.rows.size).toBe(1);
  });
  it('purges a different account or login session and never revives stale pages after auth changes', () => {
    const tab = storage();
    const old = createInquiryDraftStore({ accountId: 'staff', inquiryId: 'a', field: 'reply', storage: tab });
    old.authenticate('staff', SESSION); old.change('sensitive'); old.authenticate(null, null);
    expect(tab.rows.size).toBe(0); expect(old.getSnapshot()).toMatchObject({ body: '', blocked: true });
    old.authenticate('staff', SESSION); old.change('stale write'); expect(tab.rows.size).toBe(0);
    const active = createInquiryDraftStore({ accountId: 'staff', inquiryId: 'a', field: 'reply', storage: tab });
    active.authenticate('staff', SESSION); active.change('same account old login');
    const relogin = createInquiryDraftStore({ accountId: 'staff', inquiryId: 'a', field: 'reply', storage: tab });
    relogin.authenticate('staff', SESSION_B); expect(relogin.getSnapshot().recovery).toBeNull(); expect(tab.rows.size).toBe(0);
    relogin.change('new'); relogin.authenticate('other', SESSION_B); expect(tab.rows.size).toBe(0);
  });
  it('expires recovery even while the recovery banner remains open; sweeps malformed and older rows only in this namespace', () => {
    const tab = storage(); let now = 100;
    const make = () => createInquiryDraftStore({ accountId: 'staff', inquiryId: 'a', field: 'reply', storage: tab, now: () => now });
    const first = make(); first.authenticate('staff', SESSION); first.change('draft');
    const reload = make(); reload.authenticate('staff', SESSION);
    now += INQUIRY_DRAFT_TTL_MS; reload.restore(); expect(reload.getSnapshot().body).toBe('');
    tab.setItem(`${INQUIRY_DRAFT_PREFIX}malformed`, '{bad'); tab.setItem('unrelated', 'keep');
    make().authenticate('staff', SESSION); expect([...tab.rows.keys()]).toEqual(['unrelated']);
  });
  it('keeps editing usable when sessionStorage is unavailable and does not persist whitespace', () => {
    const store = createInquiryDraftStore({ accountId: 'staff', inquiryId: 'a', field: 'reply', storage: null });
    store.authenticate('staff', SESSION); store.change('not persisted');
    expect(store.getSnapshot()).toMatchObject({ body: 'not persisted', unavailable: true, saved: false });
    const tab = storage(); const second = createInquiryDraftStore({ accountId: 'staff', inquiryId: 'a', field: 'reply', storage: tab });
    second.authenticate('staff', SESSION); second.change('draft'); second.change('   '); expect(tab.rows.size).toBe(0);
  });
  it('extracts only a session identifier, rejecting missing/malformed tokens', () => {
    expect(inquiryDraftSessionId(`x.${btoa(JSON.stringify({ session_id: SESSION }))}.x`)).toBe(SESSION);
    expect(inquiryDraftSessionId('broken')).toBeNull(); expect(inquiryDraftSessionId('x.e30.x')).toBeNull();
  });
});

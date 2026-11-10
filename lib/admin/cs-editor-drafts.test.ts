import { describe, expect, it } from 'vitest';
import { createCsEditorDraftStore, CS_EDITOR_DRAFT_PREFIX, CS_EDITOR_DRAFT_TTL_MS, parseQuestionReplyDraft, parseReviewReplyDraft,
  parseInquiryTemplateWorkspace, parseQuestionTemplateWorkspace, parseReviewTemplateWorkspace } from './cs-editor-drafts';

function storage() {
  const rows = new Map<string, string>();
  return { get length() { return rows.size; }, key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); }, rows };
}
const session = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const reply = { body: '작성 중인 답변', sourceVersion: '[null,false]' };
const template = { id, category: 'shipping' as const, title: '배송 문구', body: '미저장 배송 안내', revision: 4 };

describe('CS editor draft recovery', () => {
  it('requires explicit recovery and separates record, reply surface, and template workspaces', () => {
    const tab = storage();
    const make = (scope = 'question', recordId = id) => createCsEditorDraftStore({ accountId: 'staff', scope, recordId, storage: tab, parse: parseQuestionReplyDraft });
    const first = make(); first.authenticate('staff', session); first.change(reply);
    const review = make('review'); review.authenticate('staff', session); expect(review.getSnapshot().recovery).toBeNull();
    const other = make('question', operationId); other.authenticate('staff', session); expect(other.getSnapshot().recovery).toBeNull();
    const templates = createCsEditorDraftStore({ accountId: 'staff', scope: 'templates', recordId: 'shared', storage: tab, parse: parseQuestionTemplateWorkspace });
    templates.authenticate('staff', session); templates.change({ drafts: { [id]: template }, selected: id, pending: null });
    const reload = make(); reload.authenticate('staff', session);
    expect(reload.getSnapshot()).toMatchObject({ value: null, recovery: reply });
    expect(tab.rows.size).toBe(2); // A reply parser must not sweep a template document.
    expect(reload.restore()).toEqual(reply); reload.discard(); expect(tab.rows.size).toBe(1);
  });
  it('clears account/session changes, locks stale editors and rejects later writes', () => {
    const tab = storage();
    const make = () => createCsEditorDraftStore({ accountId: 'staff', scope: 'review', recordId: id, storage: tab, parse: parseReviewReplyDraft });
    const first = make(); first.authenticate('staff', session); first.change(reply); first.authenticate('other', session);
    expect(first.getSnapshot()).toMatchObject({ value: null, recovery: null, blocked: true }); expect(tab.rows.size).toBe(0);
    first.authenticate('staff', session); expect(first.change(reply)).toBe(false);
    const second = make(); second.authenticate('staff', session); second.change(reply);
    const relogin = make(); relogin.authenticate('staff', operationId); expect(relogin.getSnapshot().recovery).toBeNull(); expect(tab.rows.size).toBe(0);
  });
  it('rechecks expiry at restore, rejects future/corrupt payloads, and preserves unrelated storage', () => {
    const tab = storage(); let now = 100;
    const make = () => createCsEditorDraftStore({ accountId: 'staff', scope: 'review', recordId: id, storage: tab, parse: parseReviewReplyDraft, now: () => now });
    const first = make(); first.authenticate('staff', session); first.change(reply);
    const reload = make(); reload.authenticate('staff', session); now += CS_EDITOR_DRAFT_TTL_MS;
    expect(reload.restore()).toBeNull(); expect(tab.rows.size).toBe(0);
    tab.setItem(`${CS_EDITOR_DRAFT_PREFIX}broken`, '{bad'); tab.setItem('unrelated', 'keep');
    make().authenticate('staff', session); expect([...tab.rows]).toEqual([['unrelated', 'keep']]);
    const fresh = make(); fresh.authenticate('staff', session); fresh.change(reply);
    const key = [...tab.rows.keys()].find(value => value.startsWith(CS_EDITOR_DRAFT_PREFIX))!;
    tab.setItem(key, JSON.stringify({ value: reply, savedAt: now + 1 }));
    make().authenticate('staff', session); expect(tab.getItem(key)).toBeNull();
  });
  it('keeps in-memory editing when storage is blocked and preserves deliberate empty reply edits', () => {
    const store = createCsEditorDraftStore({ accountId: 'staff', scope: 'review', recordId: id, storage: null, parse: parseReviewReplyDraft });
    store.authenticate('staff', session); expect(store.change(reply)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ value: reply, saved: false, unavailable: true });
    const tab = storage(); const first = createCsEditorDraftStore({ accountId: 'staff', scope: 'review', recordId: id, storage: tab, parse: parseReviewReplyDraft });
    first.authenticate('staff', session); first.change({ ...reply, body: '' });
    const reload = createCsEditorDraftStore({ accountId: 'staff', scope: 'review', recordId: id, storage: tab, parse: parseReviewReplyDraft });
    reload.authenticate('staff', session); expect(reload.restore()?.body).toBe('');
  });
  it('invalidates an older closed template editor when another record edits the same shared workspace', () => {
    const tab = storage();
    const make = () => createCsEditorDraftStore({ accountId: 'staff', scope: 'review-templates', recordId: 'shared', storage: tab, parse: parseReviewTemplateWorkspace });
    const first = make(), second = make(); first.authenticate('staff', session); second.authenticate('staff', session);
    const cleanups = [first.subscribe(() => {}), second.subscribe(() => {})];
    try {
      first.change({ drafts: { [id]: template }, selected: id, pending: null });
      expect(second.getSnapshot().recovery?.drafts[id]).toEqual(template);
      second.restore(); second.change({ drafts: { [id]: { ...template, body: '다른 상세에서 바꾼 문구' } }, selected: id, pending: null });
      expect(first.getSnapshot().value).toBeNull(); expect(first.getSnapshot().recovery?.drafts[id].body).toBe('다른 상세에서 바꾼 문구');
      second.discard(); expect(first.getSnapshot().recovery).toBeNull();
    } finally { cleanups.forEach(cleanup => cleanup()); }
  });
  it('preserves the exact pending inquiry operation across reload without copying customer data', () => {
    const tab = storage();
    const operation = { operationId, templateId: id, revision: 4, action: 'save' as const, values: { category: template.category, title: template.title, body: template.body } };
    const make = () => createCsEditorDraftStore({ accountId: 'staff', scope: 'inquiry-templates', recordId: 'shared', storage: tab, parse: parseInquiryTemplateWorkspace });
    const first = make(); first.authenticate('staff', session);
    first.change({ drafts: { [id]: template }, selected: id, pending: { kind: 'inquiry', operation } });
    const reload = make(); reload.authenticate('staff', session); expect(reload.restore()?.pending).toEqual({ kind: 'inquiry', operation });
    expect([...tab.rows.values()].join('')).not.toContain('access_token');
    expect(parseInquiryTemplateWorkspace({ drafts: { [id]: { ...template, customerEmail: 'discard@example.test' } }, selected: id, pending: null })?.drafts[id]).toEqual(template);
  });
  it('validates the original surface limits and rejects malformed cross-surface pending requests', () => {
    expect(parseReviewReplyDraft({ ...reply, body: '가'.repeat(1001) })).toBeNull();
    expect(parseQuestionReplyDraft({ ...reply, body: '가'.repeat(2000) })).not.toBeNull();
    expect(parseReviewTemplateWorkspace({ drafts: { [id]: { ...template, body: '가'.repeat(1001) } }, selected: id, pending: null })).toBeNull();
    expect(parseQuestionTemplateWorkspace({ drafts: { [id]: { ...template, title: '가'.repeat(36) } }, selected: id, pending: null })).toBeNull();
    expect(parseInquiryTemplateWorkspace({ drafts: { [id]: { ...template, title: '가'.repeat(40) } }, selected: id, pending: null })).not.toBeNull();
    expect(parseReviewTemplateWorkspace({ drafts: {}, selected: id, pending: null })).toBeNull();
    expect(parseReviewTemplateWorkspace({ drafts: {}, selected: null, pending: { kind: 'public', surface: 'product_question', draft: template } })).toBeNull();
  });
});

it('keeps unresolved operations beyond 24h even when another editor scope sweeps storage', () => {
  const tab = storage(); let now = 100;
  const pending = { body: '응답을 기다리는 답글', sourceVersion: 'reply:1', pending: { operationId, accountId: session, id, surface: 'review' as const, body: '응답을 기다리는 답글', expectedRevision: '1' } };
  const make = () => createCsEditorDraftStore({ accountId: session, scope: 'review', recordId: id, storage: tab, parse: parseReviewReplyDraft,
    retainUntilResolved: value => Boolean(value.pending), now: () => now });
  const first = make(); first.authenticate(session, session); first.change(pending);
  const regular = createCsEditorDraftStore({ accountId: session, scope: 'ordinary', recordId: id, storage: tab, parse: parseReviewReplyDraft, now: () => now });
  regular.authenticate(session, session); regular.change(reply);
  now += 2 * CS_EDITOR_DRAFT_TTL_MS;
  const other = createCsEditorDraftStore({ accountId: session, scope: 'template', recordId: 'shared', storage: tab, parse: parseReviewTemplateWorkspace, now: () => now });
  other.authenticate(session, session);
  expect(tab.rows.size).toBe(1);
  const reload = make(); reload.authenticate(session, session); expect(reload.restore()).toEqual(pending);
  reload.change({ body: pending.body, sourceVersion: pending.sourceVersion });
  now += CS_EDITOR_DRAFT_TTL_MS;
  expect(reload.restore()).toBeNull(); // Definitive resolution restores the ordinary draft TTL.
});
it('retention never survives account/session changes or reports oversized writes as saved', () => {
  const tab = storage();
  const make = () => createCsEditorDraftStore({ accountId: 'staff', scope: 'pending-only', recordId: id, storage: tab,
    parse: (value: unknown) => typeof value === 'string' ? value : null, retainUntilResolved: () => true });
  const first = make(); first.authenticate('staff', session); first.change('saved operation');
  first.change('x'.repeat(350000));
  expect(first.getSnapshot()).toMatchObject({ saved: false, unavailable: true });
  expect([...tab.rows.values()][0]).toContain('saved operation');
  first.authenticate('other', session); expect(tab.rows.size).toBe(0);
  const fresh = make(); fresh.authenticate('staff', session); fresh.change('saved operation');
  const changedSession = make(); changedSession.authenticate('staff', operationId);
  expect(tab.rows.size).toBe(0); expect(changedSession.getSnapshot().recovery).toBeNull();
});

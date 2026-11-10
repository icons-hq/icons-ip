import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: '', index: 0, frames: new Map<string, { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }>; jobs: (() => void)[] }>() }));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), customer: vi.fn(), unsubscribe: vi.fn(), callbacks: new Set<(event: string, session: { user: { id: string }; access_token: string } | null) => void>() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; if (!(i in f.values)) f.values[i] = typeof initial === 'function' ? initial() : initial; return [f.values[i], (next: unknown) => { f.values[i] = typeof next === 'function' ? next(f.values[i]) : next; }]; },
  useRef: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; return f.values[i] ??= { current: initial }; },
  useMemo: (work: () => unknown, deps: unknown[]) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, old = f.values[i] as { value: unknown; deps: unknown[] } | undefined; if (!old || deps.some((dep, n) => dep !== old.deps[n])) f.values[i] = { value: work(), deps }; return (f.values[i] as { value: unknown }).value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (work: () => void | (() => void), deps: unknown[] = []) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, old = f.effects.get(i); if (!old || deps.some((dep, n) => dep !== old.deps[n])) { f.effects.set(i, { deps, cleanup: old?.cleanup }); f.jobs.push(() => { old?.cleanup?.(); f.effects.get(i)!.cleanup = work() || undefined; }); } },
}));
vi.mock('@/lib/claim-contact/client', () => ({ fetchAdminClaimContactHistory: mocks.admin, fetchMyClaimContactHistory: mocks.customer }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: (event: string, session: { user: { id: string }; access_token: string } | null) => void) => {
  mocks.callbacks.add(callback); return { data: { subscription: { unsubscribe() { mocks.unsubscribe(); mocks.callbacks.delete(callback); } } } };
} } }) }));
import { ClaimContactHistory } from './ClaimContactHistory';
import { ClaimContactSession, CLAIM_CONTACT_JOURNAL_PREFIX, type ClaimContactIdentity, type ClaimContactScope } from './ClaimContactSession';
import { claimContactContractFixtures, CLAIM_CONTACT_FIXTURE_IDS as ids } from '@/lib/claim-contact/test-fixtures';
import { claimContactError, type ClaimContactJournal, type HistoryResponse } from '@/lib/claim-contact/contracts';

type Element = ReactElement<Record<string, unknown>>;
let nodes: Element[], storage: Map<string, string>, tree: ReactNode;
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const visibleText = () => nodes.filter(node => typeof node.type === 'string').map(node => text(node)).join(' ');
const memory = () => JSON.stringify([...hooks.frames.values()].map(frame => frame.values));
function render() {
  nodes = []; const seen = new Set<string>();
  function visit(node: ReactNode, path: string) { Children.toArray(node).forEach((value, index) => {
    if (!isValidElement<Record<string, unknown>>(value)) return;
    const key = `${path}/${index}:${typeof value.type === 'function' ? value.type.name : String(value.type)}:${String(value.key ?? '')}`;
    if (typeof value.type === 'function') { seen.add(key); if (!hooks.frames.has(key)) hooks.frames.set(key, { values: [], effects: new Map(), jobs: [] }); hooks.current = key; hooks.index = 0; visit((value.type as (props: unknown) => ReactNode)(value.props), key); }
    else { nodes.push(value); visit(value.props.children as ReactNode, key); }
  }); }
  visit(tree, 'root');
  for (const [key, frame] of hooks.frames) if (!seen.has(key)) { for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.delete(key); }
}
function effects() { for (const frame of hooks.frames.values()) for (const effect of frame.jobs.splice(0)) effect(); }
async function flush() { for (let i = 0; i < 6; i++) { await Promise.resolve(); render(); effects(); } }
function authenticate(actor = ids.actor as string, session = ids.session as string) { mocks.callbacks.forEach(callback => callback('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` })); }
function click(label: string) { render(); const button = nodes.find(node => node.type === 'button' && text(node) === label); expect(button, label).toBeDefined(); expect(button!.props.disabled, label).not.toBe(true); (button!.props.onClick as () => void)(); }
function dispose() { for (const frame of hooks.frames.values()) for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.clear(); nodes = []; }
function page(operator = false): HistoryResponse {
  const f = claimContactContractFixtures();
  return { ...f.HistoryResponse, viewerKind: operator ? 'operator' : 'buyer', entries: [{ ...f.HistoryEntry, actorId: operator ? ids.actor : null, agreement: operator ? '내부 합의 원문' : null }] };
}
function reply(value: HistoryResponse) { return async (input: { requestId: string }) => ({ ...value, requestId: input.requestId }); }
function journal(): ClaimContactJournal { return { operationId: ids.operation, orderId: ids.order, claimId: ids.claim, command: 'change', target: 'collection', expectedClaimType: 'exchange', expectedClaimRevision: 3, actorId: ids.actor, sessionId: ids.session, startedAt: '2026-10-14T00:00:00Z' }; }
async function mount(operator = false) { tree = <ClaimContactHistory actorId={ids.actor} orderId={ids.order} claimId={ids.claim} operator={operator} />; render(); effects(); authenticate(); await flush(); }
const deferred = () => { let resolve!: (value: HistoryResponse) => void; const promise = new Promise<HistoryResponse>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(async () => {
  vi.clearAllMocks(); hooks.frames.clear(); mocks.callbacks.clear(); nodes = []; storage = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), key: (index: number) => [...storage.keys()][index] ?? null, get length() { return storage.size; } });
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  mocks.customer.mockImplementation(reply(page())); mocks.admin.mockImplementation(reply(page(true))); await mount();
});
afterEach(() => { dispose(); vi.unstubAllGlobals(); });

describe('session isolation and metadata journal lifecycle', () => {
  it('retains only current-session metadata on initial auth and does not erase recovery on a normal unmount', async () => {
    dispose(); storage.set(`${CLAIM_CONTACT_JOURNAL_PREFIX}current`, JSON.stringify(journal()));
    storage.set(`${CLAIM_CONTACT_JOURNAL_PREFIX}other`, JSON.stringify({ ...journal(), sessionId: ids.order }));
    storage.set(`${CLAIM_CONTACT_JOURNAL_PREFIX}raw`, JSON.stringify({ ...journal(), contact: 'forbidden' })); storage.set('unrelated', 'keep');
    await mount(); expect([...storage.keys()]).toEqual([`${CLAIM_CONTACT_JOURNAL_PREFIX}current`, 'unrelated']);
    dispose(); expect(storage.has(`${CLAIM_CONTACT_JOURNAL_PREFIX}current`)).toBe(true);
  });
  it.each(['actor', 'session', 'signout', 'scope'])('blocks old tickets, clears only contact journals and destroys private child state after %s loss', async mode => {
    dispose(); let currentScope!: ClaimContactScope, currentIdentity!: ClaimContactIdentity;
    function PrivateChild() { const [secret] = useState('private contact in child'); return <p>{secret}</p>; }
    tree = <ClaimContactSession actorId={ids.actor}>{(identity, scope) => { currentScope = scope; currentIdentity = identity; return <PrivateChild />; }}</ClaimContactSession>;
    render(); effects(); authenticate(); await flush();
    expect(currentIdentity).toEqual({ actorId: ids.actor, sessionId: ids.session }); const ticket = currentScope.capture()!;
    storage.set(`${CLAIM_CONTACT_JOURNAL_PREFIX}pending`, JSON.stringify(journal())); storage.set('unrelated', 'keep');
    if (mode === 'actor') authenticate(ids.order); else if (mode === 'session') authenticate(ids.actor, ids.order);
    else if (mode === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out')); else currentScope.authenticate(null, null);
    expect(currentScope.canApply(ticket)).toBe(false); expect(storage.has(`${CLAIM_CONTACT_JOURNAL_PREFIX}pending`)).toBe(false);
    await flush(); expect(memory()).not.toContain('private contact in child'); expect(storage.get('unrelated')).toBe('keep');
    authenticate(); await flush(); expect(visibleText()).toContain('로그인 계정 또는 세션이 바뀌었습니다.');
  });
  it('same-session token refresh keeps an in-flight ticket usable', async () => {
    dispose(); let currentScope!: ClaimContactScope;
    tree = <ClaimContactSession actorId={ids.actor}>{(_identity, scope) => { currentScope = scope; return <p>ready</p>; }}</ClaimContactSession>;
    render(); effects(); authenticate(); await flush(); const ticket = currentScope.capture()!;
    authenticate(); await flush(); expect(currentScope.canApply(ticket)).toBe(true);
  });
});

describe('explicit contact history read and privacy', () => {
  it('does no raw read until the button, sends identity bindings and distinguishes original reference/address history', async () => {
    expect(mocks.customer).not.toHaveBeenCalled(); expect(memory()).not.toContain('테스트 수령인');
    click('연락처 변경 이력 확인'); await flush();
    expect(mocks.customer).toHaveBeenCalledTimes(1); expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.customer.mock.calls[0][0]).toMatchObject({ orderId: ids.order, claimId: ids.claim, limit: 20, cursor: null });
    expect(mocks.customer.mock.calls[0][1]).toMatchObject({ expectedIdentity: { actorId: ids.actor, sessionId: ids.session } });
    expect(visibleText()).toContain('원주문 배송정보 · 참고용'); expect(visibleText()).toContain('변경 수령인');
    expect(visibleText()).not.toContain(ids.actor); expect(visibleText()).not.toContain('고객 합의 기록'); expect(storage.size).toBe(0);
  });
  it('operator history shows internal agreement only through the admin endpoint', async () => {
    dispose(); await mount(true); click('연락처 변경 이력 확인'); await flush();
    expect(mocks.admin).toHaveBeenCalledOnce(); expect(mocks.customer).not.toHaveBeenCalled();
    expect(visibleText()).toContain('고객 합의 기록: 내부 합의 원문'); expect(visibleText()).toContain('교환 상품 수령 연락처');
  });
  it.each(['close', 'visibility', 'actor', 'session', 'signout', 'unmount'])('discards displayed PII from memory after %s', async mode => {
    click('연락처 변경 이력 확인'); await flush(); expect(memory()).toContain('테스트 수령인');
    if (mode === 'close') click('연락처 이력 닫기');
    else if (mode === 'visibility') { Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
    else if (mode === 'actor') authenticate(ids.order); else if (mode === 'session') authenticate(ids.actor, ids.order);
    else if (mode === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out')); else dispose();
    if (mode !== 'unmount') await flush(); expect(memory()).not.toContain('테스트 수령인'); expect(memory()).not.toContain('변경 수령인'); expect(storage.size).toBe(0);
  });
  it.each(['close', 'visibility', 'auth', 'scope-change'])('drops a late response after %s rather than repopulating private state', async mode => {
    const wait = deferred(); mocks.customer.mockReturnValueOnce(wait.promise); click('연락처 변경 이력 확인'); await flush();
    const requestId = mocks.customer.mock.calls[0][0].requestId;
    if (mode === 'close') click('연락처 이력 닫기');
    else if (mode === 'visibility') { Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
    else if (mode === 'auth') authenticate(ids.order);
    else { tree = <ClaimContactHistory actorId={ids.actor} orderId={ids.order} claimId={ids.order} />; render(); effects(); }
    wait.resolve({ ...page(), requestId }); await flush(); expect(memory()).not.toContain('테스트 수령인'); expect(visibleText()).not.toContain('변경 수령인');
    expect(mocks.customer.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('deduplicates overlapping pages and clears already loaded addresses when the next page is retention_due', async () => {
    click('연락처 변경 이력 확인'); await flush(); const first = mocks.customer.mock.calls[0][0];
    const next = page(); next.entries = [next.entries[0], { ...next.entries[0], operationId: ids.order, recordedAt: '2026-10-13T00:00:00Z' }]; next.nextCursor = null;
    mocks.customer.mockImplementationOnce(reply(next)); click('이전 변경 내역 더 보기'); await flush();
    expect(mocks.customer.mock.calls[1][0].cursor).toEqual(page().nextCursor); expect(mocks.customer.mock.calls[1][0].requestId).not.toBe(first.requestId);
    expect(nodes.filter(node => node.type === 'li')).toHaveLength(2);
    click('최신 이력 다시 확인'); await flush();
    const due = page(); due.current.collection = { ...due.current.collection, piiState: 'unavailable', unavailableReason: 'retention_due', sourceKind: null, referenceOnly: false, address: null };
    due.current.reshipment = { ...due.current.collection, target: 'reshipment' }; due.entries = []; due.nextCursor = null;
    due.reshipmentDestination = { ...due.reshipmentDestination, piiState: 'unavailable', unavailableReason: 'retention_due', address: null };
    mocks.customer.mockImplementationOnce(reply(due)); click('이전 변경 내역 더 보기'); await flush();
    expect(memory()).not.toContain('테스트 수령인'); expect(visibleText()).toContain('보관기간이 지나 연락처를 표시하지 않습니다.'); expect(visibleText()).not.toContain('연락처 정보가 삭제');
  });
  it('keeps gift-sender facts, purged states and legacy unconfirmed destinations distinct', async () => {
    const sender = page(); sender.viewerKind = 'gift_sender'; sender.piiAccess = false;
    sender.current.collection = { ...sender.current.collection, piiState: 'restricted', address: null, sourceKind: null, referenceOnly: false };
    sender.current.reshipment = { ...sender.current.collection, target: 'reshipment' };
    sender.entries = [{ ...sender.entries[0], piiState: 'purged', before: null, after: null }];
    sender.reshipmentDestination = { source: 'legacy_unconfirmed', operationId: null, recordedAt: null, piiState: 'unavailable', unavailableReason: 'source_unavailable', address: null };
    mocks.customer.mockImplementationOnce(reply(sender)); click('연락처 변경 이력 확인'); await flush();
    expect(visibleText()).toContain('변경 일시와 항목만'); expect(visibleText()).toContain('연락처 정보가 삭제'); expect(visibleText()).toContain('기존 재출고 기록에는 수령 연락처 확인 내역이 없습니다.');
    expect(memory()).not.toContain('테스트 수령인'); expect(visibleText()).not.toContain(ids.actor);
  });
  it('rejects cross-scope responses and propagates an auth error into the session privacy boundary', async () => {
    mocks.customer.mockImplementationOnce(async ({ requestId }: { requestId: string }) => ({ ...page(), requestId, claimId: ids.order }));
    click('연락처 변경 이력 확인'); await flush(); expect(memory()).not.toContain('테스트 수령인'); expect(visibleText()).toContain('현재 요청과 다른 이력');
    storage.set(`${CLAIM_CONTACT_JOURNAL_PREFIX}pending`, JSON.stringify(journal())); mocks.customer.mockResolvedValueOnce(claimContactError('auth_changed'));
    click('최신 이력 다시 확인'); await flush(); expect(visibleText()).toContain('로그인 계정 또는 세션이 바뀌었습니다.'); expect(storage.size).toBe(0);
  });
});

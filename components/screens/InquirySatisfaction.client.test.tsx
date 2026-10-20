import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: '', index: 0, frames: new Map<string, { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }>; jobs: (() => void)[] }>() }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), refresh: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useTransition: () => [false, (work: () => unknown) => { void work(); }],
  useState: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; if (!(i in f.values)) f.values[i] = typeof initial === 'function' ? initial() : initial; return [f.values[i], (next: unknown) => { f.values[i] = typeof next === 'function' ? next(f.values[i]) : next; }]; },
  useRef: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; return f.values[i] ??= { current: initial }; },
  useMemo: (work: () => unknown, deps: unknown[]) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, saved = f.values[i] as { value: unknown; deps: unknown[] } | undefined; if (!saved || deps.some((dep, n) => dep !== saved.deps[n])) f.values[i] = { value: work(), deps }; return (f.values[i] as { value: unknown }).value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (work: () => void | (() => void), deps: unknown[] = []) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, old = f.effects.get(i); if (!old || deps.some((dep, n) => dep !== old.deps[n])) { f.effects.set(i, { deps, cleanup: old?.cleanup }); f.jobs.push(() => { old?.cleanup?.(); f.effects.get(i)!.cleanup = work() || undefined; }); } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/my/inquiries/satisfaction-actions', () => ({ setInquirySatisfactionAction: mocks.save, readInquirySatisfactionOperationAction: mocks.read }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { InquirySatisfaction } from './InquirySatisfaction';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import type { InquirySatisfactionRequest, MyInquirySatisfaction } from '@/lib/inquiry-satisfaction';
import { satisfactionCompleted as completed, satisfactionCurrent as base, satisfactionIds as ids } from '@/test/fixtures/inquiry-satisfaction';
type Element = ReactElement<Record<string, unknown>>;
let nodes: Element[], storage: Map<string, string>, current: MyInquirySatisfaction;
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
function render() {
  nodes = []; const seen = new Set<string>();
  function visit(node: ReactNode, path: string) { Children.toArray(node).forEach(value => {
    if (!isValidElement<Record<string, unknown>>(value)) return;
    const key = `${path}/${String(value.key ?? '')}`;
    if (typeof value.type === 'function') { seen.add(key); if (!hooks.frames.has(key)) hooks.frames.set(key, { values: [], effects: new Map(), jobs: [] }); hooks.current = key; hooks.index = 0; visit((value.type as (props: unknown) => ReactNode)(value.props), key); }
    else { nodes.push(value); visit(value.props.children as ReactNode, key); }
  }); }
  visit(<InquirySatisfaction result={{ ok: true, value: current }} />, 'root');
  for (const [key, frame] of hooks.frames) if (!seen.has(key)) { for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.delete(key); }
}
function effects() { for (const frame of hooks.frames.values()) for (const effect of frame.jobs.splice(0)) effect(); }
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); effects(); } }
function authenticate(session = ids.session, actor = ids.actor) { mocks.auth?.('TOKEN_REFRESHED', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
function choose(label: '만족' | '불만족') {
  render(); const parent = nodes.find(node => node.type === 'label' && text(node).trim() === label)!;
  const input = Children.toArray(parent.props.children as ReactNode).find(value => isValidElement(value) && value.type === 'input') as Element;
  (input.props.onChange as () => void)();
}
function button(label: string) { render(); return nodes.find(node => node.type === 'button' && text(node) === label)!; }
function click(label: string) { const found = button(label); expect(found).toBeDefined(); expect(found.props.disabled).not.toBe(true); (found.props.onClick as () => void)(); }
function dispose() { for (const frame of hooks.frames.values()) for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.clear(); }
function success(request: InquirySatisfactionRequest) { return { ok: true, value: { ...completed, receipt: { ...completed.receipt, ...request, afterValue: request.desiredValue } } }; }
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(async () => {
  vi.resetAllMocks(); hooks.frames.clear(); current = { ...base }; storage = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('window', new EventTarget());
  mocks.save.mockResolvedValue({ ok: false, kind: 'unknown', error: '응답 유실' });
  mocks.read.mockResolvedValue({ ok: true, value: { operation: 'unresolved', receipt: null, current } });
  render(); effects(); authenticate(); await flush();
});
afterEach(() => { dispose(); vi.unstubAllGlobals(); });

it('a double click sends one operation and an unknown result locks desire while retry preserves every field', async () => {
  choose('만족'); const callback = button('평가 저장').props.onClick as () => void; callback(); callback(); await flush();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  const frozen = structuredClone(mocks.save.mock.calls[0][0]);
  expect(JSON.parse([...storage.values()][0])).toEqual(frozen); expect(Object.keys(frozen).sort()).toEqual(['operationId', 'inquiryId', 'expectedActorId', 'expectedSessionId', 'expectedAnswerId', 'expectedRevision', 'desiredValue'].sort());
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
  choose('불만족'); click('같은 요청 다시 보내기'); await flush();
  expect(mocks.save.mock.calls[1][0]).toEqual(frozen);
});
it('same-session token refresh keeps an in-flight operation valid; a historical receipt renders current new-answer state', async () => {
  const wait = deferred(); mocks.save.mockReturnValue(wait.promise); choose('만족'); click('평가 저장'); authenticate();
  const frozen = mocks.save.mock.calls[0][0] as InquirySatisfactionRequest;
  wait.resolve({ ok: true, value: { ...success(frozen).value, current: { ...base, answerId: ids.newAnswer, revision: 2 } } }); await flush();
  expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(storage.size).toBe(0);
  expect(nodes.some(node => text(node).includes('이전 답변에 대한 평가 결과'))).toBe(true);
  expect(nodes.some(node => text(node).includes('현재 평가: 미평가'))).toBe(true);
  expect(button('평가 저장').props.disabled).toBe(true);
});
it.each(['signout', 'session', 'actor'])('identity %s invalidates delayed success and deletes only this pending key', async mode => {
  storage.set('unrelated-inquiry-draft', 'keep');
  const wait = deferred(); mocks.save.mockReturnValue(wait.promise); choose('만족'); click('평가 저장');
  const frozen = mocks.save.mock.calls[0][0] as InquirySatisfactionRequest;
  if (mode === 'signout') window.dispatchEvent(new Event(INQUIRY_DRAFT_SIGN_OUT_EVENT));
  else authenticate(mode === 'session' ? ids.newSession : ids.session, mode === 'actor' ? ids.newAnswer : ids.actor);
  wait.resolve(success(frozen)); await flush();
  expect(mocks.refresh).not.toHaveBeenCalled(); expect(storage.get('unrelated-inquiry-draft')).toBe('keep'); expect(storage.size).toBe(1);
  expect(nodes.some(node => text(node).includes('평가 결과를 확인했습니다.'))).toBe(false);
});
it('new staff replies clear an unsubmitted selection; a same-answer revision update uses server current value', async () => {
  choose('만족'); current = { ...base, answerId: ids.newAnswer, revision: 1 }; await flush();
  expect(button('평가 저장').props.disabled).toBe(true); expect(mocks.save).not.toHaveBeenCalled();
  current = { ...current, value: 'dissatisfied', ratedAt: '2026-10-15T03:00:00Z', revision: 2 }; await flush();
  click('평가 철회'); await flush();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ expectedAnswerId: ids.newAnswer, expectedRevision: 2, desiredValue: null });
});
it('reload restores only the same identity request and never automatically sends it', async () => {
  choose('만족'); click('평가 저장'); await flush(); const frozen = structuredClone(mocks.save.mock.calls[0][0]);
  dispose(); mocks.save.mockClear(); render(); effects(); authenticate(); await flush();
  expect(mocks.save).not.toHaveBeenCalled(); expect(button('평가 저장').props.disabled).toBe(true);
  click('저장 결과 확인'); await flush(); expect(mocks.read).toHaveBeenCalledExactlyOnceWith(frozen);
  expect(storage.size).toBe(1);
});
it('suspension after an unknown write retains the operation for read-only receipt recovery', async () => {
  choose('만족'); click('평가 저장'); await flush();
  mocks.save.mockResolvedValue({ ok: false, kind: 'unavailable', error: '현재 계정으로 쓰기 불가' });
  click('같은 요청 다시 보내기'); await flush();
  expect(storage.size).toBe(1); expect(button('저장 결과 확인')).toBeDefined();
});

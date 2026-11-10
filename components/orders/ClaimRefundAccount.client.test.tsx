import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: '', index: 0, frames: new Map<string, { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }>; jobs: (() => void)[] }>() }));
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), read: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  startTransition: (work: () => unknown) => { void work(); },
  useState: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; if (!(i in f.values)) f.values[i] = typeof initial === 'function' ? initial() : initial; return [f.values[i], (next: unknown) => { f.values[i] = typeof next === 'function' ? next(f.values[i]) : next; }]; },
  useRef: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; return f.values[i] ??= { current: initial }; },
  useMemo: (work: () => unknown, deps: unknown[]) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, saved = f.values[i] as { value: unknown; deps: unknown[] } | undefined; if (!saved || deps.some((dep, n) => dep !== saved.deps[n])) f.values[i] = { value: work(), deps }; return (f.values[i] as { value: unknown }).value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (work: () => void | (() => void), deps: unknown[] = []) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, old = f.effects.get(i); if (!old || deps.some((dep, n) => dep !== old.deps[n])) { f.effects.set(i, { deps, cleanup: old?.cleanup }); f.jobs.push(() => { old?.cleanup?.(); f.effects.get(i)!.cleanup = work() || undefined; }); } },
}));
vi.mock('@/app/orders/claim-refund-account-actions', () => ({ loadClaimRefundAccountAction: mocks.load, saveClaimRefundAccountAction: mocks.save, readClaimRefundAccountAction: mocks.read }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { ClaimRefundAccount } from './ClaimRefundAccount';
import { refundAccountIdentity as identity, refundAccountRequest as request, refundAccountContext as context, refundAccountReceipt as receipt } from '@/test/fixtures/claim-refund-account';
import { claimRefundAccountRecoveryKey, claimRefundAccountRequestMetadata } from '@/lib/orders/claim-refund-account';
type Element = ReactElement<Record<string, unknown>>;
let nodes: Element[], storage: Map<string, string>;
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
function render() {
  nodes = []; const seen = new Set<string>();
  function visit(node: ReactNode, path: string) { Children.toArray(node).forEach(value => {
    if (!isValidElement<Record<string, unknown>>(value)) return;
    const key = `${path}/${String(value.key ?? '')}`;
    if (typeof value.type === 'function') { seen.add(key); if (!hooks.frames.has(key)) hooks.frames.set(key, { values: [], effects: new Map(), jobs: [] }); hooks.current = key; hooks.index = 0; visit((value.type as (props: unknown) => ReactNode)(value.props), key); }
    else { nodes.push(value); visit(value.props.children as ReactNode, key); }
  }); }
  visit(<ClaimRefundAccount actorId={identity.actorId} orderId={identity.orderId} claimId={identity.claimId} />, 'root');
  for (const [key, frame] of hooks.frames) if (!seen.has(key)) { for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.delete(key); }
}
function effects() { for (const frame of hooks.frames.values()) for (const effect of frame.jobs.splice(0)) effect(); }
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); effects(); } }
function authenticate(actor = identity.actorId, session = identity.sessionId) { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
function change(label: string, value: string) {
  render(); const parent = nodes.find(node => node.type === 'label' && text(node).startsWith(label))!;
  const control = Children.toArray(parent.props.children as ReactNode).find(value => isValidElement(value) && value.type === 'input') as Element;
  (control.props.onChange as (event: unknown) => void)({ target: { value } });
}
function fill() { change('은행', request.account.bankName); change('계좌번호', request.account.accountNumber); change('예금주', request.account.accountHolder); }
function click(label: string) { render(); const button = nodes.find(node => node.type === 'button' && text(node) === label); expect(button).toBeDefined(); expect(button!.props.disabled).not.toBe(true); (button!.props.onClick as () => void)(); }
function submit() { render(); const callback = nodes.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void; callback({ preventDefault() {} }); return callback; }
function dispose() { for (const frame of hooks.frames.values()) for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.clear(); }
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(async () => {
  hooks.frames.clear(); vi.clearAllMocks(); storage = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), key: (index: number) => [...storage.keys()][index] ?? null, get length() { return storage.size; } });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => false) })); vi.stubGlobal('document', new EventTarget());
  mocks.load.mockResolvedValue({ context }); mocks.save.mockResolvedValue({ error: '응답 유실', uncertain: true }); mocks.read.mockResolvedValue({ receipt: null });
  render(); effects(); authenticate(); await flush();
});
afterEach(() => { dispose(); vi.unstubAllGlobals(); });

it('연속 제출은 하나의 요청이며 계좌 원문은 브라우저 저장소에 남기지 않는다', async () => {
  fill(); const callback = submit(); callback({ preventDefault() {} }); await flush();
  expect(mocks.save).toHaveBeenCalledTimes(1); expect(storage.size).toBe(1);
  const metadata = JSON.parse([...storage.values()][0]);
  expect(Object.keys(metadata).sort()).toEqual(['actorId', 'claimId', 'operationId', 'orderId', 'revision', 'sessionId', 'version']);
  expect(JSON.stringify(metadata)).not.toContain(request.account.accountNumber);
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it('불확실 응답은 원 요청을 고정하고 재시도 뒤 확정 오류여도 확인 전에는 잠근다', async () => {
  fill(); submit(); await flush(); const original = structuredClone(mocks.save.mock.calls[0][0]);
  change('계좌번호', '999999999999'); mocks.save.mockResolvedValueOnce({ error: '최신 상태 필요', conflict: true });
  click('같은 내용으로 다시 저장'); await flush(); expect(mocks.save.mock.calls[1][0]).toEqual(original);
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true); expect(storage.size).toBe(1);
  mocks.read.mockResolvedValueOnce({ receipt: { ...receipt, operationId: original.operationId } });
  mocks.load.mockResolvedValue({ context: { ...context, revision: 2, allowed: false, blocker: 'refund_account_already_recorded', maskedAccount: '합성은행 ****1234', maskedHolder: '합***', recordedAt: receipt.createdAt } });
  click('이전 저장 결과 확인'); await flush(); expect(storage.size).toBe(0);
  expect(nodes.some(node => node.type === 'form')).toBe(false); expect(nodes.some(node => text(node).includes('환불계좌를 등록했습니다'))).toBe(true);
  expect(JSON.stringify([...hooks.frames.values()].map(frame => frame.values))).not.toContain(request.account.accountNumber);
});
it('새로고침은 원문 없이 같은 작업을 조회하고 봉인한 뒤 새 입력을 연다', async () => {
  fill(); submit(); await flush(); const original = mocks.save.mock.calls[0][0]; dispose(); render(); effects(); authenticate(); await flush();
  expect(nodes.some(node => node.type === 'button' && text(node) === '같은 내용으로 다시 저장')).toBe(false);
  click('이전 저장 결과 확인'); await flush(); expect(mocks.read.mock.calls[0][0].operationId).toBe(original.operationId);
  expect(mocks.save).toHaveBeenCalledTimes(1); expect(JSON.stringify(mocks.read.mock.calls)).not.toContain(request.account.accountNumber);
  mocks.read.mockResolvedValueOnce({ receipt: { ...receipt, operationId: original.operationId, state: 'sealed', resultRevision: 1 } });
  click('미저장 요청 종료 후 새로 입력'); await flush(); expect(mocks.read.mock.calls[1][1]).toBe(true); expect(storage.size).toBe(0);
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
});
it.each(['actor', 'session', 'signout'])('%s 변경 후 원문과 복구 요청을 지우고 늦은 응답을 적용하지 않는다', async kind => {
  const pending = deferred(); mocks.save.mockReturnValueOnce(pending.promise); fill(); submit(); await flush();
  if (kind === 'actor') authenticate(request.operationId); else if (kind === 'session') authenticate(identity.actorId, request.operationId); else window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  pending.resolve({ receipt }); await flush(); expect(storage.size).toBe(0); expect(nodes.some(node => node.type === 'form')).toBe(false);
  expect(JSON.stringify([...hooks.frames.values()].map(frame => frame.values))).not.toContain(request.account.accountNumber);
});
it('다른 세션의 저장 요청을 가져오지 않으며 조회 실패 뒤 다시 확인할 수 있다', async () => {
  const metadata = claimRefundAccountRequestMetadata(request); storage.set(claimRefundAccountRecoveryKey(identity), JSON.stringify(metadata));
  dispose(); mocks.load.mockRejectedValueOnce(new Error('offline')); render(); effects(); authenticate(identity.actorId, request.operationId); await flush();
  expect(mocks.read).not.toHaveBeenCalled(); expect(nodes.some(node => text(node).includes('최신 요청 상태를 읽지 못했습니다'))).toBe(true);
  click('최신 요청 상태 확인'); await flush(); expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
});

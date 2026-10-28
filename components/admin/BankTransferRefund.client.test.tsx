import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: '', index: 0, frames: new Map<string, { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }>; jobs: (() => void)[] }>() }));
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), read: vi.fn(), view: vi.fn(), refresh: vi.fn(), showModal: vi.fn(),
  auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  startTransition: (work: () => unknown) => { void work(); },
  useState: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; if (!(i in f.values)) f.values[i] = typeof initial === 'function' ? initial() : initial; return [f.values[i], (next: unknown) => { f.values[i] = typeof next === 'function' ? next(f.values[i]) : next; }]; },
  useRef: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; return f.values[i] ??= { current: initial }; },
  useMemo: (work: () => unknown, deps: unknown[]) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, old = f.values[i] as { value: unknown; deps: unknown[] } | undefined; if (!old || deps.some((dep, n) => dep !== old.deps[n])) f.values[i] = { value: work(), deps }; return (f.values[i] as { value: unknown }).value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (work: () => void | (() => void), deps: unknown[] = []) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, old = f.effects.get(i); if (!old || deps.some((dep, n) => dep !== old.deps[n])) { f.effects.set(i, { deps, cleanup: old?.cleanup }); f.jobs.push(() => { old?.cleanup?.(); f.effects.get(i)!.cleanup = work() || undefined; }); } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/bank-transfer-refund-actions', () => ({ loadBankRefundContextAction: mocks.load, recordBankRefundAction: mocks.save, readBankRefundAction: mocks.read }));
const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/screens/ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
vi.mock('@/lib/admin/bank-transfer-refund-account', () => ({ requestBankRefundAccount: mocks.view }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { BankTransferRefund } from './BankTransferRefund';
import { BANK_REFUND_LABELS, bankRefundRecoveryKey, type BankRefundContext, type BankRefundKind, type BankRefundRecovery, type BankRefundRequest } from '@/lib/admin/bank-transfer-refund';

const identity = { actorId: 'b1920000-0000-4000-8000-000000000001', sessionId: 'b1920000-0000-4000-8000-000000000002',
  orderId: 'b1920000-0000-4000-8000-000000000003', claimId: 'b1920000-0000-4000-8000-000000000004' };
const other = 'b1920000-0000-4000-8000-000000000099';
const NOW = '2026-10-14T06:03:25.456Z', FILED = '2026-10-14T06:03:20.123Z';
const evidence = '합성 송금 참조값', note = '합성 처리 메모';
const context: BankRefundContext = { actorId: identity.actorId, orderId: identity.orderId, claimId: identity.claimId, claimType: 'return', revision: 7,
  amount: 12000, stage: 'processing', phase: 'awaiting_transfer', gift: true, filedAt: FILED, confirmedAt: FILED, transferredAt: null,
  confirmationNotBefore: FILED, transferNotBefore: FILED, maskedAccount: '123-****-890', maskedHolder: '합**',
  confirmBlocker: 'bank_refund_already_confirmed', fileBlocker: 'bank_refund_already_filed', completeBlocker: null, viewBlocker: null };
const rawAccount = { bankName: '합성은행', accountNumber: '123-4567-890', accountHolder: '합성예금주' };
type Element = ReactElement<Record<string, unknown>>;
let nodes: Element[], storage: Map<string, string>;
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const memory = () => JSON.stringify([...hooks.frames.values()].map(frame => frame.values));
function render() {
  nodes = []; const seen = new Set<string>();
  function visit(node: ReactNode, path: string) { Children.toArray(node).forEach(value => {
    if (!isValidElement<Record<string, unknown>>(value)) return;
    const key = `${path}/${String(value.key ?? '')}`;
    if (typeof value.type === 'function') { seen.add(key); if (!hooks.frames.has(key)) hooks.frames.set(key, { values: [], effects: new Map(), jobs: [] }); hooks.current = key; hooks.index = 0; visit((value.type as (props: unknown) => ReactNode)(value.props), key); }
    else { nodes.push(value); if (value.type === 'dialog') { const ref = value.props.ref as { current: unknown } | undefined; if (ref) ref.current ??= { showModal: mocks.showModal }; } visit(value.props.children as ReactNode, key); }
  }); }
  visit(<BankTransferRefund actorId={identity.actorId} orderId={identity.orderId} claimId={identity.claimId} />, 'root');
  for (const [key, frame] of hooks.frames) if (!seen.has(key)) { for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.delete(key); }
}
function effects() { for (const frame of hooks.frames.values()) for (const effect of frame.jobs.splice(0)) effect(); }
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); effects(); } }
function authenticate(actor = identity.actorId, session = identity.sessionId) { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
function change(label: string, value: string | boolean) {
  render(); const parent = nodes.find(node => node.type === 'label' && text(node).startsWith(label))!;
  expect(parent).toBeDefined();
  const input = Children.toArray(parent.props.children as ReactNode).find(value => isValidElement(value) && value.type === 'input') as Element;
  (input.props.onChange as (event: unknown) => void)({ target: { value, checked: value } });
}
function click(label: string) { render(); const button = nodes.find(node => node.type === 'button' && text(node) === label); expect(button, label).toBeDefined(); expect(button!.props.disabled, label).not.toBe(true); (button!.props.onClick as () => void)(); }
function fill() {
  click('현재 시각 입력'); change('확인 증빙', evidence); change('처리 메모', note);
  render(); const checkbox = nodes.find(node => node.type === 'input' && node.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
}
function submit() { render(); const callback = nodes.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void; callback({ preventDefault() {} }); return callback; }
function dispose() { for (const frame of hooks.frames.values()) for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.clear(); nodes = []; }
function makeReceipt(original: BankRefundRecovery, state = 'recorded') { return { operationId: original.operationId, actorId: original.actorId, orderId: original.orderId, claimId: original.claimId,
  kind: original.kind, revision: original.revision, resultRevision: original.revision + (state === 'sealed' ? 0 : 1), amount: original.amount, state, createdAt: NOW }; }
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
async function mount(nextContext: BankRefundContext = context) { dispose(); mocks.load.mockResolvedValue({ context: nextContext }); render(); effects(); authenticate(); await flush(); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); vi.resetAllMocks(); hooks.frames.clear(); storage = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), key: (index: number) => [...storage.keys()][index] ?? null, get length() { return storage.size; } });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => false), setTimeout, clearTimeout }));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  mocks.save.mockResolvedValue({ error: '응답 유실', uncertain: true }); mocks.read.mockResolvedValue({ receipt: null });
  mocks.view.mockImplementation(async (input: { viewId: string; revision: number }) => ({ account: { ...rawAccount, viewId: input.viewId, actorId: identity.actorId, orderId: identity.orderId, claimId: identity.claimId, revision: input.revision, viewedAt: NOW } }));
  await mount();
});
afterEach(() => { dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('현재시각은 같은 분의 접수 시각 이후 밀리초까지 보존한다', async () => {
  fill(); render();
  const input = nodes.find(node => node.type === 'input' && node.props.type === 'datetime-local')!;
  expect(input.props.step).toBe('0.001');
  expect(new Date(input.props.value as string).toISOString()).toBe(NOW);
  submit(); await flush();
  expect(mocks.save.mock.calls[0][0].occurredAt).toBe(NOW);
  expect(Date.parse(mocks.save.mock.calls[0][0].occurredAt)).toBeGreaterThan(Date.parse(FILED));
});
it.each(['confirm_cancellation', 'file_transfer', 'complete_transfer'] as const)('%s 성공은 해당 단계만 안내하고 원문 증빙을 해제한다', async (kind: BankRefundKind) => {
  await mount({ ...context, confirmBlocker: kind === 'confirm_cancellation' ? null : context.confirmBlocker,
    fileBlocker: kind === 'file_transfer' ? null : context.fileBlocker, completeBlocker: kind === 'complete_transfer' ? null : 'bank_refund_filing_required' });
  mocks.save.mockImplementation(async (original: BankRefundRequest) => ({ receipt: makeReceipt(original) }));
  mocks.load.mockResolvedValue({ context: { ...context, phase: kind === 'complete_transfer' ? 'completed' : 'awaiting_transfer', completeBlocker: 'bank_refund_claim_unavailable' } });
  expect(nodes.some(node => node.type === 'legend' && text(node) === BANK_REFUND_LABELS[kind])).toBe(true);
  fill(); submit(); await flush();
  expect(mocks.save.mock.calls[0][0].kind).toBe(kind); expect(storage.size).toBe(0); expect(mocks.refresh).toHaveBeenCalledTimes(1);
  const expected = kind === 'confirm_cancellation' ? '취소를 확정하고 재고를 복원했습니다. 환불은 송금대기로 남아 있습니다.'
    : kind === 'file_transfer' ? '계좌 송금 접수를 기록했습니다. 실제 송금 후 완료 증빙을 남겨주세요.' : '실제 송금 증빙을 기록하고 환불을 완료했습니다.';
  expect(nodes.some(node => node.props.role === 'status' && text(node) === expected)).toBe(true);
  expect(memory()).not.toContain(evidence); expect(memory()).not.toContain(note);
});
it('연속 제출과 응답 유실 후 재시도는 같은 작업과 증빙을 유지하고 저장소에는 metadata만 남긴다', async () => {
  fill(); const callback = submit(); callback({ preventDefault() {} }); await flush();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  const original = structuredClone(mocks.save.mock.calls[0][0]);
  const metadata = JSON.parse(storage.get(bankRefundRecoveryKey(identity))!);
  expect(Object.keys(metadata).sort()).toEqual(['version', 'actorId', 'sessionId', 'orderId', 'claimId', 'operationId', 'revision', 'amount', 'kind'].sort());
  expect(JSON.stringify(metadata)).not.toContain(evidence); expect(JSON.stringify(metadata)).not.toContain(note);
  change('확인 증빙', '변경을 시도한 내용'); mocks.save.mockResolvedValueOnce({ error: '최신 상태 필요', conflict: true });
  click('같은 내용으로 다시 요청'); await flush();
  expect(mocks.save.mock.calls[1][0]).toEqual(original); expect(storage.size).toBe(1);
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it('새로고침은 증빙 없이 원작업을 조회·봉인하고 새 입력을 연다', async () => {
  fill(); submit(); await flush(); const original = mocks.save.mock.calls[0][0]; await mount();
  expect(memory()).not.toContain(evidence); expect(memory()).not.toContain(note);
  expect(nodes.some(node => node.type === 'button' && text(node) === '같은 내용으로 다시 요청')).toBe(false);
  click('이전 처리 결과 확인'); await flush(); expect(mocks.read.mock.calls[0][0].operationId).toBe(original.operationId);
  expect(JSON.stringify(mocks.read.mock.calls)).not.toContain(evidence); expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.read.mockResolvedValueOnce({ receipt: makeReceipt(original, 'sealed') });
  click('미처리 요청 종료 후 새로 입력'); await flush(); expect(mocks.read.mock.calls[1][1]).toBe(true); expect(storage.size).toBe(0);
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
});
it('충돌은 원입력을 덮어쓰지 않고 최신 상태를 명시적으로 다시 읽을 수 있다', async () => {
  mocks.save.mockResolvedValueOnce({ error: '최신 상태 필요', conflict: true }); fill(); submit(); await flush();
  expect(storage.size).toBe(0); expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
  mocks.load.mockResolvedValue({ context: { ...context, revision: 9 } }); click('최신 환불 상태 확인'); await flush();
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
  fill(); submit(); await flush(); expect(mocks.save.mock.calls[1][0].revision).toBe(9);
});
it.each(['timer', 'visibility', 'close', 'logout', 'unmount'])('계좌 원문은 dialog 메모리에만 있으며 %s 후 제거한다', async mode => {
  click('환불계좌 원문 확인'); await flush(); expect(mocks.showModal).toHaveBeenCalledTimes(1);
  expect(nodes.some(node => node.type === 'dialog' && text(node).includes(rawAccount.accountNumber))).toBe(true);
  expect(JSON.stringify([...storage.values()])).not.toContain(rawAccount.accountNumber);
  if (mode === 'timer') vi.advanceTimersByTime(60001);
  else if (mode === 'visibility') { Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
  else if (mode === 'close') click('계좌정보 닫기');
  else if (mode === 'logout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  else dispose();
  if (mode !== 'unmount') await flush();
  expect(nodes.some(node => node.type === 'dialog')).toBe(false); expect(memory()).not.toContain(rawAccount.accountNumber);
  expect(JSON.stringify([...storage.values()])).not.toContain(rawAccount.accountHolder);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['actor', 'session', 'logout'])('늦은 계좌 응답은 %s 변경 후 화면과 저장소에 반영하지 않는다', async mode => {
  const pending = deferred(); mocks.view.mockReturnValueOnce(pending.promise); click('환불계좌 원문 확인'); await flush();
  if (mode === 'actor') authenticate(other); else if (mode === 'session') authenticate(identity.actorId, other); else window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  pending.resolve({ account: { ...rawAccount, viewId: other, ...identity, viewedAt: NOW, revision: 7 } }); await flush();
  expect(nodes.some(node => node.type === 'dialog')).toBe(false); expect(memory()).not.toContain(rawAccount.accountNumber); expect(storage.size).toBe(0);
});
it('계좌 조회 실패와 다른 작업 receipt는 원문이나 성공 상태로 바꾸지 않는다', async () => {
  mocks.view.mockResolvedValueOnce({ error: '계좌 조회 실패' }); click('환불계좌 원문 확인'); await flush();
  expect(nodes.some(node => node.type === 'dialog')).toBe(false); expect(memory()).not.toContain(rawAccount.accountNumber);
  mocks.save.mockImplementationOnce(async (original: BankRefundRequest) => ({ receipt: { ...makeReceipt(original), claimId: other } }));
  fill(); submit(); await flush(); expect(storage.size).toBe(1); expect(mocks.refresh).not.toHaveBeenCalled();
  expect(nodes.some(node => node.props.role === 'alert' && text(node).includes('다른 결과'))).toBe(true);
});

/* m27 G4-5: 목록 위 클레임 팝업(R8) 안에서 무통장 환불 기록을 기다리는 동안 팝업이 닫히지 않게 알린다. */
it('환불 기록을 기다리는 동안 팝업에 처리 중을 알린다', async () => {
  const pending = deferred(); mocks.save.mockReturnValueOnce(pending.promise);
  render(); expect(busy).toHaveBeenLastCalledWith(false);
  fill(); submit(); render();
  expect(busy).toHaveBeenLastCalledWith(true);
  pending.resolve({ error: '응답 유실', uncertain: true }); await flush();
  expect(busy).toHaveBeenLastCalledWith(false);
});

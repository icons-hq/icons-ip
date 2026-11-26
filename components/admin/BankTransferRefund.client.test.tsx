import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: '', index: 0, frames: new Map<string, { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }>; jobs: (() => void)[] }>() }));
/* React 19의 비동기 전환(startTransition(async …))은 콜백이 첫 await에 닿기 전까지 건 상태 갱신을 전환이 끝날 때까지 보류한다.
   확인창 호스트가 창을 여는 갱신도 그 안에 들어가면 창이 뜨지 않고 멈추므로, 대역은 콜백이 동기로 도는 동안을 '전환 안'(depth > 0)으로 세고 불린 순서를 order에 남긴다. */
const transition = vi.hoisted(() => ({ depth: 0, order: [] as string[], onStart: null as null | (() => void) }));
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), read: vi.fn(), view: vi.fn(), refresh: vi.fn(), showModal: vi.fn(),
  auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  startTransition: (work: () => unknown) => {
    transition.order.push('전환 시작'); transition.onStart?.();
    transition.depth++;
    try { void work(); } finally { transition.depth--; }
  },
  useState: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; if (!(i in f.values)) f.values[i] = typeof initial === 'function' ? initial() : initial; return [f.values[i], (next: unknown) => { f.values[i] = typeof next === 'function' ? next(f.values[i]) : next; }]; },
  useRef: (initial: unknown) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++; return f.values[i] ??= { current: initial }; },
  useMemo: (work: () => unknown, deps: unknown[]) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, old = f.values[i] as { value: unknown; deps: unknown[] } | undefined; if (!old || deps.some((dep, n) => dep !== old.deps[n])) f.values[i] = { value: work(), deps }; return (f.values[i] as { value: unknown }).value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (work: () => void | (() => void), deps: unknown[] = []) => { const f = hooks.frames.get(hooks.current)!, i = hooks.index++, old = f.effects.get(i); if (!old || deps.some((dep, n) => dep !== old.deps[n])) { f.effects.set(i, { deps, cleanup: old?.cleanup }); f.jobs.push(() => { const effect = f.effects.get(i)!; effect.cleanup?.(); effect.cleanup = work() || undefined; }); } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
/* 이 파일은 컴포넌트 함수를 직접 불러 트리를 편다 — Base UI 기반 kit Badge는 실제 렌더러 밖에서 훅을 쓸 수 없어 글자만 남기는 대역으로 둔다. */
vi.mock('@/components/admin/kit/ui/badge', () => ({ Badge: (props: { children?: ReactNode }) => <span>{props.children}</span> }));
vi.mock('@/app/admin/bank-transfer-refund-actions', () => ({ loadBankRefundContextAction: mocks.load, recordBankRefundAction: mocks.save, readBankRefundAction: mocks.read }));
const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/screens/ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
vi.mock('@/lib/admin/bank-transfer-refund-account', () => ({ requestBankRefundAccount: mocks.view }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { BankTransferRefund } from './BankTransferRefund';
import { BANK_REFUND_ACCOUNT_MISSING_AFTER_PARTIAL, BANK_REFUND_FIELDS, BANK_REFUND_LABELS, bankRefundRecoveryKey, type BankRefundContext, type BankRefundKind, type BankRefundRecovery, type BankRefundRequest } from '@/lib/admin/bank-transfer-refund';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

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
/* 확인창 대역: 불린 순서를 transition.order에 남기고, 전환 안에서 불렸는지도 구분한다. 어느 시험이든 확인창이 전환 안에서 불리면 afterEach가 실패시킨다. */
const answering = (answer: boolean | (() => boolean | Promise<boolean>)) => stubAdminConfirm(() => {
  transition.order.push(transition.depth > 0 ? '확인창(전환 안)' : '확인창');
  return typeof answer === 'function' ? answer() : answer;
});
let confirm = answering(true);
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
async function flush() { for (let i = 0; i < 24; i++) { await Promise.resolve(); render(); effects(); } }
function authenticate(actor = identity.actorId, session = identity.sessionId) { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
function change(label: string, value: string | boolean) {
  render(); const parent = nodes.find(node => node.type === 'label' && text(node).startsWith(label))!;
  expect(parent).toBeDefined();
  const input = Children.toArray(parent.props.children as ReactNode).find(value => isValidElement(value) && value.type === 'input') as Element;
  (input.props.onChange as (event: unknown) => void)({ target: { value, checked: value } });
}
function click(label: string) { render(); const button = nodes.find(node => node.type === 'button' && text(node) === label); expect(button, label).toBeDefined(); expect(button!.props.disabled, label).not.toBe(true); (button!.props.onClick as () => void)(); }
/* 근거·메모 두 칸만 채운다(칸 이름은 단계마다 다르다). 시각은 '지금'이 기본이고 확인 체크는 없다. */
function fill() {
  render(); const inputs = nodes.filter(node => node.type === 'input' && node.props.maxLength === 300);
  expect(inputs).toHaveLength(2);
  (inputs[0].props.onChange as (event: unknown) => void)({ target: { value: evidence } });
  (inputs[1].props.onChange as (event: unknown) => void)({ target: { value: note } });
}
const localMinute = (iso: string) => { const at = Date.parse(iso); return new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
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
  transition.depth = 0; transition.order.length = 0; transition.onStart = null;
  confirm = answering(true);
  await mount();
  transition.order.length = 0; /* 불러오기가 시작한 전환은 세지 않는다. */
});
afterEach(() => {
  expect(transition.order, '확인창을 전환 안에서 불렀다').not.toContain('확인창(전환 안)');
  confirm.restore(); dispose(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('시각은 지금이 기본이고, 누른 시각을 밀리초까지 보내 같은 분의 접수 시각보다 늦다', async () => {
  fill(); render();
  expect(nodes.some(node => node.type === 'input' && node.props.type === 'datetime-local')).toBe(false);
  expect(nodes.some(node => node.type === 'input' && node.props.type === 'checkbox')).toBe(false);
  submit(); await flush();
  expect(mocks.save.mock.calls[0][0].occurredAt).toBe(NOW);
  expect(Date.parse(mocks.save.mock.calls[0][0].occurredAt)).toBeGreaterThan(Date.parse(FILED));
  expect(mocks.save.mock.calls[0][0].confirmed).toBe(true);
});
it('다른 시각을 분 단위로 적으면 앞 단계와 같은 분은 앞 단계 바로 뒤로 맞추고, [지금으로]로 되돌린다', async () => {
  click('다른 시각 적기'); render();
  const input = nodes.find(node => node.type === 'input' && node.props.type === 'datetime-local')!;
  expect(input.props.min).toBe(localMinute(FILED)); expect(input.props.required).toBe(true);
  change(BANK_REFUND_FIELDS.complete_transfer.time, localMinute(FILED)); fill(); submit(); await flush();
  expect(mocks.save.mock.calls[0][0].occurredAt).toBe('2026-10-14T06:03:20.124Z');
  expect(confirm.mock.calls[0][0]).toContain('송금한 시각: 2026. 10. 14. 15:03');
  await mount(); click('다른 시각 적기'); click('지금으로'); render();
  expect(nodes.some(node => node.type === 'input' && node.props.type === 'datetime-local')).toBe(false);
});
it('확인창은 금액·가린 계좌·되돌릴 수 없음을 말하고, 돌아가면 기록하지 않고 적은 내용을 그대로 둔다', async () => {
  confirm.restore(); confirm = answering(false);
  fill(); submit(); await flush();
  expect(confirm).toHaveBeenCalledOnce();
  const asked = confirm.mock.calls[0][0];
  for (const part of ['보낸 금액: 12,000원', `받는 계좌: ${context.maskedAccount} (예금주 ${context.maskedHolder})`, '이 버튼은 돈을 보내지 않고 기록만 남깁니다', '되돌릴 수 없습니다', '결제한 분에게 환불합니다']) expect(asked, part).toContain(part);
  expect(asked).not.toContain(rawAccount.accountNumber);
  expect(mocks.save).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
  expect(nodes.filter(node => node.type === 'input' && node.props.maxLength === 300).map(node => node.props.value)).toEqual([evidence, note]);
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
  /* 돌아간 뒤 다시 누르면 다시 묻는다. */
  confirm.restore(); confirm = answering(true); submit(); await flush();
  expect(confirm).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
});

/*
 * 확인창과 전환의 순서. React 19 비동기 전환은 안에서 건 갱신을 끝날 때까지 보류하므로, 확인창을 전환 안에서 부르면 창이 뜨지 않고
 * 확인을 영영 기다린다(무통장 환불 세 단계 버튼이 모두 멈추던 결함). 이 시험의 전환 대역은 콜백이 동기로 도는 동안을 '전환 안'으로 센다.
 */
it('확인창은 전환 밖에서 먼저 받고, 승인된 뒤에야 전환을 시작해 저장한다', async () => {
  mocks.save.mockImplementationOnce(async (original: BankRefundRequest) => { transition.order.push('저장'); return { receipt: makeReceipt(original) }; });
  fill(); submit();
  /* 확인을 기다리는 동안에는 전환도 저장도 시작되지 않았다. */
  expect(transition.order).toEqual(['확인창']); expect(mocks.save).not.toHaveBeenCalled();
  await flush();
  expect(transition.order.slice(0, 3)).toEqual(['확인창', '전환 시작', '저장']);
  expect(transition.order).not.toContain('확인창(전환 안)');
});
it('처리 중 표시와 팝업 닫힘 방지는 전환을 시작하기 전에 이미 걸려 있다(전환 안의 갱신은 호출이 끝날 때까지 보류된다)', async () => {
  const seen: unknown[] = [];
  fill(); submit();
  /* 전환이 시작되는 바로 그때의 화면: 팝업에 처리 중을 알렸고, 입력이 잠겼고, 처리 번호가 탭에 남아 있다. */
  transition.onStart = () => { transition.onStart = null; render(); seen.push(busy.mock.lastCall?.[0], nodes.find(node => node.type === 'fieldset')!.props.disabled, storage.has(bankRefundRecoveryKey(identity))); };
  await flush();
  expect(seen).toEqual([true, true, true]);
});
it.each(['confirm_cancellation', 'file_transfer', 'complete_transfer'] as const)('%s: 확인에서 돌아가면 전환도 저장도 시작되지 않고 잠금이 풀려 다른 버튼과 다시 하기가 그대로 된다', async (kind: BankRefundKind) => {
  await mount({ ...context, confirmBlocker: kind === 'confirm_cancellation' ? null : context.confirmBlocker,
    fileBlocker: kind === 'file_transfer' ? null : context.fileBlocker, completeBlocker: kind === 'complete_transfer' ? null : 'bank_refund_filing_required' });
  confirm.restore(); confirm = answering(false); transition.order.length = 0;
  fill(); submit(); await flush();
  expect(transition.order).toEqual(['확인창']); expect(mocks.save).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
  /* 잠금이 풀렸다 — 새로고침 전에도 계좌 보기가 눌리고, 다시 눌러도 다시 묻는다. */
  click('계좌번호 전체 보기'); await flush(); expect(mocks.view).toHaveBeenCalledTimes(1);
  confirm.restore(); confirm = answering(true); transition.order.length = 0;
  submit(); await flush();
  expect(transition.order.slice(0, 2)).toEqual(['확인창', '전환 시작']); expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.save.mock.calls[0][0].kind).toBe(kind);
});
it('확인창이 오류로 끝나도 잠금이 풀리고 저장은 시작되지 않는다', async () => {
  confirm.restore(); confirm = answering(() => { throw new Error('호스트 오류'); });
  fill(); submit(); await flush();
  expect(transition.order).toEqual(['확인창']); expect(mocks.save).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
  click('계좌번호 전체 보기'); await flush(); expect(mocks.view).toHaveBeenCalledTimes(1);
});
it('확인창이 떠 있는 동안의 거듭 제출은 확인창을 하나만 띄우고 저장도 한 번이다', async () => {
  fill(); const callback = submit(); callback({ preventDefault() {} }); callback({ preventDefault() {} }); await flush();
  expect(confirm).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
});
it('다시 저장은 이미 확인한 같은 내용이라 확인창 없이 전환 안에서 같은 기록을 다시 보낸다', async () => {
  fill(); submit(); await flush();
  const original = structuredClone(mocks.save.mock.calls[0][0]); transition.order.length = 0;
  click('같은 내용으로 다시 저장'); await flush();
  expect(transition.order).toEqual(['전환 시작']); expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1][0]).toEqual(original);
  expect(confirm).toHaveBeenCalledOnce();
});
it('순서 표시는 취소와 반품이 다르고 끝난 단계에는 시각을 보인다', async () => {
  const steps = () => { render(); return nodes.filter(node => node.type === 'li').map(node => `${text(node)}|${String(node.props['data-bank-refund-step'])}`); };
  expect(steps()).toEqual(['1. 환불 접수 · 2026. 10. 14. 15:03|done', '2. 취소 확정 · 2026. 10. 14. 15:03|done', '3. 은행에서 송금한 뒤 완료 기록 · 지금 할 일|current']);
  await mount({ ...context, claimType: 'cancel', phase: 'not_confirmed', confirmedAt: null, filedAt: null, confirmBlocker: null,
    fileBlocker: 'bank_refund_confirmation_required', completeBlocker: 'bank_refund_confirmation_required' });
  expect(steps()).toEqual(['1. 취소 확정 · 지금 할 일|current', '2. 환불 접수|waiting', '3. 은행에서 송금한 뒤 완료 기록|waiting']);
  expect(nodes.some(node => text(node).includes('이 화면에서 돈을 보내지 않습니다'))).toBe(false);
});
it.each(['confirm_cancellation', 'file_transfer', 'complete_transfer'] as const)('%s 성공은 해당 단계만 안내하고 원문 증빙을 해제한다', async (kind: BankRefundKind) => {
  await mount({ ...context, confirmBlocker: kind === 'confirm_cancellation' ? null : context.confirmBlocker,
    fileBlocker: kind === 'file_transfer' ? null : context.fileBlocker, completeBlocker: kind === 'complete_transfer' ? null : 'bank_refund_filing_required' });
  mocks.save.mockImplementation(async (original: BankRefundRequest) => ({ receipt: makeReceipt(original) }));
  mocks.load.mockResolvedValue({ context: { ...context, phase: kind === 'complete_transfer' ? 'completed' : 'awaiting_transfer', completeBlocker: 'bank_refund_claim_unavailable' } });
  expect(nodes.some(node => node.type === 'legend' && text(node) === BANK_REFUND_LABELS[kind])).toBe(true);
  fill(); submit(); await flush();
  expect(mocks.save.mock.calls[0][0].kind).toBe(kind); expect(storage.size).toBe(0); expect(mocks.refresh).toHaveBeenCalledTimes(1);
  /* 반품은 환불 접수 → 취소 확정 → 송금 완료 순서라, 끝난 단계마다 다음에 누를 버튼을 말한다. */
  const expected = kind === 'confirm_cancellation' ? '취소를 확정하고 재고를 복원했습니다. 은행에서 송금한 뒤 [송금 완료 기록]을 남겨주세요.'
    : kind === 'file_transfer' ? '환불 접수를 기록했습니다. 다음은 [취소 확정 · 재고 복원]입니다.' : '송금 완료를 기록했습니다. 환불이 끝났습니다.';
  expect(confirm).toHaveBeenCalledOnce();
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
  change('송금 증빙', '변경을 시도한 내용'); mocks.save.mockResolvedValueOnce({ error: '최신 상태 필요', conflict: true });
  click('같은 내용으로 다시 저장'); await flush();
  /* 다시 보내는 것은 이미 확인한 내용이라 다시 묻지 않는다. */
  expect(mocks.save.mock.calls[1][0]).toEqual(original); expect(storage.size).toBe(1); expect(confirm).toHaveBeenCalledOnce();
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it('새로고침은 증빙 없이 원작업을 조회·봉인하고 새 입력을 연다', async () => {
  fill(); submit(); await flush(); const original = mocks.save.mock.calls[0][0]; await mount();
  expect(memory()).not.toContain(evidence); expect(memory()).not.toContain(note);
  expect(nodes.some(node => node.type === 'button' && text(node) === '같은 내용으로 다시 저장')).toBe(false);
  click('저장됐는지 확인'); await flush(); expect(mocks.read.mock.calls[0][0].operationId).toBe(original.operationId);
  expect(JSON.stringify(mocks.read.mock.calls)).not.toContain(evidence); expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.read.mockResolvedValueOnce({ receipt: makeReceipt(original, 'sealed') });
  click('그만두고 다시 하기'); await flush(); expect(mocks.read.mock.calls[1][1]).toBe(true); expect(storage.size).toBe(0);
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
  click('계좌번호 전체 보기'); await flush(); expect(mocks.showModal).toHaveBeenCalledTimes(1);
  expect(nodes.some(node => node.type === 'dialog' && text(node).includes(rawAccount.accountNumber))).toBe(true);
  expect(JSON.stringify([...storage.values()])).not.toContain(rawAccount.accountNumber);
  if (mode === 'timer') vi.advanceTimersByTime(60001);
  else if (mode === 'visibility') { Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
  else if (mode === 'close') click('닫기');
  else if (mode === 'logout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  else dispose();
  if (mode !== 'unmount') await flush();
  expect(nodes.some(node => node.type === 'dialog')).toBe(false); expect(memory()).not.toContain(rawAccount.accountNumber);
  expect(JSON.stringify([...storage.values()])).not.toContain(rawAccount.accountHolder);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['actor', 'session', 'logout'])('늦은 계좌 응답은 %s 변경 후 화면과 저장소에 반영하지 않는다', async mode => {
  const pending = deferred(); mocks.view.mockReturnValueOnce(pending.promise); click('계좌번호 전체 보기'); await flush();
  if (mode === 'actor') authenticate(other); else if (mode === 'session') authenticate(identity.actorId, other); else window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  pending.resolve({ account: { ...rawAccount, viewId: other, ...identity, viewedAt: NOW, revision: 7 } }); await flush();
  expect(nodes.some(node => node.type === 'dialog')).toBe(false); expect(memory()).not.toContain(rawAccount.accountNumber); expect(storage.size).toBe(0);
});
it('계좌 조회 실패와 다른 작업 receipt는 원문이나 성공 상태로 바꾸지 않는다', async () => {
  mocks.view.mockResolvedValueOnce({ error: '계좌 조회 실패' }); click('계좌번호 전체 보기'); await flush();
  expect(nodes.some(node => node.type === 'dialog')).toBe(false); expect(memory()).not.toContain(rawAccount.accountNumber);
  mocks.save.mockImplementationOnce(async (original: BankRefundRequest) => ({ receipt: { ...makeReceipt(original), claimId: other } }));
  fill(); submit(); await flush(); expect(storage.size).toBe(1); expect(mocks.refresh).not.toHaveBeenCalled();
  expect(nodes.some(node => node.props.role === 'alert' && text(node).includes('이 기록과 맞지 않습니다'))).toBe(true);
});

/* m27 G4-5: 목록 위 클레임 팝업(R8) 안에서 무통장 환불 기록을 기다리는 동안 팝업이 닫히지 않게 알린다. */
it('환불 기록을 기다리는 동안 팝업에 처리 중을 알린다', async () => {
  const pending = deferred(); mocks.save.mockReturnValueOnce(pending.promise);
  render(); expect(busy).toHaveBeenLastCalledWith(false);
  fill(); submit(); await flush();
  expect(busy).toHaveBeenLastCalledWith(true);
  pending.resolve({ error: '응답 유실', uncertain: true }); await flush();
  expect(busy).toHaveBeenLastCalledWith(false);
});

/* 원장 재작업 알려진 후속 2: 재고 부족 부분 취소 뒤의 송금액은 남은 잔액이고, 잔액 0원이면 송금 없이 닫힌다고 말한다. */
it('부분 취소 뒤에는 주문 금액이 아니라 송금할 환불액(남은 잔액)을 보인다', async () => {
  await mount({ ...context, amount: 12000, partialRefund: { refundedAmount: 9500, refundAmount: 2500 } });
  expect(nodes.some(node => node.type === 'strong' && text(node) === '송금할 금액: ₩2,500')).toBe(true);
  expect(nodes.some(node => node.props['data-bank-refund-partial'] === '' && text(node) === '앞선 재고 부족 부분 취소분 9,500원은 이 요청과 따로 환불합니다. 송금할 금액은 남은 잔액입니다.')).toBe(true);
  /* 체크 칸이 말하던 금액은 확인창이 말한다 — 요청에 싣는 대조 금액은 주문 금액 그대로다. */
  fill(); submit(); await flush();
  expect(confirm.mock.calls[0][0]).toContain('보낸 금액: 2,500원 (앞선 부분 취소분 9,500원은 이 요청과 따로 환불)');
  expect(mocks.save.mock.calls[0][0].amount).toBe(12000);
});
it('잔액 0원 취소 확정은 송금대기가 아니라 송금 없이 마친다고 안내한다', async () => {
  const zero: BankRefundContext = { ...context, phase: 'not_confirmed', stage: 'processing', confirmedAt: null, filedAt: null, confirmBlocker: null,
    fileBlocker: 'bank_refund_confirmation_required', completeBlocker: 'bank_refund_confirmation_required', amount: 12000,
    partialRefund: { refundedAmount: 12000, refundAmount: 0 } };
  await mount(zero);
  expect(nodes.some(node => node.type === 'strong' && text(node) === '송금할 금액: ₩0')).toBe(true);
  expect(nodes.filter(node => node.type === 'li').map(node => text(node))).toEqual(['1. 취소 확정 · 지금 할 일']);
  expect(nodes.some(node => text(node) === '취소 확정 전')).toBe(true);
  expect(nodes.some(node => node.props['data-bank-refund-partial'] === '' && text(node).includes('결제 12,000원을 모두 따로 환불합니다'))).toBe(true);
  mocks.save.mockImplementation(async (original: BankRefundRequest) => ({ receipt: makeReceipt(original) }));
  mocks.load.mockResolvedValue({ context: { ...zero, phase: 'completed', stage: 'completed', confirmedAt: FILED, confirmBlocker: 'bank_refund_payment_unavailable' } });
  fill(); submit(); await flush();
  expect(confirm.mock.calls[0][0]).toContain('더 보낼 돈이 없어 송금 없이 환불 0원으로 끝납니다. 되돌릴 수 없습니다.');
  expect(confirm.mock.calls[0][0]).not.toContain('환불 송금 대기에 남습니다');
  expect(mocks.save.mock.calls[0][0].kind).toBe('confirm_cancellation');
  expect(nodes.some(node => node.props.role === 'status' && text(node) === '취소를 확정하고 재고를 복원했습니다. 돌려줄 잔액이 없어 송금 없이 환불을 마쳤습니다.')).toBe(true);
  expect(nodes.some(node => text(node) === '송금 없이 완료')).toBe(true);
  expect(nodes.some(node => text(node).includes('송금 대기'))).toBe(false);
});

/* F-25: 송금이 끝난 칸 머리글이 '송금할 금액'이라 이미 보낸 돈을 앞으로 보낼 돈처럼 말했다. */
it('송금이 끝난 칸은 보낸 돈이므로 송금한 금액이라고 쓴다', async () => {
  await mount({ ...context, phase: 'completed', stage: 'completed', confirmBlocker: 'bank_refund_already_confirmed', fileBlocker: 'bank_refund_already_filed', completeBlocker: 'bank_refund_claim_unavailable', transferredAt: FILED });
  expect(nodes.some(node => node.type === 'strong' && text(node) === '송금한 금액: ₩12,000')).toBe(true);
  expect(nodes.some(node => text(node).startsWith('송금할 금액'))).toBe(false);
  expect(nodes.some(node => text(node) === '송금 완료')).toBe(true);
  /* 아직 보내지 않은 단계는 그대로 '송금할 금액'이다. */
  await mount();
  expect(nodes.some(node => node.type === 'strong' && text(node) === '송금할 금액: ₩12,000')).toBe(true);
});

/*
 * F-05: 환불계좌가 없는데 앞선 부분 취소로 이미 일부를 환불한 주문은 고객 화면에서도 계좌를 추가할 수 없다(승인으로 열린 환불 기록의 금액이 결제 금액과 달라진다).
 * 운영자 화면이 '고객에게 등록해 달라고 안내'를 시키면 막다른 길이라, 그 주문만 지금은 진행할 수 없고 개발 요청이 필요하다고 말한다.
 */
it('환불계좌가 없는 주문은 일반 안내를 하되, 앞선 부분 취소가 있었던 주문은 진행할 수 없다고 말한다', async () => {
  const missing = { ...context, phase: 'not_confirmed' as const, confirmedAt: null, filedAt: null, confirmBlocker: 'claim_refund_account_missing', fileBlocker: 'claim_refund_account_missing', completeBlocker: 'claim_refund_account_missing', maskedAccount: null, maskedHolder: null };
  await mount(missing);
  const blockedText = () => nodes.filter(node => node.type === 'p' && node.props.className === 'text-muted-foreground').map(node => text(node));
  expect(blockedText()).toContain('환불계좌가 없습니다. 결제한 분에게 주문 상세(선물 주문은 선물 요청 화면)에서 환불계좌를 등록해 달라고 안내해주세요.');
  await mount({ ...missing, partialRefund: { refundedAmount: 9500, refundAmount: 2500 } });
  const partialBlocked = blockedText().filter(line => line.startsWith('환불계좌가 없습니다.'));
  expect(partialBlocked).toEqual([BANK_REFUND_ACCOUNT_MISSING_AFTER_PARTIAL]);
  expect(partialBlocked[0]).toContain('고객이 계좌를 추가할 수 없고');
  expect(partialBlocked[0]).toContain('개발 요청이 필요합니다');
  expect(partialBlocked[0]).not.toContain('안내해주세요');
});

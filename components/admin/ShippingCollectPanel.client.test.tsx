import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: '' as string, index: 0, frames: new Map<string, { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }>; jobs: (() => void)[] }>() }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), operation: vi.fn(), seal: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const frame = hooks.frames.get(hooks.current)!, index = hooks.index++;if (!(index in frame.values)) frame.values[index] = typeof initial === 'function' ? initial() : initial;return [frame.values[index], (value: unknown) => { frame.values[index] = typeof value === 'function' ? value(frame.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const frame = hooks.frames.get(hooks.current)!, index = hooks.index++;return frame.values[index] ??= { current: initial }; },
  useMemo: (callback: () => unknown, deps: unknown[]) => { const frame = hooks.frames.get(hooks.current)!, index = hooks.index++;const saved = frame.values[index] as { value: unknown; deps: unknown[] } | undefined;if (!saved || deps.some((dep, i) => dep !== saved.deps[i])) frame.values[index] = { value: callback(), deps };return (frame.values[index] as { value: unknown }).value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const frame = hooks.frames.get(hooks.current)!, index = hooks.index++, previous = frame.effects.get(index);if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { frame.effects.set(index, { deps, cleanup: previous?.cleanup });frame.jobs.push(() => { previous?.cleanup?.();frame.effects.get(index)!.cleanup = effect() || undefined; }); } },
}));
/* 목록 위 주문 상세 팝업의 대기 신호(useClaimPreviewBusy)는 실제 렌더러 없이 부르는 이 시험에서 아무 일도 하지 않는다. */
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: () => {} }));
vi.mock('@/app/admin/shipping-collect-event-actions', () => ({ readShippingCollectEventsAction: mocks.read, saveShippingCollectEventAction: mocks.save, readShippingCollectEventOperationAction: mocks.operation, sealShippingCollectOperationAction: mocks.seal }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
/* 이 파일은 컴포넌트 함수를 직접 불러 트리를 편다 — Base UI 기반 kit Badge는 실제 렌더러 밖에서 훅을 쓸 수 없어 글자만 남기는 대역으로 둔다. */
vi.mock('@/components/admin/kit/ui/badge', () => ({ Badge: (props: { children?: ReactNode }) => <span>{props.children}</span> }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback;return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { ShippingCollectPanel } from './ShippingCollectPanel';
import { shippingCollectRequest as request, shippingCollectReceipt } from '@/test/fixtures/shipping-collect';
import { shippingCollectRecoveryKey } from '@/lib/admin/shipping-collect-events';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
type Element = ReactElement<Record<string, unknown>>;
const sessionId = 'ab140000-0000-4000-8000-000000000005';let nodes: Element[];let data: Map<string, string>;
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
function render() {
  nodes = [];const seen = new Set<string>();
  function visit(node: ReactNode, path: string) {
    Children.toArray(node).forEach(value => {
      if (!isValidElement<Record<string, unknown>>(value)) return;
      const key = `${path}/${String(value.key ?? '')}`;
      if (typeof value.type === 'function') {
        seen.add(key);if (!hooks.frames.has(key)) hooks.frames.set(key, { values: [], effects: new Map(), jobs: [] });hooks.current = key;hooks.index = 0;
        visit((value.type as (props: unknown) => ReactNode)(value.props), key);
      } else { nodes.push(value);visit(value.props.children as ReactNode, key); }
    });
  }
  visit(<ShippingCollectPanel orderId={request.orderId} expectedActorId={request.expectedActorId} canManage />, 'root');
  for (const [key, frame] of hooks.frames) if (!seen.has(key)) { for (const effect of frame.effects.values()) effect.cleanup?.();hooks.frames.delete(key); }
}
function effects() { for (const frame of hooks.frames.values()) for (const effect of frame.jobs.splice(0)) effect(); }
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve();render();effects(); } }
function authenticate(actor = request.expectedActorId, session = sessionId) { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
function control(label: string) { const parent = nodes.find(node => node.type === 'label' && text(node).startsWith(label))!;return Children.toArray(parent.props.children as ReactNode).find(value => isValidElement(value) && ['input', 'select'].includes(String(value.type))) as Element; }
function change(label: string, value: string) { render();(control(label).props.onChange as (event: unknown) => void)({ target: { value } }); }
function click(label: string) { render();const button = nodes.find(node => node.type === 'button' && text(node) === label)!;expect(button).toBeDefined();expect(button.props.disabled).not.toBe(true);(button.props.onClick as () => void)(); }
function fill() { change('기록 종류', 'collected');change('발생 시각', '2026-10-14T10:00:00');change('수납·반환한 곳', '민감 본문 주체');change('증빙 번호', '민감 증빙');change('확인한 내용', '민감 상세 본문'); }
function submit() { render();const handler = nodes.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void;handler({ preventDefault() {} });return handler; }
function dispose() { for (const frame of hooks.frames.values()) for (const effect of frame.effects.values()) effect.cleanup?.();hooks.frames.clear(); }
const deferred = () => { let resolve!: (value: unknown) => void;const promise = new Promise(yes => { resolve = yes; });return { promise, resolve }; };
/* 확인창은 호스트 대신 이 핸들러가 받는다. answer가 false면 운영자가 [돌아가기]를 누른 것이다. */
let confirms: AdminConfirmRequest[] = [];let answer = true;let restoreConfirm: () => void;
beforeEach(async () => {
  confirms = [];answer = true;restoreConfirm = setAdminConfirmHandler(async request => { confirms.push(request);return answer; });
  hooks.frames.clear();vi.clearAllMocks();data = new Map();const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; } };
  vi.stubGlobal('sessionStorage', storage);vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => false) }));vi.stubGlobal('document', new EventTarget());
  const obligation = shippingCollectReceipt().obligation;obligation.revision = 1;obligation.state = 'planned';obligation.events = [];
  mocks.read.mockResolvedValue({ ok: true, value: [obligation] });mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '결과 불명확' });mocks.operation.mockResolvedValue({ ok: true, value: null });mocks.seal.mockResolvedValue({ ok: true, value: null });
  render();effects();authenticate();await flush();
});
afterEach(() => { dispose();restoreConfirm();vi.unstubAllGlobals(); });
it('동일 제출 callback을 중복 실행해도 UUID 하나이며 비PII 요청 식별자만 보관한다', async () => {
  fill();const handler = submit();handler({ preventDefault() {} });await flush();expect(mocks.save).toHaveBeenCalledTimes(1);
  const metadata = JSON.parse([...data.values()][0]);expect(Object.keys(metadata).sort()).toEqual(['expectedActorId', 'operationId', 'orderId', 'sessionId', 'shipmentId', 'version']);expect(JSON.stringify(metadata)).not.toContain('민감');
  const event = new Event('beforeunload', { cancelable: true });window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
});
it('새로고침은 원 operation 조회 후 봉인하고 최신 상태 확인 전에는 새 저장을 막는다', async () => {
  fill();submit();await flush();const original = mocks.save.mock.calls[0][0];dispose();render();effects();authenticate();await flush();
  click('저장됐는지 확인');await flush();expect(mocks.operation.mock.calls[0][0].operationId).toBe(original.operationId);expect(mocks.save).toHaveBeenCalledTimes(1);
  click('그만두고 다시 하기');await flush();expect(mocks.seal.mock.calls[0][0].operationId).toBe(original.operationId);expect(data.size).toBe(0);
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);click('새로 입력하기');await flush();expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
});
it.each(['account', 'session', 'signout'])('%s 전환 후 늦은 증빙 응답과 복구 메타데이터를 노출하지 않는다', async kind => {
  const pending = deferred();mocks.save.mockReturnValueOnce(pending.promise);fill();submit();await flush();
  if (kind === 'account') authenticate(request.orderId);else if (kind === 'session') authenticate(request.expectedActorId, request.orderId);else window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  pending.resolve({ ok: true, value: shippingCollectReceipt() });await flush();expect(nodes.some(node => node.type === 'form')).toBe(false);expect(data.size).toBe(0);
});
it('다른 세션의 식별자를 새 세션 복구 요청으로 사용하지 않는다', async () => {
  const key = shippingCollectRecoveryKey(request, sessionId, request.shipmentId);data.set(key, JSON.stringify({ ...request, version: 1, sessionId }));dispose();render();effects();authenticate(request.expectedActorId, request.orderId);await flush();
  expect(mocks.operation).not.toHaveBeenCalled();expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
});

/* D-07·D-06·D-04: 기록하기 전에 확인창이 대상·금액·지울 수 없다는 사실을 말하고, 금액은 종류가 정하며, 시각은 지금으로 시작하고, 번호는 화면에 나오지 않는다. */
const labelNames = () => nodes.filter(node => node.type === 'label').map(node => text(node));
it('기록하기는 확인창에 출고지·착불 금액·기록 종류·금액·지울 수 없다는 사실을 말한 뒤에 저장한다', async () => {
  fill();submit();await flush();
  expect(confirms).toHaveLength(1);
  expect(confirms[0]).toMatchObject({ title: '착불 수납을 기록할까요?', confirmLabel: '기록하기', cancelLabel: '돌아가기' });
  expect(confirms[0].message).toContain('TEST 합성출고지 · 착불 배송비 2,250원');
  expect(confirms[0].message).toContain('기록 종류: 외부 수납 확인');
  expect(confirms[0].message).toContain('금액: 2,250원');
  expect(confirms[0].message).toContain('기록은 지울 수 없습니다');
  expect(confirms[0].message).toContain('온라인 결제·환불 금액은 바뀌지 않습니다');
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ event: 'collected', amount: 2250 });
});
it('확인창에서 돌아가면 저장하지 않고 요청 번호도 보관하지 않는다', async () => {
  answer = false;fill();submit();await flush();
  expect(confirms).toHaveLength(1);expect(mocks.save).not.toHaveBeenCalled();expect(data.size).toBe(0);
  answer = true;submit();await flush();expect(mocks.save).toHaveBeenCalledTimes(1);
});
it('금액은 기록 종류가 정한다 — 수납 확인은 주문 당시 금액, 미수납 종료는 0원, 금액 불일치만 직접 적는다', async () => {
  render();expect(labelNames().some(name => name.startsWith('금액'))).toBe(false);expect(nodes.some(node => node.props['data-collect-amount'])).toBe(false);
  const fixed = () => nodes.find(node => node.props['data-collect-amount'] === 'fixed');
  change('기록 종류', 'collected');render();expect(text(fixed()!)).toContain('2,250원');expect(text(fixed()!)).toContain('주문 당시 착불 금액입니다.');expect(labelNames().some(name => name.startsWith('금액'))).toBe(false);
  change('기록 종류', 'void');render();expect(text(fixed()!)).toContain('0원');expect(text(fixed()!)).toContain('미수납으로 끝내므로 0원입니다.');
  change('기록 종류', 'mismatch');render();expect(fixed()).toBeUndefined();expect(labelNames().some(name => name.startsWith('금액 (원)'))).toBe(true);
  change('금액', '1500');render();expect((control('금액').props.value)).toBe('1500');
  change('기록 종류', 'collected');render();expect(text(fixed()!)).toContain('2,250원');expect(labelNames().some(name => name.startsWith('금액'))).toBe(false);
});
it('수납 금액 불일치는 예정 금액과 같으면 확인창 전에 막는다', async () => {
  change('기록 종류', 'mismatch');change('금액', '2250');change('발생 시각', '2026-10-14T10:00:00');change('수납·반환한 곳', '운송사');change('증빙 번호', 'R-1');change('확인한 내용', '확인');
  submit();await flush();expect(confirms).toHaveLength(0);expect(mocks.save).not.toHaveBeenCalled();
  render();expect(text(nodes.find(node => node.type === 'p' && text(node).includes('다른 금액이어야'))!)).toContain('예정 금액(2,250원)');
});
it('발생 시각은 지금(KST)으로 시작하고, 아무것도 입력하지 않았으면 나갈 때 묻지 않는다', async () => {
  render();const occurredAt = control('발생 시각').props.value as string;
  expect(occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  const event = new Event('beforeunload', { cancelable: true });window.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
  change('수납·반환한 곳', '운송사');await flush();const typed = new Event('beforeunload', { cancelable: true });window.dispatchEvent(typed);expect(typed.defaultPrevented).toBe(true);
});
it('저장 결과를 모를 때 화면에 요청 번호를 내보이지 않고 [저장됐는지 확인]으로 이끈다', async () => {
  mocks.save.mockRejectedValueOnce(new Error('network'));
  fill();submit();await flush();const original = mocks.save.mock.calls[0][0];
  const alertText = () => nodes.filter(node => node.props.role === 'alert').map(node => text(node)).join('|');
  expect(alertText()).toContain('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');expect(alertText()).not.toContain(original.operationId);
  dispose();render();effects();authenticate();await flush();
  expect(alertText()).toContain('보낸 기록이 저장됐는지 아직 모릅니다. [저장됐는지 확인]을 먼저 눌러주세요.');expect(alertText()).toContain('[그만두고 다시 하기]');expect(alertText()).not.toContain(original.operationId);
  const buttons = nodes.filter(node => node.type === 'button').map(node => text(node));
  expect(buttons).toContain('저장됐는지 확인');expect(buttons).toContain('그만두고 다시 하기');
  for (const retired of ['이전 결과 확인', '이전 요청 무효 처리 후 다시 입력', '최신 상태 확인 · 새 증빙 입력', '현재 시각 입력', '증빙 확인 후 기록']) expect(buttons.some(name => name.includes(retired))).toBe(false);
});
it('수납 상태를 말할 때 기록 번호(기록 N)를 쓰지 않는다', async () => {
  render();expect(nodes.map(node => text(node)).join('|')).not.toMatch(/기록 \d/);
});
it('저장됐는지 모를 때 서버가 준 안내(낱말 표의 문장)를 그대로 보인다', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, uncertain: true, error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.' });
  fill();submit();await flush();render();
  const alerts = nodes.filter(node => node.props.role === 'alert').map(node => text(node)).join('|');
  expect(alerts).toContain('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');expect(alerts).not.toContain('이전 결과 확인');
});

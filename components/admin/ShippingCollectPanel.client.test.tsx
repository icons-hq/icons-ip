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
vi.mock('@/app/admin/shipping-collect-event-actions', () => ({ readShippingCollectEventsAction: mocks.read, saveShippingCollectEventAction: mocks.save, readShippingCollectEventOperationAction: mocks.operation, sealShippingCollectOperationAction: mocks.seal }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback;return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { ShippingCollectPanel } from './ShippingCollectPanel';
import { shippingCollectRequest as request, shippingCollectReceipt } from '@/test/fixtures/shipping-collect';
import { shippingCollectRecoveryKey } from '@/lib/admin/shipping-collect-events';
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
function fill() { change('기록 종류', 'collected');change('실제 확인 금액', '2250');change('실제 발생 시각', '2026-10-14T10:00:00');change('수납·반환 주체', '민감 본문 주체');change('운송사 수납·환급', '민감 증빙');change('확인 내용', '민감 상세 본문'); }
function submit() { render();const handler = nodes.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void;handler({ preventDefault() {} });return handler; }
function dispose() { for (const frame of hooks.frames.values()) for (const effect of frame.effects.values()) effect.cleanup?.();hooks.frames.clear(); }
const deferred = () => { let resolve!: (value: unknown) => void;const promise = new Promise(yes => { resolve = yes; });return { promise, resolve }; };
beforeEach(async () => {
  hooks.frames.clear();vi.clearAllMocks();data = new Map();const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; } };
  vi.stubGlobal('sessionStorage', storage);vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => false) }));vi.stubGlobal('document', new EventTarget());
  const obligation = shippingCollectReceipt().obligation;obligation.revision = 1;obligation.state = 'planned';obligation.events = [];
  mocks.read.mockResolvedValue({ ok: true, value: [obligation] });mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '결과 불명확' });mocks.operation.mockResolvedValue({ ok: true, value: null });mocks.seal.mockResolvedValue({ ok: true, value: null });
  render();effects();authenticate();await flush();
});
afterEach(() => { dispose();vi.unstubAllGlobals(); });
it('동일 제출 callback을 중복 실행해도 UUID 하나이며 비PII 요청 식별자만 보관한다', async () => {
  fill();const handler = submit();handler({ preventDefault() {} });await flush();expect(mocks.save).toHaveBeenCalledTimes(1);
  const metadata = JSON.parse([...data.values()][0]);expect(Object.keys(metadata).sort()).toEqual(['expectedActorId', 'operationId', 'orderId', 'sessionId', 'shipmentId', 'version']);expect(JSON.stringify(metadata)).not.toContain('민감');
  const event = new Event('beforeunload', { cancelable: true });window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
});
it('새로고침은 원 operation 조회 후 봉인하고 최신 상태 확인 전에는 새 저장을 막는다', async () => {
  fill();submit();await flush();const original = mocks.save.mock.calls[0][0];dispose();render();effects();authenticate();await flush();
  click('이전 결과 확인');await flush();expect(mocks.operation.mock.calls[0][0].operationId).toBe(original.operationId);expect(mocks.save).toHaveBeenCalledTimes(1);
  click('이전 요청 봉인 후 다시 입력');await flush();expect(mocks.seal.mock.calls[0][0].operationId).toBe(original.operationId);expect(data.size).toBe(0);
  expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);click('최신 상태 확인 · 새 증빙 입력');await flush();expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
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

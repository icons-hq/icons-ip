import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), busy: vi.fn(), unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (callback: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, j) => dep !== hooks.memos[i].deps[j])) hooks.memos[i] = { value: callback(), deps }; return hooks.memos[i].value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const i = hooks.effectIndex++, previous = hooks.effects[i]; if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { hooks.effects[i] = { deps, effect, cleanup: previous?.cleanup }; hooks.changed.push(i); } },
}));
vi.mock('@/app/admin/goods-subscription-policy-actions', () => ({ readGoodsSubscriptionPolicyAction: mocks.read, saveGoodsSubscriptionPolicyAction: mocks.save }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { GoodsSubscriptionPolicyFields, GoodsSubscriptionPolicyPanel } from './GoodsSubscriptionPolicyPanel';
import type { GoodsSubscriptionPolicy } from '@/lib/admin/goods-subscription-policy';
type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const actor = '91000000-0000-4000-8000-000000000001', session = '91000000-0000-4000-8000-000000000002';
const base: GoodsSubscriptionPolicy = { goodId: 'term-good', revision: 0, goodUpdatedAt: '2026-10-14T01:00:00.123456Z', enabled: false, intervals: ['month_1'], message: '' };
let props: Parameters<typeof GoodsSubscriptionPolicyPanel>[0], data: Map<string, string>;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function render() { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return GoodsSubscriptionPolicyPanel(props); }
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 6; i++) { await Promise.resolve(); render(); effects(); } }
function button(label: string) { return all(render()).find(item => item.type === 'button' && text(item) === label)!; }
function click(label: string) { const item = button(label); expect(item).toBeDefined(); expect(item.props.disabled).not.toBe(true); (item.props.onClick as () => void)(); }
function change(patch: Record<string, unknown>) {
  const item = all(render()).find(node => node.type === GoodsSubscriptionPolicyFields)!;
  (item.props.onChange as (value: unknown) => void)({ ...item.props.value as object, ...patch });
}
function authenticate(id = actor, sessionId = session) { mocks.auth?.('SIGNED_IN', { user: { id }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.x` }); }
beforeEach(async () => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; vi.clearAllMocks(); data = new Map();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size; } };
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage, confirm: vi.fn(() => false) }));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  props = { goodId: base.goodId, accountId: actor, onBusyChange: mocks.busy }; mocks.read.mockResolvedValue({ ok: true, value: base });
  mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '결과 불명확' });
  render(); effects(); authenticate(); await flush();
});
afterEach(() => { for (const effect of hooks.effects) effect.cleanup?.(); vi.unstubAllGlobals(); });
it('기본 상품 미저장 또는 저장 중에는 정책 저장을 시작하지 않는다', () => {
  props = { ...props, disabledReason: '기본 상품 미저장' }; const stale = button('정기배송 설정 저장');
  expect(stale.props.disabled).toBe(true); (stale.props.onClick as () => void)(); expect(mocks.save).not.toHaveBeenCalled();
});
/* T3a-7 근본 정리: 상품 편집기가 패널 위에 공통 잠금 안내를 보이면 패널은 같은 이유를 다시 그리지 않는다. 잠금은 그대로다. */
it('이유 문장 표시를 끄면 본문에 이유를 그리지 않고 저장 잠금은 유지한다', () => {
  props = { ...props, disabledReason: '기본 상품 미저장' }; expect(text(render())).toContain('기본 상품 미저장');
  props = { ...props, showDisabledReason: false }; const stale = button('정기배송 설정 저장');
  expect(stale.props.disabled).toBe(true); (stale.props.onClick as () => void)(); expect(mocks.save).not.toHaveBeenCalled();
  expect(text(render())).not.toContain('기본 상품 미저장');
});
it('같은 콜백 중복 실행은 한 요청이며 불명확한 결과는 원 요청과 UUID로 재확인한다', async () => {
  change({ message: '다음 회차 안내' }); const pending = deferred<unknown>(); mocks.save.mockReturnValueOnce(pending.promise);
  const stale = button('정기배송 설정 저장'); (stale.props.onClick as () => void)(); (stale.props.onClick as () => void)();
  expect(mocks.save).toHaveBeenCalledTimes(1); await flush(); const original = mocks.save.mock.calls[0][0];
  expect(mocks.busy).toHaveBeenLastCalledWith(true); expect([...data.values()][0]).toContain(original.operationId);
  pending.resolve({ ok: false, uncertain: true, error: '불명확' }); await flush();
  expect(mocks.busy).toHaveBeenLastCalledWith(true); expect(button('정기배송 설정 저장').props.disabled).toBe(true);
  click('같은 요청으로 결과 확인'); await flush(); expect(mocks.save.mock.calls[1][0]).toBe(original);
});
it('주기 선택이 없는 임시 입력은 보관하되 서버에 보내지 않는다', async () => {
  change({ intervals: [] }); await flush(); click('정기배송 설정 저장'); await flush();
  expect(mocks.save).not.toHaveBeenCalled(); expect(text(render())).toContain('주기를 하나 이상');
  window.dispatchEvent(new Event('pagehide')); expect([...data.values()][0]).toContain('intervals');
});
it('CAS 충돌은 입력을 유지하고 최신본 채택을 명시적으로 분리한다', async () => {
  change({ message: '내 입력' }); mocks.save.mockResolvedValueOnce({ ok: false, conflict: true, error: '충돌', latest: { ...base, revision: 4, message: '동료 입력' } });
  click('정기배송 설정 저장'); await flush(); expect(all(render()).find(node => node.type === GoodsSubscriptionPolicyFields)!.props.value).toMatchObject({ message: '내 입력' });
  click('내 입력 유지 · 최신 버전을 저장 기준으로'); click('정기배송 설정 저장'); await flush();
  expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: 4, message: '내 입력' });
});
it('저장은 확인되고 readback이 실패하면 새 저장을 잠그고 최신본 확인을 요구한다', async () => {
  change({ message: '내 입력' }); mocks.save.mockResolvedValueOnce({ ok: false, committed: true, error: '다시 읽기 실패' });
  click('정기배송 설정 저장'); await flush(); expect(button('정기배송 설정 저장').props.disabled).toBe(true);
  expect(text(render())).toContain('최신 저장본 확인 필요'); mocks.read.mockResolvedValueOnce({ ok: true, value: { ...base, revision: 1, message: '내 입력' } });
  click('최신 저장본 비교'); await flush(); click('내 입력 버리고 최신 저장본 불러오기'); await flush(); expect(text(render())).toContain('서버 저장값과 동일');
});
it.each(['account', 'session', 'signout', 'unmount'])('%s 이후 늦은 응답이 다른 계정이나 세션에 노출되지 않는다', async kind => {
  change({ message: '이전 계정 입력' }); const pending = deferred<unknown>(); mocks.save.mockReturnValueOnce(pending.promise); click('정기배송 설정 저장'); await flush();
  if (kind === 'account') authenticate(session); if (kind === 'session') authenticate(actor, '91000000-0000-4000-8000-000000000003');
  if (kind === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  if (kind === 'unmount') for (const effect of hooks.effects) { effect.cleanup?.(); effect.cleanup = undefined; }
  pending.resolve({ ok: true, value: { ...base, revision: 99 } }); await flush(); expect(text(render())).not.toContain('설정을 저장하고 다시 확인했습니다');
  if (kind !== 'unmount') expect(data.size).toBe(0);
});
it('새로고침 후 같은 세션은 불명확한 원 요청을 복원한다', async () => {
  change({ message: '내 입력' }); click('정기배송 설정 저장'); await flush(); const original = mocks.save.mock.calls[0][0];
  for (const effect of hooks.effects) effect.cleanup?.(); hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
  render(); effects(); authenticate(); await flush(); click('임시 입력 복원'); await flush(); click('같은 요청으로 결과 확인'); await flush();
  expect(mocks.save.mock.calls[1][0]).toEqual(original);
});
it('세션이 바뀐 임시 입력은 복원을 막고 상품 전환 시 이전 입력을 숨긴다', async () => {
  change({ message: '내 입력' }); click('정기배송 설정 저장'); await flush();
  for (const effect of hooks.effects) effect.cleanup?.(); hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
  render(); effects(); authenticate(actor, '91000000-0000-4000-8000-000000000003'); await flush();
  expect(button('임시 입력 복원')).toBeUndefined(); expect(text(render())).toContain('이전 로그인 세션');
  props = { ...props, goodId: 'another-good' }; const pending = deferred<unknown>(); mocks.read.mockReturnValueOnce(pending.promise); render(); effects(); authenticate(); await flush();
  expect(all(render()).find(node => node.type === GoodsSubscriptionPolicyFields)).toBeUndefined();
  pending.resolve({ ok: true, value: { ...base, goodId: 'another-good' } }); await flush();
});

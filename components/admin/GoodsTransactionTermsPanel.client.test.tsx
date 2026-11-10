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
vi.mock('@/app/admin/goods-transaction-terms-actions', () => ({ readGoodsTransactionTermsAction: mocks.read, saveGoodsTransactionTermsAction: mocks.save }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { GoodsDeliveryPricingFields, GoodsTransactionTermsPanel, GoodsVolumeDiscountFields } from './GoodsTransactionTermsPanel';
import { goodsTermsDraft } from '@/lib/admin/goods-transaction-terms';
import type { GoodsTransactionAdminTerms } from '@/lib/goods-transaction';
type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const actor = '91000000-0000-4000-8000-000000000001', session = '91000000-0000-4000-8000-000000000002';
const base: GoodsTransactionAdminTerms = { goodId: 'term-good', revision: 0, goodUpdatedAt: '2026-10-14T01:00:00.123456Z', volume: null, delivery: null };
let props: Parameters<typeof GoodsTransactionTermsPanel>[0], data: Map<string, string>;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function render() { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return GoodsTransactionTermsPanel(props); }
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 6; i++) { await Promise.resolve(); render(); effects(); } }
function button(label: string) { return all(render()).find(item => item.type === 'button' && text(item) === label)!; }
function click(label: string) { const item = button(label); expect(item).toBeDefined(); expect(item.props.disabled).not.toBe(true); (item.props.onClick as () => void)(); }
function change(kind: 'volume' | 'delivery', field: string, value: string) {
  const type = kind === 'volume' ? GoodsVolumeDiscountFields : GoodsDeliveryPricingFields;
  const item = all(render()).find(node => node.type === type)!, draft = item.props.value as { status: string; fields: Record<string, string> };
  (item.props.onChange as (value: unknown) => void)({ ...draft, fields: { ...draft.fields, [field]: value } });
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
it('기본 상품의 미저장·저장 중 상태에서는 정책 전환을 시작하지 않는다', () => {
  props = { ...props, disabledReason: '기본 상품 미저장' }; const stale = button('복수구매 할인 저장'); expect(stale.props.disabled).toBe(true);
  (stale.props.onClick as () => void)(); expect(mocks.save).not.toHaveBeenCalled(); expect(text(render())).toContain('기본 상품 미저장');
});
/* T3a-7 근본 정리: 상품 편집기가 패널 위에 공통 잠금 안내를 보이면 패널은 같은 이유를 다시 그리지 않는다. 잠금은 그대로다. */
it('이유 문장 표시를 끄면 본문에 이유를 그리지 않고 저장 잠금은 유지한다', () => {
  props = { ...props, disabledReason: '기본 상품 미저장', showDisabledReason: false }; const stale = button('복수구매 할인 저장'); expect(stale.props.disabled).toBe(true);
  (stale.props.onClick as () => void)(); expect(mocks.save).not.toHaveBeenCalled(); expect(text(render())).not.toContain('기본 상품 미저장');
});
it('같은 callback을 두 번 눌러도 한 요청이며 응답 불명은 원 UUID·원문으로 재확인한다', async () => {
  change('volume', 'threshold', '3'); const stale = button('복수구매 할인 저장'), pending = deferred<unknown>(); mocks.save.mockReturnValueOnce(pending.promise);
  (stale.props.onClick as () => void)(); (stale.props.onClick as () => void)(); expect(mocks.save).toHaveBeenCalledTimes(1); await flush();
  expect(mocks.busy).toHaveBeenLastCalledWith(true); expect(data.size).toBe(1); const original = mocks.save.mock.calls[0][0];
  expect(JSON.parse([...data.values()][0]).values.policyDraft).toContain(original.operationId);
  pending.resolve({ ok: false, uncertain: true, error: '결과 불명확' }); await flush();
  expect(button('확장 배송비 저장').props.disabled).toBe(true); click('같은 요청으로 결과 확인'); await flush(); expect(mocks.save.mock.calls[1][0]).toBe(original);
});
it('다른 정책의 미저장 입력을 한쪽 저장의 readback이 덮어쓰지 않는다', async () => {
  change('volume', 'threshold', '3'); change('delivery', 'baseFee', '7777');
  const volume = { id: session, goodId: base.goodId, revision: 1, status: 'draft' as const, terms: null, draftValues: { ...goodsTermsDraft(base).volume.fields, threshold: '3' } };
  mocks.save.mockResolvedValueOnce({ ok: true, value: { ...base, revision: 1, volume } }); click('복수구매 할인 저장'); await flush();
  const delivery = all(render()).find(node => node.type === GoodsDeliveryPricingFields)!;
  expect(delivery.props.value).toMatchObject({ fields: { baseFee: '7777' } }); expect(text(render())).toContain('미저장 입력');
});
it('CAS 충돌은 입력을 유지하고 최신본 채택을 명시적으로 분리한다', async () => {
  change('volume', 'threshold', '3'); mocks.save.mockResolvedValueOnce({ ok: false, conflict: true, error: '충돌' }); click('복수구매 할인 저장'); await flush();
  mocks.read.mockResolvedValueOnce({ ok: true, value: { ...base, revision: 4 } }); click('최신 저장본 비교'); await flush();
  expect(all(render()).find(node => node.type === GoodsVolumeDiscountFields)!.props.value).toMatchObject({ fields: { threshold: '3' } });
  click('내 입력 유지 · 최신 버전을 저장 기준으로'); click('복수구매 할인 저장'); await flush(); expect(mocks.save.mock.calls[1][0].expectedRevision).toBe(4);
});
it.each(['account', 'session', 'signout', 'unmount'])('%s 이후 늦은 저장 응답과 임시 입력을 다른 세션에 노출하지 않는다', async kind => {
  change('volume', 'threshold', '3'); const pending = deferred<unknown>(); mocks.save.mockReturnValueOnce(pending.promise); click('복수구매 할인 저장'); await flush();
  if (kind === 'account') authenticate(session); if (kind === 'session') authenticate(actor, '91000000-0000-4000-8000-000000000003');
  if (kind === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  if (kind === 'unmount') for (const effect of hooks.effects) { effect.cleanup?.(); effect.cleanup = undefined; }
  pending.resolve({ ok: true, value: { ...base, revision: 99 } }); await flush(); expect(text(render())).not.toContain('설정을 저장하고 다시 확인했습니다');
  if (kind !== 'unmount') expect(data.size).toBe(0);
});
it('미저장 입력은 새로고침 전에 flush하며 경고한다', async () => {
  change('delivery', 'baseFee', '2500'); await flush(); const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true); expect([...data.values()][0]).toContain('2500');
});
it('새로고침 후 같은 로그인 세션은 불명확한 원요청을 복원해 같은 UUID로 조회한다', async () => {
  change('volume', 'threshold', '3'); click('복수구매 할인 저장'); await flush(); const original = mocks.save.mock.calls[0][0];
  for (const effect of hooks.effects) effect.cleanup?.(); hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
  render(); effects(); authenticate(); await flush(); click('임시 입력 복원'); await flush(); click('같은 요청으로 결과 확인'); await flush();
  expect(mocks.save.mock.calls[1][0]).toEqual(original);
});
it('새 로그인 세션의 복원은 차단하며 상품 전환 중 이전 입력을 보여주지 않는다', async () => {
  change('volume', 'threshold', '3'); click('복수구매 할인 저장'); await flush();
  for (const effect of hooks.effects) effect.cleanup?.(); hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
  render(); effects(); authenticate(actor, '91000000-0000-4000-8000-000000000003'); await flush();
  expect(button('임시 입력 복원')).toBeUndefined(); expect(text(render())).toContain('이전 로그인 세션');
  props = { ...props, goodId: 'another-good' }; const pending = deferred<unknown>(); mocks.read.mockReturnValueOnce(pending.promise); render(); effects(); authenticate(); await flush();
  expect(all(render()).find(node => node.type === GoodsVolumeDiscountFields)).toBeUndefined();
  pending.resolve({ ok: true, value: { ...base, goodId: 'another-good' } }); await flush();
});

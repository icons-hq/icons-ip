/* eslint-disable react-hooks/rules-of-hooks -- This test harness owns hook slots and fixes one root per mount. */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), apply: vi.fn(), read: vi.fn(), seal: vi.fn(), latest: vi.fn(), find: vi.fn(), preview: vi.fn(), receipt: vi.fn(),
  unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (callback: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, j) => dep !== hooks.memos[i].deps[j])) hooks.memos[i] = { value: callback(), deps }; return hooks.memos[i].value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const i = hooks.effectIndex++, previous = hooks.effects[i]; if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { hooks.effects[i] = { deps, effect, cleanup: previous?.cleanup }; hooks.changed.push(i); } },
}));
vi.mock('@/app/admin/shipping-settings-template-actions', () => ({ saveShippingSettingsTemplateAction: mocks.save, applyShippingSettingsTemplateAction: mocks.apply,
  readShippingSettingsOperationAction: mocks.read, sealShippingSettingsOperationAction: mocks.seal, readShippingSettingsTemplateAction: mocks.latest,
  findShippingSettingsGoodsAction: mocks.find, previewShippingSettingsTemplateAction: mocks.preview }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { useShippingSettingsOperation, useShippingSettingsPending, useShippingSettingsSession } from './useShippingSettingsOperation';
import { ShippingSettingsApplyDialog } from './ShippingSettingsApplyDialog';
import { ShippingSettingsTemplateForm } from './ShippingSettingsTemplateForm';
import { GoodsDeliveryPricingFields } from '@/components/admin/GoodsTransactionTermsPanel';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { shippingFixtures, shippingIdentity as identity, shippingIds as ids } from '@/test/fixtures/shipping-settings';
import type { GoodsTermsDraft } from '@/lib/admin/goods-transaction-terms';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let scope: ReturnType<typeof createGoodsDescriptionToolScope>, values: Map<string, string>, mode: 'operation' | 'session' | 'apply' | 'form';
let command: 'save' | 'apply';
let initialGoodIds: string[] = [];
function resetHooks() {
  for (const effect of hooks.effects) effect.cleanup?.();
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
}
function render() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0;
  if (mode === 'session') { const session = useShippingSettingsSession(ids.actor); return { ...session, pending: useShippingSettingsPending(session.identity) }; }
  if (mode === 'apply') return ShippingSettingsApplyDialog({ template: shippingFixtures().template, origins: [], identity, scope, onClose: vi.fn(), onApplied: mocks.receipt, initialGoodIds });
  if (mode === 'form') return ShippingSettingsTemplateForm({ newId: ids.template, origins: [], regions: [], identity, scope, onClose: vi.fn(), onSaved: mocks.receipt });
  return useShippingSettingsOperation({ identity, scope, templateId: ids.template, command, onReceipt: mocks.receipt });
}
const operation = () => render() as ReturnType<typeof useShippingSettingsOperation>;
const node = () => render() as ReactElement;
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 7; i++) { await Promise.resolve(); render(); effects(); } }
function button(label: string) { return all(node()).find(item => item.type === 'button' && text(item) === label)!; }
function click(label: string) { const item = button(label); expect(item).toBeDefined(); expect(item.props.disabled).not.toBe(true); (item.props.onClick as () => void)(); }
function authenticate(actor = ids.actor, session = ids.session) { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
beforeEach(() => {
  resetHooks(); vi.clearAllMocks(); values = new Map(); mode = 'operation'; command = 'apply'; initialGoodIds = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null, get length() { return values.size; } };
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('window', Object.assign(new EventTarget(), { sessionStorage: storage }));
  scope = createGoodsDescriptionToolScope(ids.actor); scope.activate(); scope.setEnabled(true); scope.authenticate(ids.actor, ids.session);
  mocks.save.mockResolvedValue({ error: '응답 불명', uncertain: true }); mocks.apply.mockResolvedValue({ error: '응답 불명', uncertain: true });
  mocks.read.mockResolvedValue({ data: null }); mocks.seal.mockResolvedValue({ data: shippingFixtures().sealed }); mocks.latest.mockResolvedValue({ data: null });
  mocks.find.mockResolvedValue({ data: shippingFixtures().candidates }); mocks.preview.mockResolvedValue({ data: shippingFixtures().preview });
});
afterEach(() => { resetHooks(); scope.dispose(); vi.unstubAllGlobals(); });

it('중복 클릭은 한 번 전송하며 이 탭에는 작업 context만 보관한다', async () => {
  const request = shippingFixtures().apply, pending = deferred<unknown>(); mocks.apply.mockReturnValueOnce(pending.promise);
  const current = operation(); effects(); void current.send(request); void current.send(request);
  expect(mocks.apply).toHaveBeenCalledTimes(1); expect(values.size).toBe(1);
  const journal = JSON.parse([...values.values()][0]); expect(journal).toEqual(shippingFixtures().context);
  expect(journal).not.toHaveProperty('goods'); expect(journal).not.toHaveProperty('settings');
  pending.resolve({ error: '응답 불명', uncertain: true }); await flush(); expect(operation().canRetry).toBe(true);
  await operation().retry(); expect(mocks.apply.mock.calls[1][0]).toEqual(request); expect(mocks.apply.mock.calls[1][0].operationId).toBe(request.operationId);
});
it('새로고침 뒤 원문이 없으면 재전송하지 않고 null 조회 다음에 명시적으로 봉인한다', async () => {
  const current = operation(); effects(); await current.send(shippingFixtures().apply); await flush(); resetHooks();
  expect(operation().context).toEqual(shippingFixtures().context); effects(); expect(operation().canRetry).toBe(false);
  await operation().retry(); expect(mocks.apply).toHaveBeenCalledTimes(1);
  await operation().recover(); expect(operation().context).not.toBeNull(); expect(values.size).toBe(1); expect(mocks.receipt).not.toHaveBeenCalled();
  await operation().send({ ...shippingFixtures().apply, operationId: ids.other }); expect(mocks.apply).toHaveBeenCalledTimes(1);
  await operation().recover(true); expect(mocks.seal).toHaveBeenCalledExactlyOnceWith(shippingFixtures().context);
  expect(values.size).toBe(0); expect(mocks.receipt).toHaveBeenCalledWith(shippingFixtures().sealed);
});
it('봉인과 경합한 늦은 최초 저장은 확정 영수증으로 수렴한다', async () => {
  operation(); effects(); await operation().send(shippingFixtures().apply); mocks.seal.mockResolvedValueOnce({ data: shippingFixtures().applied });
  await operation().recover(true); expect(values.size).toBe(0); expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(shippingFixtures().applied);
});
it('선행 봉인 영수증이 원요청으로 돌아오면 journal과 재시도를 종료한다', async () => {
  mocks.apply.mockResolvedValueOnce({ data: shippingFixtures().sealed }); operation(); effects();
  await operation().send(shippingFixtures().apply); await flush();
  expect(operation().context).toBeNull(); expect(operation().canRetry).toBe(false); expect(values.size).toBe(0);
  expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(shippingFixtures().sealed); expect(mocks.read).not.toHaveBeenCalled();
});
it('다른 scope 영수증은 journal을 지우거나 완료 callback을 호출하지 않는다', async () => {
  operation(); effects(); mocks.apply.mockResolvedValueOnce({ data: { ...shippingFixtures().applied, actorId: ids.other } });
  await operation().send(shippingFixtures().apply); expect(values.size).toBe(1); expect(operation().context).not.toBeNull(); expect(mocks.receipt).not.toHaveBeenCalled();
});
it.each(['auth', 'unmount'] as const)('%s 이후 도착한 응답은 현재 화면에 반영하지 않는다', async kind => {
  const pending = deferred<unknown>(); mocks.apply.mockReturnValueOnce(pending.promise); operation(); effects(); void operation().send(shippingFixtures().apply);
  if (kind === 'auth') scope.authenticate(ids.actor, ids.other); else for (const effect of hooks.effects) effect.cleanup?.();
  pending.resolve({ data: shippingFixtures().applied }); await flush(); expect(mocks.receipt).not.toHaveBeenCalled();
});
it('확정 오류도 기존 요청번호를 버리지 않고 읽기와 봉인을 남긴다', async () => {
  mocks.apply.mockResolvedValueOnce({ error: '현재 조건 변경', uncertain: false, conflict: true }); operation(); effects();
  await operation().send(shippingFixtures().apply); expect(operation().canRetry).toBe(false); expect(operation().context).not.toBeNull(); expect(values.size).toBe(1);
});
it('요청번호 보관 실패면 서버에 전송하지 않는다', async () => {
  vi.spyOn(sessionStorage, 'setItem').mockImplementationOnce(() => { throw new Error('unavailable'); }); operation(); effects();
  await operation().send(shippingFixtures().apply); expect(mocks.apply).not.toHaveBeenCalled(); expect(operation().error).toContain('전송하지 않았습니다');
});
it('불명확한 요청이 있는 동안 새로고침을 경고한다', async () => {
  operation(); effects(); await operation().send(shippingFixtures().apply); await flush();
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it.each(['session', 'account', 'signout'] as const)('%s 변경은 다른 세션에 journal과 편집 권한을 넘기지 않는다', async kind => {
  operation(); effects(); await operation().send(shippingFixtures().apply); resetHooks(); mode = 'session'; render(); effects(); authenticate(); await flush();
  expect((render() as ReturnType<typeof useShippingSettingsSession>).identity).toEqual(identity);
  if (kind === 'session') authenticate(ids.actor, ids.other); if (kind === 'account') authenticate(ids.other, ids.session);
  if (kind === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  await flush(); expect((render() as ReturnType<typeof useShippingSettingsSession>).identity).toBeNull(); expect(values.size).toBe(0);
});
it('새 템플릿의 미확정 저장도 목록 화면에서 찾을 수 있다', async () => {
  command = 'save'; operation(); effects(); await operation().send(shippingFixtures().save); resetHooks(); mode = 'session'; render(); effects(); authenticate(); await flush();
  expect((render() as { pending: unknown[] }).pending).toEqual([{ ...shippingFixtures().context, command: 'save', expectedRevision: 0 }]);
});

it('적용 화면은 공유 원상품 guard와 착불 버전을 미리보기 그대로 전송한다', async () => {
  const { candidates, preview, guard } = shippingFixtures(), familyGoodIds = ['good-1', 'child'];
  mocks.find.mockResolvedValueOnce({ data: { ...candidates, rows: [{ ...candidates.rows[0], familyGoodIds }] } });
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, goods: [{ ...preview.goods[0], familyGoodIds }] } });
  mode = 'apply'; render(); effects(); await flush();
  const checkbox = all(node()).find(item => item.type === 'input' && item.props.type === 'checkbox')!;
  (checkbox.props.onChange as () => void)(); click('적용 미리보기'); await flush(); click('1개 상품에 적용'); await flush();
  expect(mocks.apply).toHaveBeenCalledTimes(1); expect(mocks.apply.mock.calls[0][0]).toMatchObject({ command: 'apply', ...identity,
    collectRevision: 1, collectVersionId: ids.collect, goods: [{ ...guard, familyGoodIds }] });
  expect(text(node())).toContain('기존 수량별·착불 설정은 유지'); expect(text(node())).not.toContain('배송 설정 전체');
  expect(text(node())).toContain('원상품의 출고지·기본 배송비와 확장 배송 정책은 합산군 전체의 배송비 계산에 사용됩니다.');
  expect(text(node())).toContain('수령 방식·반품 및 교환 안내·템플릿 연결은 직접 선택한 상품에 저장합니다.');
  expect(button('같은 입력으로 재시도')).toBeDefined();
});
it('합산군 자식은 선택하지 않고 원상품을 자동으로 추가하지 않는다', async () => {
  const { candidates } = shippingFixtures(); mocks.find.mockResolvedValueOnce({ data: { ...candidates, rows: [{ ...candidates.rows[0], id: 'child', ownerGoodId: 'good-1',
    familyGoodIds: ['child', 'good-1'], editable: false, blocker: 'goods_aggregation_policy_owned_by_source' }] } });
  mode = 'apply'; render(); effects(); await flush(); const checkbox = all(node()).find(item => item.type === 'input' && item.props.type === 'checkbox')!;
  expect(checkbox.props.disabled).toBe(true); (checkbox.props.onChange as () => void)(); expect(text(node())).toContain('선택 0개');
  expect(mocks.preview).not.toHaveBeenCalled(); expect(button('적용 미리보기').props.disabled).toBe(true);
});
it('서버가 착불 준비 미완료를 반환하면 적용 버튼과 handler 모두 닫힌다', async () => {
  const { preview } = shippingFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, canApply: false, origin: { ...preview.origin, collectReady: false },
    goods: [{ ...preview.goods[0], blocker: 'collect_contract_not_ready' }] } });
  mode = 'apply'; render(); effects(); await flush(); const checkbox = all(node()).find(item => item.type === 'input' && item.props.type === 'checkbox')!;
  (checkbox.props.onChange as () => void)(); click('적용 미리보기'); await flush();
  expect(button('1개 상품에 적용').props.disabled).toBe(true); (button('1개 상품에 적용').props.onClick as () => void)(); expect(mocks.apply).not.toHaveBeenCalled();
  expect(text(node())).toContain('전체 적용을 중단');
});
it('최신 저장본 비교는 반품·교환 허용 조건과 세 비용 및 사유를 모두 표시한다', async () => {
  const { template } = shippingFixtures();
  mocks.latest.mockResolvedValueOnce({ data: { ...template, revision: 8, settings: { ...template.settings, claimPolicy: {
    returnAllowed: false, exchangeAllowed: true, returnFee: 3100, returnFreeShippingFee: 6200, exchangeFee: 7300, restrictionReason: '최신 개별 확인 사유',
  } } } });
  mode = 'form'; render(); effects(); click('최신 저장본 불러오기'); await flush();
  const latest = all(node()).find(item => item.type === 'div' && all(item).some(child => child.type === 'strong' && text(child) === '최신 저장본'))!;
  for (const expected of ['반품 조건: 제한 사유와 개별 확인 필요', '교환 조건: 기본 정책에 따라 가능', '고객 귀책 반품비 · 편도: 3,100원',
    '최초 무료배송 후 반품비 · 왕복 합계: 6,200원', '고객 귀책 교환비 · 왕복 합계: 7,300원', '제한 사유와 적용 조건: 최신 개별 확인 사유']) expect(text(latest)).toContain(expected);
  click('내 입력 유지 · 최신 버전을 저장 기준으로'); await flush();
  expect(all(node()).find(item => item.type === 'input' && item.props.name === 'revision')?.props.value).toBe(8);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('폼의 명시적 적용은 공용 parser로 3구간·구매자 선택 정책을 직렬화한다', async () => {
  const NativeFormData = FormData;
  vi.stubGlobal('FormData', class extends NativeFormData { constructor(source?: FormData) { super(); source?.forEach((value, key) => this.append(key, value)); } });
  mode = 'form'; render(); effects();
  const modeField = all(node()).find(item => item.type === 'select' && item.props.id === 'shipping-settings-deliveryMode')!;
  (modeField.props.onChange as (event: unknown) => void)({ target: { value: 'replace' } });
  const delivery = all(node()).find(item => item.type === GoodsDeliveryPricingFields)!;
  (delivery.props.onChange as (draft: GoodsTermsDraft['delivery']) => void)({ status: 'active', fields: { kind: 'tier3', baseFee: '3000', interval: '7', firstLimit: '2', secondLimit: '4', extra1: '1000', extra2: '2000', paymentMode: 'buyer_choice' } });
  const form = new NativeFormData(); for (const [key, value] of Object.entries({ id: ids.template, revision: '0', name: '합성 배송 조건', enabled: 'true', originId: ids.origin,
    feeType: 'free', individualFee: '3500', claimReturnAllowed: '', claimExchangeAllowed: '', claimRestrictionReason: '', claimReturnFee: '', claimReturnFreeShippingFee: '', claimExchangeFee: '' })) form.set(key, value);
  const element = all(node()).find(item => item.type === 'form')!;
  await (element.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: form }); await flush();
  expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.save.mock.calls[0][0]).toMatchObject({ command: 'save', expectedRevision: 0, ...identity,
    settings: { delivery: { mode: 'replace', policy: shippingFixtures().policy } } });
  const journal = JSON.parse([...values.values()][0]); expect(journal.command).toBe('save'); expect(journal).not.toHaveProperty('settings');
});

it('목록에서 선택한 상품은 서버 비교만 먼저 하고 적용 버튼 전에는 저장하지 않는다', async () => {
  mode = 'apply'; initialGoodIds = ['good-1']; node(); effects(); await flush();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.template, ['good-1'], identity);
  expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  expect(button('1개 상품에 적용').props.disabled).toBe(false);
  click('1개 상품에 적용'); await flush(); expect(mocks.apply).toHaveBeenCalledOnce();
  expect(mocks.apply.mock.calls[0][0].goods).toEqual([shippingFixtures().guard]);
});

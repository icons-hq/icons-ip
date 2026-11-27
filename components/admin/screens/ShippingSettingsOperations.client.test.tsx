/* eslint-disable react-hooks/rules-of-hooks -- This test harness owns hook slots and fixes one root per mount. */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), apply: vi.fn(), read: vi.fn(), seal: vi.fn(), latest: vi.fn(), outdated: vi.fn(), preview: vi.fn(), receipt: vi.fn(), failure: vi.fn(), closed: vi.fn(),
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
  findShippingSettingsOutdatedGoodsAction: mocks.outdated, previewShippingSettingsTemplateAction: mocks.preview }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { useShippingSettingsOperation, useShippingSettingsPending, useShippingSettingsSession } from './useShippingSettingsOperation';
import { ShippingSettingsApplyDialog } from './ShippingSettingsApplyDialog';
import { ShippingSettingsTemplateForm } from './ShippingSettingsTemplateForm';
import { GoodsDeliveryPricingFields } from '@/components/admin/GoodsTransactionTermsPanel';
import { AdminGoodsPicker } from '@/components/admin/AdminGoodsPicker';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { SHIPPING_SETTINGS_BLOCKER_LABELS, SHIPPING_SETTINGS_RUNTIME_OFF } from '@/lib/admin/shipping-settings-templates';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { shippingFixtures, shippingIdentity as identity, shippingIds as ids } from '@/test/fixtures/shipping-settings';
import { shippingChargeSettingsFixtures } from '@/test/fixtures/shipping-settings-charge-groups';
import type { GoodsTermsDraft } from '@/lib/admin/goods-transaction-terms';
import { Button } from '@/components/admin/kit/ui/button';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let scope: ReturnType<typeof createGoodsDescriptionToolScope>, values: Map<string, string>, mode: 'operation' | 'session' | 'apply' | 'form';
let command: 'save' | 'apply';
let initialGoodIds: string[] = [], reapply = false, runtimeEnabled: boolean | null = null, formTemplate: ReturnType<typeof shippingFixtures>['template'] | undefined;
function resetHooks() {
  for (const effect of hooks.effects) effect.cleanup?.();
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
}
function render() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0;
  if (mode === 'session') { const session = useShippingSettingsSession(ids.actor); return { ...session, pending: useShippingSettingsPending(session.identity) }; }
  if (mode === 'apply') return ShippingSettingsApplyDialog({ template: shippingFixtures().template, origins: [], identity, scope, onClose: mocks.closed, onApplied: mocks.receipt, initialGoodIds, reapply });
  if (mode === 'form') return ShippingSettingsTemplateForm({ ...(formTemplate ? { template: formTemplate } : { newId: ids.template }), origins: [], regions: [], identity, scope, runtimeEnabled, onClose: mocks.closed, onSaved: mocks.receipt });
  return useShippingSettingsOperation({ identity, scope, templateId: ids.template, command, onReceipt: mocks.receipt, onFailure: mocks.failure });
}
const operation = () => render() as ReturnType<typeof useShippingSettingsOperation>;
const node = () => render() as ReactElement;
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 7; i++) { await Promise.resolve(); render(); effects(); } }
/* 화면은 kit Button(ADR-0028)을 쓴다. 이 얕은 렌더는 kit 부품을 펼치지 않으므로 그 요소를 그대로 찾는다 — kit 부품은 onClick·disabled를 네이티브 요소에 그대로 넘긴다. */
const isButton = (item: Element) => item.type === 'button' || item.type === Button;
/* 상품은 공용 상품 선택창에서 고른다. 선택창은 펼치지 않고, 줄의 [선택]과 [완료]가 부르는 onSelect·onClose를 그대로 부른다. */
const pickerRow = (id = 'good-1', name = '합성 상품') => ({ id, code: id.toUpperCase(), name, categoryName: null, imageUrl: null, published: true });
const picker = () => all(node()).find(item => item.type === AdminGoodsPicker)!;
async function pickAndFinish(rows = [pickerRow()]) { for (const row of rows) (picker().props.onSelect as (row: unknown) => void)(row); (picker().props.onClose as () => void)(); await flush(); }
/* 저장·적용·그만두기의 결과는 보낸 일의 번호가 같아야 받아들인다. 화면이 만든 번호를 그대로 돌려준다. */
const answering = (receipt: object) => async (input: { operationId: string }) => ({ data: { ...receipt, operationId: input.operationId } });
function button(label: string) { return all(node()).find(item => isButton(item) && text(item) === label)!; }
function click(label: string) { const item = button(label); expect(item).toBeDefined(); expect(item.props.disabled).not.toBe(true); (item.props.onClick as () => void)(); }
function authenticate(actor = ids.actor, session = ids.session) { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
beforeEach(() => {
  resetHooks(); vi.clearAllMocks(); values = new Map(); mode = 'operation'; command = 'apply'; initialGoodIds = []; reapply = false; runtimeEnabled = null; formTemplate = undefined;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null, get length() { return values.size; } };
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('window', Object.assign(new EventTarget(), { sessionStorage: storage }));
  scope = createGoodsDescriptionToolScope(ids.actor); scope.activate(); scope.setEnabled(true); scope.authenticate(ids.actor, ids.session);
  mocks.save.mockResolvedValue({ error: '응답 불명', uncertain: true }); mocks.apply.mockResolvedValue({ error: '응답 불명', uncertain: true });
  mocks.read.mockResolvedValue({ data: null }); mocks.seal.mockResolvedValue({ data: shippingFixtures().sealed }); mocks.latest.mockResolvedValue({ data: null });
  mocks.preview.mockResolvedValue({ data: shippingFixtures().preview });
  mocks.outdated.mockResolvedValue({ data: { ids: [], total: 0 } });
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
it('저장되지 않은 것이 확실하면 그 일을 바로 끝내 다시 저장할 수 있게 하고 이유를 남긴다', async () => {
  mocks.apply.mockResolvedValueOnce({ error: '현재 조건 변경', uncertain: false, conflict: true }); operation(); effects();
  await operation().send(shippingFixtures().apply);
  expect(mocks.seal).toHaveBeenCalledExactlyOnceWith(shippingFixtures().context);
  expect(operation().context).toBeNull(); expect(operation().canRetry).toBe(false); expect(values.size).toBe(0);
  expect(operation().error).toBe('현재 조건 변경');
  expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ error: '현재 조건 변경', changed: false }); expect(mocks.receipt).not.toHaveBeenCalled();
  /* 끝냈으므로 같은 화면에서 새로 보낼 수 있다. */
  mocks.apply.mockResolvedValueOnce({ data: { ...shippingFixtures().applied, operationId: ids.other } });
  await operation().send({ ...shippingFixtures().apply, operationId: ids.other }); expect(mocks.apply).toHaveBeenCalledTimes(2);
  expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith({ ...shippingFixtures().applied, operationId: ids.other }); expect(operation().error).toBe('');
});
it('다른 사람이 템플릿을 먼저 바꾼 저장은 changed로 알린다', async () => {
  command = 'save'; mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다.', uncertain: false, conflict: true, changed: true });
  mocks.seal.mockResolvedValueOnce({ data: { ...shippingFixtures().sealed, command: 'save', expectedRevision: 0 } }); operation(); effects();
  await operation().send(shippingFixtures().save);
  expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ error: '다른 사람이 먼저 바꿨습니다.', changed: true }); expect(operation().context).toBeNull();
});
it('끝내려 했는데 그사이 처리돼 있었으면 그 결과로 끝난다', async () => {
  mocks.apply.mockResolvedValueOnce({ error: '현재 조건 변경', uncertain: false }); mocks.seal.mockResolvedValueOnce({ data: shippingFixtures().applied }); operation(); effects();
  await operation().send(shippingFixtures().apply);
  expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(shippingFixtures().applied); expect(mocks.failure).not.toHaveBeenCalled();
  expect(operation().context).toBeNull(); expect(operation().error).toBe('');
});
it('끝내지 못했으면 이유와 함께 [저장됐는지 확인]·[그만두고 다시 하기]를 남긴다', async () => {
  mocks.apply.mockResolvedValueOnce({ error: '현재 조건 변경', uncertain: false }); mocks.seal.mockResolvedValueOnce({ error: SAVE_UNKNOWN_MESSAGE, uncertain: true }); operation(); effects();
  await operation().send(shippingFixtures().apply);
  expect(operation().context).toEqual(shippingFixtures().context); expect(values.size).toBe(1); expect(operation().error).toBe('현재 조건 변경');
  expect(operation().canRetry).toBe(false); expect(mocks.failure).not.toHaveBeenCalled();
  await operation().recover(true); expect(mocks.seal).toHaveBeenCalledTimes(2); expect(operation().context).toBeNull(); expect(values.size).toBe(0);
});
it('[저장됐는지 확인]은 보낸 내용이 남아 있으면 같은 내용을 다시 보내고, 새로고침 뒤에는 결과만 읽는다', async () => {
  operation(); effects(); await operation().send(shippingFixtures().apply); expect(operation().error).toBe('응답 불명');
  await operation().check(); expect(mocks.apply).toHaveBeenCalledTimes(2); expect(mocks.read).not.toHaveBeenCalled();
  resetHooks(); operation(); effects(); await operation().check();
  expect(mocks.apply).toHaveBeenCalledTimes(2); expect(mocks.read).toHaveBeenCalledExactlyOnceWith(shippingFixtures().context);
  expect(operation().message).toBe('아직 저장된 것이 없습니다. [그만두고 다시 하기]를 누른 뒤 처음부터 다시 해 주세요.');
});
it('이 탭에 진행 기록을 남길 수 없으면 서버에 보내지 않는다', async () => {
  vi.spyOn(sessionStorage, 'setItem').mockImplementationOnce(() => { throw new Error('unavailable'); }); operation(); effects();
  await operation().send(shippingFixtures().apply); expect(mocks.apply).not.toHaveBeenCalled(); expect(operation().error).toContain('보내지 않았습니다');
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

it('상품은 공용 상품 선택창에서 여러 개 고르고, [완료]를 누르면 바뀌는 내용부터 보여 준다', async () => {
  const { preview, guard } = shippingFixtures(), familyGoodIds = ['good-1', 'child'];
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, goods: [{ ...preview.goods[0], familyGoodIds }] } });
  mode = 'apply'; render(); effects(); await flush();
  expect(picker().props).toMatchObject({ title: '상품 고르기', multiple: true, selectedKeys: [] });
  expect(String(picker().props.description)).toContain('‘합성 배송 조건’ 템플릿을 적용할 상품을 고릅니다.');
  expect(mocks.preview).not.toHaveBeenCalled();
  (picker().props.onSelect as (row: unknown) => void)(pickerRow()); expect(picker().props.selectedKeys).toEqual(['good-1']);
  (picker().props.onDeselect as (row: unknown) => void)(pickerRow()); expect(picker().props.selectedKeys).toEqual([]);
  await pickAndFinish();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.template, ['good-1'], identity);
  expect(text(node())).toContain('상품 1개의 배송 설정이 ‘합성 배송 조건’ 템플릿 값으로 바뀝니다.');
  expect(text(node())).toContain('바꾸는 것: 출고지, 배송비 유형, 반품·교환 조건. 이미 받은 주문의 배송비와 회수 주소는 그대로입니다.');
  expect(text(node())).toContain('함께 묶인 상품 1개의 배송비 계산도 같이 바뀝니다. 수령 방식과 반품·교환 조건은 이 상품만 바뀝니다.');
  for (const gone of ['버전', '합산군', '전체 적용을 중단']) expect(text(node())).not.toContain(gone);
  click('1개 상품에 적용'); await flush();
  expect(mocks.apply).toHaveBeenCalledTimes(1); expect(mocks.apply.mock.calls[0][0]).toMatchObject({ command: 'apply', ...identity,
    collectRevision: 1, collectVersionId: ids.collect, goods: [{ ...guard, familyGoodIds }] });
  /* 결과를 받지 못했다(기본 응답). 낱말 표의 두 버튼만 남는다. */
  expect(text(node())).toContain('응답 불명'); expect(button('저장됐는지 확인')).toBeDefined(); expect(button('그만두고 다시 하기')).toBeDefined();
  for (const old of ['저장 결과 확인', '같은 입력으로 재시도', '미처리 요청 종료']) expect(button(old)).toBeUndefined();
});
it('고른 상품이 없이 선택창을 닫으면 창을 닫고, 한 번에 100개까지만 고르게 한다', async () => {
  mode = 'apply'; render(); effects(); await flush();
  for (let index = 0; index < 100; index++) (picker().props.onSelect as (row: unknown) => void)(pickerRow(`good-${index}`));
  expect((picker().props.selectedKeys as string[]).length).toBe(100);
  expect((picker().props.rowBlocked as (row: unknown) => string | null)(pickerRow('good-100'))).toBe('한 번에 100개까지');
  expect((picker().props.rowBlocked as (row: unknown) => string | null)(pickerRow('good-1'))).toBeNull();
  (picker().props.onSelect as (row: unknown) => void)(pickerRow('good-100')); expect((picker().props.selectedKeys as string[]).length).toBe(100);
  resetHooks(); render(); effects(); (picker().props.onClose as () => void)(); await flush();
  expect(mocks.closed).toHaveBeenCalledOnce(); expect(mocks.preview).not.toHaveBeenCalled();
});
it('조건이 안 맞는 상품은 건너뛰고 나머지만 적용하며, 건너뛴 상품과 이유를 결과에 남긴다', async () => {
  const { preview, applied, guard } = shippingFixtures();
  const blocked = { ...preview.goods[0], id: 'good-2', ownerGoodId: 'good-2', familyGoodIds: ['good-2'], name: '착불 상품', code: 'TEST-2', blocker: 'collect_contract_not_ready' as const };
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, canApply: false, origin: { ...preview.origin, collectReady: false }, goods: [preview.goods[0], blocked] } });
  mocks.apply.mockImplementationOnce(answering(applied));
  mode = 'apply'; render(); effects(); await flush(); await pickAndFinish([pickerRow(), pickerRow('good-2', '착불 상품')]);
  expect(text(node())).toContain('상품 1개의 배송 설정이 ‘합성 배송 조건’ 템플릿 값으로 바뀝니다. 1개는 건너뜁니다.');
  /* S6-1: 건너뜀 이유는 문장이 끝나는 자리에서 마침표로 닫는다. */
  expect(text(node())).toContain(`건너뜀 · ${SHIPPING_SETTINGS_BLOCKER_LABELS.collect_contract_not_ready}.`);
  click('1개 상품에 적용'); await flush();
  expect(mocks.apply.mock.calls[0][0].goods).toEqual([guard]);
  expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(1, [{ id: 'good-2', name: '착불 상품', reason: SHIPPING_SETTINGS_BLOCKER_LABELS.collect_contract_not_ready }]);
});
it('적용할 수 있는 상품이 하나도 없으면 적용 버튼과 handler가 모두 닫힌다', async () => {
  const { preview } = shippingFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, canApply: false, origin: { ...preview.origin, collectReady: false },
    goods: [{ ...preview.goods[0], blocker: 'collect_contract_not_ready' }] } });
  mode = 'apply'; render(); effects(); await flush(); await pickAndFinish();
  expect(button('0개 상품에 적용').props.disabled).toBe(true); (button('0개 상품에 적용').props.onClick as () => void)(); await flush(); expect(mocks.apply).not.toHaveBeenCalled();
  expect(all(node()).some(item => item.type === AdminNotice && item.props.title === '적용할 수 있는 상품이 없습니다.')).toBe(true);
});
it('원상품에서 나눈 상품은 건너뛰고 원상품을 자동으로 넣지 않는다', async () => {
  const { preview } = shippingFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, canApply: false, goods: [{ ...preview.goods[0], id: 'child', ownerGoodId: 'good-1',
    familyGoodIds: ['child', 'good-1'], editable: false, blocker: 'goods_aggregation_policy_owned_by_source' }] } });
  mode = 'apply'; render(); effects(); await flush(); await pickAndFinish([pickerRow('child', '나눈 상품')]);
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.template, ['child'], identity);
  expect(text(node())).toContain(`건너뜀 · ${SHIPPING_SETTINGS_BLOCKER_LABELS.goods_aggregation_policy_owned_by_source}.`); expect(text(node())).toContain('원상품 열기 (새 탭)');
  expect(button('0개 상품에 적용').props.disabled).toBe(true);
});
it('그사이 상품이 바뀌어 적용되지 않았으면 이유를 보이고 미리보기를 다시 만들게 한다', async () => {
  mocks.apply.mockResolvedValueOnce({ error: '고른 상품이나 그 상품의 배송 설정이 그사이 바뀌었습니다. 미리보기를 다시 만들어 주세요.', uncertain: false, conflict: true });
  mocks.seal.mockImplementationOnce(answering(shippingFixtures().sealed));
  mode = 'apply'; render(); effects(); await flush(); await pickAndFinish(); click('1개 상품에 적용'); await flush();
  expect(mocks.seal).toHaveBeenCalledOnce(); expect(text(node())).toContain('그사이 바뀌었습니다. 미리보기를 다시 만들어 주세요.');
  expect(button('저장됐는지 확인')).toBeUndefined(); expect(text(node())).toContain('고른 상품 1개 · 합성 상품');
  click('미리보기'); await flush(); expect(mocks.preview).toHaveBeenCalledTimes(2); expect(button('1개 상품에 적용').props.disabled).toBe(false);
  expect(text(node())).not.toContain('그사이 바뀌었습니다');
});
it('디지털 파일이 연결된 상품의 수령 방식을 바꿀 때만 한 번 더 묻는다', async () => {
  /* 수령 방식을 바꾸는 적용은 묶음그룹 확인값까지 함께 보내는 모양이다. */
  const f = shippingChargeSettingsFixtures('preserve');
  const fulfillment = { mode: 'replace' as const, policy: { mode: 'no_delivery' as const, methods: [{ method: 'none' as const, feeAmount: 0, feeBasis: 'per_order' as const, installationFee: 0 }], publicNote: '' } };
  const before = { goodId: f.guard.id, revision: 2, mode: 'digital' as const, methods: [{ method: 'digital' as const, feeAmount: 0, feeBasis: 'per_order' as const, installationFee: 0 }],
    files: [{ id: ids.other, name: '합성.pdf', mimeType: 'application/pdf', size: 10 }], publicNote: '' };
  const template = { ...f.template, settings: { ...f.settings, fulfillment } };
  const good = { ...f.preview.goods[0], fulfillmentRevision: 2, after: template.settings, effectiveBefore: { ...f.preview.goods[0].effectiveBefore, fulfillment: before } };
  mocks.preview.mockResolvedValue({ data: { ...f.preview, template, goods: [good] } });
  const confirm = stubAdminConfirm(false);
  try {
    mode = 'apply'; render(); effects(); await flush(); await pickAndFinish();
    expect(text(node())).toContain('디지털 파일이 연결된 상품 1개는 새 주문부터 파일을 받을 수 없게 됩니다.');
    expect(text(node())).toContain('바꾸는 것: 출고지, 배송비 유형, 반품·교환 조건, 수령 방식.');
    click('1개 상품에 적용'); await flush();
    expect(confirm).toHaveBeenCalledOnce(); expect(confirm.mock.calls[0][0]).toContain('‘합성 상품’에 연결해 둔 파일이 새 주문부터 빠집니다.');
    expect(mocks.apply).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    mocks.apply.mockImplementationOnce(answering({ ...f.applied, template, fulfillmentVersion: 1, goods: [{ ...f.applied.goods[0], fulfillmentRevision: 3 }] }));
    click('1개 상품에 적용'); await flush(); expect(mocks.apply).toHaveBeenCalledOnce();
    expect(mocks.apply.mock.calls[0][0]).toMatchObject({ targetGroup: null, goods: [{ ...f.guard, fulfillmentRevision: 2 }] });
    expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(1, []);
  } finally { confirm.restore(); }
});
it('고른 상품이 있으면 적용하지 않고 닫기 전에 묻는다', async () => {
  const confirm = stubAdminConfirm(false);
  try {
    mode = 'apply'; render(); effects(); await flush(); await pickAndFinish();
    click('닫기'); await flush(); expect(confirm.mock.calls[0][0]).toBe('고른 상품 1개가 사라집니다. 아직 아무 상품도 바뀌지 않았습니다.'); expect(mocks.closed).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); click('닫기'); await flush(); expect(mocks.closed).toHaveBeenCalledOnce();
  } finally { confirm.restore(); }
});
it('[다시 적용]은 고친 뒤 다시 적용하지 않은 상품으로 바로 미리보기를 만든다', async () => {
  mocks.outdated.mockResolvedValueOnce({ data: { ids: ['good-1'], total: 131 } });
  mode = 'apply'; reapply = true; node(); effects(); await flush();
  expect(mocks.outdated).toHaveBeenCalledExactlyOnceWith(ids.template, identity); expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.template, ['good-1'], identity);
  expect(picker()).toBeUndefined(); expect(button('상품 다시 고르기')).toBeUndefined();
  expect(text(node())).toContain('한 번에 100개까지 적용합니다. 남은 130개는 적용한 뒤 목록에서 [다시 적용]을 한 번 더 눌러 주세요.');
  expect(button('1개 상품에 적용').props.disabled).toBe(false);
});
it('다시 적용할 상품이 없으면 그렇다고 말하고 아무것도 보내지 않는다', async () => {
  mode = 'apply'; reapply = true; node(); effects(); await flush();
  expect(mocks.preview).not.toHaveBeenCalled(); expect(text(node())).toContain('다시 적용할 상품이 없습니다.'); expect(button('미리보기').props.disabled).toBe(true);
});
it('다른 사람이 먼저 바꿨으면 지금 저장된 템플릿을 보이고 두 길을 고르게 한다', async () => {
  const NativeFormData = FormData;
  vi.stubGlobal('FormData', class extends NativeFormData { constructor(source?: FormData) { super(); source?.forEach((value, key) => this.append(key, value)); } });
  const { template, save, saved, sealed } = shippingFixtures();
  formTemplate = template;
  mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다. 적은 내용은 그대로 있습니다.', uncertain: false, conflict: true, changed: true });
  mocks.seal.mockImplementationOnce(answering({ ...sealed, command: 'save' }));
  mocks.latest.mockResolvedValueOnce({ data: { ...template, revision: 8, name: '먼저 고친 이름', settings: { ...template.settings, claimPolicy: {
    returnAllowed: false, exchangeAllowed: true, returnFee: 3100, returnFreeShippingFee: 6200, exchangeFee: 7300, restrictionReason: '최신 개별 확인 사유',
  } } } });
  mode = 'form'; render(); effects();
  const form = new NativeFormData(); for (const [key, value] of Object.entries({ id: ids.template, revision: '1', name: save.name, enabled: 'true', originId: ids.origin,
    feeType: 'free', individualFee: '3500', claimReturnAllowed: '', claimExchangeAllowed: '', claimRestrictionReason: '', claimReturnFee: '', claimReturnFreeShippingFee: '', claimExchangeFee: '' })) form.set(key, value);
  await (all(node()).find(item => item.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: form }); await flush();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ expectedRevision: 1 }); expect(mocks.seal).toHaveBeenCalledOnce(); expect(mocks.latest).toHaveBeenCalledExactlyOnceWith(ids.template, identity);
  const notice = all(node()).find(item => item.type === AdminNotice && text(item).includes('다른 사람이 먼저 바꿨습니다.'))!;
  expect(text(notice)).toContain('[내 입력으로 덮어쓰기]를 누르면 다른 사람이 저장한 내용이 사라지고 내 입력으로 바뀝니다.');
  /* 지금 저장된 템플릿(SavedTemplate)은 펼치지 않으므로 받은 값으로 확인한다. 버전은 화면에 내보이지 않는다. */
  expect(all(notice).find(item => (item.props.template as { name?: string } | undefined)?.name === '먼저 고친 이름')).toBeDefined();
  expect(text(node())).not.toContain('버전'); expect(button('저장')).toBeUndefined();
  expect(all(node()).find(item => item.type === 'fieldset' && 'disabled' in item.props)?.props.disabled).toBe(true);
  /* 덮어쓰면 같은 입력을 지금 저장된 템플릿 위에 다시 보낸다. */
  mocks.save.mockImplementationOnce(answering({ ...saved, expectedRevision: 8, template: { ...template, revision: 9 } }));
  click('내 입력으로 덮어쓰기'); await flush();
  expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: 8, name: save.name, settings: { feeType: 'free' } });
  expect(mocks.save.mock.calls[1][0].operationId).not.toBe(mocks.save.mock.calls[0][0].operationId);
  expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith({ ...template, revision: 9 });
});
it('[내 입력 버리기]는 사라지는 것을 묻고 목록을 다시 읽게 닫는다', async () => {
  const NativeFormData = FormData;
  vi.stubGlobal('FormData', class extends NativeFormData { constructor(source?: FormData) { super(); source?.forEach((value, key) => this.append(key, value)); } });
  const { template, sealed } = shippingFixtures(); formTemplate = template;
  mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다.', uncertain: false, conflict: true, changed: true }); mocks.seal.mockImplementationOnce(answering({ ...sealed, command: 'save' }));
  const confirm = stubAdminConfirm(true);
  try {
    mode = 'form'; render(); effects();
    const form = new NativeFormData(); for (const [key, value] of Object.entries({ id: ids.template, revision: '1', name: '합성 배송 조건', enabled: 'true', originId: ids.origin,
      feeType: 'free', individualFee: '3500', claimReturnAllowed: '', claimExchangeAllowed: '', claimRestrictionReason: '', claimReturnFee: '', claimReturnFreeShippingFee: '', claimExchangeFee: '' })) form.set(key, value);
    await (all(node()).find(item => item.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: form }); await flush();
    click('내 입력 버리기'); await flush();
    expect(confirm.mock.calls[0][0]).toBe('지금 적은 내용이 사라지고, 다른 사람이 저장한 내용이 그대로 남습니다.'); expect(mocks.closed).toHaveBeenCalledExactlyOnceWith(true);
  } finally { confirm.restore(); }
});
it('적은 내용이 있으면 닫기 전에 묻고, 없으면 묻지 않고 닫는다', async () => {
  const confirm = stubAdminConfirm(false);
  try {
    mode = 'form'; render(); effects(); click('닫기'); await flush(); expect(confirm).not.toHaveBeenCalled(); expect(mocks.closed).toHaveBeenCalledExactlyOnceWith(false);
    (all(node()).find(item => item.type === 'form')!.props.onChange as () => void)();
    click('닫기'); await flush(); expect(confirm.mock.calls[0][0]).toBe('지금 적은 내용이 사라집니다.'); expect(mocks.closed).toHaveBeenCalledOnce();
    confirm.mockReturnValue(true); click('닫기'); await flush(); expect(mocks.closed).toHaveBeenCalledTimes(2);
  } finally { confirm.restore(); }
});
it('쇼핑몰 주문 설정이 꺼져 있으면 함께 바꾸는 것을 고르기 전에 막고 이유를 보인다', async () => {
  const toggles = () => all(node()).filter(item => item.type === 'input' && 'data-shipping-extra-toggle' in item.props);
  mode = 'form'; runtimeEnabled = false; render(); effects();
  expect(toggles().map(item => [item.props['data-shipping-extra-toggle'], item.props.checked, item.props.disabled])).toEqual([['delivery', false, true], ['chargeGroup', false, true], ['fulfillment', false, true]]);
  expect(text(node())).toContain(SHIPPING_SETTINGS_RUNTIME_OFF); expect(text(node())).not.toContain('운영 설정');
  resetHooks(); runtimeEnabled = true; render(); effects();
  expect(toggles().every(item => item.props.disabled === false)).toBe(true); expect(text(node())).not.toContain('지금 쇼핑몰 설정에서는');
  /* 이미 그렇게 저장된 템플릿은 체크를 끌 수 있게 열어 두고, 무엇을 끄면 적용되는지 말한다. */
  const { template } = shippingFixtures(); resetHooks(); runtimeEnabled = false; formTemplate = { ...template, settings: { ...template.settings, chargeGroup: { mode: 'clear' } } }; render(); effects();
  expect(toggles().map(item => [item.props.checked, item.props.disabled])).toEqual([[false, true], [true, false], [false, true]]);
  expect(text(node())).toContain('함께 바꾸는 것(묶음그룹)의 체크를 끄고 저장하면 적용할 수 있습니다.');
});
it('수량별·착불 설정을 체크하면 공용 parser로 3구간·구매자 선택 정책을 직렬화한다', async () => {
  const NativeFormData = FormData;
  vi.stubGlobal('FormData', class extends NativeFormData { constructor(source?: FormData) { super(); source?.forEach((value, key) => this.append(key, value)); } });
  mode = 'form'; render(); effects();
  expect(all(node()).some(item => item.type === GoodsDeliveryPricingFields)).toBe(false);
  const toggle = all(node()).find(item => item.type === 'input' && item.props['data-shipping-extra-toggle'] === 'delivery')!;
  (toggle.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  const delivery = all(node()).find(item => item.type === GoodsDeliveryPricingFields)!;
  (delivery.props.onChange as (draft: GoodsTermsDraft['delivery']) => void)({ status: 'active', fields: { kind: 'tier3', baseFee: '3000', interval: '7', firstLimit: '2', secondLimit: '4', extra1: '1000', extra2: '2000', paymentMode: 'buyer_choice' } });
  const form = new NativeFormData(); for (const [key, value] of Object.entries({ id: ids.template, revision: '0', name: '합성 배송 조건', enabled: 'true', originId: ids.origin,
    feeType: 'free', individualFee: '3500', claimReturnAllowed: '', claimExchangeAllowed: '', claimRestrictionReason: '', claimReturnFee: '', claimReturnFreeShippingFee: '', claimExchangeFee: '' })) form.set(key, value);
  const element = all(node()).find(item => item.type === 'form')!;
  await (element.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: form }); await flush();
  expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.save.mock.calls[0][0]).toMatchObject({ command: 'save', expectedRevision: 0, ...identity,
    settings: { delivery: { mode: 'replace', policy: shippingFixtures().policy }, chargeGroup: { mode: 'preserve' }, fulfillment: { mode: 'preserve' } } });
  const journal = JSON.parse([...values.values()][0]); expect(journal.command).toBe('save'); expect(journal).not.toHaveProperty('settings');
});
it('수령 방식을 체크하면 적용 근거·확인 체크 없이 저장한다', async () => {
  const NativeFormData = FormData;
  vi.stubGlobal('FormData', class extends NativeFormData { constructor(source?: FormData) { super(); source?.forEach((value, key) => this.append(key, value)); } });
  mode = 'form'; render(); effects();
  const toggle = all(node()).find(item => item.type === 'input' && item.props['data-shipping-extra-toggle'] === 'fulfillment')!;
  (toggle.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  expect(text(node())).toContain('수령 방식은 택배 하나입니다.'); expect(text(node())).toContain('디지털 파일이 새 주문부터 빠집니다.');
  for (const gone of ['적용 근거', '확인했습니다']) expect(text(node())).not.toContain(gone);
  const form = new NativeFormData(); for (const [key, value] of Object.entries({ id: ids.template, revision: '0', name: '합성 배송 조건', enabled: 'true', originId: ids.origin,
    feeType: 'policy', individualFee: '0', claimReturnAllowed: '', claimExchangeAllowed: '', claimRestrictionReason: '', claimReturnFee: '', claimReturnFreeShippingFee: '', claimExchangeFee: '' })) form.set(key, value);
  await (all(node()).find(item => item.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: form }); await flush();
  expect(mocks.save.mock.calls[0][0].settings.fulfillment).toEqual({ mode: 'replace', policy: { mode: 'shipping',
    methods: [{ method: 'parcel', feeAmount: null, feeBasis: 'per_order', installationFee: 0 }], publicNote: '' } });
});

it('목록에서 선택한 상품은 서버 비교만 먼저 하고 적용 버튼 전에는 저장하지 않는다', async () => {
  mode = 'apply'; initialGoodIds = ['good-1']; node(); effects(); await flush();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.template, ['good-1'], identity);
  expect(mocks.apply).not.toHaveBeenCalled(); expect(picker()).toBeUndefined();
  expect(button('1개 상품에 적용').props.disabled).toBe(false);
  click('1개 상품에 적용'); await flush(); expect(mocks.apply).toHaveBeenCalledOnce();
  expect(mocks.apply.mock.calls[0][0].goods).toEqual([shippingFixtures().guard]);
});

/* eslint-disable react-hooks/rules-of-hooks -- The test harness owns hook slots and fixes one component root per mount. */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), assign: vi.fn(), read: vi.fn(), seal: vi.fn(), latest: vi.fn(), list: vi.fn(), find: vi.fn(), preview: vi.fn(), receipt: vi.fn(), change: vi.fn(),
  unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (callback: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, j) => dep !== hooks.memos[i].deps[j])) hooks.memos[i] = { value: callback(), deps }; return hooks.memos[i].value; },
  useId: () => 'charge-group-test', useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const i = hooks.effectIndex++, previous = hooks.effects[i]; if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { hooks.effects[i] = { deps, effect, cleanup: previous?.cleanup }; hooks.changed.push(i); } },
}));
vi.mock('@/app/admin/shipping-charge-group-actions', () => ({ saveShippingChargeGroupAction: mocks.save, assignShippingChargeGroupAction: mocks.assign,
  readShippingChargeGroupOperationAction: mocks.read, sealShippingChargeGroupOperationAction: mocks.seal,
  getShippingChargeGroupAction: mocks.latest, listShippingChargeGroupsAction: mocks.list,
  findShippingChargeGroupGoodsAction: mocks.find, previewShippingChargeGroupAssignmentAction: mocks.preview }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => {
  mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { shippingChargeGroupOperationContext, type ShippingChargeGroupListData } from '@/lib/admin/shipping-charge-groups';
import { chargeAdminFixtures, chargeIdentity as identity, chargeIds as ids } from '@/test/fixtures/shipping-charge-groups';
import { ShippingChargeGroupField, ShippingChargeGroupSummary, type ShippingChargeGroupFieldProps } from '../ShippingChargeGroupField';
import { ShippingChargeGroupEditor } from '../screens/ShippingChargeGroupsPanel';
import { ShippingChargeGroupAssignmentDialog } from './ShippingChargeGroupAssignmentDialog';
import { useShippingChargeGroupOperation, useShippingChargeGroupPending, useShippingChargeGroupSession } from './useShippingChargeGroupOperation';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let scope: ReturnType<typeof createGoodsDescriptionToolScope>, storageValues: Map<string, string>, mode: 'operation' | 'session' | 'field' | 'editor' | 'assignment';
let command: 'save' | 'assign', groupId: string | null, fieldProps: ShippingChargeGroupFieldProps;
let editorProps: Parameters<typeof ShippingChargeGroupEditor>[0];
let assignmentProps: Parameters<typeof ShippingChargeGroupAssignmentDialog>[0];
function listData(): ShippingChargeGroupListData {
  const { group, origin } = chargeAdminFixtures();
  return { actorId: ids.actor, sessionId: ids.session, runtimeEnabled: true, page: 1, pageSize: 20, total: 1, groups: [group], origins: [origin], canManageRegional: true };
}
function resetHooks() { for (const effect of hooks.effects) effect.cleanup?.(); hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; }
function render() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0;
  if (mode === 'session') { const session = useShippingChargeGroupSession(ids.actor); return { ...session, pending: useShippingChargeGroupPending(session.identity) }; }
  if (mode === 'field') return ShippingChargeGroupField(fieldProps);
  if (mode === 'editor') return ShippingChargeGroupEditor(editorProps);
  if (mode === 'assignment') return ShippingChargeGroupAssignmentDialog(assignmentProps);
  return useShippingChargeGroupOperation({ identity, scope, groupId, command, onReceipt: mocks.receipt });
}
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 7; i++) { await Promise.resolve(); render(); effects(); } }
const operation = () => render() as ReturnType<typeof useShippingChargeGroupOperation>;
const node = () => render() as ReactElement;
const button = (label: string) => all(node()).find(item => item.type === 'button' && text(item) === label)!;
function click(label: string) { const item = button(label); expect(item).toBeDefined(); expect(item.props.disabled).not.toBe(true); (item.props.onClick as () => void)(); }
function field(label: string) { const parent = all(node()).find(item => item.type === 'label' && text(item).startsWith(label)); return parent && all(parent.props.children as ReactNode).find(item => ['input', 'select', 'textarea'].includes(String(item.type))); }
function change(label: string, value: string | boolean) { const item = field(label)!; expect(item).toBeDefined(); (item.props.onChange as (event: unknown) => void)({ target: typeof value === 'boolean' ? { checked: value } : { value } }); }
async function submit() { const form = all(node()).find(item => item.type === 'form')!; await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }); await flush(); }
function authenticate(actor = ids.actor, session = ids.session) { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
beforeEach(() => {
  resetHooks(); vi.clearAllMocks(); mocks.auth = null; storageValues = new Map(); mode = 'operation'; command = 'assign'; groupId = ids.group;
  const storage = { getItem: (key: string) => storageValues.get(key) ?? null, setItem: (key: string, value: string) => storageValues.set(key, value), removeItem: (key: string) => storageValues.delete(key),
    key: (index: number) => [...storageValues.keys()][index] ?? null, get length() { return storageValues.size; } };
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('window', Object.assign(new EventTarget(), { sessionStorage: storage }));
  scope = createGoodsDescriptionToolScope(ids.actor); scope.activate(); scope.setEnabled(true); scope.authenticate(ids.actor, ids.session);
  const fixtures = chargeAdminFixtures();
  mocks.save.mockResolvedValue({ error: '응답 불명', uncertain: true }); mocks.assign.mockResolvedValue({ error: '응답 불명', uncertain: true });
  mocks.read.mockResolvedValue({ data: null }); mocks.seal.mockResolvedValue({ data: { ...fixtures.sealed, command: 'assign', expectedRevision: 1 } });
  mocks.latest.mockResolvedValue({ data: { actorId: ids.actor, sessionId: ids.session, runtimeEnabled: true, group: fixtures.group, origin: fixtures.origin, canManageRegional: true } });
  mocks.list.mockResolvedValue({ data: listData() });
  mocks.find.mockResolvedValue({ data: { actorId: ids.actor, sessionId: ids.session, page: 1, pageSize: 20, total: 1, goods: [fixtures.good] } });
  mocks.preview.mockResolvedValue({ data: fixtures.preview });
  fieldProps = { identity, originId: ids.origin, value: null, onChange: mocks.change };
  editorProps = { start: { id: ids.group, originId: ids.origin, data: { actorId: ids.actor, sessionId: ids.session, runtimeEnabled: true,
    group: fixtures.group, origin: fixtures.origin, canManageRegional: true } }, identity, scope, origins: [], carriers: [], canEdit: true,
    canManageRegional: true, initialList: listData(), otherPending: false, onClose: vi.fn(), onSaved: mocks.receipt };
  assignmentProps = { group: fixtures.group, identity, scope, canEdit: true, onClose: vi.fn(), onApplied: mocks.receipt };
});
afterEach(() => { resetHooks(); scope.dispose(); vi.unstubAllGlobals(); });

it('중복 클릭은 한 번 전송하고 요청 메타데이터 6개만 보관한다', async () => {
  const { assign } = chargeAdminFixtures(), pending = deferred<unknown>(); mocks.assign.mockReturnValueOnce(pending.promise);
  const current = operation(); effects(); void current.send(assign); void current.send(assign);
  expect(mocks.assign).toHaveBeenCalledTimes(1); expect(storageValues.size).toBe(1);
  expect(JSON.parse([...storageValues.values()][0])).toEqual(shippingChargeGroupOperationContext(assign));
  expect(Object.keys(JSON.parse([...storageValues.values()][0]))).toHaveLength(6);
  pending.resolve({ error: '응답 불명', uncertain: true }); await flush();
  await operation().send({ ...assign, operationId: ids.other }); expect(mocks.assign).toHaveBeenCalledTimes(1);
});
it('응답 불명·새로고침 뒤에는 원문 재전송 없이 동일 UUID 읽기·봉인으로 해결한다', async () => {
  operation(); effects(); const { assign } = chargeAdminFixtures(); await operation().send(assign); resetHooks(); operation(); effects();
  expect(operation().context).toEqual(shippingChargeGroupOperationContext(assign));
  await operation().recover(); expect(storageValues.size).toBe(1); expect(operation().message).toContain('새 요청을 만들지 않고');
  await operation().send({ ...assign, operationId: ids.other }); expect(mocks.assign).toHaveBeenCalledTimes(1);
  await operation().recover(true); expect(mocks.seal).toHaveBeenCalledExactlyOnceWith(shippingChargeGroupOperationContext(assign));
  expect(storageValues.size).toBe(0); expect(mocks.receipt).toHaveBeenCalledOnce();
});
it('봉인과 늦은 저장이 경합하면 확정 영수증으로 수렴한다', async () => {
  operation(); effects(); await operation().send(chargeAdminFixtures().assign); mocks.seal.mockResolvedValueOnce({ data: chargeAdminFixtures().assigned });
  await operation().recover(true); expect(storageValues.size).toBe(0); expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(chargeAdminFixtures().assigned);
});
it('다른 계정·세션 영수증은 journal과 완료 callback을 변경하지 않는다', async () => {
  operation(); effects(); mocks.assign.mockResolvedValueOnce({ data: { ...chargeAdminFixtures().assigned, sessionId: ids.other } });
  await operation().send(chargeAdminFixtures().assign); expect(storageValues.size).toBe(1); expect(mocks.receipt).not.toHaveBeenCalled();
});
it.each(['auth', 'unmount'] as const)('%s 이후 늦은 응답은 현재 화면에 반영하지 않는다', async kind => {
  const pending = deferred<unknown>(); mocks.assign.mockReturnValueOnce(pending.promise); operation(); effects(); void operation().send(chargeAdminFixtures().assign);
  if (kind === 'auth') scope.authenticate(ids.actor, ids.other); else for (const effect of hooks.effects) effect.cleanup?.();
  pending.resolve({ data: chargeAdminFixtures().assigned }); await flush(); expect(mocks.receipt).not.toHaveBeenCalled();
});
it('확정 오류도 같은 요청번호를 유지하고 새 UUID로 우회하지 않는다', async () => {
  mocks.assign.mockResolvedValueOnce({ error: '저장 기준 변경', uncertain: false, conflict: true }); operation(); effects();
  await operation().send(chargeAdminFixtures().assign); expect(operation().context).not.toBeNull(); expect(storageValues.size).toBe(1);
});
it('원문 전체 parser가 거부하거나 checkpoint가 실패하면 전송하지 않는다', async () => {
  operation(); effects(); await operation().send({ ...chargeAdminFixtures().assign, goods: [] }); expect(mocks.assign).not.toHaveBeenCalled(); expect(storageValues.size).toBe(0);
  vi.spyOn(sessionStorage, 'setItem').mockImplementationOnce(() => { throw new Error('unavailable'); });
  await operation().send(chargeAdminFixtures().assign); expect(mocks.assign).not.toHaveBeenCalled(); expect(operation().error).toContain('전송하지 않았습니다');
});
it('미확정 요청은 beforeunload 경고와 목록 recovery 대상으로 남는다', async () => {
  command = 'save'; operation(); effects(); await operation().send(chargeAdminFixtures().save); await flush();
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  resetHooks(); mode = 'session'; render(); effects(); authenticate(); await flush();
  expect((render() as { pending: unknown[] }).pending).toEqual([shippingChargeGroupOperationContext(chargeAdminFixtures().save)]);
});
it.each(['session', 'account', 'signout'] as const)('%s 변경은 다른 세션에 journal과 입력 권한을 넘기지 않는다', async kind => {
  operation(); effects(); await operation().send(chargeAdminFixtures().assign); resetHooks(); mode = 'session'; render(); effects(); authenticate(); await flush();
  if (kind === 'session') authenticate(ids.actor, ids.other); if (kind === 'account') authenticate(ids.other, ids.session);
  if (kind === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  await flush(); expect((render() as ReturnType<typeof useShippingChargeGroupSession>).identity).toBeNull(); expect(storageValues.size).toBe(0);
});
it('명시적 배정 해제도 nullable group UUID로 복구하고 상품 식별자를 journal에 남기지 않는다', async () => {
  groupId = null; const request = { ...chargeAdminFixtures().assign, groupId: null, expectedRevision: 0 };
  operation(); effects(); await operation().send(request); expect(operation().context?.groupId).toBeNull();
  expect([...storageValues.values()][0]).not.toContain('good-a'); expect(mocks.assign).toHaveBeenCalledExactlyOnceWith(request);
});

it('그룹 선택은 같은 출고지의 활성 그룹만 보이며 기본 그룹을 자동 배정하지 않는다', async () => {
  mode = 'field'; const { group } = chargeAdminFixtures(); mocks.list.mockResolvedValueOnce({ data: { ...listData(), groups: [
    { ...group, isDefault: true }, { ...group, id: ids.other, originId: ids.other }, { ...group, id: ids.version, enabled: false },
  ] } }); render(); effects(); click('배송비 묶음그룹 선택'); await flush();
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ originId: ids.origin, query: '', status: 'active', page: 1 }, identity);
  expect(all(node()).filter(item => item.type === 'li')).toHaveLength(1); expect(mocks.change).not.toHaveBeenCalled();
  click('선택'); expect(mocks.change).toHaveBeenCalledExactlyOnceWith(ids.group, { ...group, isDefault: true });
});
it('읽기 전용 자식 필드는 선택·해제·이름 조회로 쓰기를 유도하지 않는다', async () => {
  mode = 'field'; fieldProps = { ...fieldProps, value: ids.group, selectedGroup: chargeAdminFixtures().group, readOnly: true, ownerGoodId: 'owner' };
  render(); effects(); await flush(); expect(all(node()).filter(item => item.type === 'button')).toHaveLength(0); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
  expect(text(ShippingChargeGroupSummary({ group: chargeAdminFixtures().group, inherited: true, ownerGoodId: 'owner' }))).toContain('원상품의 묶음그룹 배정');
});
it('출고지나 세션이 바뀌면 이전 검색 결과와 늦은 응답을 격리한다', async () => {
  mode = 'field'; const pending = deferred<unknown>(); mocks.list.mockReturnValueOnce(pending.promise); render(); effects(); click('배송비 묶음그룹 선택');
  fieldProps = { ...fieldProps, identity: { ...identity, expectedSessionId: ids.other }, originId: ids.other }; render(); effects();
  pending.resolve({ data: listData() }); await flush(); expect(all(node()).filter(item => item.type === 'li')).toHaveLength(0); expect(mocks.change).not.toHaveBeenCalled();
  expect(button('배송비 묶음그룹 선택').props['aria-expanded']).toBe(false);
});
it('조회 실패는 선택을 해제하거나 무료배송으로 바꾸지 않는다', async () => {
  mode = 'field'; fieldProps = { ...fieldProps, value: ids.group }; mocks.latest.mockResolvedValueOnce({ error: '조회 실패' });
  render(); effects(); await flush(); const summary = all(node()).find(item => item.type === ShippingChargeGroupSummary)!;
  expect(summary.props.group).toBeUndefined(); expect(text(node())).toContain('조회 실패'); expect(mocks.change).not.toHaveBeenCalled();
  expect(text(ShippingChargeGroupSummary({ group: undefined }))).toContain('미확인 상태를 미지정이나 무료배송으로 처리하지 않습니다');
});

it('그룹 편집은 기본 그룹 CAS와 출고지 저장 기준을 함께 전송한다', async () => {
  mode = 'editor'; render(); effects(); change('묶음그룹 이름', '명시적 변경'); change('계산 방식', 'max'); await submit();
  expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ ...identity, command: 'save', groupId: ids.group,
    expectedRevision: 1, originId: ids.origin, originUpdatedAt: chargeAdminFixtures().origin.updatedAt, expectedDefaultGroupId: null, expectedDefaultGroupRevision: 0,
    values: { name: '명시적 변경', calculationMode: 'max' }, attestRegional: false });
  expect(button('새 버전 저장').props.disabled).toBe(true); expect(button('저장 결과 확인')).toBeDefined();
});
it('배정 상품이 있으면 사용 중지·보관 handler 우회도 전송되지 않는다', async () => {
  mode = 'editor'; editorProps.start.data!.group.assignedCount = 1; render(); effects();
  expect(field('사용 여부')?.props.disabled).toBe(true); change('사용 여부', 'false'); await submit();
  expect(mocks.save).not.toHaveBeenCalled(); expect(text(node())).toContain('배정된 상품을 먼저 해제');
});
it('지역 설정 변경은 지역 관리 권한과 명시적 확인을 모두 요구한다', async () => {
  mode = 'editor'; editorProps.canManageRegional = false; render(); effects(); change('지역 추가료 적용 방식', 'override'); await submit();
  expect(mocks.save).not.toHaveBeenCalled(); expect(text(node())).toContain('별도 관리 권한과 명시적인 확인');
});
it('기존 그룹 지역 정책을 유지한 이름 변경은 일반 상품관리 권한으로 저장한다', async () => {
  mode = 'editor'; editorProps.canManageRegional = false; editorProps.start.data!.group.regional = { mode: 'override', policy: chargeAdminFixtures().region };
  render(); effects(); change('묶음그룹 이름', '지역 설정 유지'); await submit(); expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ attestRegional: false, values: { regional: { mode: 'override', policy: chargeAdminFixtures().region } } });
});
it('봉인 후에는 최신 저장 기준 비교·선택을 거쳐야 새 요청을 만들 수 있다', async () => {
  mode = 'editor'; const { group, origin } = chargeAdminFixtures(); render(); effects(); change('묶음그룹 이름', '내 입력'); await submit();
  const original = mocks.save.mock.calls[0][0]; mocks.seal.mockResolvedValueOnce({ data: { ...chargeAdminFixtures().sealed, operationId: original.operationId, expectedRevision: 1 } });
  click('미처리 요청 종료'); await flush(); expect(button('새 버전 저장').props.disabled).toBe(true); await submit(); expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.latest.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, runtimeEnabled: true,
    group: { ...group, revision: 3, name: '최신 저장본', calculationMode: 'max' }, origin, canManageRegional: true } });
  click('최신 저장 기준 확인'); await flush(); expect(text(node())).toContain('내 입력'); click('내 입력 유지 · 최신 버전을 저장 기준으로'); await flush(); await submit();
  expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: 3, values: { name: '내 입력', calculationMode: 'min' } });
  expect(mocks.save.mock.calls[1][0].operationId).not.toBe(original.operationId);
});
it('변경 없는 저장 영수증은 동일 revision도 완료로 처리한다', async () => {
  mode = 'editor'; mocks.save.mockImplementationOnce(async request => ({ data: { ...chargeAdminFixtures().saved,
    operationId: request.operationId, expectedRevision: 1, group: chargeAdminFixtures().group } }));
  render(); effects(); await submit(); expect(mocks.receipt).toHaveBeenCalledOnce(); expect(storageValues.size).toBe(0);
});

function selectAssignmentGood(index = 0) {
  const checkbox = all(node()).filter(item => item.type === 'input' && item.props.type === 'checkbox')[index];
  expect(checkbox).toBeDefined(); (checkbox.props.onChange as () => void)();
}
function selectAssignmentTarget() {
  change('선택 상품의 배정 변경', 'set');
  const picker = all(node()).find(item => item.type === ShippingChargeGroupField)!;
  (picker.props.onChange as (id: string, group: unknown) => void)(ids.group, chargeAdminFixtures().group);
}
async function mountAssignment() { mode = 'assignment'; render(); effects(); await flush(); }

it('상품 배정 조회는 현재 연결/전체 출고지 필터를 명시적으로 바꾸며 자동 선택하지 않는다', async () => {
  await mountAssignment(); expect(mocks.find).toHaveBeenCalledExactlyOnceWith({ originId: ids.origin, groupId: ids.group, query: '', page: 1 }, identity);
  expect(text(node())).toContain('선택 0개'); expect(button('배정 미리보기').props.disabled).toBe(true);
  change('조회 범위', 'all'); change('상품명·상품코드·상품번호', '찾는 상품'); await submit();
  expect(mocks.find).toHaveBeenLastCalledWith({ originId: ids.origin, groupId: null, query: '찾는 상품', page: 1 }, identity);
  expect(text(node())).toContain('선택 0개'); expect(mocks.preview).not.toHaveBeenCalled();
});
it('상품 배정에서 자식과 editable인 차단 원상품은 선택 handler도 거부한다', async () => {
  const { good } = chargeAdminFixtures(); mocks.find.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, page: 1, pageSize: 20, total: 3,
    goods: [good, { ...good, id: 'child', ownerGoodId: good.id, familyGoodIds: [good.id, 'child'], effectiveCount: 2, editable: false, blocker: 'goods_aggregation_policy_owned_by_source' },
      { ...good, id: 'blocked', ownerGoodId: 'blocked', familyGoodIds: ['blocked'], editable: true, blocker: 'collect_contract_not_ready' }] } });
  await mountAssignment(); const checkboxes = all(node()).filter(item => item.type === 'input' && item.props.type === 'checkbox');
  expect(checkboxes[1].props.disabled).toBe(true); expect(checkboxes[2].props.disabled).toBe(true);
  selectAssignmentGood(1); selectAssignmentGood(2); expect(text(node())).toContain('선택 0개'); selectAssignmentGood(); expect(text(node())).toContain('선택 1개');
});
it('상품 배정은 fresh preview의 full guard와 원상품 공유 범위·출고지 CAS를 전송한다', async () => {
  const { good, guard, preview, origin } = chargeAdminFixtures(), familyGoodIds = ['good-a', 'child'];
  mocks.find.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, page: 1, pageSize: 20, total: 1, goods: [{ ...good, familyGoodIds, effectiveCount: 2 }] } });
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, goods: [{ ...preview.goods[0], familyGoodIds, effectiveCount: 2 }] } });
  await mountAssignment(); selectAssignmentGood(); selectAssignmentTarget(); click('배정 미리보기'); await flush();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.group, ['good-a'], identity); expect(text(node())).toContain('합산군 전체가 배정을 공유');
  click('1개 원상품에 적용'); await flush(); expect(mocks.assign).toHaveBeenCalledOnce();
  expect(mocks.assign.mock.calls[0][0]).toMatchObject({ ...identity, command: 'assign', groupId: ids.group, expectedRevision: 1,
    origins: [origin], goods: [{ ...guard, familyGoodIds }] });
  expect(button('저장 결과 확인')).toBeDefined(); expect(storageValues.size).toBe(1); expect([...storageValues.values()][0]).not.toContain('good-a');
});
it('상품 배정 해제는 null 그룹·0 revision으로 미리보기 후 적용하며 무료배송으로 표시하지 않는다', async () => {
  const { preview } = chargeAdminFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, group: null, goods: [{ ...preview.goods[0], afterGroup: null }] } });
  await mountAssignment(); selectAssignmentGood(); change('선택 상품의 배정 변경', 'clear'); expect(text(node())).toContain('무료배송으로 바꾸지 않습니다');
  click('배정 미리보기'); await flush(); expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(null, ['good-a'], identity);
  click('1개 원상품에 적용'); await flush(); expect(mocks.assign.mock.calls[0][0]).toMatchObject({ groupId: null, expectedRevision: 0, command: 'assign' });
});
it('상품 배정 preview 차단은 전체 적용 버튼과 handler를 함께 닫는다', async () => {
  const { preview } = chargeAdminFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, canAssign: false,
    goods: [{ ...preview.goods[0], editable: true, blocker: 'collect_contract_not_ready' }] } });
  await mountAssignment(); selectAssignmentGood(); selectAssignmentTarget(); click('배정 미리보기'); await flush();
  expect(button('1개 원상품에 적용').props.disabled).toBe(true); (button('1개 원상품에 적용').props.onClick as () => void)();
  expect(mocks.assign).not.toHaveBeenCalled(); expect(text(node())).toContain('전체 적용을 중단');
});
it('상품 배정 preview가 다른 상품이나 세션으로 돌아오면 전송 입력을 만들지 않는다', async () => {
  const { preview } = chargeAdminFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, sessionId: ids.other } });
  await mountAssignment(); selectAssignmentGood(); selectAssignmentTarget(); click('배정 미리보기'); await flush();
  expect(text(node())).toContain('현재 선택과 다른 미리보기'); expect(button('1개 원상품에 적용')).toBeUndefined(); expect(mocks.assign).not.toHaveBeenCalled();
});
it('상품 배정은 100개 선택 한도를 handler에서도 제한한다', async () => {
  const { good } = chargeAdminFixtures(), goods = Array.from({ length: 101 }, (_, index) => ({ ...good, id: `good-${index}`, ownerGoodId: `good-${index}`, familyGoodIds: [`good-${index}`] }));
  mocks.find.mockReset();
  for (let page = 1; page <= 6; page++) mocks.find.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, page, pageSize: 20,
    total: 101, goods: goods.slice((page - 1) * 20, page * 20) } });
  await mountAssignment();
  for (let page = 1; page <= 6; page++) {
    for (let index = 0; index < (page === 6 ? 1 : 20); index++) selectAssignmentGood(index);
    if (page < 6) { click('다음'); await flush(); }
  }
  expect(text(node())).toContain('선택 100개'); expect(text(node())).toContain('한 번에 최대 100개 원상품');
});
it('상품 배정 읽기 전용은 검색하되 상품 선택과 변경 작업을 만들지 않는다', async () => {
  assignmentProps.canEdit = false; await mountAssignment(); expect(text(node())).toContain('상품 배정은 읽기 전용');
  selectAssignmentGood(); expect(text(node())).toContain('선택 0개'); expect(button('배정 미리보기')).toBeUndefined(); expect(mocks.assign).not.toHaveBeenCalled();
});
it.each(['shipping_charge_group_origin_unavailable', 'collect_contract_not_ready', 'shipping_charge_group_unavailable', 'shipping_charge_group_origin_mismatch'] as const)('상품 배정 해제는 %s 상품도 선택하고 clear preview로 최종 판단한다', async blocker => {
  const { good, preview } = chargeAdminFixtures(); mocks.find.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, page: 1, pageSize: 20, total: 2,
    goods: [{ ...good, blocker }, { ...good, id: 'child', editable: false, blocker: 'goods_aggregation_policy_owned_by_source', ownerGoodId: good.id, familyGoodIds: [good.id, 'child'], effectiveCount: 2 }] } });
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, group: null, goods: [{ ...preview.goods[0], afterGroup: null }] } });
  await mountAssignment(); expect(all(node()).filter(item => item.type === 'input' && item.props.type === 'checkbox')[0].props.disabled).toBe(true);
  change('선택 상품의 배정 변경', 'clear'); const checkboxes = all(node()).filter(item => item.type === 'input' && item.props.type === 'checkbox');
  expect(checkboxes[0].props.disabled).toBe(false); expect(checkboxes[1].props.disabled).toBe(true); selectAssignmentGood(1); expect(text(node())).toContain('선택 0개');
  selectAssignmentGood(); click('배정 미리보기'); await flush(); expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(null, ['good-a'], identity);
  click('1개 원상품에 적용'); await flush(); expect(mocks.assign).toHaveBeenCalledOnce(); expect(mocks.assign.mock.calls[0][0]).toMatchObject({ groupId: null, expectedRevision: 0 });
});
it('상품 배정 해제도 거래 계약이 준비되지 않은 상품은 선택하지 않는다', async () => {
  const { good } = chargeAdminFixtures(); mocks.find.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, page: 1, pageSize: 20, total: 1,
    goods: [{ ...good, blocker: 'checkout_contract_upgrade_required' }] } });
  await mountAssignment(); change('선택 상품의 배정 변경', 'clear');
  expect(all(node()).filter(item => item.type === 'input' && item.props.type === 'checkbox')[0].props.disabled).toBe(true);
  selectAssignmentGood(); expect(text(node())).toContain('선택 0개'); expect(mocks.preview).not.toHaveBeenCalled();
});
it('상품 배정 해제 preview가 거부하면 진단 blocker와 무관하게 전체 적용을 중단한다', async () => {
  const { good, preview } = chargeAdminFixtures(); mocks.find.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, page: 1, pageSize: 20, total: 1,
    goods: [{ ...good, blocker: 'collect_contract_not_ready' }] } });
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, canAssign: false, group: null, goods: [{ ...preview.goods[0], afterGroup: null }] } });
  await mountAssignment(); change('선택 상품의 배정 변경', 'clear'); selectAssignmentGood(); click('배정 미리보기'); await flush();
  expect(button('1개 원상품에 적용').props.disabled).toBe(true); (button('1개 원상품에 적용').props.onClick as () => void)(); expect(mocks.assign).not.toHaveBeenCalled();
});

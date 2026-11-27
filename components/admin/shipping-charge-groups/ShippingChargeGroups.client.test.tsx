/* eslint-disable react-hooks/rules-of-hooks -- The test harness owns hook slots and fixes one component root per mount. */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), assign: vi.fn(), read: vi.fn(), seal: vi.fn(), latest: vi.fn(), list: vi.fn(), find: vi.fn(), preview: vi.fn(), receipt: vi.fn(), failure: vi.fn(), change: vi.fn(),
  unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (callback: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, j) => dep !== hooks.memos[i].deps[j])) hooks.memos[i] = { value: callback(), deps }; return hooks.memos[i].value; },
  useCallback: (callback: unknown) => callback, useId: () => 'charge-group-test', useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
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
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { SHIPPING_CHARGE_GROUP_RUNTIME_OFF, shippingChargeGroupOperationContext, type ShippingChargeGroup, type ShippingChargeGroupGood, type ShippingChargeGroupListData,
  type ShippingChargeGroupOperationContext, type ShippingChargeGroupRegionPolicy } from '@/lib/admin/shipping-charge-groups';
import { chargeAdminFixtures, chargeId, chargeIdentity as identity, chargeIds as ids } from '@/test/fixtures/shipping-charge-groups';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { ShippingChargeGroupField, ShippingChargeGroupSummary, shippingChargeGroupPickerRowView, type ShippingChargeGroupFieldProps } from '../ShippingChargeGroupField';
import { GroupsWorkspace, ShippingChargeGroupArchiveButton } from '../screens/ShippingChargeGroupsPanel';
import { ShippingChargeGroupEditor } from './ShippingChargeGroupEditor';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { ConsoleListCard } from '@/components/admin/console/ConsoleListCard';
import { AdminPickerDialog } from '@/components/admin/console/AdminPickerDialog';
import { ShippingChargeGroupAssignmentDialog } from './ShippingChargeGroupAssignmentDialog';
import { useShippingChargeGroupOperation, useShippingChargeGroupPending, useShippingChargeGroupSession } from './useShippingChargeGroupOperation';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let scope: ReturnType<typeof createGoodsDescriptionToolScope>, storageValues: Map<string, string>, mode: 'operation' | 'session' | 'field' | 'editor' | 'assignment' | 'workspace' | 'archive';
let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
let workspaceProps: Parameters<typeof GroupsWorkspace>[0], archiveProps: Parameters<typeof ShippingChargeGroupArchiveButton>[0];
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
  if (mode === 'workspace') return GroupsWorkspace(workspaceProps);
  if (mode === 'archive') return ShippingChargeGroupArchiveButton(archiveProps);
  return useShippingChargeGroupOperation({ identity, scope, groupId, command, onReceipt: mocks.receipt, onFailure: mocks.failure });
}
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 7; i++) { await Promise.resolve(); render(); effects(); } }
const operation = () => render() as ReturnType<typeof useShippingChargeGroupOperation>;
const node = () => render() as ReactElement;
/* 편집·배정 팝업은 kit Button·Input·NativeSelect·Textarea(ADR-0028)를 쓴다. 이 얕은 렌더는 kit 부품을 펼치지 않으므로 그 요소를 그대로 찾는다 — kit 부품은 onClick·disabled·onChange를 네이티브 요소에 그대로 넘긴다. */
const CONTROL_TYPES: unknown[] = ['input', 'select', 'textarea', Input, NativeSelect, Textarea];
const button = (label: string) => all(node()).find(item => (item.type === 'button' || item.type === Button) && text(item) === label)!;
function click(label: string) { const item = button(label); expect(item).toBeDefined(); expect(item.props.disabled).not.toBe(true); (item.props.onClick as () => void)(); }
function field(label: string) { const parent = all(node()).find(item => item.type === 'label' && text(item).startsWith(label)); return parent && all(parent.props.children as ReactNode).find(item => CONTROL_TYPES.includes(item.type)); }
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
  assignmentProps = { group: fixtures.group, task: 'add', identity, scope, canEdit: true, onClose: vi.fn(), onApplied: mocks.receipt };
  workspaceProps = { identity, scope, origins: [], carriers: [], canEdit: true, canManageRegional: true };
  archiveProps = { group: fixtures.group, origin: fixtures.origin, identity, scope, disabled: false, onReceipt: mocks.receipt, onFailure: mocks.failure };
});
afterEach(() => { resetHooks(); scope.dispose(); vi.unstubAllGlobals(); confirm?.restore(); confirm = null; });
/* 저장되지 않은 것이 확실한 실패 뒤 훅이 그 일을 끝낼 때(봉인) 돌려줄 영수증. 보낸 일의 번호를 그대로 돌려준다. */
const sealOf = async (context: ShippingChargeGroupOperationContext) => ({ data: { ...chargeAdminFixtures().sealed, operationId: context.operationId, command: context.command, groupId: context.groupId, expectedRevision: context.expectedRevision } });

it('중복 클릭은 한 번 전송하고 요청 메타데이터 6개만 보관한다', async () => {
  const { assign } = chargeAdminFixtures(), pending = deferred<unknown>(); mocks.assign.mockReturnValueOnce(pending.promise);
  const current = operation(); effects(); void current.send(assign); void current.send(assign);
  expect(mocks.assign).toHaveBeenCalledTimes(1); expect(storageValues.size).toBe(1);
  expect(JSON.parse([...storageValues.values()][0])).toEqual(shippingChargeGroupOperationContext(assign));
  expect(Object.keys(JSON.parse([...storageValues.values()][0]))).toHaveLength(6);
  pending.resolve({ error: '응답 불명', uncertain: true }); await flush();
  await operation().send({ ...assign, operationId: ids.other }); expect(mocks.assign).toHaveBeenCalledTimes(1);
});
it('결과를 모르면 새로고침 뒤에도 같은 내용을 다시 보내지 않고 같은 번호로 결과만 읽거나 그만둔다', async () => {
  operation(); effects(); const { assign } = chargeAdminFixtures(); await operation().send(assign); resetHooks(); operation(); effects();
  expect(operation().context).toEqual(shippingChargeGroupOperationContext(assign));
  await operation().recover(); expect(storageValues.size).toBe(1);
  expect(operation().message).toBe('아직 저장된 것이 없습니다. [그만두고 다시 하기]를 누른 뒤 처음부터 다시 해 주세요.');
  await operation().send({ ...assign, operationId: ids.other }); expect(mocks.assign).toHaveBeenCalledTimes(1);
  await operation().recover(true); expect(mocks.seal).toHaveBeenCalledExactlyOnceWith(shippingChargeGroupOperationContext(assign));
  expect(storageValues.size).toBe(0); expect(mocks.receipt).toHaveBeenCalledOnce();
});
it('결과를 모를 때의 말은 [저장됐는지 확인]을 가리키고 요청·번호 같은 말을 쓰지 않는다', async () => {
  operation(); effects(); mocks.assign.mockRejectedValueOnce(new Error('network')); await operation().send(chargeAdminFixtures().assign);
  expect(operation().error).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
  expect(operation().context).not.toBeNull();
});
it('봉인과 늦은 저장이 경합하면 확정 영수증으로 수렴한다', async () => {
  operation(); effects(); await operation().send(chargeAdminFixtures().assign); mocks.seal.mockResolvedValueOnce({ data: chargeAdminFixtures().assigned });
  await operation().recover(true); expect(storageValues.size).toBe(0); expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(chargeAdminFixtures().assigned);
});
it('다른 계정·세션 영수증은 journal과 완료 callback을 변경하지 않는다', async () => {
  operation(); effects(); mocks.assign.mockResolvedValueOnce({ data: { ...chargeAdminFixtures().assigned, sessionId: ids.other } });
  await operation().send(chargeAdminFixtures().assign); expect(storageValues.size).toBe(1); expect(mocks.receipt).not.toHaveBeenCalled();
  expect(operation().error).toBe('다른 작업의 결과가 돌아왔습니다. [저장됐는지 확인]을 다시 눌러 주세요.');
});
it.each(['auth', 'unmount'] as const)('%s 이후 늦은 응답은 현재 화면에 반영하지 않는다', async kind => {
  const pending = deferred<unknown>(); mocks.assign.mockReturnValueOnce(pending.promise); operation(); effects(); void operation().send(chargeAdminFixtures().assign);
  if (kind === 'auth') scope.authenticate(ids.actor, ids.other); else for (const effect of hooks.effects) effect.cleanup?.();
  pending.resolve({ data: chargeAdminFixtures().assigned }); await flush(); expect(mocks.receipt).not.toHaveBeenCalled();
});
/* DB가 이유를 들어 거절하면 저장되지 않은 것이 확실하다. 운영자가 [그만두고 다시 하기]를 따로 누르지 않아도 그 일을 끝내고 이유를 알린다. */
it('저장되지 않은 것이 확실한 실패는 그 일을 바로 끝내고 이유를 알린다', async () => {
  mocks.assign.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다.', uncertain: false, conflict: true, changed: true }); operation(); effects();
  await operation().send(chargeAdminFixtures().assign); await flush();
  expect(mocks.seal).toHaveBeenCalledExactlyOnceWith(shippingChargeGroupOperationContext(chargeAdminFixtures().assign));
  expect(operation().context).toBeNull(); expect(storageValues.size).toBe(0);
  expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ error: '다른 사람이 먼저 바꿨습니다.', changed: true }); expect(mocks.receipt).not.toHaveBeenCalled();
  expect(operation().error).toBe('다른 사람이 먼저 바꿨습니다.');
  operation().reset(); expect(operation().error).toBe('');
});
it('그 일을 끝내지 못하면 번호를 남겨 [저장됐는지 확인]·[그만두고 다시 하기]로 이어 가게 한다', async () => {
  mocks.assign.mockResolvedValueOnce({ error: '다른 저장이 진행 중이라 저장하지 않았습니다.', uncertain: false, conflict: true });
  mocks.seal.mockRejectedValueOnce(new Error('network')); operation(); effects();
  await operation().send(chargeAdminFixtures().assign); await flush();
  expect(operation().context).not.toBeNull(); expect(storageValues.size).toBe(1); expect(mocks.failure).not.toHaveBeenCalled();
  expect(operation().error).toBe('다른 저장이 진행 중이라 저장하지 않았습니다.');
});
it('끝내려는 사이 이미 저장돼 있었으면 실패가 아니라 그 결과로 끝난다', async () => {
  mocks.assign.mockResolvedValueOnce({ error: '거절', uncertain: false }); mocks.seal.mockResolvedValueOnce({ data: chargeAdminFixtures().assigned }); operation(); effects();
  await operation().send(chargeAdminFixtures().assign); await flush();
  expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(chargeAdminFixtures().assigned); expect(mocks.failure).not.toHaveBeenCalled(); expect(operation().error).toBe('');
});
it('원문 전체 parser가 거부하거나 checkpoint가 실패하면 전송하지 않는다', async () => {
  operation(); effects(); await operation().send({ ...chargeAdminFixtures().assign, goods: [] }); expect(mocks.assign).not.toHaveBeenCalled(); expect(storageValues.size).toBe(0);
  expect(operation().error).toBe('로그인한 계정이나 묶음그룹이 달라 보내지 않았습니다. 화면을 새로고침한 뒤 다시 해 주세요.');
  vi.spyOn(sessionStorage, 'setItem').mockImplementationOnce(() => { throw new Error('unavailable'); });
  await operation().send(chargeAdminFixtures().assign); expect(mocks.assign).not.toHaveBeenCalled(); expect(operation().error).toContain('진행 기록을 남길 수 없어 보내지 않았습니다');
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
it('묶음그룹에서 빼기도 nullable group UUID로 복구하고 상품 식별자를 journal에 남기지 않는다', async () => {
  groupId = null; const request = { ...chargeAdminFixtures().assign, groupId: null, expectedRevision: 0 };
  operation(); effects(); await operation().send(request); expect(operation().context?.groupId).toBeNull();
  expect([...storageValues.values()][0]).not.toContain('good-a'); expect(mocks.assign).toHaveBeenCalledExactlyOnceWith(request);
});

/* 묶음그룹 고르기는 공용 선택창(AdminPickerDialog)이다. 얕은 렌더는 부품을 펼치지 않으므로 그 요소의 조회(load)·선택(onSelect) 등을 직접 부른다. */
type PickerRequest = { query: string; field: string; filter: string; page: number };
type GroupPicker = { load: (request: PickerRequest) => Promise<{ rows?: unknown[]; total?: number; page?: number; pageSize?: number; error?: string }>;
  onSelect: (group: unknown) => unknown; rowBlocked: (group: unknown) => string | null; rowView: (group: unknown) => { title: ReactNode; meta: ReactNode }; blockedReason: string | null; onClose: () => void;
  excludedNote: string; title: string; emptyText: string; description?: string };
const groupPicker = () => all(node()).find(item => item.type === AdminPickerDialog) as unknown as ReactElement<GroupPicker> | undefined;
const open = () => { click('묶음그룹 고르기'); return groupPicker()!.props; };
const firstRequest: PickerRequest = { query: '', field: '', filter: '', page: 1 };

it('묶음그룹 고르기는 지금 출고지의 사용 묶음그룹을 서버에 묻고, 열기만 해서는 추천 묶음그룹을 넣지 않는다', async () => {
  mode = 'field'; const { group } = chargeAdminFixtures(); mocks.list.mockResolvedValueOnce({ data: { ...listData(), total: 41, page: 1, groups: [{ ...group, isDefault: true }] } });
  render(); effects(); expect(groupPicker()).toBeUndefined();
  const picker = open();
  expect(picker.title).toBe('묶음그룹 고르기');
  const loaded = await picker.load({ ...firstRequest, query: '  묶음 ' });
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ originId: ids.origin, query: '묶음', status: 'active', page: 1 }, identity);
  expect(loaded).toEqual({ rows: [{ ...group, isDefault: true }], total: 41, page: 1, pageSize: 20 });
  expect(picker.excludedNote).toBe("다른 출고지의 묶음그룹과 '사용 안 함'·보관된 묶음그룹은 목록에서 뺐습니다.");
  expect(picker.emptyText).toBe('이 출고지에 고를 수 있는 묶음그룹이 없습니다. 배송정보 관리에서 묶음그룹을 먼저 만들어 주세요.');
  expect(mocks.change).not.toHaveBeenCalled();
  picker.onSelect({ ...group, isDefault: true });
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith(ids.group, { ...group, isDefault: true });
});
it('선택창은 쪽을 넘겨 다음 쪽을 묻고, 조회가 실패하면 그 이유를 창 안에 보이게 돌려준다', async () => {
  mode = 'field'; mocks.list.mockResolvedValueOnce({ data: { ...listData(), page: 2, total: 41 } }).mockResolvedValueOnce({ error: '로그인 상태나 상품관리 권한이 바뀌었습니다.', authChanged: true });
  render(); effects(); const picker = open();
  expect(await picker.load({ ...firstRequest, page: 2 })).toMatchObject({ page: 2, total: 41 });
  expect(mocks.list).toHaveBeenLastCalledWith({ originId: ids.origin, query: '', status: 'active', page: 2 }, identity);
  expect(await picker.load(firstRequest)).toEqual({ error: '로그인 상태나 상품관리 권한이 바뀌었습니다.' });
});
it('선택창에 새어 든 다른 출고지·사용 안 함·보관 묶음그룹은 고르지 않는다(창은 그대로 둔다)', () => {
  mode = 'field'; const { group } = chargeAdminFixtures(); render(); effects(); const picker = open();
  expect(picker.onSelect({ ...group, originId: ids.other })).toBe(false);
  expect(picker.onSelect({ ...group, enabled: false })).toBe(false);
  expect(picker.onSelect({ ...group, archived: true })).toBe(false);
  expect(mocks.change).not.toHaveBeenCalled();
});
it('줄에는 이름(추천)과 가장 싼(비싼) 배송비 한 번·지역별 추가배송비를 말하고 내부 값은 보이지 않는다', () => {
  mode = 'field'; const { group } = chargeAdminFixtures(); render(); effects(); const picker = open();
  const min = picker.rowView({ ...group, name: '기본 묶음', calculationMode: 'min', isDefault: true, regional: { mode: 'inherit', policy: null } });
  expect(text(min.title)).toBe('기본 묶음 추천');
  expect(text(min.meta)).toBe('가장 싼 배송비 한 번 · 지역별 추가배송비는 출고지 설정 그대로');
  const max = picker.rowView({ ...group, calculationMode: 'max', isDefault: false, regional: { mode: 'override', policy: chargeAdminFixtures().region } });
  expect(text(max.meta)).toBe('가장 비싼 배송비 한 번 · 지역별 추가배송비는 이 묶음그룹의 지역표대로');
  for (const view of [min, max]) expect(`${text(view.title)}${text(view.meta)}`).not.toMatch(/버전|최소 부과|최대 부과|무료 우선|기본 그룹|추가료|[0-9a-f]{8}-[0-9a-f]{4}/);
});
it('QA2: 저장 충돌 뒤 같은 묶음그룹도 다시 고를 수 있고, 줄에 설정이 바뀌었다고 알린다(저장해 둔 설정이 낡았을 때만)', () => {
  mode = 'field'; const { group } = chargeAdminFixtures();
  fieldProps = { ...fieldProps, value: group.id, selectedGroup: { ...group, revision: group.revision - 1 } };
  render(); effects(); const picker = open();
  expect(picker.rowBlocked(group)).toBeNull();
  expect(text(picker.rowView(group).meta)).toContain('묶음그룹 설정이 바뀌었습니다. [선택]을 다시 눌러 주세요.');
  picker.onSelect(group); expect(mocks.change).toHaveBeenCalledExactlyOnceWith(group.id, group);
});
it('QA2: 이미 최신 설정으로 고른 묶음그룹은 선택됨으로 잠기고 바뀌었다는 안내도 없다', () => {
  mode = 'field'; const { group } = chargeAdminFixtures();
  fieldProps = { ...fieldProps, value: group.id, selectedGroup: group };
  render(); effects(); const picker = open();
  expect(picker.rowBlocked(group)).toBe('선택됨');
  expect(text(picker.rowView(group).meta)).not.toContain('바뀌었습니다');
});
it('아직 고른 묶음그룹을 읽는 중이면 같은 묶음그룹에 바뀌었다는 안내를 붙이지 않는다', () => {
  mode = 'field'; const { group } = chargeAdminFixtures(); fieldProps = { ...fieldProps, value: group.id };
  render(); effects(); const picker = open();
  expect(picker.rowBlocked(group)).toBeNull(); expect(text(picker.rowView(group).meta)).not.toContain('바뀌었습니다');
});
it('다른 작업을 처리하는 중이면 열려 있는 선택창도 잠근다', () => {
  mode = 'field'; render(); effects(); expect(open().blockedReason).toBeNull();
  fieldProps = { ...fieldProps, disabled: true }; render(); expect(groupPicker()!.props.blockedReason).toContain('다른 작업을 처리하는 중');
  expect(button('묶음그룹 고르기').props.disabled).toBe(true);
});
it('출고지를 고르기 전에는 고르기 버튼이 잠기고 먼저 고르라고 말한다', () => {
  mode = 'field'; fieldProps = { ...fieldProps, originId: null }; render(); effects();
  expect(button('묶음그룹 고르기').props.disabled).toBe(true); expect(text(node())).toContain('출고지를 먼저 고르면 그 출고지의 묶음그룹을 고를 수 있습니다.');
});
it('고른 묶음그룹에서 뺄 수 있고, 빼면 열려 있던 선택창도 닫는다', () => {
  mode = 'field'; const { group } = chargeAdminFixtures(); fieldProps = { ...fieldProps, value: group.id, selectedGroup: group };
  render(); effects(); open(); expect(groupPicker()).toBeDefined(); click('묶음그룹에서 빼기');
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith(null, null); expect(groupPicker()).toBeUndefined();
});
it('버튼은 [묶음그룹 고르기]·[묶음그룹에서 빼기]다(옛 이름을 쓰지 않는다)', () => {
  mode = 'field'; const { group } = chargeAdminFixtures(); fieldProps = { ...fieldProps, value: group.id, selectedGroup: group };
  render(); effects();
  expect(all(node()).filter(item => item.type === 'button').map(item => text(item))).toEqual(['묶음그룹 고르기', '묶음그룹에서 빼기']);
  fieldProps = { ...fieldProps, allowClear: false }; expect(all(node()).filter(item => item.type === 'button').map(item => text(item))).toEqual(['묶음그룹 고르기']);
});
it('읽기 전용 자식 필드는 고르기·빼기·이름 조회로 쓰기를 유도하지 않는다', async () => {
  mode = 'field'; fieldProps = { ...fieldProps, value: ids.group, selectedGroup: chargeAdminFixtures().group, readOnly: true, ownerGoodId: 'owner' };
  render(); effects(); await flush(); expect(all(node()).filter(item => item.type === 'button')).toHaveLength(0); expect(groupPicker()).toBeUndefined(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
  expect(text(ShippingChargeGroupSummary({ group: chargeAdminFixtures().group, inherited: true, ownerGoodId: 'owner' }))).toContain('이 상품은 원상품의 묶음그룹을 함께 씁니다.');
  expect(text(ShippingChargeGroupSummary({ group: null, inherited: true, ownerGoodId: 'owner' }))).toContain('묶음그룹은 원상품에서 바꿉니다.');
});
it('출고지나 세션이 바뀌면 열려 있던 선택창을 닫고 이전 조건의 늦은 응답은 아무것도 고르지 않는다', async () => {
  mode = 'field'; const pending = deferred<unknown>(); mocks.list.mockReturnValueOnce(pending.promise); render(); effects();
  const stale = open().load(firstRequest);
  fieldProps = { ...fieldProps, identity: { ...identity, expectedSessionId: ids.other }, originId: ids.other }; render(); effects();
  pending.resolve({ data: listData() }); await stale; await flush();
  expect(groupPicker()).toBeUndefined(); expect(mocks.change).not.toHaveBeenCalled();
});
it('조회 실패는 고른 것을 풀거나 무료배송으로 바꾸지 않는다', async () => {
  mode = 'field'; fieldProps = { ...fieldProps, value: ids.group }; mocks.latest.mockResolvedValueOnce({ error: '조회 실패' });
  render(); effects(); await flush(); const summary = all(node()).find(item => item.type === ShippingChargeGroupSummary)!;
  expect(summary.props.group).toBeUndefined(); expect(text(node())).toContain('조회 실패'); expect(mocks.change).not.toHaveBeenCalled();
  expect(text(ShippingChargeGroupSummary({ group: undefined }))).toContain('묶음그룹을 확인하고 있습니다. 확인이 끝나기 전에는 배송비를 바꾸지 않습니다.');
});
it('출고지와 다른 묶음그룹이 골라져 있으면 알리고 다시 고르거나 빼게 한다', () => {
  mode = 'field'; const { group } = chargeAdminFixtures(); fieldProps = { ...fieldProps, value: group.id, selectedGroup: { ...group, originId: ids.other } };
  render(); effects(); expect(text(node())).toContain('고른 묶음그룹의 출고지가 지금 출고지와 다릅니다. 같은 출고지의 묶음그룹을 다시 고르거나 [묶음그룹에서 빼기]를 눌러 주세요.');
  fieldProps = { ...fieldProps, allowClear: false }; expect(text(node())).toContain('같은 출고지의 묶음그룹을 다시 골라 주세요.');
});

/* 요약 상자는 고른 묶음그룹의 뜻을 말과 예시 금액으로 보이고, 저장 버전·내부 번호는 보이지 않는다(화면 규칙 8). */
const summaryText = (props: Parameters<typeof ShippingChargeGroupSummary>[0]) => text(ShippingChargeGroupSummary(props));
it('요약: 가장 싼 배송비 한 번이면 예시도 가장 싼 금액이다', () => {
  const { group } = chargeAdminFixtures(); const shown = summaryText({ group: { ...group, calculationMode: 'min', regional: { mode: 'inherit', policy: null } }, example: true });
  expect(shown).toContain('같은 묶음그룹 상품을 함께 주문하면 가장 싼 배송비 한 번만 받습니다.');
  expect(shown).toContain('예) 배송비가 3,000원과 2,500원인 상품을 함께 주문하면 2,500원을 받습니다. 무료배송이 되는 상품이 하나라도 있으면 0원입니다.');
  expect(shown).toContain('지역별 추가배송비는 출고지 설정 그대로 받습니다.');
});
it('요약: 가장 비싼 배송비 한 번이면 예시도 가장 비싼 금액이고 묶음그룹 지역표를 말한다', () => {
  const { group } = chargeAdminFixtures(); const shown = summaryText({ group: { ...group, calculationMode: 'max', regional: { mode: 'override', policy: chargeAdminFixtures().region } }, example: true });
  expect(shown).toContain('가장 비싼 배송비 한 번만 받습니다.'); expect(shown).toContain('3,000원을 받습니다.');
  expect(shown).toContain('지역별 추가배송비는 이 묶음그룹의 지역표대로 한 번만 받습니다.');
});
it('요약: 표 안처럼 좁은 자리에서는 예시를 빼고, 상태·출고지는 보인다', () => {
  const { group } = chargeAdminFixtures(); const shown = summaryText({ group, originName: '김포 창고' });
  expect(shown).not.toContain('예)'); expect(shown).toContain('출고지 · 김포 창고'); expect(shown).toContain(group.name);
});
it('요약: 저장 버전·최소 부과 같은 내부 표현과 옛 이름(추가료·기본 그룹·배정)을 쓰지 않는다', () => {
  const { group } = chargeAdminFixtures(); const shown = [summaryText({ group: { ...group, revision: 7 }, example: true, manageLink: true }), summaryText({ group: null }), summaryText({ group: undefined }),
    summaryText({ group: { id: group.id, originId: group.originId, revision: 7, name: group.name, enabled: true, archived: false, calculationMode: 'min' } })].join('\n');
  expect(shown).not.toMatch(/저장 버전|버전|최소 부과|최대 부과|무료 우선|미지정|미확인|처리하지 않습니다|기본 그룹|묶음 기본료|추가료|지역 추가 배송비|배정|확인해주세요/);
  expect(shown).not.toContain(String(7));
});
it('요약: 넣지 않은 상태는 상품과 출고지의 배송비를 그대로 받는다고 말한다', () => {
  expect(summaryText({ group: null })).toBe('묶음그룹에 넣지 않음상품과 출고지의 배송비를 그대로 받습니다.');
});
it('필드는 요약에 예시와 관리 링크를 켠다(표 안의 요약은 켜지 않는다)', () => {
  mode = 'field'; render(); effects();
  const summary = all(node()).find(item => item.type === ShippingChargeGroupSummary)!;
  expect(summary.props).toMatchObject({ example: true, manageLink: true });
});

/* ── 편집 창 ── */
const carrierOf = (code: string, label: string, active = true): EditableCarrier => ({ code, label, active, trackingUrlTemplate: '', updatedAt: '2026-10-14T00:00:00Z' });
/* 서버가 돌려주는 지역표 줄은 키 순서가 화면이 만드는 줄과 다르다(jsonb). 그 모양 그대로 둔다. */
const savedRule = { id: chargeId(70), amount: 3000, postalTo: '63644', postalFrom: '63000', disposition: 'surcharge', regionLabel: '제주', addressPrefix: '' } as ShippingChargeGroupRegionPolicy['rules'][number];
const regionWithRules = (): ShippingChargeGroupRegionPolicy => ({ ...chargeAdminFixtures().region, noRulesConfirmed: false, rules: [savedRule] });
const regionFields = () => all(node()).find(item => typeof item.type === 'function' && item.type.name === 'RegionFields');
const regionTree = () => { const item = regionFields()!; return (item.type as unknown as (props: unknown) => ReactNode)(item.props); };
const patchRegion = (patch: Partial<ShippingChargeGroupRegionPolicy>) => (regionFields()!.props.onChange as (value: unknown) => void)({ ...(regionFields()!.props.policy as object), ...patch });
async function settle() { await flush(); await flush(); await flush(); }

it('묶음그룹 저장은 추천 묶음그룹과 출고지의 확인값을 함께 보내고, 결과를 모르면 [저장됐는지 확인]을 보인다', async () => {
  mode = 'editor'; mocks.save.mockRejectedValueOnce(new Error('network')); render(); effects(); change('묶음그룹 이름', '명시적 변경'); change('배송비 계산', 'max'); await submit();
  expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ ...identity, command: 'save', groupId: ids.group,
    expectedRevision: 1, originId: ids.origin, originUpdatedAt: chargeAdminFixtures().origin.updatedAt, expectedDefaultGroupId: null, expectedDefaultGroupRevision: 0,
    values: { name: '명시적 변경', calculationMode: 'max' }, attestRegional: false });
  expect(button('저장').props.disabled).toBe(true); expect(button('저장됐는지 확인')).toBeDefined(); expect(button('그만두고 다시 하기')).toBeDefined();
  expect(text(node())).toContain('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
  for (const old of ['새 버전 저장', '저장 결과 확인', '미처리 요청 종료', '최신 저장 기준 확인']) expect(button(old)).toBeUndefined();
});
it('새 묶음그룹은 [묶음그룹 추가]로 저장한다', async () => {
  mode = 'editor'; editorProps.start = { id: ids.other, data: null, originId: ids.origin }; render(); effects();
  change('묶음그룹 이름', '새 묶음'); await submit();
  expect(button('묶음그룹 추가')).toBeDefined();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ groupId: ids.other, expectedRevision: 0, originId: ids.origin, values: { name: '새 묶음', enabled: false, regional: { mode: 'inherit', policy: null } }, attestRegional: false });
});
it('고른 값의 뜻을 요약 상자가 예시와 함께 바로 되읽고, 계산 방식 설명 문단은 없다', () => {
  mode = 'editor'; render(); effects(); change('배송비 계산', 'max');
  const summary = all(node()).find(item => item.type === ShippingChargeGroupSummary)!;
  expect(summary.props).toMatchObject({ example: true, group: { name: 'TEST 묶음그룹', calculationMode: 'max', regionalMode: 'inherit', enabled: true } });
  expect(all(field('배송비 계산')!.props.children as ReactNode).map(item => text(item))).toEqual(['가장 싼 배송비 한 번', '가장 비싼 배송비 한 번']);
  expect(text(node())).not.toMatch(/최소·최대 방식|그룹 기본 배송비가 0원|참고하는 표시일 뿐|기본 그룹|그룹 보관|버전|저장 기준/);
});
it('상품이 들어 있으면 사용 안 함으로 바꿀 수 없고 까닭을 칸 아래에 말한다', async () => {
  mode = 'editor'; editorProps.start.data!.group.assignedCount = 1; render(); effects();
  expect(field('사용 여부')?.props.disabled).toBe(true); expect(text(node())).toContain('상품 1개가 들어 있어 ‘사용 안 함’으로 바꿀 수 없습니다. 목록의 상품 수를 눌러 상품을 먼저 빼 주세요.');
  change('사용 여부', 'false'); await submit();
  expect(mocks.save).not.toHaveBeenCalled(); expect(text(node())).toContain("상품 1개가 들어 있어 '사용 안 함'으로 바꿀 수 없습니다.");
});
it('보관은 이 창에 없고(목록의 [보관]·[복원]), 보관한 묶음그룹은 사용 여부가 잠긴다', () => {
  mode = 'editor'; render(); effects();
  expect(all(node()).filter(item => item.type === 'input' && item.props.type === 'checkbox')).toHaveLength(1);
  expect(text(node())).toContain('묶음그룹 고르기 창에서 ‘추천’으로 보이기');
  resetHooks(); Object.assign(editorProps.start.data!.group, { enabled: false, archived: true }); render(); effects();
  expect(field('사용 여부')?.props.disabled).toBe(true); expect(text(node())).toContain('보관한 묶음그룹입니다. 목록에서 [복원]한 뒤 ‘사용’으로 바꿀 수 있습니다.');
});
it('쇼핑몰 설정이 꺼져 있으면 사용을 고르기 전에 막고 누구에게 요청하는지 말한다', async () => {
  mode = 'editor'; editorProps.start.data!.runtimeEnabled = false; editorProps.start.data!.group.enabled = false; render(); effects();
  const use = all(field('사용 여부')!.props.children as ReactNode).find(item => item.props.value === 'true')!;
  expect(use.props.disabled).toBe(true); expect(text(node())).toContain(SHIPPING_CHARGE_GROUP_RUNTIME_OFF);
  expect(SHIPPING_CHARGE_GROUP_RUNTIME_OFF).toContain('개발 담당자에게 요청해 주세요'); expect(text(node())).not.toContain('운영 설정을 확인');
  change('사용 여부', 'true'); await submit(); expect(mocks.save).not.toHaveBeenCalled();
});
it('새로 만들 때 사용 안 하는 출고지는 목록에 없다', () => {
  mode = 'editor'; editorProps.start = { id: ids.other, data: null, originId: '' };
  editorProps.origins = [{ id: ids.origin, name: '김포', active: true }, { id: ids.other, name: '닫은 창고', active: false }] as GoodsFulfillmentOrigin[];
  render(); effects();
  expect(all(field('출고지')!.props.children as ReactNode).map(item => text(item))).toEqual(['골라 주세요', '김포']);
});
it('지역 설정을 바꾸는 저장은 최고 관리자만 할 수 있다', async () => {
  mode = 'editor'; editorProps.canManageRegional = false; render(); effects();
  expect(field('지역별 추가배송비')?.props.disabled).toBe(true); expect(text(node())).toContain('지역별 추가배송비 설정은 최고 관리자만 바꿀 수 있습니다.');
  change('지역별 추가배송비', 'override'); await submit();
  expect(mocks.save).not.toHaveBeenCalled(); expect(text(node())).toContain('지역별 추가배송비 설정을 바꾸는 저장은 최고 관리자만 할 수 있습니다.');
});
it('지역표를 쓰는 사용 안 함 묶음그룹은 최고 관리자만 사용으로 바꿀 수 있고, 잠근 까닭을 칸 아래에 말한다', () => {
  mode = 'editor'; editorProps.canManageRegional = false; Object.assign(editorProps.start.data!.group, { enabled: false, regional: { mode: 'override', policy: chargeAdminFixtures().region } });
  render(); effects(); expect(field('사용 여부')?.props.disabled).toBe(true); expect(text(node())).toContain('지역표를 쓰는 묶음그룹은 최고 관리자만 ‘사용’으로 바꿀 수 있습니다.');
});
it('지역표를 그대로 둔 이름 변경은 상품 관리 권한으로 저장하고, 저장돼 있던 줄과 근거를 그대로 보낸다', async () => {
  mode = 'editor'; editorProps.canManageRegional = false; editorProps.start.data!.group.regional = { mode: 'override', policy: regionWithRules() };
  confirm = stubAdminConfirm(false);
  render(); effects(); change('묶음그룹 이름', '지역 설정 유지'); await submit(); expect(mocks.save).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ attestRegional: false, values: { name: '지역 설정 유지', regional: { mode: 'override',
    policy: { sourceEvidence: 'TEST 계약 참조', noRulesConfirmed: false, rules: [{ id: chargeId(70), postalFrom: '63000', postalTo: '63644', regionLabel: '제주', disposition: 'surcharge', amount: 3000 }] } } } });
});
it('지역표에는 근거 칸·확인 체크·택배사 고르기가 없고, 받는 지역이 없으면 선택으로 고른다', () => {
  mode = 'editor'; editorProps.start.data!.group.regional = { mode: 'override', policy: regionWithRules() }; editorProps.carriers = [carrierOf('cj', 'CJ대한통운')];
  render(); effects(); const tree = regionTree(), shown = text(tree);
  expect(shown).not.toMatch(/근거|확인했습니다|추가료|미확인|계약 택배사|임의 분류|원문/);
  expect(all(tree).some(item => item.type === 'input' && item.props.type === 'checkbox')).toBe(false);
  expect(shown).toContain('택배사: CJ대한통운 · 추가배송비는 묶음그룹마다 한 번만 받습니다.');
  const labels = all(tree).filter(item => item.type === 'label').map(item => text(item));
  expect(labels.some(label => label.startsWith('추가배송비를 받는 지역지역표로 정하기추가배송비를 받는 지역 없음'))).toBe(true);
  expect(labels.some(label => label.startsWith('표에 없는 지역추가배송비 없이 주문받기주문받지 않기'))).toBe(true);
  expect(labels.some(label => label.startsWith('적용 시작 (KST)'))).toBe(true);
  expect(shown).toContain('지역표 미리보기 · 1줄'); expect(shown).toContain('추가배송비 받음');
  patchRegion({ noRulesConfirmed: true }); expect(text(regionTree())).not.toContain('지역표 미리보기');
});
/* 지역표 붙여넣기는 지역별 추가배송비 화면과 같은 읽기(parseShippingRegionRulesTsv)다. 쉼표 자리가 틀린 금액이 조용히 다른 금액이 되지 않는다. */
it('붙여넣은 지역표의 쉼표 자리가 틀린 금액(3,00)은 300원으로 읽지 않고 그 줄을 알리며, 맞는 금액(3,000)은 읽는다', () => {
  mode = 'editor'; editorProps.start.data!.group.regional = { mode: 'override', policy: regionWithRules() }; render(); effects();
  const paste = (value: string) => (regionFields()!.props.onTsvChange as (next: string) => void)(value);
  paste('63000\t63644\t\t제주\t추가배송비 받음\t3,00');
  const bad = text(regionTree());
  expect(bad).toContain('지역표 1번째 줄의 추가배송비(3,00)를 읽지 못했습니다. 0부터 1,000,000까지 숫자만 적어 주세요. 쉼표는 3,000처럼 세 자리마다만 찍어 주세요.');
  expect(bad).not.toContain('지역표 미리보기');
  paste('63000\t63644\t\t제주\t추가배송비 받음\t3,000원');
  const good = text(regionTree());
  expect(good).not.toContain('읽지 못했습니다');
  expect(good).toContain('지역표 미리보기 · 1줄'); expect(good).toContain('3,000원');
});
it('붙여넣은 지역표에 틀린 줄이 여럿이면 줄 순서대로 모두 목록으로 알린다', () => {
  mode = 'editor'; editorProps.start.data!.group.regional = { mode: 'override', policy: regionWithRules() }; render(); effects();
  const paste = (value: string) => (regionFields()!.props.onTsvChange as (next: string) => void)(value);
  paste('63000\t63644\t\t제주\t추가배송비 받음\t3,00\n63100\t63200\t\t제주\t추가배송비 받음\t3,000\n63300\t63400\t\t제주\t알 수 없음\t0');
  const shown = text(regionTree());
  expect(shown).toContain('지역표 1번째 줄의 추가배송비(3,00)를 읽지 못했습니다.');
  expect(shown).toContain('지역표 3번째 줄의 처리(알 수 없음)를 읽지 못했습니다.');
  expect(shown.indexOf('지역표 1번째 줄')).toBeLessThan(shown.indexOf('지역표 3번째 줄'));
  expect(shown).not.toContain('지역표 2번째 줄');
  expect(shown).not.toContain('지역표 미리보기');
});
it('지역 설정이 바뀌는 저장은 확인 체크 대신 대상·금액·적용 기간을 보여 주는 확인창 한 번을 거친다', async () => {
  mode = 'editor'; confirm = stubAdminConfirm(true); render(); effects(); change('지역별 추가배송비', 'override');
  expect(regionFields()!.props.policy).toMatchObject({ carrierCode: 'cj', openEnded: true, unlistedDisposition: 'standard', sourceEvidence: '', noRulesConfirmed: false });
  await submit(); expect(mocks.save).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  expect(text(node())).toContain('지역표를 붙여넣거나 ‘추가배송비를 받는 지역 없음’을 골라 주세요.');
  patchRegion({ noRulesConfirmed: true }); await submit(); await settle();
  expect(confirm).toHaveBeenCalledOnce(); const message = String(confirm.mock.calls[0][0]);
  expect(message).toContain('TEST 출고지 · TEST 묶음그룹 · 넣은 상품 0개'); expect(message).toContain('추가배송비: 받는 지역 없음 · 묶음그룹마다 한 번');
  expect(message).toContain('표에 없는 지역: 추가배송비 없음'); expect(message).toContain('저장하면 바로 새 주문에 적용됩니다. 이미 들어온 주문의 배송비는 그대로입니다.');
  expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ attestRegional: true,
    values: { regional: { mode: 'override', policy: { carrierCode: 'cj', sourceEvidence: '', noRulesConfirmed: true, openEnded: true, endsAt: null, unlistedDisposition: 'standard', rules: [] } } } });
});
it('확인창에서 돌아가면 저장하지 않는다', async () => {
  mode = 'editor'; confirm = stubAdminConfirm(false); render(); effects(); change('지역별 추가배송비', 'override'); patchRegion({ noRulesConfirmed: true });
  await submit(); await settle(); expect(confirm).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
});
it('지역표의 택배사가 출고지의 기본 택배사와 다르면 사용으로 저장하기 전에 막고 맞추는 버튼을 준다', async () => {
  mode = 'editor'; confirm = stubAdminConfirm(true); editorProps.carriers = [carrierOf('cj', 'CJ대한통운'), carrierOf('hanjin', '한진택배')];
  editorProps.start.data!.group.regional = { mode: 'override', policy: { ...chargeAdminFixtures().region, carrierCode: 'hanjin' } };
  render(); effects(); expect(text(regionTree())).toContain('지역표의 택배사(한진택배)가 출고지의 지금 기본 택배사(CJ대한통운)와 달라 ‘사용’으로 저장할 수 없습니다.');
  change('묶음그룹 이름', '이름만'); await submit(); await settle(); expect(mocks.save).not.toHaveBeenCalled(); expect(text(node())).toContain('지역표의 택배사가 출고지의 기본 택배사와 다르거나');
  const fix = all(regionTree()).find(item => item.type === Button && text(item) === '출고지의 기본 택배사로 바꾸기')!; (fix.props.onClick as () => void)();
  expect(regionFields()!.props.policy).toMatchObject({ carrierCode: 'cj' });
  await submit(); await settle(); expect(confirm).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ attestRegional: true });
});
it('적용 기간 밖에는 주문이 막힌다는 것을 칸 아래와 확인창에서 말한다', async () => {
  mode = 'editor'; confirm = stubAdminConfirm(true);
  editorProps.start.data!.group.regional = { mode: 'override', policy: { ...chargeAdminFixtures().region, startsAt: '2099-01-01T00:00:00.000Z', openEnded: false, endsAt: '2099-02-01T00:00:00.000Z' } };
  render(); effects(); const shown = text(regionTree());
  expect(shown).toContain('이 시각 전에는 이 묶음그룹 상품의 새 주문이 막힙니다.'); expect(shown).toContain('이 시각 뒤에는 이 묶음그룹 상품의 새 주문이 막힙니다.');
  patchRegion({ unlistedDisposition: 'manual_review' }); await submit(); await settle();
  const message = String(confirm.mock.calls[0][0]);
  expect(message).toMatch(/전에는 이 묶음그룹 상품의 새 주문이 막힙니다\./); expect(message).toContain('지역표에 없는 주소로는 이 묶음그룹 상품을 주문할 수 없게 됩니다.');
  expect(message).toMatch(/뒤에는 이 묶음그룹 상품의 새 주문이 막힙니다\./);
});
it('다른 사람이 먼저 바꿨으면 입력을 둔 채 두 길을 보이고, 덮어쓰면 지금 저장된 묶음그룹 위에 다시 저장한다', async () => {
  mode = 'editor'; const { group, origin } = chargeAdminFixtures();
  mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다. 지금 저장된 묶음그룹을 확인한 뒤 다시 해 주세요.', uncertain: false, conflict: true, changed: true });
  mocks.seal.mockImplementationOnce(sealOf);
  mocks.latest.mockResolvedValue({ data: { actorId: ids.actor, sessionId: ids.session, runtimeEnabled: true, group: { ...group, revision: 3, name: '먼저 저장한 이름', calculationMode: 'max', assignedCount: 2 }, origin, canManageRegional: true } });
  render(); effects(); change('묶음그룹 이름', '내 입력'); await submit(); await settle();
  expect(text(node())).toContain('다른 사람이 먼저 바꿨습니다. 적은 내용은 그대로 있습니다.'); expect(text(node())).toContain('지금 저장된 묶음그룹 · 넣은 상품 2개');
  expect(text(node())).toContain('[내 입력으로 덮어쓰기]를 누르면 다른 사람이 저장한 내용이 사라지고 내 입력으로 바뀝니다.');
  expect(button('저장')).toBeUndefined(); expect(storageValues.size).toBe(0);
  expect(all(node()).filter(item => item.type === ShippingChargeGroupSummary).some(item => (item.props.group as { name: string }).name === '먼저 저장한 이름')).toBe(true);
  click('내 입력으로 덮어쓰기'); await settle();
  expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: 3, values: { name: '내 입력', calculationMode: 'min' } });
  expect(mocks.save.mock.calls[1][0].operationId).not.toBe(mocks.save.mock.calls[0][0].operationId);
});
it('[내 입력 버리기]는 물은 뒤 닫고 목록을 다시 읽게 한다', async () => {
  mode = 'editor'; confirm = stubAdminConfirm(true);
  mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다.', uncertain: false, changed: true }); mocks.seal.mockImplementationOnce(sealOf);
  render(); effects(); change('묶음그룹 이름', '내 입력'); await submit(); await settle();
  click('내 입력 버리기'); await settle(); expect(confirm).toHaveBeenCalledOnce(); expect(editorProps.onClose).toHaveBeenCalledExactlyOnceWith(true);
});
it('다른 사람이 바꾼 것이 아닌 거절은 이유만 보이고 고쳐서 바로 다시 저장할 수 있다', async () => {
  mode = 'editor'; mocks.save.mockResolvedValueOnce({ error: '다른 저장이 진행 중이라 저장하지 않았습니다. 잠시 뒤 다시 눌러 주세요.', uncertain: false, conflict: true, changed: false });
  mocks.seal.mockImplementationOnce(sealOf);
  render(); effects(); change('묶음그룹 이름', '내 입력'); await submit(); await settle();
  expect(text(node())).toContain('다른 저장이 진행 중이라 저장하지 않았습니다.'); expect(text(node())).not.toContain('다른 사람이 먼저 바꿨습니다.');
  expect(button('저장').props.disabled).not.toBe(true); await submit(); expect(mocks.save).toHaveBeenCalledTimes(2);
});
it('결과를 모를 때 [그만두고 다시 하기]를 누르면 입력을 둔 채 다시 저장할 수 있다', async () => {
  mode = 'editor'; render(); effects(); change('묶음그룹 이름', '내 입력'); await submit();
  const original = mocks.save.mock.calls[0][0]; mocks.seal.mockImplementationOnce(sealOf);
  click('그만두고 다시 하기'); await settle();
  expect(text(node())).toContain('저장하지 않았습니다. 적은 내용은 그대로 있습니다. 확인한 뒤 다시 저장해 주세요.'); expect(button('저장').props.disabled).not.toBe(true);
  await submit(); expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: 1, values: { name: '내 입력' } });
  expect(mocks.save.mock.calls[1][0].operationId).not.toBe(original.operationId);
});
it('변경 없는 저장 영수증은 동일 revision도 완료로 처리한다', async () => {
  mode = 'editor'; mocks.save.mockImplementationOnce(async request => ({ data: { ...chargeAdminFixtures().saved,
    operationId: request.operationId, expectedRevision: 1, group: chargeAdminFixtures().group } }));
  render(); effects(); await submit(); expect(mocks.receipt).toHaveBeenCalledOnce(); expect(storageValues.size).toBe(0);
});
it('적은 내용이 있으면 닫기 전에 묻고, 없으면 바로 닫는다', async () => {
  mode = 'editor'; confirm = stubAdminConfirm(false); render(); effects();
  click('닫기'); await flush(); expect(editorProps.onClose).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  change('묶음그룹 이름', '고치는 중'); click('닫기'); await flush(); expect(confirm).toHaveBeenCalledOnce(); expect(editorProps.onClose).toHaveBeenCalledOnce();
  confirm.restore(); confirm = stubAdminConfirm(true); click('닫기'); await flush(); expect(editorProps.onClose).toHaveBeenCalledTimes(2);
});

/* ── 상품 넣기·빼기·옮기기 창 ── 상품과 옮길 묶음그룹은 공용 선택창에서 고른다. 얕은 렌더라 선택창 요소의 props를 직접 부른다. */
type GoodsPicker = { load: (request: PickerRequest) => Promise<{ rows?: unknown[]; total?: number; page?: number; pageSize?: number; error?: string }>;
  onSelect: (row: unknown) => unknown; onDeselect: (row: unknown) => void; onClose: () => void; rowBlocked: (row: unknown) => string | null;
  rowView: (row: unknown) => { title: ReactNode; meta: ReactNode }; rowAction?: (row: unknown, state: { busy: boolean }) => ReactNode; footer: ReactNode;
  title: string; description: string; selectedKeys: string[]; multiple?: boolean; closeLabel?: string; blockedReason: string | null; excludedNote?: string; emptyText: string };
const goodsPicker = () => all(node()).find(item => item.type === AdminPickerDialog) as unknown as ReactElement<GoodsPicker> | undefined;
const footerButton = (label: string) => all(goodsPicker()!.props.footer).find(item => item.type === Button && text(item) === label)!;
async function mountAssignment(task: 'add' | 'manage' = 'add') { mode = 'assignment'; assignmentProps = { ...assignmentProps, task }; render(); effects(); await flush(); }
const goodOf = (id: string, patch: Partial<ShippingChargeGroupGood> = {}): ShippingChargeGroupGood => ({ ...chargeAdminFixtures().good, id, ownerGoodId: id, familyGoodIds: [id], name: `상품 ${id}`, ...patch });
/** 이 묶음그룹에 들어 있는 상품(배정 영수증의 상품과 같은 모양). */
const goodIn = (): ShippingChargeGroupGood => ({ ...chargeAdminFixtures().good, ...chargeAdminFixtures().assigned.goods[0] });
const pickGood = (good: ShippingChargeGroupGood) => goodsPicker()!.props.onSelect(good);
const assignedReceipt = async (request: { operationId: string; groupId: string | null; expectedRevision: number; goods: { id: string }[] }) => {
  const { assigned } = chargeAdminFixtures();
  return { data: { ...assigned, operationId: request.operationId, groupId: request.groupId, expectedRevision: request.expectedRevision, group: request.groupId ? assigned.group : null,
    goods: request.groupId ? assigned.goods : [chargeAdminFixtures().guard] } };
};

it('[상품 넣기]는 같은 출고지의 상품을 공용 선택창에 묻고, 넣는 묶음그룹을 다시 고르게 하지 않는다', async () => {
  await mountAssignment(); const picker = goodsPicker()!.props;
  expect(picker).toMatchObject({ title: '상품 고르기', multiple: true, closeLabel: undefined, blockedReason: null, excludedNote: '이 묶음그룹과 출고지가 다른 상품은 목록에서 뺐습니다.' });
  expect(picker.description).toBe('‘TEST 묶음그룹’ 묶음그룹에 넣을 상품을 고릅니다. 한 번에 100개까지 고를 수 있고, [완료]를 누르면 바뀌는 내용을 먼저 보여 줍니다.');
  expect(await picker.load({ ...firstRequest, query: ' 찾는 상품 ', page: 2 })).toMatchObject({ total: 1, pageSize: 20 });
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith({ originId: ids.origin, groupId: null, query: '찾는 상품', page: 2 }, identity);
  expect(text(picker.footer)).toBe('고른 상품 0개'); expect(mocks.preview).not.toHaveBeenCalled();
  expect(all(node()).some(item => item.type === ShippingChargeGroupField)).toBe(false);
});
it('상품 수로 열면 이 묶음그룹의 상품만 묻고, 고른 상품을 빼거나 옮기는 버튼을 둔다', async () => {
  await mountAssignment('manage'); const picker = goodsPicker()!.props;
  expect(picker).toMatchObject({ title: '묶음그룹의 상품', multiple: true, closeLabel: '닫기', excludedNote: undefined });
  expect(picker.description).toBe('‘TEST 묶음그룹’ 묶음그룹에 넣은 상품입니다. 빼거나 옮길 상품을 [선택]으로 고른 뒤 아래 버튼을 눌러 주세요.');
  await picker.load(firstRequest); expect(mocks.find).toHaveBeenCalledExactlyOnceWith({ originId: ids.origin, groupId: ids.group, query: '', page: 1 }, identity);
  expect(footerButton('묶음그룹에서 빼기').props.disabled).toBe(true); expect(footerButton('다른 묶음그룹으로 옮기기').props.disabled).toBe(true);
  pickGood(goodIn()); expect(footerButton('묶음그룹에서 빼기').props.disabled).toBe(false); expect(text(goodsPicker()!.props.footer)).toContain('고른 상품 1개');
});
it('줄에는 상품명과 상품 자동코드만 보이고 내부 번호·버전·합산군 같은 말은 보이지 않는다', async () => {
  await mountAssignment(); const picker = goodsPicker()!.props, { good } = chargeAdminFixtures();
  const plain = picker.rowView(good); expect(text(plain.title)).toBe('TEST 상품'); expect(text(plain.meta)).toBe('TEST-1');
  const moved = picker.rowView({ ...good, groupId: ids.other, groupRevision: 4, assignmentRevision: 2, assignmentVersionId: ids.assignment });
  expect(text(moved.meta)).toBe('TEST-1 · 다른 묶음그룹에 있음 — 넣으면 이 묶음그룹으로 옮깁니다');
  const family = picker.rowView({ ...good, familyGoodIds: ['good-a', 'child'], effectiveCount: 2 });
  expect(text(family.meta)).toBe('TEST-1함께 묶인 상품 1개도 같이 바뀝니다.');
  for (const view of [plain, moved, family]) expect(`${text(view.title)} ${text(view.meta)}`).not.toMatch(/버전|합산군|원상품|개별|미지정|[0-9a-f]{8}-[0-9a-f]{4}|good-a/);
});
it('고를 수 없는 상품은 줄에 까닭을 보이고 선택도 받지 않는다', async () => {
  await mountAssignment(); const { good } = chargeAdminFixtures();
  const child = { ...good, id: 'child', ownerGoodId: good.id, familyGoodIds: [good.id, 'child'], effectiveCount: 2, editable: false, blocker: 'goods_aggregation_policy_owned_by_source' as const };
  const collect = goodOf('blocked', { blocker: 'collect_contract_not_ready' });
  const picker = goodsPicker()!.props;
  expect(picker.rowBlocked(child)).toBe('원상품에서 나눈 상품이라 원상품에서 바꿔야 합니다');
  expect(text(picker.rowView(child).meta)).toContain('원상품 열기 (새 탭)');
  expect(picker.rowBlocked(collect)).toBe('출고지가 착불을 받을 준비가 돼 있지 않습니다. 배송정보 관리에서 출고지의 착불 조건을 먼저 준비해 주세요');
  expect(picker.rowBlocked(goodIn())).toBe('이미 이 묶음그룹에 있습니다'); expect(picker.rowBlocked(good)).toBeNull();
  expect(pickGood(child)).toBe(false); expect(pickGood(collect)).toBe(false); expect(pickGood(goodIn())).toBe(false); expect(goodsPicker()!.props.selectedKeys).toEqual([]);
  pickGood(good); expect(goodsPicker()!.props.selectedKeys).toEqual(['good-a']); expect(goodsPicker()!.props.rowBlocked(good)).toBeNull();
  goodsPicker()!.props.onDeselect(good); expect(goodsPicker()!.props.selectedKeys).toEqual([]);
});
it('상품을 고르고 [완료]하면 바뀌는 내용을 먼저 보이고, 넣기는 그 미리보기 그대로 한 번 보낸다', async () => {
  const { good, guard, preview, origin } = chargeAdminFixtures(), familyGoodIds = ['good-a', 'child'];
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, goods: [{ ...preview.goods[0], familyGoodIds, effectiveCount: 2 }] } });
  await mountAssignment(); pickGood({ ...good, familyGoodIds, effectiveCount: 2 }); goodsPicker()!.props.onClose(); await flush();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.group, ['good-a'], identity); expect(goodsPicker()).toBeUndefined();
  const shown = text(node()); expect(shown).toContain('상품 1개를 ‘TEST 묶음그룹’ 묶음그룹에 넣습니다.'); expect(shown).toContain('이미 들어온 주문의 배송비는 그대로입니다.');
  expect(shown).toContain('함께 묶인 상품 1개도 같이 바뀝니다.'); expect(shown).toContain('묶음그룹 없음'); expect(shown).not.toMatch(/버전|합산군|원상품|전체 적용을 중단|[0-9a-f]{8}-[0-9a-f]{4}/);
  click('1개 상품 넣기'); await flush(); expect(mocks.assign).toHaveBeenCalledOnce();
  expect(mocks.assign.mock.calls[0][0]).toMatchObject({ ...identity, command: 'assign', groupId: ids.group, expectedRevision: 1, origins: [origin], goods: [{ ...guard, familyGoodIds }] });
  expect(button('저장됐는지 확인')).toBeDefined(); expect(button('그만두고 다시 하기')).toBeDefined(); expect(storageValues.size).toBe(1); expect([...storageValues.values()][0]).not.toContain('good-a');
});
it('조건이 안 맞는 상품은 건너뛰고 나머지만 넣는다(막힌 상품을 빼고 미리보기를 한 번 더 만든다)', async () => {
  const { preview, summary } = chargeAdminFixtures(), ready = chargeAdminFixtures().good, blocked = goodOf('good-b', { blocker: 'collect_contract_not_ready' });
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, canAssign: false, goods: [{ ...ready, beforeGroup: null, afterGroup: summary }, { ...blocked, beforeGroup: null, afterGroup: summary }] } })
    .mockResolvedValueOnce({ data: preview });
  mocks.assign.mockImplementationOnce(assignedReceipt);
  await mountAssignment(); pickGood(ready); pickGood(goodOf('good-b')); goodsPicker()!.props.onClose(); await settle();
  expect(mocks.preview.mock.calls.map(([group, goods]) => [group, goods])).toEqual([[ids.group, ['good-a', 'good-b']], [ids.group, ['good-a']]]);
  const shown = text(node()); expect(shown).toContain('상품 1개를 ‘TEST 묶음그룹’ 묶음그룹에 넣습니다. 1개는 건너뜁니다.');
  expect(shown).toContain('건너뜀 · 출고지가 착불을 받을 준비가 돼 있지 않습니다.');
  /* S6-1: 건너뜀 이유는 마지막 문장도 마침표로 닫는다. */
  expect(shown).toContain('착불 조건을 먼저 준비해 주세요.');
  click('1개 상품 넣기'); await settle();
  expect(mocks.assign.mock.calls[0][0].goods.map((good: { id: string }) => good.id)).toEqual(['good-a']);
  expect(mocks.receipt).toHaveBeenCalledOnce(); expect(mocks.receipt.mock.calls[0][1]).toEqual({ action: 'add', groupName: 'TEST 묶음그룹',
    skipped: [{ id: 'good-b', name: '상품 good-b', reason: '출고지가 착불을 받을 준비가 돼 있지 않습니다. 배송정보 관리에서 출고지의 착불 조건을 먼저 준비해 주세요' }] });
});
it('넣을 수 있는 상품이 하나도 없으면 까닭만 보이고 넣기 버튼을 두지 않는다', async () => {
  const { preview, summary, good } = chargeAdminFixtures();
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, canAssign: false, goods: [{ ...good, blocker: 'collect_contract_not_ready', beforeGroup: null, afterGroup: summary }] } });
  await mountAssignment(); pickGood(good); goodsPicker()!.props.onClose(); await settle();
  expect(mocks.preview).toHaveBeenCalledOnce(); expect(all(node()).some(item => item.props.title === '넣을 수 있는 상품이 없습니다.')).toBe(true); expect(text(node())).toContain('건너뜀 · 출고지가 착불을');
  expect(button('1개 상품 넣기')).toBeUndefined(); expect(button('미리보기 다시 만들기')).toBeUndefined(); expect(button('상품 다시 고르기').props.disabled).not.toBe(true); expect(mocks.assign).not.toHaveBeenCalled();
  click('상품 다시 고르기'); expect(goodsPicker()!.props.selectedKeys).toEqual(['good-a']);
});
it('묶음그룹에서 빼기는 묶음그룹 없이 미리보기한 뒤 보내고, 뺀 상품이 무료배송이 된다고 말하지 않는다', async () => {
  const { preview, summary } = chargeAdminFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, group: null, goods: [{ ...goodIn(), beforeGroup: summary, afterGroup: null }] } });
  await mountAssignment('manage'); pickGood(goodIn()); (footerButton('묶음그룹에서 빼기').props.onClick as () => void)(); await settle();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(null, ['good-a'], identity);
  const shown = text(node()); expect(shown).toContain('상품 1개를 ‘TEST 묶음그룹’ 묶음그룹에서 뺍니다.'); expect(shown).toContain('뺀 상품은 상품과 출고지의 배송비를 그대로 받습니다.'); expect(shown).not.toContain('무료배송');
  click('1개 상품 빼기'); await flush(); expect(mocks.assign.mock.calls[0][0]).toMatchObject({ groupId: null, expectedRevision: 0, command: 'assign' });
});
it('다른 묶음그룹으로 옮기기는 옮길 곳만 선택창에서 고르고 바로 미리보기로 넘어간다', async () => {
  const { preview, summary, group } = chargeAdminFixtures(), other: ShippingChargeGroup = { ...group, id: ids.other, name: '다른 묶음', revision: 2 };
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, group: other, goods: [{ ...goodIn(), beforeGroup: summary, afterGroup: { ...summary, id: other.id, name: other.name, revision: 2 } }] } });
  await mountAssignment('manage'); pickGood(goodIn()); (footerButton('다른 묶음그룹으로 옮기기').props.onClick as () => void)();
  const target = goodsPicker()!.props; expect(target.title).toBe('묶음그룹 고르기'); expect(target.description).toBe('고른 상품 1개를 옮길 묶음그룹을 고릅니다. 고르면 바뀌는 내용을 먼저 보여 줍니다.');
  expect(target.rowBlocked(group)).toBe('지금 묶음그룹'); expect(target.rowBlocked(other)).toBeNull();
  await target.load(firstRequest); expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ originId: ids.origin, query: '', status: 'active', page: 1 }, identity);
  expect(target.onSelect(group)).toBe(false); expect(mocks.preview).not.toHaveBeenCalled();
  expect(target.onSelect(other)).toBe(false); await settle();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.other, ['good-a'], identity); expect(text(node())).toContain('상품 1개를 ‘다른 묶음’ 묶음그룹으로 옮깁니다.');
  click('1개 상품 옮기기'); await flush(); expect(mocks.assign.mock.calls[0][0]).toMatchObject({ groupId: ids.other, expectedRevision: 2 });
});
it('옮길 곳 고르기를 닫으면 고른 상품을 둔 채 상품 목록으로 돌아간다', async () => {
  await mountAssignment('manage'); pickGood(goodIn()); (footerButton('다른 묶음그룹으로 옮기기').props.onClick as () => void)();
  goodsPicker()!.props.onClose(); expect(goodsPicker()!.props).toMatchObject({ title: '묶음그룹의 상품', selectedKeys: ['good-a'] });
});

/*
 * QA-S S3-1: [다른 묶음그룹으로 옮기기]를 누르면 화면 전체가 죽었다("Cannot read properties of undefined (reading 'mode')").
 * 상품 고르기와 옮길 곳 고르기는 같은 부품(AdminPickerDialog)을 같은 자리에서 단계만 바꿔 그린다. React는 같은 자리에 같은 부품과 같은 key가 오면
 * 새로 만들지 않고 이전 것을 재사용해 상태를 물려준다. 선택창은 조회 결과(줄)를 자기 상태로 들고 있어서, 뒤 단계의 줄 그리기(묶음그룹용)가
 * 앞 단계에서 읽은 상품 줄에 불렸다. 이 저장소 시험에는 DOM이 없어 실제로 갱신해 보지 못하므로, 그 재사용 규칙(부품·key가 같은가)을
 * 단계가 바뀔 때마다 돌려받는 요소로 직접 가린다.
 */
const sharesState = (before: ReactElement, after: ReactElement) => before.type === after.type && before.key === after.key;
it('상품 고르기와 옮길 곳 고르기는 같은 선택창 부품이지만 key가 달라, 단계가 바뀔 때 앞 단계의 조회 결과(상품 줄)를 물려받지 않는다', async () => {
  await mountAssignment('manage');
  const pickStep = node(); expect(pickStep.type).toBe(AdminPickerDialog); expect(pickStep.key).not.toBeNull();
  pickGood(goodIn()); (footerButton('다른 묶음그룹으로 옮기기').props.onClick as () => void)();
  const targetStep = node(); expect(targetStep.type).toBe(AdminPickerDialog); expect(targetStep.key).not.toBeNull();
  expect(sharesState(pickStep, targetStep)).toBe(false);
  /* 이 두 단계는 줄의 종류도 다르다 — 상품 줄과 묶음그룹 줄을 같은 선택창이 함께 들고 있으면 안 된다. */
  expect((pickStep.props as { title: string }).title).toBe('묶음그룹의 상품'); expect((targetStep.props as { title: string }).title).toBe('묶음그룹 고르기');
  /* 상품 단계로 돌아올 때도 같다. */
  (targetStep.props as { onClose: () => void }).onClose();
  const backStep = node(); expect(backStep.type).toBe(AdminPickerDialog);
  expect(sharesState(targetStep, backStep)).toBe(false);
  expect(backStep.key).toBe(pickStep.key);
});
it('단계가 바뀌어도 같은 key를 이어 쓰는 두 선택창이 이어서 그려지는 곳이 없다 — 상품 넣기·빼기·옮기기의 모든 단계 이동', async () => {
  const { preview, summary, group } = chargeAdminFixtures(), other: ShippingChargeGroup = { ...group, id: ids.other, name: '다른 묶음', revision: 2 };
  mocks.preview.mockResolvedValue({ data: { ...preview, group: other, goods: [{ ...goodIn(), beforeGroup: summary, afterGroup: { ...summary, id: other.id, name: other.name, revision: 2 } }] } });
  await mountAssignment('manage');
  /* 한 단계씩 돌려받은 요소를 모아 이웃한 단계가 같은 것으로 판정되지 않는지 본다. 미리보기 창은 선택창이 아닌 부품이라 서로 다르다. */
  const steps: ReactElement[] = [node()];
  pickGood(goodIn()); (footerButton('다른 묶음그룹으로 옮기기').props.onClick as () => void)(); steps.push(node());    /* pick → target */
  (goodsPicker()!.props.onSelect as (row: unknown) => unknown)(other); await settle(); steps.push(node());           /* target → preview */
  click('상품 다시 고르기'); steps.push(node());                                                                    /* preview → pick */
  (footerButton('다른 묶음그룹으로 옮기기').props.onClick as () => void)(); steps.push(node());                        /* pick → target */
  expect(steps.map(step => step.type === AdminPickerDialog ? String(step.key) : 'preview')).toEqual(['pick', 'target', 'preview', 'pick', 'target']);
  for (let index = 1; index < steps.length; index++) expect(sharesState(steps[index - 1], steps[index])).toBe(false);
});
it('옮길 곳 선택창이 처음 여는 조회는 묶음그룹 목록이고, 이 선택창의 줄 그리기는 묶음그룹 줄을 읽는다', async () => {
  const { group } = chargeAdminFixtures();
  await mountAssignment('manage'); pickGood(goodIn()); (footerButton('다른 묶음그룹으로 옮기기').props.onClick as () => void)();
  const target = goodsPicker()!.props;
  await target.load(firstRequest); expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ originId: ids.origin, query: '', status: 'active', page: 1 }, identity);
  expect(mocks.find).not.toHaveBeenCalled();
  expect(text(target.rowView(group).title)).toBe('TEST 묶음그룹'); expect(text(target.rowView(group).meta)).toBe('가장 싼 배송비 한 번 · 지역별 추가배송비는 출고지 설정 그대로');
});
/* 방어: 줄이 섞이지 않게 하는 것은 위 key의 몫이다. 그래도 묶음그룹이 아닌 줄(상품 줄)이 들어오면 화면 전체가 죽지 않고 있는 값만 말한다. */
it('묶음그룹 줄 그리기는 묶음그룹이 아닌 줄을 받아도 던지지 않는다', () => {
  const { group, good } = chargeAdminFixtures();
  expect(text(shippingChargeGroupPickerRowView(group).meta)).toBe('가장 싼 배송비 한 번 · 지역별 추가배송비는 출고지 설정 그대로');
  expect(text(shippingChargeGroupPickerRowView({ ...group, calculationMode: 'max', regional: { mode: 'override', policy: chargeAdminFixtures().region } }).meta)).toBe('가장 비싼 배송비 한 번 · 지역별 추가배송비는 이 묶음그룹의 지역표대로');
  expect(() => shippingChargeGroupPickerRowView(good as unknown as ShippingChargeGroup)).not.toThrow();
  expect(text(shippingChargeGroupPickerRowView(good as unknown as ShippingChargeGroup).meta)).toBe('');
});
it('다른 상품이나 로그인의 미리보기가 돌아오면 보낼 내용을 만들지 않는다', async () => {
  const { preview, good } = chargeAdminFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, sessionId: ids.other } });
  await mountAssignment(); pickGood(good); goodsPicker()!.props.onClose(); await settle();
  expect(text(node())).toContain('고른 것과 다른 미리보기가 돌아왔습니다.'); expect(button('1개 상품 넣기')).toBeUndefined(); expect(mocks.assign).not.toHaveBeenCalled();
});
it('한 번에 100개까지만 고를 수 있고, 넘는 줄에는 까닭을 보인다', async () => {
  await mountAssignment();
  for (let index = 0; index < 100; index++) pickGood(goodOf(`good-${index}`));
  expect(goodsPicker()!.props.selectedKeys).toHaveLength(100); expect(text(goodsPicker()!.props.footer)).toBe('고른 상품 100개');
  expect(goodsPicker()!.props.rowBlocked(goodOf('good-100'))).toBe('한 번에 100개까지'); expect(goodsPicker()!.props.rowBlocked(goodOf('good-5'))).toBeNull();
  expect(pickGood(goodOf('good-100'))).toBe(false); expect(goodsPicker()!.props.selectedKeys).toHaveLength(100);
});
it('바꿀 권한이 없으면 이 묶음그룹의 상품만 보이고 고르는 버튼을 두지 않는다', async () => {
  assignmentProps.canEdit = false; await mountAssignment('manage'); const picker = goodsPicker()!.props;
  expect(picker.description).toBe('‘TEST 묶음그룹’ 묶음그룹에 넣은 상품입니다.'); expect(picker.footer).toBeNull();
  expect(picker.rowAction?.(goodIn(), { busy: false })).toBeNull(); expect(pickGood(goodIn())).toBe(false); expect(goodsPicker()!.props.selectedKeys).toEqual([]);
});
it('쇼핑몰 설정이 꺼져 있으면 넣고 뺄 수 없어 목록만 보이고 누구에게 요청하는지 말한다', async () => {
  assignmentProps = { ...assignmentProps, runtimeEnabled: false }; await mountAssignment('manage'); const picker = goodsPicker()!.props;
  expect(text(picker.footer)).toBe(SHIPPING_CHARGE_GROUP_RUNTIME_OFF); expect(picker.rowAction?.(goodIn(), { busy: false })).toBeNull(); expect(pickGood(goodIn())).toBe(false);
});
it.each(['shipping_charge_group_origin_unavailable', 'collect_contract_not_ready', 'shipping_charge_group_unavailable', 'shipping_charge_group_origin_mismatch'] as const)('빼려는 상품은 %s 상태여도 고를 수 있고 되는지는 미리보기가 정한다', async blocker => {
  const { preview, summary } = chargeAdminFixtures(), stuck = { ...goodIn(), blocker };
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, group: null, goods: [{ ...goodIn(), beforeGroup: summary, afterGroup: null }] } });
  await mountAssignment('manage'); expect(goodsPicker()!.props.rowBlocked(stuck)).toBeNull(); pickGood(stuck);
  (footerButton('묶음그룹에서 빼기').props.onClick as () => void)(); await settle(); expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(null, ['good-a'], identity);
  click('1개 상품 빼기'); await flush(); expect(mocks.assign).toHaveBeenCalledOnce(); expect(mocks.assign.mock.calls[0][0]).toMatchObject({ groupId: null, expectedRevision: 0 });
});
it('넣을 때는 막힌 상품을 고를 수 없고, 쇼핑몰 설정으로 막힌 상품은 뺄 때도 고를 수 없다', async () => {
  await mountAssignment('manage');
  expect(goodsPicker()!.props.rowBlocked({ ...goodIn(), blocker: 'checkout_contract_upgrade_required' })).toBe('지금 쇼핑몰 설정에서는 묶음그룹에 넣거나 뺄 수 없습니다');
  resetHooks(); await mountAssignment('add');
  expect(goodsPicker()!.props.rowBlocked(goodOf('good-x', { blocker: 'shipping_charge_group_origin_unavailable' }))).toContain("상품의 출고지가 없거나 '사용 안 함'입니다.");
});
it('그사이 바뀌어 저장되지 않았으면 낡은 미리보기를 지우고 이유와 함께 다시 만들게 한다', async () => {
  const { good } = chargeAdminFixtures();
  mocks.assign.mockResolvedValueOnce({ error: '그사이 상품의 묶음그룹이 바뀌었습니다. 상품을 다시 고르거나 미리보기를 다시 만들어 주세요.', uncertain: false, conflict: true, changed: true });
  mocks.seal.mockImplementationOnce(sealOf);
  await mountAssignment(); pickGood(good); goodsPicker()!.props.onClose(); await settle(); click('1개 상품 넣기'); await settle();
  expect(storageValues.size).toBe(0); expect(text(node())).toContain('그사이 상품의 묶음그룹이 바뀌었습니다.'); expect(text(node())).toContain('고른 상품 1개 · TEST 상품');
  expect(button('1개 상품 넣기')).toBeUndefined(); click('미리보기 다시 만들기'); await settle(); expect(mocks.preview).toHaveBeenCalledTimes(2); expect(button('1개 상품 넣기')).toBeDefined();
});
it('고른 상품이 있는 채로 닫으면 먼저 묻는다', async () => {
  confirm = stubAdminConfirm(false); const { good } = chargeAdminFixtures();
  await mountAssignment(); pickGood(good); goodsPicker()!.props.onClose(); await settle();
  click('닫기'); await flush(); expect(confirm).toHaveBeenCalledOnce(); expect(String(confirm.mock.calls[0][0])).toBe('고른 상품 1개의 선택이 풀립니다. 아직 아무 상품도 바뀌지 않았습니다.'); expect(assignmentProps.onClose).not.toHaveBeenCalled();
  confirm.restore(); confirm = stubAdminConfirm(true); click('닫기'); await flush(); expect(assignmentProps.onClose).toHaveBeenCalledOnce();
});
it('상품 목록도 고른 상품이 있으면 닫기 전에 묻고, 없으면 바로 닫는다', async () => {
  confirm = stubAdminConfirm(false); await mountAssignment('manage');
  pickGood(goodIn()); goodsPicker()!.props.onClose(); await flush(); expect(confirm).toHaveBeenCalledOnce(); expect(assignmentProps.onClose).not.toHaveBeenCalled();
  goodsPicker()!.props.onDeselect(goodIn()); goodsPicker()!.props.onClose(); await flush(); expect(confirm).toHaveBeenCalledOnce(); expect(assignmentProps.onClose).toHaveBeenCalledOnce();
});
it('고른 상품 없이 [완료]하면 그대로 닫는다', async () => {
  await mountAssignment(); goodsPicker()!.props.onClose(); expect(assignmentProps.onClose).toHaveBeenCalledOnce(); expect(mocks.preview).not.toHaveBeenCalled();
});

/* ── 목록 ── */
async function mountWorkspace() { mode = 'workspace'; render(); effects(); await new Promise(resolve => setTimeout(resolve, 0)); await flush(); }
const rowButton = (label: string) => all(node()).find(item => item.type === Button && text(item) === label);
/* 목록 카드 머리 오른쪽(actions)은 props라 본문 글에 들어 있지 않다. */
const listActions = () => (all(node()).find(item => item.type === ConsoleListCard)!.props as { actions: ReactNode }).actions;
const assignmentDialog = () => all(node()).find(item => item.type === ShippingChargeGroupAssignmentDialog);

it('목록에는 내부 번호·버전이 없고, 줄마다 하는 일을 말하는 버튼이 있다', async () => {
  await mountWorkspace(); const shown = text(node());
  expect(shown).toContain('TEST 묶음그룹'); expect(shown).toContain('가장 싼 배송비 한 번'); expect(shown).toContain('출고지 설정 그대로'); expect(shown).toContain('0개');
  for (const head of ['묶음그룹 이름', '출고지', '배송비 계산', '지역별 추가배송비', '상품', '사용 여부', '수정일', '관리']) expect(shown).toContain(head);
  expect(shown).not.toMatch(/그룹번호|버전|배정 원상품|원상품|최소 부과|최대 부과|추가료|읽기 전용|자동 재배정|[0-9a-f]{8}-[0-9a-f]{4}/);
  expect(rowButton('수정')).toBeDefined(); expect(rowButton('상품 넣기')!.props.disabled).not.toBe(true); expect(rowButton('상품 배정')).toBeUndefined();
  expect(text(listActions())).toBe('묶음그룹 추가');
  expect(all(node()).some(item => item.type === ShippingChargeGroupArchiveButton)).toBe(true);
});
/* S3-2: 남양주 탭에서 [묶음그룹 추가]를 열면 출고지가 '골라 주세요'로 비어 있지 않고 그 탭의 출고지로 시작한다. */
it('[묶음그룹 추가]는 목록에서 고른 출고지 조건이 먼저이고, 없으면 열어 둔 출고지 탭의 출고지로 시작한다', async () => {
  const origin = (patch: Partial<GoodsFulfillmentOrigin> = {}): GoodsFulfillmentOrigin => ({ id: ids.origin, name: 'TEST 출고지', defaultCarrier: 'cj', baseFee: 3000, freeThreshold: null, returnAddress: '', active: true, ...patch });
  const editorStart = () => all(node()).find(item => item.type === ShippingChargeGroupEditor)?.props.start as { originId: string } | undefined;
  const addGroup = () => (all(listActions()).find(item => item.type === Button)!.props.onClick as () => void)();
  workspaceProps = { ...workspaceProps, origins: [origin()], defaultOriginId: ids.origin };
  await mountWorkspace(); expect(editorStart()).toBeUndefined();
  addGroup(); expect(editorStart()!.originId).toBe(ids.origin);
  /* 열어 둔 탭이 없으면(출고지 추가 탭 등) 예전처럼 비어 있다. */
  resetHooks(); workspaceProps = { ...workspaceProps, defaultOriginId: undefined }; await mountWorkspace(); addGroup(); expect(editorStart()!.originId).toBe('');
  /* 사용 안 함이거나 목록에 없는 출고지는 고를 수 없으니 비운다. */
  resetHooks(); workspaceProps = { ...workspaceProps, origins: [origin({ active: false })], defaultOriginId: ids.origin }; await mountWorkspace(); addGroup(); expect(editorStart()!.originId).toBe('');
  resetHooks(); workspaceProps = { ...workspaceProps, origins: [origin()], defaultOriginId: '00000000-0000-4000-8000-0000000000ff' }; await mountWorkspace(); addGroup(); expect(editorStart()!.originId).toBe('');
});
it('[상품 넣기]와 상품 수는 서로 다른 일로 창을 연다', async () => {
  const { group } = chargeAdminFixtures(); mocks.list.mockReset().mockResolvedValue({ data: { ...listData(), groups: [{ ...group, assignedCount: 3 }] } });
  await mountWorkspace(); expect(assignmentDialog()).toBeUndefined();
  (rowButton('상품 넣기')!.props.onClick as () => void)(); expect(assignmentDialog()!.props).toMatchObject({ task: 'add', runtimeEnabled: true });
  (assignmentDialog()!.props.onClose as () => void)(); expect(assignmentDialog()).toBeUndefined();
  const count = rowButton('3개')!; expect(count.props['aria-label']).toBe('TEST 묶음그룹 묶음그룹에 넣은 상품 3개 보기'); (count.props.onClick as () => void)();
  expect(assignmentDialog()!.props).toMatchObject({ task: 'manage' }); expect(text(node())).toContain('상품을 모두 빼야 보관할 수 있습니다');
});
it('쇼핑몰 설정이 꺼져 있으면 [상품 넣기]를 누르기 전에 잠그고 한 줄로 알린다', async () => {
  mocks.list.mockReset().mockResolvedValue({ data: { ...listData(), runtimeEnabled: false } }); await mountWorkspace();
  expect(rowButton('상품 넣기')!.props.disabled).toBe(true); expect(text(node())).toContain(SHIPPING_CHARGE_GROUP_RUNTIME_OFF);
  (rowButton('상품 넣기')!.props.onClick as () => void)(); expect(assignmentDialog()).toBeUndefined();
});
it("'사용 안 함' 묶음그룹은 상품을 넣을 수 없는 까닭을 줄에 보인다", async () => {
  const { group } = chargeAdminFixtures(); mocks.list.mockReset().mockResolvedValue({ data: { ...listData(), groups: [{ ...group, enabled: false }] } }); await mountWorkspace();
  expect(rowButton('상품 넣기')!.props.disabled).toBe(true); expect(text(node())).toContain("'사용'으로 바꿔야 상품을 넣을 수 있습니다");
});
it('지역표가 적용 기간 밖이면 그 묶음그룹 상품의 주문이 막혀 있다고 줄에 알린다', async () => {
  const { group, region } = chargeAdminFixtures();
  mocks.list.mockReset().mockResolvedValue({ data: { ...listData(), groups: [{ ...group, regional: { mode: 'override', policy: { ...region, startsAt: '2099-01-01T00:00:00.000Z' } } }] } });
  await mountWorkspace(); expect(text(node())).toContain('지역표의 적용 시작 전이라 이 묶음그룹 상품의 새 주문이 막혀 있습니다. [수정]에서 고쳐 주세요.');
  expect(text(node())).toContain('이 묶음그룹의 지역표대로'); expect(text(node())).toContain('받는 지역 없음');
});
it('끝난 일은 무엇을 했는지와 건너뛴 상품을 목록 위에 한 줄로 남긴다', async () => {
  await mountWorkspace(); (rowButton('상품 넣기')!.props.onClick as () => void)();
  (assignmentDialog()!.props.onApplied as (receipt: unknown, done: unknown) => void)(chargeAdminFixtures().assigned, { action: 'add', groupName: 'TEST 묶음그룹', skipped: [{ id: 'good-b', name: '상품 B', reason: '상품과 묶음그룹의 출고지가 다릅니다' }] });
  expect(assignmentDialog()).toBeUndefined(); const shown = text(node());
  expect(shown).toContain('상품 1개를 ‘TEST 묶음그룹’ 묶음그룹에 넣었습니다.'); expect(shown).toContain('건너뛴 상품 1개'); expect(shown).toContain('상품 B — 상품과 묶음그룹의 출고지가 다릅니다');
  const archive = all(node()).find(item => item.type === ShippingChargeGroupArchiveButton)!;
  (archive.props.onReceipt as (receipt: unknown) => void)(chargeAdminFixtures().saved);
  expect(text(node())).toContain('‘TEST 묶음그룹’ 묶음그룹을 보관했습니다. 이제 묶음그룹 고르기 창에 나오지 않습니다. 되살리려면 사용 여부가 ‘보관’인 그 줄의 [복원]을 눌러 주세요.');
});
it('권한이 없으면 바꾸는 버튼을 두지 않고 [보기]만 둔다', async () => {
  workspaceProps = { ...workspaceProps, canEdit: false }; await mountWorkspace();
  expect(rowButton('보기')).toBeDefined(); for (const label of ['수정', '상품 넣기']) expect(rowButton(label)).toBeUndefined();
  expect(all(node()).some(item => item.type === ShippingChargeGroupArchiveButton)).toBe(false); expect(text(listActions())).toBe('상품 관리 권한이 있어야 바꿀 수 있습니다.');
});

/* 줄의 [보관]·[복원]은 보관 상태만 바꿔 저장한다. */
it('[보관]은 사용 안 함·추천 해제와 함께 보관 상태만 바꿔 보낸다', async () => {
  mode = 'archive'; const { group, origin, region } = chargeAdminFixtures();
  archiveProps = { ...archiveProps, group: { ...group, isDefault: true, regional: { mode: 'override', policy: region } }, origin: { ...origin, defaultGroupId: group.id, defaultGroupRevision: 1 } };
  render(); effects(); click('보관'); await flush();
  expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ ...identity, command: 'save', groupId: ids.group, expectedRevision: 1, originId: ids.origin,
    expectedDefaultGroupId: ids.group, expectedDefaultGroupRevision: 1, attestRegional: false,
    values: { name: 'TEST 묶음그룹', archived: true, enabled: false, isDefault: false, calculationMode: 'min', regional: { mode: 'override', policy: region } } });
});
it('보관한 묶음그룹은 [복원]으로 되살리고(사용 안 함), 상품이 들어 있으면 보관할 수 없다', async () => {
  mode = 'archive'; const { group } = chargeAdminFixtures(); archiveProps = { ...archiveProps, group: { ...group, enabled: false, archived: true } };
  render(); effects(); click('복원'); await flush(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ values: { archived: false, enabled: false } });
  resetHooks(); storageValues.clear(); archiveProps = { ...archiveProps, group: { ...group, assignedCount: 2 } }; render(); effects();
  expect(button('보관').props.disabled).toBe(true); (button('보관').props.onClick as () => void)(); expect(mocks.save).toHaveBeenCalledOnce();
});

/*
 * 서버가 이유를 들어 거절한 저장은 목록 위에 알린다(onFailure). 보내기 전에 멈춘 경우(이 브라우저에 진행 기록을 남길 수 없음·보낼 값의 형식이 맞지 않음)는
 * 버튼 아래에 이유를 보인다 — 눌러도 아무 일도 없는 것처럼 보이지 않게 한다. 같은 거절 이유를 두 곳에서 말하지는 않는다.
 */
const archiveError = () => all(node()).find(item => item.props['data-charge-group-archive-error'] !== undefined);
it('[보관]이 보내기 전에 멈추면(진행 기록을 남길 수 없음) 버튼 아래에 이유를 보이고 아무것도 보내지 않는다', async () => {
  mode = 'archive'; render(); effects(); expect(archiveError()).toBeUndefined();
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => { throw new Error('blocked'); }, removeItem: () => {}, key: () => null, length: 0 });
  click('보관'); await flush();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(text(archiveError()!)).toBe('이 브라우저에 진행 기록을 남길 수 없어 보내지 않았습니다. 시크릿 창이 아닌 일반 창에서 열거나, 브라우저 설정에서 사이트 데이터 저장을 허용해 주세요.');
  expect(archiveError()!.props.role).toBe('alert');
  expect(mocks.failure).not.toHaveBeenCalled();
});
it('[복원]도 보낼 값의 형식이 맞지 않아 멈추면 이유를 보인다', async () => {
  mode = 'archive'; const { group, origin } = chargeAdminFixtures();
  /* 출고지를 읽은 시각이 시각 형식이 아니라 요청 검사에서 걸린다. */
  archiveProps = { ...archiveProps, group: { ...group, enabled: false, archived: true }, origin: { ...origin, updatedAt: '시각 아님' } };
  render(); effects(); click('복원'); await flush();
  expect(mocks.save).not.toHaveBeenCalled(); expect(storageValues.size).toBe(0);
  expect(text(archiveError()!)).toBe('로그인한 계정이나 묶음그룹이 달라 보내지 않았습니다. 화면을 새로고침한 뒤 다시 해 주세요.');
});
it('서버가 이유를 들어 거절한 [보관]은 목록 위에서 알리므로 버튼 아래에 한 번 더 말하지 않는다', async () => {
  mode = 'archive'; mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다.', uncertain: false, changed: true }); mocks.seal.mockImplementationOnce(sealOf);
  render(); effects(); click('보관'); await flush();
  expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ error: '다른 사람이 먼저 바꿨습니다.', changed: true });
  expect(archiveError()).toBeUndefined();
});
it('결과를 모르는 [보관]은 목록 위 \'저장하던 중이었습니다\' 상자가 말하므로 버튼 아래에 이유를 두지 않는다', async () => {
  mode = 'archive'; render(); effects(); click('보관'); await flush();
  expect(mocks.save).toHaveBeenCalledOnce(); expect(storageValues.size).toBe(1);
  expect(archiveError()).toBeUndefined();
  expect(button('보관').props.disabled).toBe(true);
});

/* 위에서 출고지의 기본 택배사를 저장하면 화면이 새 출고지를 내려 준다 — 지역표 택배사가 달라진 묶음그룹의 경고를 보이려면 목록을 다시 읽어야 한다. */
it('출고지의 기본 택배사가 바뀌어 새 출고지가 내려오면 목록을 다시 읽고, 같은 출고지가 다시 내려오면 읽지 않는다', async () => {
  const origin = (patch: Partial<GoodsFulfillmentOrigin> = {}): GoodsFulfillmentOrigin => ({ id: ids.origin, name: 'TEST 출고지', defaultCarrier: 'cj', baseFee: 3000, freeThreshold: null, returnAddress: '', active: true, ...patch });
  workspaceProps = { ...workspaceProps, origins: [origin()] };
  await mountWorkspace(); expect(mocks.list).toHaveBeenCalledTimes(1);
  workspaceProps = { ...workspaceProps, origins: [origin()] }; node(); effects(); await flush();
  expect(mocks.list).toHaveBeenCalledTimes(1);
  workspaceProps = { ...workspaceProps, origins: [origin({ defaultCarrier: 'hanjin' })] }; node(); effects(); await flush();
  expect(mocks.list).toHaveBeenCalledTimes(2);
  /* 사용 여부가 바뀌어도 같다. 이름만 바뀌면 읽지 않는다. */
  workspaceProps = { ...workspaceProps, origins: [origin({ defaultCarrier: 'hanjin', active: false })] }; node(); effects(); await flush();
  expect(mocks.list).toHaveBeenCalledTimes(3);
  workspaceProps = { ...workspaceProps, origins: [origin({ defaultCarrier: 'hanjin', active: false, name: '이름만 바뀜' })] }; node(); effects(); await flush();
  expect(mocks.list).toHaveBeenCalledTimes(3);
});

/* 공용 페이지 이동(ConsolePagination)은 범위 밖 페이지를 범위 안으로 보정해 그려 '이전'이 닫힌다 — 보관 등으로 마지막
   페이지가 비면 같은 페이지에 남지 않고 마지막 유효 페이지를 다시 읽어야 빈 목록에 갇히지 않는다(템플릿 화면과 같다). */
it('다음 페이지가 비어 돌아오면 마지막 유효 페이지를 다시 읽는다', async () => {
  mode = 'workspace';
  const { group } = chargeAdminFixtures();
  mocks.list.mockReset()
    .mockResolvedValueOnce({ data: { ...listData(), total: 21 } })
    .mockResolvedValueOnce({ data: { ...listData(), page: 2, total: 20, groups: [] } })
    .mockResolvedValueOnce({ data: { ...listData(), page: 1, total: 20, groups: [group] } });
  render(); effects(); await new Promise(resolve => setTimeout(resolve, 0)); await flush();
  const pager = () => all(node()).find(item => item.type === ConsolePagination)!;
  expect(pager().props).toMatchObject({ page: 1, total: 21 });
  (pager().props.onPageChange as (page: number) => void)(2); await flush();
  expect(mocks.list.mock.calls.map(([filters]) => filters.page)).toEqual([1, 2, 1]);
  expect(pager().props).toMatchObject({ page: 1, total: 20 });
});

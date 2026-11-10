/* The harness assigns independent hook banks to the editor and each recovery child. */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => {
  const empty = () => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[],
    effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], state: 0, ref: 0, memo: 0, effect: 0 });
  return { empty, banks: new Map<string, ReturnType<typeof empty>>(), current: 'editor' };
});
const mocks = vi.hoisted(() => ({ get: vi.fn(), preview: vi.fn(), assign: vi.fn(), read: vi.fn(), seal: vi.fn(), busy: vi.fn(), unsubscribe: vi.fn(),
  auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => {
  const bank = () => hooks.banks.get(hooks.current)!;
  const memo = (value: () => unknown, deps: unknown[]) => { const b = bank(), i = b.memo++; if (!b.memos[i] || deps.some((dep, j) => dep !== b.memos[i].deps[j])) b.memos[i] = { value: value(), deps }; return b.memos[i].value; };
  return { ...await vi.importActual<typeof import('react')>('react'),
    useState: (value: unknown) => { const b = bank(), i = b.state++; if (!(i in b.states)) b.states[i] = typeof value === 'function' ? value() : value;
      return [b.states[i], (next: unknown) => { b.states[i] = typeof next === 'function' ? next(b.states[i]) : next; }]; },
    useRef: (value: unknown) => { const b = bank(), i = b.ref++; return b.refs[i] ??= { current: value }; },
    useMemo: memo, useCallback: (value: unknown, deps: unknown[]) => memo(() => value, deps), useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
    useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const b = bank(), i = b.effect++, previous = b.effects[i];
      if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { b.effects[i] = { deps, effect, cleanup: previous?.cleanup }; b.changed.push(i); } },
  };
});
vi.mock('@/app/admin/shipping-charge-group-actions', () => ({ getGoodShippingChargeGroupAction: mocks.get, previewShippingChargeGroupAssignmentAction: mocks.preview,
  assignShippingChargeGroupAction: mocks.assign, saveShippingChargeGroupAction: vi.fn(), readShippingChargeGroupOperationAction: mocks.read,
  sealShippingChargeGroupOperationAction: mocks.seal, getShippingChargeGroupAction: vi.fn(), listShippingChargeGroupsAction: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => {
  mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { shippingChargeGroupOperationContext, type ShippingChargeGroupGoodData, type ShippingChargeGroupOperationReceipt } from '@/lib/admin/shipping-charge-groups';
import { chargeAdminFixtures, chargeIdentity as identity, chargeIds as ids } from '@/test/fixtures/shipping-charge-groups';
import { GoodShippingChargeGroupAssignmentEditor, GoodShippingChargeGroupPanel } from '../GoodShippingChargeGroupPanel';
import { ShippingChargeGroupField } from '../ShippingChargeGroupField';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let scope: ReturnType<typeof createGoodsDescriptionToolScope>, storageValues: Map<string, string>;
let props: Parameters<typeof GoodShippingChargeGroupAssignmentEditor>[0], outer = false;
function goodData(assigned = false): ShippingChargeGroupGoodData {
  const { good, group, origin, assigned: receipt } = chargeAdminFixtures();
  return { actorId: ids.actor, sessionId: ids.session, runtimeEnabled: true, good: assigned ? { ...good, ...receipt.goods[0] } : good,
    group: assigned ? { ...group, assignedCount: 1 } : null, origin, canManageRegional: false };
}
function withBank<T>(key: string, fn: () => T): T {
  const bank = hooks.banks.get(key) ?? hooks.empty(); hooks.banks.set(key, bank); hooks.current = key;
  bank.state = 0; bank.ref = 0; bank.memo = 0; bank.effect = 0; return fn();
}
function cleanup() { for (const bank of hooks.banks.values()) for (const effect of bank.effects) effect.cleanup?.(); hooks.banks.clear(); }
function rawNode() { return withBank('editor', () => outer ? GoodShippingChargeGroupPanel({ accountId: ids.actor, goodId: props.goodId, onBusyChange: mocks.busy }) : GoodShippingChargeGroupAssignmentEditor(props)); }
function node() {
  const root = rawNode(), children = all(root).filter(item => typeof item.type === 'function' && item.type.name === 'PendingAssignment');
  const active = new Set(['editor']);
  const recovery = children.map(item => { const key = `pending:${String(item.key)}`; active.add(key);
    return withBank(key, () => (item.type as (props: Record<string, unknown>) => ReactNode)(item.props)); });
  for (const [key, bank] of hooks.banks) if (!active.has(key)) { for (const effect of bank.effects) effect.cleanup?.(); hooks.banks.delete(key); }
  return <>{root}{recovery}</>;
}
function effects() { for (const bank of hooks.banks.values()) for (const index of bank.changed.splice(0)) { const item = bank.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); node(); effects(); } }
const button = (label: string) => all(node()).find(item => item.type === 'button' && text(item) === label)!;
function click(label: string) { const value = button(label); expect(value).toBeDefined(); expect(value.props.disabled).not.toBe(true); (value.props.onClick as () => void)(); }
function picker() { return all(node()).find(item => item.type === ShippingChargeGroupField)!; }
function choose(group = chargeAdminFixtures().group as ShippingChargeGroupGoodData['group']) {
  (picker().props.onChange as (id: string | null, group: unknown) => void)(group?.id ?? null, group);
}
async function mount() { node(); effects(); await flush(); }
async function prepare() { choose(); click('배정 미리보기'); await flush(); }
function seedPending() {
  const context = shippingChargeGroupOperationContext(chargeAdminFixtures().assign);
  storageValues.set(`icons:shipping-charge-group-operation:v1:${ids.actor}:${ids.session}:${ids.group}:assign`, JSON.stringify(context));
  return context;
}
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); outer = false; storageValues = new Map(); mocks.auth = null;
  const storage = { getItem: (key: string) => storageValues.get(key) ?? null, setItem: (key: string, value: string) => storageValues.set(key, value), removeItem: (key: string) => storageValues.delete(key),
    key: (index: number) => [...storageValues.keys()][index] ?? null, get length() { return storageValues.size; } };
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('window', Object.assign(new EventTarget(), { sessionStorage: storage }));
  scope = createGoodsDescriptionToolScope(ids.actor); scope.activate(); scope.setEnabled(true); scope.authenticate(ids.actor, ids.session);
  props = { goodId: 'good-a', identity, scope, disabledReason: '', onBusyChange: mocks.busy };
  mocks.get.mockResolvedValue({ data: goodData() }); mocks.preview.mockResolvedValue({ data: chargeAdminFixtures().preview });
  mocks.assign.mockResolvedValue({ error: '응답 불명', uncertain: true }); mocks.read.mockResolvedValue({ data: null });
  mocks.seal.mockImplementation(async context => {
    const { expectedActorId: actorId, expectedSessionId: sessionId, ...operation } = context;
    return { data: { ...chargeAdminFixtures().sealed, ...operation, actorId, sessionId } };
  });
});
afterEach(() => { cleanup(); scope.dispose(); vi.unstubAllGlobals(); });

it('초기 조회는 현재 상품·세션에 결속되고 조회가 끝날 때까지 parent를 잠근다', async () => {
  const pending = deferred<unknown>(); mocks.get.mockReturnValueOnce(pending.promise); node(); effects(); await flush();
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith('good-a', identity); expect(mocks.busy).toHaveBeenLastCalledWith(true); expect(button('배정 미리보기').props.disabled).toBe(true);
  pending.resolve({ data: goodData() }); await flush(); expect(mocks.busy).toHaveBeenLastCalledWith(false); expect(picker().props.value).toBeNull(); expect(mocks.preview).not.toHaveBeenCalled();
});
it('명시 선택 후 fresh preview의 full guard·공유 범위를 한 번만 전송한다', async () => {
  const { preview, guard, origin } = chargeAdminFixtures(), familyGoodIds = ['good-a', 'child'];
  mocks.preview.mockResolvedValueOnce({ data: { ...preview, goods: [{ ...preview.goods[0], familyGoodIds, effectiveCount: 2 }] } });
  await mount(); await prepare(); expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(ids.group, ['good-a'], identity);
  const save = button('이 배정으로 저장'); (save.props.onClick as () => void)(); (save.props.onClick as () => void)(); await flush();
  expect(mocks.assign).toHaveBeenCalledOnce(); expect(mocks.assign.mock.calls[0][0]).toMatchObject({ ...identity, command: 'assign', groupId: ids.group,
    expectedRevision: 1, origins: [origin], goods: [{ ...guard, familyGoodIds }] });
  expect(storageValues.size).toBe(1); expect(Object.keys(JSON.parse([...storageValues.values()][0]))).toHaveLength(6); expect(mocks.busy).toHaveBeenLastCalledWith(true);
});
it.each(['shipping_charge_group_origin_unavailable', 'collect_contract_not_ready'] as const)('%s 현재 진단은 명시적인 clear 미리보기를 막지 않는다', async blocker => {
  const data = goodData(true), { summary } = chargeAdminFixtures(); data.good.blocker = blocker; data.origin!.isActive = blocker !== 'shipping_charge_group_origin_unavailable';
  mocks.get.mockResolvedValueOnce({ data }); mocks.preview.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, group: null,
    runtimeEnabled: true, canAssign: true, origins: [data.origin], canManageRegional: false,
    goods: [{ ...data.good, blocker: null, beforeGroup: summary, afterGroup: null }] } });
  await mount(); choose(null); click('배정 미리보기'); await flush(); expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(null, ['good-a'], identity);
  click('이 배정으로 저장'); await flush(); expect(mocks.assign.mock.calls[0][0]).toMatchObject({ groupId: null, expectedRevision: 0, origins: [data.origin] });
});
it('출고지 없는 미지정 원상품은 origins 빈 배열의 noop clear 미리보기가 가능하다', async () => {
  const data = goodData(); data.good.originId = null; data.good.blocker = 'shipping_charge_group_origin_unavailable'; data.origin = null;
  mocks.get.mockResolvedValueOnce({ data }); mocks.preview.mockResolvedValueOnce({ data: { actorId: ids.actor, sessionId: ids.session, group: null,
    runtimeEnabled: true, canAssign: true, origins: [], canManageRegional: false, goods: [{ ...data.good, blocker: null, beforeGroup: null, afterGroup: null }] } });
  await mount(); click('배정 미리보기'); await flush(); click('이 배정으로 저장'); await flush();
  expect(mocks.assign.mock.calls[0][0]).toMatchObject({ groupId: null, expectedRevision: 0, origins: [], goods: [{ id: 'good-a', originId: null }] });
});
it('합산군 자식은 읽기 전용이고 변경 callback과 미리보기 handler도 거부한다', async () => {
  const data = goodData(); data.good = { ...data.good, ownerGoodId: 'owner', editable: false, blocker: 'goods_aggregation_policy_owned_by_source', familyGoodIds: ['good-a', 'owner'], effectiveCount: 2 };
  mocks.get.mockResolvedValueOnce({ data }); await mount(); expect(picker().props.readOnly).toBe(true); expect(picker().props.disabled).toBe(true);
  choose(); expect(picker().props.value).toBeNull(); (button('배정 미리보기').props.onClick as () => void)(); await flush(); expect(mocks.preview).not.toHaveBeenCalled();
});
it('상호 잠금은 선택·미리보기·재조회와 이미 만든 미리보기 저장 handler에 적용한다', async () => {
  await mount(); props = { ...props, disabledReason: '다른 설정 저장 중' }; choose(); expect(picker().props.value).toBeNull();
  (button('배정 미리보기').props.onClick as () => void)(); (button('최신 배정 불러오기').props.onClick as () => void)(); await flush();
  expect(mocks.get).toHaveBeenCalledOnce(); expect(mocks.preview).not.toHaveBeenCalled();
  props = { ...props, disabledReason: '' }; await prepare(); props = { ...props, disabledReason: '다른 설정 저장 중' };
  expect(button('이 배정으로 저장').props.disabled).toBe(true); (button('이 배정으로 저장').props.onClick as () => void)(); expect(mocks.assign).not.toHaveBeenCalled();
});
/* T3a-7 근본 정리: 상품 편집기가 패널 위에 공통 잠금 안내를 보이면 패널은 같은 이유를 다시 그리지 않는다. 잠금은 그대로다. */
it('이유 문장 표시를 끄면 본문에 이유를 그리지 않고 잠금은 유지한다', async () => {
  await mount(); props = { ...props, disabledReason: '다른 설정 저장 중' }; expect(text(node())).toContain('다른 설정 저장 중');
  props = { ...props, showDisabledReason: false }; expect(text(node())).not.toContain('다른 설정 저장 중');
  expect(button('배정 미리보기').props.disabled).toBe(true); expect(button('최신 배정 불러오기').props.disabled).toBe(true);
  choose(); expect(picker().props.value).toBeNull();
});
it('서버 preview 차단은 버튼과 handler 모두 닫는다', async () => {
  const { preview } = chargeAdminFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, canAssign: false,
    goods: [{ ...preview.goods[0], blocker: 'collect_contract_not_ready' }] } });
  await mount(); await prepare(); expect(button('이 배정으로 저장').props.disabled).toBe(true); (button('이 배정으로 저장').props.onClick as () => void)(); expect(mocks.assign).not.toHaveBeenCalled();
});
it.each(['actor', 'session', 'good', 'group'] as const)('다른 %s 미리보기는 저장 기준으로 받아들이지 않는다', async kind => {
  const { preview } = chargeAdminFixtures(), wrong = structuredClone(preview);
  if (kind === 'actor') wrong.actorId = ids.other; if (kind === 'session') wrong.sessionId = ids.other;
  if (kind === 'good') wrong.goods[0].id = 'other-good'; if (kind === 'group') wrong.group!.id = ids.other;
  mocks.preview.mockResolvedValueOnce({ data: wrong }); await mount(); await prepare();
  expect(button('이 배정으로 저장')).toBeUndefined(); expect(text(node())).toContain('다른 미리보기'); expect(mocks.assign).not.toHaveBeenCalled();
});
it('서버 미리보기의 full guard가 불완전하면 저장 입력을 만들지 않는다', async () => {
  const { preview } = chargeAdminFixtures(); mocks.preview.mockResolvedValueOnce({ data: { ...preview, goods: [{ ...preview.goods[0], assignmentVersionId: ids.assignment }] } });
  await mount(); await prepare(); expect(button('이 배정으로 저장').props.disabled).toBe(true); expect(text(node())).toContain('저장 기준을 확인하지 못했습니다');
});
it('재조회 실패는 이전 미리보기와 저장 권한을 폐기하고 미지정으로 표시하지 않는다', async () => {
  await mount(); await prepare(); mocks.get.mockRejectedValueOnce(new Error('network')); click('최신 배정 불러오기'); await flush();
  expect(picker()).toBeUndefined(); expect(button('이 배정으로 저장')).toBeUndefined(); expect(button('배정 미리보기').props.disabled).toBe(true); expect(mocks.assign).not.toHaveBeenCalled();
});
it('reload 뒤 journal은 재전송하지 않고 같은 UUID 읽기·봉인 후 다시 조회한다', async () => {
  await mount(); await prepare(); click('이 배정으로 저장'); await flush(); const request = mocks.assign.mock.calls[0][0]; cleanup(); await mount();
  click('저장 결과 확인'); await flush(); expect(mocks.read).toHaveBeenCalledExactlyOnceWith(shippingChargeGroupOperationContext(request)); expect(storageValues.size).toBe(1);
  mocks.seal.mockResolvedValueOnce({ data: { ...chargeAdminFixtures().sealed, operationId: request.operationId, command: 'assign', expectedRevision: 1 } });
  click('미처리 요청 종료'); await flush(); expect(storageValues.size).toBe(0); expect(mocks.assign).toHaveBeenCalledOnce(); expect(mocks.get).toHaveBeenCalledTimes(3);
  expect(button('이 배정으로 저장')).toBeUndefined(); expect(mocks.busy).toHaveBeenLastCalledWith(false);
});
it('초기 조회 중 recovery는 막고 receipt callback이 경합하면 새 readback만 적용한다', async () => {
  seedPending(); const old = deferred<unknown>(), latest = deferred<unknown>(); mocks.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  node(); effects(); await flush(); expect(button('저장 결과 확인').props.disabled).toBe(true); (button('저장 결과 확인').props.onClick as () => void)(); expect(mocks.read).not.toHaveBeenCalled();
  const pending = all(rawNode()).find(item => typeof item.type === 'function' && item.type.name === 'PendingAssignment')!;
  (pending.props.onReceipt as (value: ShippingChargeGroupOperationReceipt) => void)(chargeAdminFixtures().assigned); await flush(); expect(mocks.get).toHaveBeenCalledTimes(2);
  latest.resolve({ data: goodData(true) }); await flush(); expect(picker().props.value).toBe(ids.group);
  old.resolve({ data: goodData() }); await flush(); expect(picker().props.value).toBe(ids.group); expect(mocks.busy).toHaveBeenLastCalledWith(true);
});
it('확정 영수증 뒤 readback 동안 parent busy가 잠시 해제되지 않는다', async () => {
  seedPending(); await mount(); const latest = deferred<unknown>(); mocks.get.mockReturnValueOnce(latest.promise); mocks.read.mockResolvedValueOnce({ data: chargeAdminFixtures().assigned }); mocks.busy.mockClear();
  click('저장 결과 확인'); await flush(); expect(storageValues.size).toBe(0); expect(mocks.busy).toHaveBeenLastCalledWith(true); expect(mocks.busy.mock.calls.some(([value]) => value === false)).toBe(false);
  latest.resolve({ data: goodData(true) }); await flush(); expect(mocks.busy).toHaveBeenLastCalledWith(false);
});
it.each(['auth', 'unmount'] as const)('%s 뒤 도착한 초기 조회는 화면과 parent 상태를 되살리지 않는다', async kind => {
  const pending = deferred<unknown>(); mocks.get.mockReturnValueOnce(pending.promise); node(); effects(); await flush();
  if (kind === 'auth') scope.authenticate(ids.actor, ids.other); else cleanup();
  const before = mocks.busy.mock.calls.length; pending.resolve({ data: goodData(true) });
  if (kind === 'auth') await flush(); else for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(mocks.busy).toHaveBeenCalledTimes(before); if (kind === 'auth') expect(picker()).toBeUndefined(); else expect(mocks.busy).toHaveBeenLastCalledWith(false);
});
it('계정 전환 뒤 늦은 미리보기는 저장 입력을 만들지 않는다', async () => {
  await mount(); const pending = deferred<unknown>(); mocks.preview.mockReturnValueOnce(pending.promise); choose(); click('배정 미리보기'); scope.authenticate(ids.actor, ids.other);
  pending.resolve({ data: chargeAdminFixtures().preview }); await flush(); expect(button('이 배정으로 저장')).toBeUndefined(); expect(mocks.assign).not.toHaveBeenCalled();
});
it('언마운트 뒤 보관된 receipt callback은 재조회와 parent 알림을 만들지 않는다', async () => {
  seedPending(); await mount(); const pending = all(rawNode()).find(item => typeof item.type === 'function' && item.type.name === 'PendingAssignment')!;
  cleanup(); const count = mocks.busy.mock.calls.length; (pending.props.onReceipt as (value: ShippingChargeGroupOperationReceipt) => void)(chargeAdminFixtures().assigned);
  for (let i = 0; i < 8; i++) await Promise.resolve(); expect(mocks.get).toHaveBeenCalledOnce(); expect(mocks.busy).toHaveBeenCalledTimes(count);
});
it('바깥 패널은 로그인 세션을 key로 격리하고 세션 교체 시 편집기를 제거한다', async () => {
  outer = true; node(); effects(); const authenticate = (session: string) => mocks.auth?.('SIGNED_IN', { user: { id: ids.actor },
    access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` });
  authenticate(ids.session); await flush(); const editor = all(node()).find(item => item.type === GoodShippingChargeGroupAssignmentEditor)!;
  expect(editor.key).toContain(ids.session); authenticate(ids.other); await flush(); expect(all(node()).some(item => item.type === GoodShippingChargeGroupAssignmentEditor)).toBe(false);
  expect(text(node())).toContain('로그인 계정 또는 세션이 바뀌었습니다');
});

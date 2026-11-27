import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), lookup: vi.fn(), runtime: vi.fn(), unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (callback: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, j) => dep !== hooks.memos[i].deps[j])) hooks.memos[i] = { value: callback(), deps }; return hooks.memos[i].value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const i = hooks.effectIndex++, previous = hooks.effects[i]; if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { hooks.effects[i] = { deps, effect, cleanup: previous?.cleanup }; hooks.changed.push(i); } },
}));
vi.mock('@/app/admin/shipping-collect-contract-actions', () => ({ readShippingCollectContractAction: mocks.read, readShippingCollectOperationAction: mocks.lookup, saveShippingCollectContractAction: mocks.save }));
vi.mock('@/app/admin/goods-transaction-runtime-actions', () => ({ readGoodsTransactionRuntimeAction: mocks.runtime }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { ShippingCollectContractPanel } from './ShippingCollectContractPanel';
import { SHIPPING_COLLECT_FIELDS, SHIPPING_COLLECT_OFF_CONFIRM, SHIPPING_COLLECT_RUNTIME_OFF, type ShippingCollectValues } from '@/lib/admin/shipping-collect-contract';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { RELOAD_SAVED_CONFIRM, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const actor = '91000000-0000-4000-8000-000000000001', session = '91000000-0000-4000-8000-000000000002';
const row = { originId: actor, revision: 0, versionId: null, status: 'disabled' as const, values: Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, ''])) as ShippingCollectValues };
let props: Parameters<typeof ShippingCollectContractPanel>[0], data: Map<string, string>;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function render() { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return ShippingCollectContractPanel(props); }
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 6; i++) { await Promise.resolve(); render(); effects(); } }
function button(label: string) { return all(render()).find(item => item.type === 'button' && text(item) === label)!; }
function click(label: string) { const item = button(label); expect(item).toBeDefined(); expect(item.props.disabled).not.toBe(true); (item.props.onClick as () => void)(); }
const inputs = () => all(render()).filter(node => node.type === 'input');
function change(value: string, index = 0) { (inputs()[index].props.onChange as (event: unknown) => void)({ target: { value } }); }
const statusSelect = () => all(render()).find(node => node.type === 'select')!;
function choose(value: 'active' | 'off') { (statusSelect().props.onChange as (event: unknown) => void)({ target: { value } }); }
const filled = Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, `${key} 값`])) as ShippingCollectValues;
let confirmStub: ReturnType<typeof stubAdminConfirm> | undefined;
function authenticate(id = actor, sessionId = session) { mocks.auth?.('SIGNED_IN', { user: { id }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.x` }); }
function remount() { for (const effect of hooks.effects) effect.cleanup?.(); hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; render(); effects(); authenticate(); }
beforeEach(async () => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; vi.clearAllMocks(); data = new Map();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => false) })); vi.stubGlobal('document', new EventTarget());
  props = { originId: actor, accountId: actor, canEdit: true }; mocks.read.mockResolvedValue({ ok: true, value: row }); mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '불명확' }); mocks.runtime.mockResolvedValue(true);
  mocks.lookup.mockResolvedValue({ ok: true, value: { receipt: null, latest: row } }); render(); effects(); authenticate(); await flush();
});
afterEach(() => { for (const effect of hooks.effects) effect.cleanup?.(); confirmStub?.restore(); confirmStub = undefined; vi.unstubAllGlobals(); });
it('연락처·안내 입력은 sessionStorage에 남기지 않고 저장됐는지 확인할 번호만 보관한다', async () => {
  change('개인연락처-CANARY'); click('착불 조건 저장'); await flush(); expect(data.size).toBe(1); expect([...data.values()][0]).not.toContain('CANARY');
  expect(JSON.parse([...data.values()][0])).toEqual({ version: 1, sessionId: session, originId: actor, operationId: mocks.save.mock.calls[0][0].operationId });
  /* 저장하려던 내용이 화면에 남아 있으면 [저장됐는지 확인]은 같은 내용을 그대로 다시 보낸다(두 번 저장되지 않는다). */
  expect(text(render()).split(SAVE_UNKNOWN_MESSAGE)).toHaveLength(2);
  click('저장됐는지 확인'); await flush(); expect(mocks.save.mock.calls[1][0]).toBe(mocks.save.mock.calls[0][0]); expect(mocks.lookup).not.toHaveBeenCalled();
});
it('[그만두고 다시 하기]는 적은 내용이 사라진다고 묻고, 지금 저장된 내용을 새로 읽어 잠금을 푼다', async () => {
  change('적는 중'); click('착불 조건 저장'); await flush(); const reads = mocks.read.mock.calls.length;
  confirmStub = stubAdminConfirm(false); click('그만두고 다시 하기'); await flush();
  expect(confirmStub).toHaveBeenCalledWith(RELOAD_SAVED_CONFIRM.message); expect(mocks.read).toHaveBeenCalledTimes(reads); expect(data.size).toBe(1); expect(inputs()[0].props.value).toBe('적는 중');
  confirmStub.restore(); confirmStub = stubAdminConfirm(true); click('그만두고 다시 하기'); await flush();
  expect(mocks.read).toHaveBeenCalledTimes(reads + 1); expect(data.size).toBe(0); expect(inputs()[0].props.value).toBe(''); expect(button('착불 조건 저장').props.disabled).toBe(false);
  expect(mocks.save).toHaveBeenCalledOnce();
});
it('새로고침 뒤에는 다시 저장하지 않고 조회만 하며, 확인되지 않으면 [그만두고 다시 하기]로 지금 저장된 내용에서 다시 적는다', async () => {
  change('안내-CANARY'); click('착불 조건 저장'); await flush(); remount(); await flush();
  click('저장됐는지 확인'); await flush(); expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.lookup).toHaveBeenCalledOnce();
  expect(text(render())).toContain('아직 확인되지 않습니다'); click('그만두고 다시 하기'); await flush();
  expect(data.size).toBe(0); expect(button('착불 조건 저장').props.disabled).toBe(false); expect(inputs()[0].props.value).toBe('');
});
it('새로고침 뒤 앞서 누른 저장이 된 것을 확인하면 다시 저장하지 않고 잠금을 푼다', async () => {
  click('착불 조건 저장'); await flush(); const op = mocks.save.mock.calls[0][0].operationId; remount(); await flush();
  const saved = { ...row, revision: 1, versionId: session }; mocks.lookup.mockResolvedValueOnce({ ok: true, value: { receipt: { ...saved, operationId: op }, latest: saved } });
  click('저장됐는지 확인'); await flush(); expect(mocks.save).toHaveBeenCalledOnce(); expect(data.size).toBe(0); expect(text(render())).toContain('앞서 누른 저장이 됐습니다.');
  expect(button('저장됐는지 확인')).toBeUndefined();
});
it('중복 callback은 한 요청이며 계정 전환 뒤 늦은 결과는 드러내지 않는다', async () => {
  const pending = deferred<unknown>(); mocks.save.mockReturnValueOnce(pending.promise); const stale = button('착불 조건 저장');
  (stale.props.onClick as () => void)(); (stale.props.onClick as () => void)(); expect(mocks.save).toHaveBeenCalledOnce();
  authenticate(session); pending.resolve({ ok: true, value: { ...row, revision: 1, versionId: actor } }); await flush();
  expect(text(render())).not.toContain('저장했습니다'); expect(data.size).toBe(0);
});
it('readonly 입력은 write를 시작하지 않으며 미저장 본문은 이탈 경고를 낸다', async () => {
  props = { ...props, canEdit: false }; const disabled = button('착불 조건 저장'); expect(disabled.props.disabled).toBe(true); (disabled.props.onClick as () => void)(); expect(mocks.save).not.toHaveBeenCalled();
  props = { ...props, canEdit: true }; change('적는 중'); await flush(); const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
/* 근거 칸은 걷어 냈다(2026-11-26): 화면에는 고객에게 보이는 네 칸뿐이고, 버전·요청 번호 같은 내부 값은 보이지 않는다. */
it('고객에게 보이는 네 칸만 있고 근거 칸·버전·요청 번호는 화면에 없다', () => {
  expect(inputs()).toHaveLength(4); const shown = text(render());
  for (const label of ['수납 주체', '수납 방법', '환불 문의처', '고객 안내', '착불 사용 여부']) expect(shown).toContain(label);
  for (const gone of ['근거', '증빙', '분쟁', '버전', '요청 번호', '준비 중', '환급', '임시저장']) expect(shown).not.toContain(gone);
  expect(Children.toArray(statusSelect().props.children as ReactNode).map(option => text(option))).toEqual(['사용 안 함', '사용']);
});
it("'사용'으로 저장하려는데 빈 칸이 있으면 저장하지 않고 그 칸 이름을 말한다", async () => {
  change('TEST 수납사'); choose('active'); click('착불 조건 저장'); await flush();
  expect(mocks.save).not.toHaveBeenCalled(); expect(text(render())).toContain("'사용'으로 저장하려면 수납 방법 · 환불 문의처 · 고객 안내 칸을 적어 주세요.");
});
it('네 칸만 보내고 앞뒤 빈칸은 지운 뒤 사용으로 저장하며, 켜면 생기는 일을 한 줄로 되읽는다', async () => {
  SHIPPING_COLLECT_FIELDS.forEach((key, index) => change(index === 0 ? ' 한진택배 배송 기사 ' : filled[key], index)); choose('active');
  expect(text(render())).toContain("'이 상품만의 배송비 규칙'에서 착불을 고를 수 있습니다"); expect(text(render())).toContain('한진택배 배송 기사에게 배송비를 내고, 온라인 결제 금액에는 들어가지 않습니다.');
  const values = { ...filled, collectorName: '한진택배 배송 기사' };
  mocks.save.mockResolvedValueOnce({ ok: true, value: { ...row, revision: 1, versionId: session, status: 'active', values } }); click('착불 조건 저장'); await flush();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ originId: actor, expectedActorId: actor, expectedRevision: 0, status: 'active', values });
  expect(Object.keys(mocks.save.mock.calls[0][0].values)).toEqual([...SHIPPING_COLLECT_FIELDS]);
  expect(text(render())).toContain('착불 조건을 사용으로 저장했습니다.'); expect(data.size).toBe(0);
});
it("쇼핑몰 주문 설정이 꺼져 있으면 '사용'을 고르기 전에 막고 누구에게 요청하는지 말한다", async () => {
  mocks.runtime.mockResolvedValue(false); remount(); await flush();
  const use = Children.toArray(statusSelect().props.children as ReactNode).filter(isValidElement<Record<string, unknown>>).find(option => option.props.value === 'active')!;
  expect(use.props.disabled).toBe(true); expect(text(render())).toContain(SHIPPING_COLLECT_RUNTIME_OFF); expect(SHIPPING_COLLECT_RUNTIME_OFF).not.toContain('운영 설정을 확인');
});
it('사용 안 함인 출고지에서는 입력을 잠그고 어디를 바꾸면 되는지 말한다', () => {
  props = { ...props, originActive: false };
  expect(button('착불 조건 저장').props.disabled).toBe(true); expect(all(render()).find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
  expect(text(render())).toContain('사용 안 함인 출고지에는 착불 조건을 저장할 수 없습니다.');
});
it('착불을 끌 때는 막히는 주문을 확인창으로 말하고, 돌아가면 저장하지 않는다', async () => {
  mocks.read.mockResolvedValue({ ok: true, value: { ...row, revision: 1, versionId: session, status: 'active', values: filled } }); remount(); await flush();
  confirmStub = stubAdminConfirm(false); choose('off'); expect(text(render())).toContain('이 출고지 상품은 착불로 팔 수 없습니다.');
  click('착불 조건 저장'); await flush(); expect(confirmStub).toHaveBeenCalledWith(SHIPPING_COLLECT_OFF_CONFIRM.message); expect(mocks.save).not.toHaveBeenCalled();
  expect(SHIPPING_COLLECT_OFF_CONFIRM.message).toContain('새 주문이 막히고'); expect(button('착불 조건 저장').props.disabled).toBe(false);
  confirmStub.restore(); confirmStub = stubAdminConfirm(true); click('착불 조건 저장'); await flush();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ expectedRevision: 1, status: 'disabled', values: filled });
});
it('다른 사람이 먼저 바꿨으면 지금 저장된 내용을 바로 읽어 비교하고, [내 입력으로 덮어쓰기]는 그 내용 위에 저장한다', async () => {
  change('내 수납사'); const theirs = { ...row, revision: 2, versionId: session, values: { ...row.values, collectorName: '다른 사람 수납사' } };
  mocks.save.mockResolvedValueOnce({ ok: false, uncertain: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다. 비교해 주세요.' }); mocks.read.mockResolvedValue({ ok: true, value: theirs });
  click('착불 조건 저장'); await flush();
  const shown = text(render()); expect(shown).toContain('다른 사람 수납사'); expect(shown).toContain('내 수납사'); expect(shown).toContain('다른 사람이 저장한 내용이 사라지고 내 입력으로 바뀝니다.');
  expect(button('착불 조건 저장').props.disabled).toBe(true); expect(data.size).toBe(0);
  mocks.save.mockResolvedValueOnce({ ok: true, value: { ...theirs, revision: 3, values: { ...row.values, collectorName: '내 수납사' } } }); click('내 입력으로 덮어쓰기'); await flush();
  expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: 2, values: { collectorName: '내 수납사' } }); expect(button('내 입력으로 덮어쓰기')).toBeUndefined();
});

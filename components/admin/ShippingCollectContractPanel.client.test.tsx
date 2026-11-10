import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), lookup: vi.fn(), unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (callback: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, j) => dep !== hooks.memos[i].deps[j])) hooks.memos[i] = { value: callback(), deps }; return hooks.memos[i].value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const i = hooks.effectIndex++, previous = hooks.effects[i]; if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { hooks.effects[i] = { deps, effect, cleanup: previous?.cleanup }; hooks.changed.push(i); } },
}));
vi.mock('@/app/admin/shipping-collect-contract-actions', () => ({ readShippingCollectContractAction: mocks.read, readShippingCollectOperationAction: mocks.lookup, saveShippingCollectContractAction: mocks.save }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { ShippingCollectContractPanel } from './ShippingCollectContractPanel';
import { SHIPPING_COLLECT_FIELDS, type ShippingCollectValues } from '@/lib/admin/shipping-collect-contract';
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
function change(value: string) { const field = all(render()).find(node => node.type === 'input')!; (field.props.onChange as (event: unknown) => void)({ target: { value } }); }
function authenticate(id = actor, sessionId = session) { mocks.auth?.('SIGNED_IN', { user: { id }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.x` }); }
function remount() { for (const effect of hooks.effects) effect.cleanup?.(); hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; render(); effects(); authenticate(); }
beforeEach(async () => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; vi.clearAllMocks(); data = new Map();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => false) })); vi.stubGlobal('document', new EventTarget());
  props = { originId: actor, accountId: actor, canEdit: true }; mocks.read.mockResolvedValue({ ok: true, value: row }); mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '불명확' });
  mocks.lookup.mockResolvedValue({ ok: true, value: { receipt: null, latest: row } }); render(); effects(); authenticate(); await flush();
});
afterEach(() => { for (const effect of hooks.effects) effect.cleanup?.(); vi.unstubAllGlobals(); });
it('연락처·계약 입력은 sessionStorage에 남기지 않고 불명확 요청 식별자만 보관한다', async () => {
  change('개인연락처-CANARY'); click('착불 운영 조건 저장'); await flush(); expect(data.size).toBe(1); expect([...data.values()][0]).not.toContain('CANARY');
  expect(JSON.parse([...data.values()][0])).toEqual({ version: 1, sessionId: session, originId: actor, operationId: mocks.save.mock.calls[0][0].operationId });
  click('같은 입력으로 결과 확인'); await flush(); expect(mocks.save.mock.calls[1][0]).toBe(mocks.save.mock.calls[0][0]);
});
it('조회 null은 자동 재저장하지 않으며 최신값을 명시적으로 채택한 다음 새 편집을 시작한다', async () => {
  change('계약-CANARY'); click('착불 운영 조건 저장'); await flush(); remount(); await flush();
  expect(button('같은 입력으로 결과 확인')).toBeUndefined(); click('이전 저장 결과 확인'); await flush(); expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(text(render())).toContain('미처리로 단정하지 않습니다'); click('현재 저장값으로 편집 시작'); await flush();
  expect(data.size).toBe(0); expect(button('착불 운영 조건 저장').props.disabled).toBe(false); expect(all(render()).find(node => node.type === 'input')!.props.value).toBe('');
});
it('새로고침 이후 원래 영수증과 최신 저장본을 확인하면 중복 write 없이 pending을 해제한다', async () => {
  click('착불 운영 조건 저장'); await flush(); const op = mocks.save.mock.calls[0][0].operationId; remount(); await flush();
  const saved = { ...row, revision: 1, versionId: session }; mocks.lookup.mockResolvedValueOnce({ ok: true, value: { receipt: { ...saved, operationId: op }, latest: saved } });
  click('이전 저장 결과 확인'); await flush(); expect(mocks.save).toHaveBeenCalledOnce(); expect(data.size).toBe(0); expect(text(render())).toContain('원래 요청의 저장 기록');
});
it('중복 callback은 한 요청이며 계정 전환 뒤 늦은 결과는 드러내지 않는다', async () => {
  const pending = deferred<unknown>(); mocks.save.mockReturnValueOnce(pending.promise); const stale = button('착불 운영 조건 저장');
  (stale.props.onClick as () => void)(); (stale.props.onClick as () => void)(); expect(mocks.save).toHaveBeenCalledOnce();
  authenticate(session); pending.resolve({ ok: true, value: { ...row, revision: 1, versionId: actor } }); await flush();
  expect(text(render())).not.toContain('저장하고 다시 확인했습니다'); expect(data.size).toBe(0);
});
it('readonly 입력은 write를 시작하지 않으며 미저장 본문은 이탈 경고를 낸다', async () => {
  props = { ...props, canEdit: false }; const disabled = button('착불 운영 조건 저장'); expect(disabled.props.disabled).toBe(true); (disabled.props.onClick as () => void)(); expect(mocks.save).not.toHaveBeenCalled();
  props = { ...props, canEdit: true }; change('초안 입력'); await flush(); const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});

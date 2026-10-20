import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), jobs: [] as (() => void)[], pending: false }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), reload: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = hooks.index++, previous = hooks.effects.get(index); if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects.set(index, { deps, cleanup: previous?.cleanup }); hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects.get(index)!.cleanup = effect() || undefined; }); } },
  useTransition: () => [hooks.pending, (action: () => Promise<void>) => { hooks.pending = true; void action().finally(() => { hooks.pending = false; }); }],
}));
vi.mock('@/app/admin/category-display-actions', () => ({ updateCategoryDisplayTreeAction: mocks.save, reloadCategoryDisplayTreeAction: mocks.reload }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { CategoryDisplayTree } from './CategoryDisplayTree';
import type { CategoryDisplayDirectory } from '@/lib/category-display';
const id = (n: number) => `94933000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(90), sessionId = id(91);
const node = (n: number, parent: number | null = null, depth = 1) => ({ id: id(n), name: `전시 ${n}`, parentId: parent === null ? null : id(parent), depth, sortOrder: n - 1, publicEnabled: true, archivedAt: null, legacyCategoryId: null });
const initial: CategoryDisplayDirectory = { categories: [node(1), node(2), node(3, 1, 2)], sourceCategories: [], revision: 8, checkedAt: '2026-10-14T00:00:00Z' };
type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
let props: Parameters<typeof CategoryDisplayTree>[0];
function render() { hooks.index = 0; const result = CategoryDisplayTree(props); for (const job of hooks.jobs.splice(0)) job(); return nodes(result); }
async function flush() { for (let i = 0; i < 10; i++) { await Promise.resolve(); render(); } }
function change(label: string, value: string) { const parent = render().find(node => node.type === 'label' && text(node).startsWith(label))!; const input = nodes(parent).find(node => node.type === 'input' || node.type === 'select')!; (input.props.onChange as (event: unknown) => void)({ target: { value } }); }
function click(label: string) { const button = render().find(node => node.type === 'button' && text(node) === label)!; expect(button).toBeDefined(); expect(button.props.disabled).not.toBe(true); (button.props.onClick as () => void)(); }
function submit() { const form = render().find(node => node.type === 'form')!; (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); }
function authenticate(actorId = actor, session = sessionId) { mocks.auth?.('SIGNED_IN', { user: { id: actorId }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
beforeEach(() => {
  hooks.values = []; hooks.effects.clear(); hooks.jobs = []; hooks.pending = false; vi.clearAllMocks();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => true) })); vi.stubGlobal('document', new EventTarget());
  props = { initial, selectedId: id(1), actorId: actor, sessionId }; mocks.save.mockResolvedValue({ error: '연결을 확인하지 못했습니다.', uncertain: true }); mocks.reload.mockResolvedValue({ directory: initial });
  render(); authenticate();
});
afterEach(() => { for (const effect of hooks.effects.values()) effect.cleanup?.(); vi.unstubAllGlobals(); });
it('이름·부모 변경은 전시 노드 명령 하나만 보내며 결과 불명확 재시도는 원 UUID와 입력을 재사용한다', async () => {
  change('전시분류명', '새 전시 이름'); change('상위 전시분류', id(2)); submit(); await flush();
  expect(mocks.save.mock.calls[0][0]).toEqual({ action: 'update', id: id(1), name: '새 전시 이름', parentId: id(2), position: 0 });
  expect(mocks.save.mock.calls[0][1]).toBe(8); expect(mocks.save.mock.calls[0][3]).toBe(actor);
  expect(render().find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
  const first = mocks.save.mock.calls[0]; submit(); await flush(); expect(mocks.save.mock.calls[1]).toEqual(first);
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it('CAS 충돌에서 입력을 유지하고 최신 분류를 명시적으로 읽은 뒤에만 다시 수정한다', async () => {
  mocks.save.mockResolvedValue({ error: '다른 관리자가 변경했습니다.', conflict: true }); change('전시분류명', '보존할 입력'); submit(); await flush();
  expect(render().some(node => node.type === 'input' && node.props.value === '보존할 입력')).toBe(true);
  expect(render().find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
  click('최신 분류 불러오기'); await flush(); expect(mocks.reload).toHaveBeenCalledWith(actor);
  expect(render().some(node => node.type === 'input' && node.props.value === '전시 1')).toBe(true);
});
it('상품분류가 없어도 첫 전시분류를 만들 수 있고 새 상품 구성 링크를 제공한다', async () => {
  for (const effect of hooks.effects.values()) effect.cleanup?.(); hooks.values = []; hooks.effects.clear(); props = { ...props, selectedId: null, initial: { ...initial, categories: [], revision: 0 } }; render();
  mocks.save.mockImplementation(async (change: { id: string; name: string }) => ({ nodeId: change.id, directory: { ...props.initial, revision: 1, categories: [{ ...node(1), id: change.id, name: change.name, sortOrder: 0 }] } }));
  change('전시분류명', '시즌 컬렉션'); submit(); await flush();
  const saved = mocks.save.mock.calls[0][0]; expect(saved).toMatchObject({ action: 'create', name: '시즌 컬렉션', parentId: null, position: 0 });
  expect(render().some(node => node.props.href === `/admin/display/categories?id=${saved.id}`)).toBe(true);
});
it.each(['account', 'session'])('%s 변경 뒤 늦게 도착한 저장 응답을 화면에 적용하지 않는다', async kind => {
  let resolve!: (value: unknown) => void; mocks.save.mockReturnValue(new Promise(yes => { resolve = yes; }));
  change('전시분류명', '늦은 이름'); submit(); await flush(); if (kind === 'account') authenticate(id(92)); else authenticate(actor, id(92));
  resolve({ nodeId: id(1), directory: { ...initial, revision: 9, categories: [{ ...node(1), name: '서버 늦은 결과' }, node(2), node(3, 1, 2)] } }); await flush();
  expect(render().some(node => node.props.role === 'alert' && text(node).includes('로그인 상태'))).toBe(true);
  expect(render().some(node => node.type === 'input' && node.props.value === '서버 늦은 결과')).toBe(false);
});

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), jobs: [] as (() => void)[] }));
const mocks = vi.hoisted(() => ({ reload: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = hooks.index++, previous = hooks.effects.get(index); if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects.set(index, { deps, cleanup: previous?.cleanup }); hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects.get(index)!.cleanup = effect() || undefined; }); } },
}));
vi.mock('@/app/admin/category-display-actions', () => ({ reloadCategoryDisplayAction: mocks.reload, saveCategoryDisplayAction: vi.fn(), previewCategoryDisplayAction: vi.fn(), searchCategoryDisplayGoodsAction: vi.fn(), updateCategoryDisplayTreeAction: vi.fn(), reloadCategoryDisplayTreeAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));

import { CategoryDisplayScreen } from './CategoryDisplayScreen';
import { defaultCategoryDisplayValues, type CategoryDisplaySnapshot } from '@/lib/category-display';

const id = '94933000-0000-4000-8000-000000000001', actorId = '94933000-0000-4000-8000-000000000090';
const category = { id, name: '합성 전시', parentId: null, depth: 1, sortOrder: 0, publicEnabled: false };
const initial: CategoryDisplaySnapshot = { category, revision: 1, values: defaultCategoryDisplayValues(id), checkedAt: '2026-10-20T00:00:00Z' };
type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
function render() {
  hooks.index = 0;
  const screen = CategoryDisplayScreen({ initial, actorId, sessionId: null, directory: { categories: [{ ...category, archivedAt: null, legacyCategoryId: null }], sourceCategories: [], revision: 1, checkedAt: initial.checkedAt } });
  const editor = nodes(screen).find(node => typeof node.type === 'function' && node.type.name === 'CategoryDisplayEditor')!;
  const result = (editor.type as (props: Record<string, unknown>) => ReactNode)(editor.props);
  for (const job of hooks.jobs.splice(0)) job();
  return nodes(result);
}
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } }
function titleInput() { const label = render().find(node => node.type === 'label' && text(node) === '제목 · 40자')!; return nodes(label).find(node => node.type === 'input')!; }
function reload() { const button = render().find(node => node.type === 'button' && text(node) === '최신 저장본 불러오기')!; expect(button.props.disabled).not.toBe(true); (button.props.onClick as () => void)(); }

beforeEach(() => {
  hooks.values = []; hooks.effects.clear(); hooks.jobs = []; vi.clearAllMocks();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => true) })); vi.stubGlobal('document', new EventTarget());
  render();
  (titleInput().props.onChange as (event: unknown) => void)({ target: { value: '보존할 미저장 제목' } });
});
afterEach(() => { for (const effect of hooks.effects.values()) effect.cleanup?.(); vi.unstubAllGlobals(); });

it('최신 저장본 통신 실패 뒤 입력을 유지하고 저장·재조회를 다시 허용한다', async () => {
  mocks.reload.mockRejectedValueOnce(new Error('Failed to fetch'));
  reload(); await flush();
  expect(titleInput().props.value).toBe('보존할 미저장 제목');
  expect(render().some(node => node.props.role === 'alert' && text(node).includes('입력은 유지됩니다'))).toBe(true);
  expect(render().find(node => node.type === 'button' && node.props.type === 'submit')!.props.disabled).toBe(false);
  const fresh = { ...initial, revision: 2, values: { ...initial.values, banner: { ...initial.values.banner, title: '서버 저장 제목' } } };
  mocks.reload.mockResolvedValueOnce({ snapshot: fresh });
  reload(); await flush();
  expect(mocks.reload).toHaveBeenCalledTimes(2);
  expect(titleInput().props.value).toBe('서버 저장 제목');
});

it('계정 변경 뒤 도착한 재조회 결과는 이전 화면에 적용하지 않는다', async () => {
  let resolve!: (result: unknown) => void; mocks.reload.mockReturnValue(new Promise(done => { resolve = done; }));
  reload(); await flush();
  mocks.auth?.('SIGNED_IN', { user: { id: 'other-account' }, access_token: '' });
  resolve({ snapshot: initial }); await flush();
  expect(titleInput().props.value).toBe('보존할 미저장 제목');
  expect(render().some(node => node.props.role === 'alert' && text(node).includes('로그인 상태가 바뀌었습니다'))).toBe(true);
});

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ search: vi.fn(), states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0, work: [] as Promise<void>[] }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/app/admin/goods-group-actions', () => ({ searchGoodsGroupConsoleAction: mocks.search }));
vi.mock('../GoodsGroupEditor', () => ({ GoodsGroupEditor: () => null }));
vi.mock('../GoodsBulkToolbar', () => ({ GoodsBulkToolbar: () => null }));
vi.mock('../GoodsGroupOperation', () => ({
  GROUP_BUTTON: 'wc-admin-kit__button', GROUP_PRIMARY: 'wc-admin-kit__button', GroupPager: () => null,
  GroupTable: ({ children }: { children: ReactNode }) => children,
  useGoodsGroupSession: () => ({ current: () => true, blocked: false, deny: vi.fn() }),
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = mocks.refIndex++; mocks.refs[index] ??= { current: initial }; return mocks.refs[index]; },
  useTransition: () => [false, (work: () => Promise<void>) => { mocks.work.push(work()); }],
}));
import { GoodsBulkToolbar } from '../GoodsBulkToolbar';
import { GoodsGroupsScreen } from './GoodsGroupsScreen';
import { DEFAULT_GROUP_FILTERS } from '@/lib/admin/goods-group-console';
import type { GoodsGroupSnapshot } from '@/lib/admin/goods-groups';
type Element = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
const group = (id: string, archivedAt: string | null = null) => ({ id, name: `그룹 ${id}`, optionNames: ['색상'], members: [], archivedAt }) as unknown as GoodsGroupSnapshot;
const page = (rows: GoodsGroupSnapshot[]) => ({ rows, total: rows.length, page: 1, pageSize: 20, counts: { all: rows.length, active: rows.length, archived: 0 }, metadata: {} });
function render() {
  mocks.index = 0; mocks.refIndex = 0;
  return GoodsGroupsScreen({ initialPage: page([group('a'), group('b')]), initialConsole: page([group('a'), group('b')]) as never, initialGroup: null,
    initialFilters: { ...DEFAULT_GROUP_FILTERS }, actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' });
}
const toolbar = () => nodes(render()).find(node => node.type === GoodsBulkToolbar)!;
function check(label: string) {
  const box = nodes(render()).find(node => node.type === 'input' && node.props['aria-label'] === label)!;
  (box.props.onChange as (event: unknown) => void)({ target: { checked: true } });
}
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.refs = []; mocks.work = []; });

it('그룹 일괄 변경을 확정해도 선택을 유지하고, 다시 읽은 목록에서 보관된 그룹만 뺀다', async () => {
  check('그룹 a 선택'); check('그룹 b 선택');
  expect(toolbar().props.selectedIds).toEqual(['a', 'b']);
  mocks.search.mockResolvedValue({ value: page([group('a'), group('b', '2026-10-28T00:00:00Z')]) });
  (toolbar().props.onCompleted as () => void)(); await Promise.all(mocks.work);
  expect(mocks.search).toHaveBeenCalledOnce();
  expect(toolbar().props.selectedIds).toEqual(['a']);
});

it('선택 해제 버튼이 선택을 비우고, 검색·페이지 이동은 지금처럼 선택을 비운다', async () => {
  expect(nodes(render()).some(node => node.type === 'button' && text(node.props.children as ReactNode) === '선택 해제')).toBe(false);
  check('그룹 a 선택');
  const clear = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '선택 해제')!;
  (clear.props.onClick as () => void)();
  expect(toolbar().props.selectedIds).toEqual([]);
  check('그룹 b 선택');
  mocks.search.mockResolvedValue({ value: page([group('a'), group('b')]) });
  const form = nodes(render()).find(node => node.type === 'form')!;
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() }); await Promise.all(mocks.work);
  expect(toolbar().props.selectedIds).toEqual([]);
});

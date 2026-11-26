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
import { Button } from '../kit/ui/button';
import { GoodsGroupsScreen } from './GoodsGroupsScreen';
import { DEFAULT_GROUP_FILTERS } from '@/lib/admin/goods-group-console';
import type { GoodsGroupSnapshot } from '@/lib/admin/goods-groups';
type Element = ReactElement<Record<string, unknown>>;
/* 일괄 변경 막대의 선택 동작 자리(selectionActions)도 이 화면이 그리는 요소다. */
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.selectionActions as ReactNode), ...nodes(node.props.children as ReactNode)] : []); }
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
  expect(nodes(render()).some(node => (node.type === 'button' || node.type === Button) && text(node.props.children as ReactNode) === '선택 해제')).toBe(false);
  check('그룹 a 선택');
  const clear = nodes(render()).find(node => (node.type === 'button' || node.type === Button) && text(node.props.children as ReactNode) === '선택 해제')!;
  (clear.props.onClick as () => void)();
  expect(toolbar().props.selectedIds).toEqual([]);
  check('그룹 b 선택');
  mocks.search.mockResolvedValue({ value: page([group('a'), group('b')]) });
  const form = nodes(render()).find(node => node.type === 'form')!;
  // 검색은 폼 제출이다(kit 버튼의 기본 type은 button).
  expect(nodes(form.props.children as ReactNode).find(node => node.type === Button && text(node.props.children as ReactNode) === '검색')?.props.type).toBe('submit');
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() }); await Promise.all(mocks.work);
  expect(toolbar().props.selectedIds).toEqual([]);
});

/* G-01: 그룹 번호(UUID)와 상품 URL은 운영자가 쓸 일이 없는 내부 값이라 목록에도 검색 항목에도 보이지 않는다. */
const GROUP_UUID = 'bc1d0000-0000-4000-8000-000000000123';
function renderWithMembers() {
  const row = { id: GROUP_UUID, name: '머그컵 그룹', optionNames: ['색상'], archivedAt: null, members: [
    { goodId: 'mug-red', name: '머그컵 빨강', code: 'MUG-RED', values: ['빨강'], price: 9000, stockQty: 3, publishedAt: '2026-11-01T00:00:00Z', archivedAt: null },
    { goodId: 'mug-old', name: '머그컵 파랑', code: null, values: ['파랑'], price: 9000, stockQty: 0, publishedAt: null, archivedAt: null }] } as unknown as GoodsGroupSnapshot;
  mocks.index = 0; mocks.refIndex = 0;
  const base = { initialPage: page([row]), initialConsole: { ...page([row]), metadata: { [GROUP_UUID]: { createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', category: '머그' } } } as never, initialGroup: null,
    initialFilters: { ...DEFAULT_GROUP_FILTERS }, actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
  return GoodsGroupsScreen(base);
}
it('그룹 이름 아래에 그룹 번호 조각을 보이지 않는다', () => {
  mocks.states = []; mocks.refs = []; const tree = nodes(renderWithMembers());
  expect(tree.some(node => text(node.props.children as ReactNode).includes('머그컵 그룹'))).toBe(true);
  expect(tree.some(node => text(node.props.children as ReactNode).includes(GROUP_UUID.slice(0, 8)))).toBe(false);
  expect(tree.some(node => node.props.title === GROUP_UUID)).toBe(false);
});
it('펼친 판매옵션 표는 상품 자동코드가 없을 때 상품 번호 대신 줄표를 보인다', () => {
  mocks.states = []; mocks.refs = []; renderWithMembers();
  const toggle = nodes(renderWithMembers()).find(node => node.type === Button && node.props['aria-label'] === '머그컵 그룹 판매옵션 펼치기')!;
  (toggle.props.onClick as () => void)();
  const shown = nodes(renderWithMembers()).filter(node => node.type === 'small').map(node => text(node.props.children as ReactNode));
  expect(shown).toEqual(['MUG-RED', '—']);
});
it('검색 항목은 전체·상품 자동코드·그룹상품명·제조사명이다', () => {
  mocks.states = []; mocks.refs = [];
  const labels = nodes(renderWithMembers()).filter(node => node.type === 'input' && node.props.name === 'group-field').map(node => node.props.value);
  expect(labels).toEqual(['all', 'code', 'name', 'maker']);
});

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), states: [] as unknown[], index: 0 }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./MarketingLinkIssuer', () => ({ MarketingLinkIssuer: () => null }));
vi.mock('../GoodsBulkToolbar', () => ({ GoodsBulkToolbar: () => null }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
}));
import { ConsoleGrid } from '@/components/admin/console/ConsoleGrid';
import { GoodsBulkToolbar } from '../GoodsBulkToolbar';
import { MarketingLinksGoodsGrid } from './MarketingLinksGoodsGrid';
type Element = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const rows = ['good-a', 'good-b', 'good-c'].map(id => ({ id, cells: [id] }));
function render(visible = rows) { mocks.index = 0; return MarketingLinksGoodsGrid({ canIssue: true, bulkIdentity: identity, caption: '상품 목록', columns: [{ key: 'name', label: '상품명' }], rows: visible }); }
const grid = (tree: ReactNode) => nodes(tree).find(node => node.type === ConsoleGrid)!;
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.index = 0; });

it('일괄 변경을 확정해도 선택을 유지하고 목록만 새로 읽는다', () => {
  (grid(render()).props.onSelectionChange as (ids: string[]) => void)(['good-a', 'good-b']);
  const toolbar = nodes(render()).find(node => node.type === GoodsBulkToolbar)!;
  expect(toolbar.props.selectedIds).toEqual(['good-a', 'good-b']);
  (toolbar.props.onCompleted as () => void)();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(grid(render()).props.selectedIds).toEqual(['good-a', 'good-b']);
  expect(text(render())).toContain('2개 선택');
});

it('선택 해제 버튼이 선택을 비우고, 선택이 없으면 버튼을 두지 않는다', () => {
  expect(nodes(render()).some(node => node.type === 'button' && text(node.props.children as ReactNode) === '선택 해제')).toBe(false);
  (grid(render()).props.onSelectionChange as (ids: string[]) => void)(['good-c']);
  const clear = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '선택 해제')!;
  (clear.props.onClick as () => void)();
  expect(grid(render()).props.selectedIds).toEqual([]);
});

it('새로 읽은 목록에서 사라진 상품은 선택에서 뺀다(보관 등으로 필터 밖으로 나간 상품)', () => {
  (grid(render()).props.onSelectionChange as (ids: string[]) => void)(['good-a', 'good-b']);
  const after = render(rows.filter(row => row.id !== 'good-b'));
  expect(grid(after).props.selectedIds).toEqual(['good-a']);
  expect(nodes(after).find(node => node.type === GoodsBulkToolbar)!.props.selectedIds).toEqual(['good-a']);
  expect(text(after)).toContain('1개 선택');
});

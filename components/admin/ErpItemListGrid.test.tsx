import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleGridRow } from '@/components/admin/console/ConsoleGrid';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  pending: [] as Promise<unknown>[],
  refresh: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/app/admin/erp-item-actions', () => ({ deleteErpItemsAction: hooks.remove }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next;
      }];
    },
    useTransition: () => [false, (callback: () => Promise<unknown>) => { hooks.pending.push(callback()); }],
  };
});

const { ErpItemListGrid } = await import('./ErpItemListGrid');
const { ConsoleGrid } = await import('@/components/admin/console/ConsoleGrid');
const { ConsoleBulkActionBar } = await import('@/components/admin/console/ConsoleBulkActionBar');

type Props = {
  children?: ReactNode;
  rows?: ConsoleGridRow[];
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  selectedCount?: number;
  actions?: { label: string; variant?: string; disabled?: boolean }[];
};

const columns = [{ key: 'code', label: 'ERP 코드' }, { key: 'name', label: 'ERP 품명' }];
const row = (code: string, name: string): ConsoleGridRow => ({ id: code, cells: [code, name], selectLabel: `${code} ${name} 선택` });
const page = [row('000123', '아크릴 키링'), row('K-2', '키링 거치대')];

function render(rows = page) {
  hooks.stateIndex = 0;
  return ErpItemListGrid({ columns, rows, emptyLabel: '없음' });
}
function find(node: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const matches = predicate(node) ? [node] : [];
  for (const child of [node.props.children].flat()) matches.push(...find(child, predicate));
  return matches;
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<Props>(node) ? text(node.props.children) : '';
}
const grid = (tree: ReactNode) => find(tree, (element) => element.type === ConsoleGrid)[0];
const bar = (tree: ReactNode) => find(tree, (element) => element.type === ConsoleBulkActionBar)[0];
const form = (tree: ReactNode) => find(tree, (element) => element.type === 'form')[0];
const submit = (tree: ReactNode) => {
  const event = { preventDefault: vi.fn() };
  form(tree).props.onSubmit?.(event);
  expect(event.preventDefault).toHaveBeenCalled();
};

beforeEach(() => {
  hooks.state = [];
  hooks.pending = [];
  hooks.refresh.mockReset();
  hooks.remove.mockReset();
  hooks.confirm.mockReset();
  vi.stubGlobal('window', { confirm: hooks.confirm });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ERP 품목 목록 선택 삭제', () => {
  it('행을 고를 수 있고, 고르기 전에는 삭제 바를 띄우지 않는다', () => {
    const tree = render();
    expect(grid(tree).props.selectable).toBe(true);
    expect(grid(tree).props.selectedIds).toEqual([]);
    expect(bar(tree).props.selectedCount).toBe(0);
    expect(grid(render([])).props.selectable).toBe(false);
  });

  it('확인을 거친 뒤 고른 ERP 코드만 지우고 결과를 안내하며 목록을 새로 고친다', async () => {
    hooks.remove.mockResolvedValue({ ok: true, deleted: 1, missing: 0, message: 'ERP 품목 1건을 지웠습니다.' });
    hooks.confirm.mockReturnValue(true);
    grid(render()).props.onSelectionChange?.(['K-2']);
    let tree = render();
    expect(bar(tree).props.selectedCount).toBe(1);
    expect(bar(tree).props.actions?.[0]).toMatchObject({ label: '선택 삭제', variant: 'danger' });
    submit(tree);
    expect(hooks.confirm).toHaveBeenCalledWith(expect.stringContaining('선택한 ERP 품목 1건을 지울까요?'));
    expect(hooks.confirm.mock.calls[0][0]).toContain('이미 상품 옵션에 넣은 ERP 코드·품명은 바뀌지 않습니다');
    await Promise.all(hooks.pending.splice(0));
    expect(hooks.remove).toHaveBeenCalledWith(['K-2']);
    tree = render();
    expect(text(tree)).toContain('ERP 품목 1건을 지웠습니다.');
    expect(grid(tree).props.selectedIds).toEqual([]);
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('확인을 취소하면 지우지 않는다', () => {
    hooks.confirm.mockReturnValue(false);
    grid(render()).props.onSelectionChange?.(['000123', 'K-2']);
    submit(render());
    expect(hooks.confirm).toHaveBeenCalledWith(expect.stringContaining('선택한 ERP 품목 2건을 지울까요?'));
    expect(hooks.remove).not.toHaveBeenCalled();
  });

  it('지금 페이지에 없는 선택은 보내지 않고, 서버 거절은 선택을 유지한 채 안내한다', async () => {
    hooks.remove.mockResolvedValue({ ok: false, error: 'ERP 품목을 지우지 못했습니다. 다시 시도해주세요.' });
    hooks.confirm.mockReturnValue(true);
    grid(render()).props.onSelectionChange?.(['000123', 'OTHER-PAGE']);
    const tree = render();
    expect(grid(tree).props.selectedIds).toEqual(['000123']);
    submit(tree);
    await Promise.all(hooks.pending.splice(0));
    expect(hooks.remove).toHaveBeenCalledWith(['000123']);
    expect(text(render())).toContain('ERP 품목을 지우지 못했습니다. 다시 시도해주세요.');
    expect(grid(render()).props.selectedIds).toEqual(['000123']);
    expect(hooks.refresh).not.toHaveBeenCalled();
  });
});

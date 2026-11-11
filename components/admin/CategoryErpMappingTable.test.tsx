import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCategoryErpMapping, AdminCategoryNode } from '@/lib/admin/category';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  save: vi.fn(),
  leaveGuard: vi.fn(),
  action: null as null | ((state: unknown, data: FormData) => Promise<unknown>),
  actionState: {} as unknown,
}));

vi.mock('@/app/admin/category-actions', () => ({ saveAdminCategoryErpMappingAction: hooks.save }));
vi.mock('./useAdminLeaveGuard', () => ({ useAdminLeaveGuard: hooks.leaveGuard }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useEffect: () => undefined,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next;
      }];
    },
    useActionState: (action: (state: unknown, data: FormData) => Promise<unknown>) => { hooks.action = action; return [hooks.actionState, 'FORM_ACTION', false]; },
  };
});

const { CategoryErpMappingTable } = await import('./CategoryErpMappingTable');
const { ConsolePagination } = await import('./console/ConsolePagination');
const { Input } = await import('./kit/ui/input');
const { Button } = await import('./kit/ui/button');

type Props = { children?: ReactNode; id?: string; name?: string; form?: string; value?: unknown; disabled?: boolean; required?: boolean; type?: string; 'aria-label'?: string; row?: { value: string; label: string }; onChange?: (event: { target: { value?: string; checked?: boolean } }) => void; onPageChange?: (page: number) => void; total?: number; page?: number };

function find(tree: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] {
  if (!isValidElement<Props>(tree)) return Array.isArray(tree) ? tree.flatMap((child) => find(child, predicate)) : [];
  const matches = predicate(tree) ? [tree] : [];
  for (const child of [tree.props.children].flat()) matches.push(...find(child, predicate));
  return matches;
}
function text(tree: ReactNode): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return isValidElement<Props>(tree) ? text(tree.props.children) : '';
}

const node = (id: string, name: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({
  id, code: `code-${id}`, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...extra,
});
const mapping = (categoryId: string, extra: Partial<AdminCategoryErpMapping> = {}): AdminCategoryErpMapping => ({
  categoryId, erpCode: 'ERP-1', erpName: '키링류', source: '분류표 v1', verifiedAt: '2026-11-09T15:30:00+00:00', verifiedBy: null, ...extra,
});
const small = [node('p', '문구', null, { childCount: 2 }), node('k', '키링', 'p'), node('s', '스티커', 'p')];
const TABLE_STATE_COUNT = 4;

const render = (categories: AdminCategoryNode[] = small, mappings: AdminCategoryErpMapping[] = []) => {
  hooks.stateIndex = 0;
  return CategoryErpMappingTable({ categories, mappings });
};
const rowElements = (table: ReactNode) => find(table, (element) => Boolean(element.props.row));
const labels = (table: ReactNode) => rowElements(table).map((element) => element.props.row!.label);
/* 표는 행 컴포넌트를 렌더할 뿐이라, 행 요소를 꺼내 같은 훅 저장소로 직접 렌더한다. */
const renderRow = (label: string, categories = small, mappings: AdminCategoryErpMapping[] = []) => {
  const table = render(categories, mappings);
  const element = rowElements(table).find((row) => row.props.row!.label === label)!;
  hooks.stateIndex = TABLE_STATE_COUNT;
  return (element.type as (props: Props) => ReactNode)(element.props);
};
const input = (tree: ReactNode, name: string) => find(tree, (element) => element.type === Input && element.props.name === name)[0];
const filterInput = (table: ReactNode) => find(table, (element) => element.props.id === 'category-erp-mapping-filter')[0];
const unsetToggle = (table: ReactNode) => find(table, (element) => element.type === 'input' && element.props.type === 'checkbox')[0];
const saveButton = (tree: ReactNode) => find(tree, (element) => element.type === Button)[0];
const leaveDirty = () => (hooks.leaveGuard.mock.calls.at(-1)?.[0] as { dirty: boolean }).dirty;

beforeEach(() => {
  hooks.state = [];
  hooks.save.mockReset();
  hooks.leaveGuard.mockReset();
  hooks.actionState = {};
});

describe('카테고리별 ERP 분류 매핑 표', () => {
  /* 2026-11-10 사람 눈 시험: 말단 336개를 카드로 펼치면 페이지가 10만 px까지 길어졌다. */
  it('카테고리가 늘어도 한 번에 50행만 그리고 높이가 고정된 스크롤 영역에 둔다', () => {
    const many = [node('p', '문구', null, { childCount: 336 }), ...Array.from({ length: 336 }, (_, index) => node(`c${String(index).padStart(3, '0')}`, `분류${String(index).padStart(3, '0')}`, 'p'))];
    const table = render(many);
    expect(rowElements(table)).toHaveLength(50);
    expect(find(table, (element) => (element.props as { role?: string }).role === 'region')[0].props).toMatchObject({ 'aria-label': '카테고리별 ERP 분류 매핑' });
    expect(String((find(table, (element) => (element.props as { role?: string }).role === 'region')[0].props as { className?: string }).className)).toContain('max-h-[520px]');
    const pager = find(table, (element) => element.type === ConsolePagination)[0];
    expect(pager.props).toMatchObject({ page: 1, total: 336 });
    pager.props.onPageChange?.(7);
    const last = render(many);
    expect(rowElements(last)).toHaveLength(36);
    expect(labels(last)[0]).toBe('문구 > 분류300');
    expect(text(last)).toContain('마지막 단계 카테고리 336개 중 0개 입력됨');
  });

  it('행마다 전체 경로와 코드를 보이고 입력은 그 행의 저장 폼에 묶인다', () => {
    const tree = renderRow('문구 > 키링');
    expect(text(tree)).toContain('문구 > 키링');
    expect(text(tree)).toContain('code-k');
    const form = find(tree, (element) => element.type === 'form')[0];
    expect(form.props.id).toBe('category-erp-mapping-k');
    for (const name of ['erpCode', 'erpName', 'source', 'verifiedAt']) {
      expect(input(tree, name).props).toMatchObject({ form: 'category-erp-mapping-k', required: true });
    }
    expect(input(tree, 'erpCode').props['aria-label']).toBe('문구 > 키링 ERP 코드');
    expect(input(tree, 'verifiedAt').props.type).toBe('datetime-local');
  });

  it('저장된 값을 보여 주고 검증 시각은 한국 시간 입력값으로 바꾼다', () => {
    const tree = renderRow('문구 > 키링', small, [mapping('k')]);
    expect(input(tree, 'erpCode').props.value).toBe('ERP-1');
    expect(input(tree, 'source').props.value).toBe('분류표 v1');
    expect(input(tree, 'verifiedAt').props.value).toBe('2026-11-10T00:30');
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  it('경로·붙여 쓴 경로·코드·ERP 코드·ERP 품명으로 찾고 미설정만 골라 본다', () => {
    const mappings = [mapping('k')];
    const search = (value: string) => {
      filterInput(render(small, mappings)).props.onChange?.({ target: { value } });
      return labels(render(small, mappings));
    };
    expect(search('키링')).toEqual(['문구 > 키링']);
    expect(search('문구>스티커')).toEqual(['문구 > 스티커']);
    expect(search('code-s')).toEqual(['문구 > 스티커']);
    expect(search('erp-1')).toEqual(['문구 > 키링']);
    expect(search('키링류')).toEqual(['문구 > 키링']);
    expect(search('없는말')).toEqual([]);
    expect(text(render(small, mappings))).toContain('조건에 맞는 카테고리가 없습니다.');
    search('');
    unsetToggle(render(small, mappings)).props.onChange?.({ target: { checked: true } });
    expect(labels(render(small, mappings))).toEqual(['문구 > 스티커']);
    expect(text(render(small, mappings))).toContain('2개 중 1개 입력됨');
  });

  it('검색하면 첫 페이지로 돌아간다', () => {
    const many = [node('p', '문구', null, { childCount: 60 }), ...Array.from({ length: 60 }, (_, index) => node(`c${index}`, `분류${String(index).padStart(2, '0')}`, 'p'))];
    find(render(many), (element) => element.type === ConsolePagination)[0].props.onPageChange?.(2);
    expect(find(render(many), (element) => element.type === ConsolePagination)[0].props.page).toBe(2);
    filterInput(render(many)).props.onChange?.({ target: { value: '분류0' } });
    expect(find(render(many), (element) => element.type === ConsolePagination)[0].props.page).toBe(1);
  });

  it('입력하면 저장이 켜지고 떠날 때 묻고, 원래 값으로 되돌리면 묻지 않는다', () => {
    const mappings = [mapping('k')];
    let tree = renderRow('문구 > 키링', small, mappings);
    input(tree, 'erpCode').props.onChange?.({ target: { value: 'ERP-2' } });
    tree = renderRow('문구 > 키링', small, mappings);
    expect(input(tree, 'erpCode').props.value).toBe('ERP-2');
    expect(saveButton(tree).props.disabled).toBe(false);
    expect(leaveDirty()).toBe(true);
    input(tree, 'erpCode').props.onChange?.({ target: { value: 'ERP-1' } });
    tree = renderRow('문구 > 키링', small, mappings);
    expect(saveButton(tree).props.disabled).toBe(true);
    expect(leaveDirty()).toBe(false);
  });

  it('검색으로 행이 빠져도 입력이 남는다', () => {
    const tree = renderRow('문구 > 키링');
    input(tree, 'erpCode').props.onChange?.({ target: { value: 'ERP-9' } });
    filterInput(render()).props.onChange?.({ target: { value: '스티커' } });
    expect(labels(render())).toEqual(['문구 > 스티커']);
    expect(leaveDirty()).toBe(true);
    filterInput(render()).props.onChange?.({ target: { value: '' } });
    expect(input(renderRow('문구 > 키링'), 'erpCode').props.value).toBe('ERP-9');
  });

  it('저장하면 입력을 비우고 그 행에 저장됨을 보인다', async () => {
    let tree = renderRow('문구 > 키링');
    input(tree, 'erpCode').props.onChange?.({ target: { value: 'ERP-9' } });
    renderRow('문구 > 키링');
    hooks.save.mockResolvedValue({ message: 'ERP 분류 매핑을 저장했습니다.', changed: true });
    hooks.actionState = await hooks.action!({}, new FormData());
    expect(hooks.save).toHaveBeenCalledOnce();
    tree = renderRow('문구 > 키링');
    expect(leaveDirty()).toBe(false);
    expect(text(tree)).toContain('저장됨');
  });

  it('실패하면 입력과 경고를 남기고 문구를 그 행에 보이며, 값을 고치면 문구를 지운다', async () => {
    let tree = renderRow('문구 > 키링');
    input(tree, 'erpCode').props.onChange?.({ target: { value: 'ERP-9' } });
    renderRow('문구 > 키링');
    hooks.save.mockResolvedValue({ errors: { form: '이미 연결된 ERP 코드입니다.' } });
    hooks.actionState = await hooks.action!({}, new FormData());
    tree = renderRow('문구 > 키링');
    expect(text(tree)).toContain('이미 연결된 ERP 코드입니다.');
    expect(input(tree, 'erpCode').props.value).toBe('ERP-9');
    expect(leaveDirty()).toBe(true);
    input(tree, 'erpCode').props.onChange?.({ target: { value: 'ERP-10' } });
    expect(text(renderRow('문구 > 키링'))).not.toContain('이미 연결된 ERP 코드입니다.');
  });

  it('마지막 단계 카테고리가 없으면 안내만 보인다', () => {
    expect(text(render([]))).toContain('ERP 분류를 매핑할 마지막 단계 카테고리가 없습니다.');
  });
});

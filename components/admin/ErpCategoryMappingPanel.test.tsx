import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  pending: [] as Promise<unknown>[],
  refresh: vi.fn(),
  save: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/app/admin/erp-item-actions', () => ({ setErpCategoryMappingAction: hooks.save }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useMemo: (factory: () => unknown) => factory(),
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

const { ErpCategoryMappingPanel } = await import('./ErpCategoryMappingPanel');

type Props = { children?: ReactNode; row?: { erpCategory: string }; value?: string; disabled?: boolean; onClick?: () => void; onChange?: (event: unknown) => void };

const node = (id: string, name: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({
  id, code: id, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null,
  updatedAt: '2026-10-07T00:00:00Z', childCount: 0, assignedGoodCount: 0, ...extra,
});
const PARENT = '00000000-0000-4000-8000-000000071110';
const PHOTO = '00000000-0000-4000-8000-000000071112';
const KEYRING = '00000000-0000-4000-8000-000000071111';
const categories = [node(PARENT, '문구', null, { childCount: 2 }), node(PHOTO, '포토카드', PARENT), node(KEYRING, '키링', PARENT)];
type Row = { erpCategory: string; itemCount: number; categoryId: string | null; updatedAt: string | null; fallbackCategoryId: string | null };
type Mapping = { categoryId: string; erpCode: string; erpName: string };
const rows: Row[] = [{ erpCategory: '문구 > 포토카드', itemCount: 3, categoryId: null, updatedAt: null, fallbackCategoryId: null }];

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

/* 패널은 행 컴포넌트를 렌더할 뿐이라, 행 요소를 꺼내 같은 훅 저장소로 직접 렌더한다. */
async function renderRow(options: { rows?: Row[]; categoryErpMappings?: Mapping[] } = {}) {
  hooks.stateIndex = 0;
  const panel = ErpCategoryMappingPanel({ rows: options.rows ?? rows, categories, categoryErpMappings: options.categoryErpMappings ?? [] });
  const rowElement = find(panel, (element) => Boolean(element.props.row))[0];
  hooks.stateIndex = 2;
  const component = rowElement.type as (props: Props) => ReactNode;
  return component(rowElement.props);
}
const button = (tree: ReactNode, label: string) => find(tree, (element) => element.type === 'button' && text(element).includes(label))[0];

beforeEach(() => {
  hooks.state = [];
  hooks.pending = [];
  hooks.refresh.mockReset();
  hooks.save.mockReset();
});

describe('ERP 분류 연결 표', () => {
  it('같은 이름 말단 제안을 한 번에 저장하고 목록을 새로 고친다', async () => {
    hooks.save.mockResolvedValue({ ok: true, changed: true, categoryId: PHOTO, message: 'ERP 분류를 고객 카테고리에 연결했습니다.' });
    button(await renderRow(), '같은 이름으로 연결 · 문구 > 포토카드').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(hooks.save).toHaveBeenCalledWith({ erpCategory: '문구 > 포토카드', categoryId: PHOTO });
    const tree = await renderRow();
    expect(text(tree)).toContain('ERP 분류를 고객 카테고리에 연결했습니다.');
    expect(button(tree, '연결').props.disabled).toBe(true);
    expect(find(tree, (element) => element.type === 'button' && text(element).includes('같은 이름으로 연결'))).toHaveLength(0);
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('고른 값만 저장하고, 서버 거절 문구를 그 행에 보여 준다', async () => {
    hooks.save.mockResolvedValue({ ok: false, error: '보관된 카테고리에는 연결할 수 없습니다.' });
    let tree = await renderRow();
    expect(button(tree, '연결 해제').props.disabled).toBe(true);
    find(tree, (element) => element.type === 'select')[0].props.onChange?.({ target: { value: PHOTO } });
    tree = await renderRow();
    button(tree, '연결 저장').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(text(await renderRow())).toContain('보관된 카테고리에는 연결할 수 없습니다.');
    expect(hooks.refresh).not.toHaveBeenCalled();
  });

  it('새 연결이 없어도 고객 카테고리의 정본 ERP 분류 매핑으로 제안 중인 말단을 보여 주고 연결된 분류로 센다', async () => {
    const fallbackRows: Row[] = [{ erpCategory: '키링', itemCount: 2, categoryId: null, updatedAt: null, fallbackCategoryId: KEYRING }];
    const mappings = [{ categoryId: KEYRING, erpCode: 'KR-01', erpName: '키링' }];
    const panel = ErpCategoryMappingPanel({ rows: fallbackRows, categories, categoryErpMappings: mappings });
    expect(text(panel)).toContain('ERP 분류 1개 중 1개 연결됨');
    const tree = await renderRow({ rows: fallbackRows, categoryErpMappings: mappings });
    expect(text(tree)).toContain('고객 카테고리의 ERP 분류 매핑에 따라 ‘문구 > 키링’ 카테고리를 제안합니다.');
    expect(find(tree, (element) => element.type === 'button' && text(element).includes('ERP 분류 매핑대로 연결'))).toHaveLength(0);
  });

  it('고른 말단의 정본 ERP 분류 매핑이 이 ERP 분류와 다르면 저장 전에 경고한다', async () => {
    const mappings = [{ categoryId: KEYRING, erpCode: 'ST-01', erpName: '문구' }, { categoryId: PHOTO, erpCode: 'PC-01', erpName: '문구 > 포토카드' }];
    let tree = await renderRow({ categoryErpMappings: mappings });
    expect(text(tree)).not.toContain('다른 ERP 분류');
    find(tree, (element) => element.type === 'select')[0].props.onChange?.({ target: { value: KEYRING } });
    tree = await renderRow({ categoryErpMappings: mappings });
    expect(text(tree)).toContain('고른 카테고리는 고객 카테고리 화면에서 다른 ERP 분류(‘문구’, ST-01)에 매핑돼 있습니다. 맞는 카테고리인지 확인해주세요.');
    find(tree, (element) => element.type === 'select')[0].props.onChange?.({ target: { value: PHOTO } });
    expect(text(await renderRow({ categoryErpMappings: mappings }))).not.toContain('다른 ERP 분류');
  });
});

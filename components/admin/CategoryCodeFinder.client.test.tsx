import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { CategoryCodeChoice } from '@/lib/admin/category-code-finder';

/* 화면 시험의 방식: react 훅을 인덱스로 모킹하고 컴포넌트를 함수로 불러 요소 트리를 걷는다(GoodCategoryFields.client.test.tsx와 같다). */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, action: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));
vi.mock('@/app/admin/category-code-actions', () => ({ loadCategoryCodesAction: hooks.action }));

import { AdminPickerDialog, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { CategoryCodeFinder } from './CategoryCodeFinder';

type Props = { children?: ReactNode; className?: string; href?: string; role?: string; disabled?: boolean; onClick?: () => unknown; type?: string; footer?: ReactNode };
type DialogProps = AdminPickerPanelProps<CategoryCodeChoice> & { title: string };

function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}
const texts = (node: ReactNode): string[] => Array.isArray(node) ? node.flatMap(texts)
  : typeof node === 'string' || typeof node === 'number' ? [String(node)]
    : isValidElement<Props>(node) ? texts(node.props.children) : [];

const node = (id: string, name: string, patch: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({ id, code: `code-${id}`, name, parentId: 'root', depth: 2, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...patch });
const root = node('root', '문구', { parentId: null, depth: 1, childCount: 3 });
const categories: AdminCategoryNode[] = [root, node('a', '가방'), node('b', '노트'), node('c', '다이어리', { archivedAt: '2026-11-01' })];
const request = (query = '', page = 1) => ({ query, field: '', filter: '', page });

const onClose = vi.fn();
const reset = () => { hooks.stateIndex = 0; hooks.refIndex = 0; };
function dialog() {
  reset();
  const tree = CategoryCodeFinder({ onClose });
  return { tree, props: (tree as ReactElement<DialogProps>).props };
}
async function firstRows(query = '', page = 1) {
  const result = await dialog().props.load(request(query, page));
  if ('error' in result) throw new Error(result.error);
  return result;
}

beforeEach(() => {
  hooks.state = []; hooks.refs = [];
  hooks.action.mockReset().mockResolvedValue({ ok: true, categories });
  onClose.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('카테고리 코드 고르기 창(M-01)', () => {
  it('공용 선택창 하나로 열리고, 어느 엑셀 칸에 붙여넣는지 한 문장으로 말한다', () => {
    const { tree, props } = dialog();
    expect((tree as ReactElement).type).toBe(AdminPickerDialog);
    expect(props.title).toBe('카테고리 코드 고르기');
    expect(props.description).toBe("복사한 코드를 엑스스퀘어 양식의 '고객 카테고리 코드'·'추가 카테고리 코드' 칸에 붙여넣습니다.");
    expect(props.excludedNote).toBe('하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다.');
    props.onClose();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('옛 자체 창(찾기 방식 전환·자주 쓰는 카테고리·단계 선택·읽기 전용 코드 칸)을 쓰지 않는다', () => {
    const source = readFileSync(join(process.cwd(), 'components/admin/CategoryCodeFinder.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const stale of ['CategoryTemplatesScreen', 'CategoryTemplateTree', 'CustomerServiceDialog', 'ConsolePagination', 'type="search"', 'aria-pressed']) expect(source, stale).not.toContain(stale);
    const { props } = dialog();
    const shown = [props.title, props.description, props.excludedNote, props.searchPlaceholder, props.emptyText, texts(props.footer).join('')].join('|');
    for (const stale of ['카테고리명 검색', '자주 쓰는 카테고리', '최신 카테고리 다시 조회', '선택한 카테고리 코드', '코드 복사 후', '다운로드']) expect(shown, stale).not.toContain(stale);
  });
});

describe('목록 조회', () => {
  it('창을 열 때 서버 액션을 한 번 읽고, 검색·쪽 넘기기는 읽어 둔 목록에서 자른다', async () => {
    const first = await firstRows();
    expect(first.rows.map((row) => row.path)).toEqual(['문구 > 가방', '문구 > 노트']);
    expect(first).toMatchObject({ total: 2, page: 1 });
    await firstRows('노트');
    await firstRows('', 2);
    expect(hooks.action).toHaveBeenCalledTimes(1);
  });

  it('보관했거나 하위가 있는 카테고리는 목록에 넣지 않고, 이름·경로·코드로 찾는다', async () => {
    expect((await firstRows()).rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect((await firstRows('문구 노트')).rows.map((row) => row.id)).toEqual(['b']);
    expect((await firstRows('code-a')).rows.map((row) => row.id)).toEqual(['a']);
    expect((await firstRows('다이어리')).total).toBe(0);
    expect((await firstRows('없는 카테고리')).rows).toEqual([]);
  });

  it('줄은 경로를 이름으로, 코드를 이름표를 붙여 보이고 내부 번호는 보이지 않는다', async () => {
    const [row] = (await firstRows()).rows;
    const view = dialog().props.rowView(row);
    expect(view.title).toBe('문구 > 가방');
    expect(texts(view.meta).join('')).toBe('카테고리 코드 code-a');
    expect(Object.keys(view)).toEqual(['title', 'meta']);
    expect(dialog().props.rowKey(row)).toBe('a');
  });

  it('읽지 못하면 창 안에 오류를 돌려주고, 실패는 기억하지 않아 다음 검색에서 다시 읽는다', async () => {
    hooks.action.mockResolvedValueOnce({ ok: false, error: '상품 관리 권한이 필요합니다.' });
    expect(await dialog().props.load(request())).toEqual({ error: '상품 관리 권한이 필요합니다.' });
    hooks.action.mockRejectedValueOnce(new Error('network'));
    expect(await dialog().props.load(request())).toEqual({ error: '카테고리 코드를 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.' });
    expect((await firstRows()).total).toBe(2);
    expect(hooks.action).toHaveBeenCalledTimes(3);
  });
});

describe('줄마다 [코드 복사]', () => {
  const rowAction = async () => {
    const [row] = (await firstRows()).rows;
    return { row, render: (busy = false) => (dialog().props.rowAction!(row, { busy }) as ReactElement<Props>) };
  };

  it('[선택] 대신 줄마다 [코드 복사]가 있고, 읽어 주는 이름에는 어느 카테고리인지 붙는다', async () => {
    const { render } = await rowAction();
    expect(render().type).toBe('button');
    expect(render().props).toMatchObject({ type: 'button', disabled: false });
    expect(texts(render()).join('')).toBe('문구 > 가방 코드 복사');
    expect(all(render()).some((item) => item.props.className === 'sr-only')).toBe(true);
    expect(render(true).props.disabled).toBe(true);
  });

  it('누르면 그 줄의 코드를 복사하고 그 줄만 [복사됨]으로 바뀐다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { row, render } = await rowAction();
    const other = (await firstRows()).rows[1];
    await render().props.onClick!();
    expect(writeText).toHaveBeenCalledWith('code-a');
    expect(texts(render()).join('')).toBe('문구 > 가방 복사됨');
    expect(texts(dialog().props.rowAction!(other, { busy: false })).join('')).toBe('문구 > 노트 코드 복사');
    expect(row.code).toBe('code-a');
    const footer = all(dialog().props.footer);
    expect(footer.some((item) => item.props.role === 'alert')).toBe(false);
    expect(texts(footer).join('')).toContain('문구 > 가방 카테고리 코드를 복사했습니다.');
  });

  it('복사를 허용하지 않는 환경이면 [복사 안 됨]과 함께 줄의 코드를 직접 복사하라고 알린다', async () => {
    vi.stubGlobal('navigator', {});
    const { render } = await rowAction();
    await render().props.onClick!();
    expect(texts(render()).join('')).toBe('문구 > 가방 복사 안 됨');
    const alert = all(dialog().props.footer).find((item) => item.props.role === 'alert');
    expect(texts(alert).join('')).toBe('복사하지 못했습니다. 줄에 적힌 카테고리 코드를 직접 선택해 복사해주세요.');
  });

  it('전체 코드 CSV는 목록 아래 내려받기 링크로 둔다', () => {
    const link = all(dialog().props.footer).find((item) => item.type === 'a')!;
    expect(link.props.href).toBe('/api/admin/categories/export');
    expect(texts(link).join('')).toBe('전체 카테고리 코드 CSV 내려받기');
  });
});

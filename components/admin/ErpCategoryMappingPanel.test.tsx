import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  pending: [] as Promise<unknown>[],
  refresh: vi.fn(),
  save: vi.fn(),
  leaveGuard: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/app/admin/erp-item-actions', () => ({ setErpCategoryMappingAction: hooks.save }));
vi.mock('./useAdminLeaveGuard', () => ({ useAdminLeaveGuard: hooks.leaveGuard }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
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
const { AdminSearchSelect } = await import('./console/AdminSearchSelect');
const { Button } = await import('./kit/ui/button');
/* kit 버튼도 네이티브와 같은 조작 부품으로 찾는다(ADR-0028). */
const isButton = (element: ReactElement) => element.type === 'button' || element.type === Button;
const isSelect = (element: ReactElement) => element.type === AdminSearchSelect;

type Option = { value: string; label: string };
type Props = { children?: ReactNode; row?: { erpCategory: string }; value?: string; disabled?: boolean; onClick?: () => void; onValueChange?: (value: string) => void; options?: readonly Option[]; pinnedOptions?: readonly Option[]; 'aria-label'?: string };

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

/* 패널의 useState 개수: 검색어·연결 필요만·저장 안 한 선택. 행의 훅은 그 뒤에 이어진다. */
const PANEL_STATE_COUNT = 3;

/* 패널은 행 컴포넌트를 렌더할 뿐이라, 행 요소를 꺼내 같은 훅 저장소로 직접 렌더한다. */
async function renderRow(options: { rows?: Row[]; categoryErpMappings?: Mapping[] } = {}) {
  hooks.stateIndex = 0;
  const panel = ErpCategoryMappingPanel({ rows: options.rows ?? rows, categories, categoryErpMappings: options.categoryErpMappings ?? [] });
  const rowElement = find(panel, (element) => Boolean(element.props.row))[0];
  hooks.stateIndex = PANEL_STATE_COUNT;
  const component = rowElement.type as (props: Props) => ReactNode;
  return component(rowElement.props);
}
const button = (tree: ReactNode, label: string) => find(tree, (element) => isButton(element) && text(element).includes(label))[0];

beforeEach(() => {
  hooks.state = [];
  hooks.pending = [];
  hooks.refresh.mockReset();
  hooks.save.mockReset();
  hooks.leaveGuard.mockReset();
});

describe('ERP 분류 연결 표', () => {
  it('같은 경로 말단 제안을 한 번에 저장하고 목록을 새로 고친다', async () => {
    hooks.save.mockResolvedValue({ ok: true, changed: true, categoryId: PHOTO, message: 'ERP 분류를 고객 카테고리에 연결했습니다.' });
    button(await renderRow(), '같은 경로로 연결 · 문구 > 포토카드').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(hooks.save).toHaveBeenCalledWith({ erpCategory: '문구 > 포토카드', categoryId: PHOTO });
    const tree = await renderRow();
    expect(text(tree)).toContain('ERP 분류를 고객 카테고리에 연결했습니다.');
    expect(button(tree, '연결').props.disabled).toBe(true);
    expect(find(tree, (element) => isButton(element) && text(element).includes('같은 경로로 연결'))).toHaveLength(0);
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('고른 값만 저장하고, 서버 거절 문구를 그 행에 보여 준다', async () => {
    hooks.save.mockResolvedValue({ ok: false, error: '보관된 카테고리에는 연결할 수 없습니다.' });
    let tree = await renderRow();
    find(tree, (element) => isSelect(element))[0].props.onValueChange?.(PHOTO);
    tree = await renderRow();
    button(tree, '연결 저장').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(text(await renderRow())).toContain('보관된 카테고리에는 연결할 수 없습니다.');
    expect(hooks.refresh).not.toHaveBeenCalled();
  });

  /* 2026-10-07 QA: 연결 안 된 분류에도 비활성 '연결 해제' 버튼이 보여 이미 연결된 분류처럼 읽혔다. */
  it('연결도 선택도 없으면 저장 버튼을 숨기고, 저장된 연결을 비웠을 때만 연결 해제를 보여 준다', async () => {
    const saveButtons = (tree: ReactNode) => find(tree, (element) => isButton(element) && /연결 (저장|해제)|저장 중/.test(text(element)));
    const choose = (tree: ReactNode, value: string) => find(tree, (element) => isSelect(element))[0].props.onValueChange?.(value);
    let tree = await renderRow();
    expect(saveButtons(tree)).toHaveLength(0);
    choose(tree, PHOTO);
    tree = await renderRow();
    expect(saveButtons(tree).map((element) => [text(element), element.props.disabled])).toEqual([['연결 저장', false]]);
    choose(tree, '');
    expect(saveButtons(await renderRow())).toHaveLength(0);

    hooks.state = [];
    const linkedRows: Row[] = [{ ...rows[0], categoryId: PHOTO, updatedAt: '2026-10-07T00:00:00Z' }];
    tree = await renderRow({ rows: linkedRows });
    expect(saveButtons(tree).map((element) => [text(element), element.props.disabled])).toEqual([['연결 저장', true]]);
    choose(tree, '');
    tree = await renderRow({ rows: linkedRows });
    expect(saveButtons(tree).map((element) => [text(element), element.props.disabled])).toEqual([['연결 해제', false]]);
    hooks.save.mockResolvedValue({ ok: true, changed: true, categoryId: null, message: 'ERP 분류 연결을 해제했습니다.' });
    button(tree, '연결 해제').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(hooks.save).toHaveBeenCalledWith({ erpCategory: '문구 > 포토카드', categoryId: null });
    tree = await renderRow({ rows: linkedRows });
    expect(saveButtons(tree)).toHaveLength(0);
    expect(text(tree)).toContain('ERP 분류 연결을 해제했습니다.');
  });

  it('새 연결이 없어도 고객 카테고리의 정본 ERP 분류 매핑으로 제안 중인 말단을 보여 주고 연결된 분류로 센다', async () => {
    const fallbackRows: Row[] = [{ erpCategory: '키링', itemCount: 2, categoryId: null, updatedAt: null, fallbackCategoryId: KEYRING }];
    const mappings = [{ categoryId: KEYRING, erpCode: 'KR-01', erpName: '키링' }];
    const panel = ErpCategoryMappingPanel({ rows: fallbackRows, categories, categoryErpMappings: mappings });
    expect(text(panel)).toContain('ERP 분류 1개 중 1개 연결됨');
    const tree = await renderRow({ rows: fallbackRows, categoryErpMappings: mappings });
    expect(text(tree)).toContain('고객 카테고리의 ERP 분류 매핑에 따라 ‘문구 > 키링’ 카테고리를 제안합니다.');
    expect(find(tree, (element) => isButton(element) && text(element).includes('ERP 분류 매핑대로 연결'))).toHaveLength(0);
  });

  /* R9: DB가 전체 경로로 자동 연결한 분류는 '연결됨'으로 세고, 연결 필요 개수와 필터를 따로 보인다. */
  it('같은 경로로 자동 연결된 분류를 연결됨으로 세고 연결 필요만 골라 본다', async () => {
    const pathRows: Row[] = [
      { erpCategory: '문구>키링', itemCount: 2, categoryId: null, updatedAt: null, fallbackCategoryId: KEYRING },
      { erpCategory: '문구>스티커', itemCount: 1, categoryId: null, updatedAt: null, fallbackCategoryId: null },
    ];
    const panel = ErpCategoryMappingPanel({ rows: pathRows, categories, categoryErpMappings: [] });
    expect(text(panel)).toContain('ERP 분류 2개 중 1개 연결됨 · 연결 필요 1개');
    expect(text(panel)).toContain('연결 필요만');
    const tree = await renderRow({ rows: pathRows });
    expect(text(tree)).toContain('같은 경로의 ‘문구 > 키링’ 카테고리에 자동으로 연결됩니다. 다른 카테고리를 쓰려면 골라 저장해주세요.');
  });

  it('고른 말단의 정본 ERP 분류 매핑이 이 ERP 분류와 다르면 저장 전에 경고한다', async () => {
    const mappings = [{ categoryId: KEYRING, erpCode: 'ST-01', erpName: '문구' }, { categoryId: PHOTO, erpCode: 'PC-01', erpName: '문구 > 포토카드' }];
    let tree = await renderRow({ categoryErpMappings: mappings });
    expect(text(tree)).not.toContain('다른 ERP 분류');
    find(tree, (element) => isSelect(element))[0].props.onValueChange?.(KEYRING);
    tree = await renderRow({ categoryErpMappings: mappings });
    expect(text(tree)).toContain('고른 카테고리는 고객 카테고리 화면에서 다른 ERP 분류(‘문구’, ST-01)에 매핑돼 있습니다. 맞는 카테고리인지 확인해주세요.');
    find(tree, (element) => isSelect(element))[0].props.onValueChange?.(PHOTO);
    expect(text(await renderRow({ categoryErpMappings: mappings }))).not.toContain('다른 ERP 분류');
  });

  /* 2026-11-10 실측: 행마다 select에 말단 전체를 그려 첫 진입이 4초까지 걸렸다. 선택 칸은 행마다 하나, 목록은 표가 한 벌을 나눠 쓴다. */
  it('행마다 같은 선택지 배열을 나눠 쓰고, 칸 이름과 연결 안 함을 준다', async () => {
    const twoRows: Row[] = [rows[0], { ...rows[0], erpCategory: '문구 > 키링' }];
    const panel = ErpCategoryMappingPanel({ rows: twoRows, categories, categoryErpMappings: [] });
    const rowElements = find(panel, (element) => Boolean(element.props.row)) as ReactElement<Props & { options: readonly Option[] }>[];
    expect(rowElements[0].props.options).toBe(rowElements[1].props.options);
    expect(rowElements[0].props.options).toEqual([
      { value: KEYRING, label: '문구 > 키링', keywords: '문구>키링' },
      { value: PHOTO, label: '문구 > 포토카드', keywords: '문구>포토카드' },
    ]);
    const field = find(await renderRow(), (element) => isSelect(element))[0];
    expect(field.props['aria-label']).toBe('문구 > 포토카드 고객 카테고리');
    expect(field.props.value).toBe('');
    expect(field.props.pinnedOptions).toEqual([{ value: '', label: '연결 안 함' }]);
  });

  it('현재 연결이 보관되거나 하위가 생겨 고를 수 없어도 그 값을 칸에 그대로 보여 주고 연결 안 함으로 바꿀 수 있다', async () => {
    const archived = '00000000-0000-4000-8000-000000071113';
    const withArchived = [...categories, node(archived, '단종', PARENT, { archivedAt: '2026-10-01T00:00:00Z' })];
    const staleRows: Row[] = [{ ...rows[0], categoryId: archived, updatedAt: '2026-10-07T00:00:00Z' }];
    const render = (categoryId: string) => {
      hooks.stateIndex = 0;
      const panel = ErpCategoryMappingPanel({ rows: [{ ...staleRows[0], categoryId }], categories: withArchived, categoryErpMappings: [] });
      hooks.stateIndex = PANEL_STATE_COUNT;
      const rowElement = find(panel, (element) => Boolean(element.props.row))[0];
      return find((rowElement.type as (props: Props) => ReactNode)(rowElement.props), (element) => isSelect(element))[0];
    };
    expect(render(archived).props.value).toBe(archived);
    expect(render(archived).props.pinnedOptions).toEqual([{ value: '', label: '연결 안 함' }, { value: archived, label: '문구 > 단종 · 지금은 연결할 수 없음' }]);
    expect(render(archived).props.options?.map((option) => option.value)).not.toContain(archived);
    /* 카테고리가 지워져 경로를 모르면 경로 대신 그렇다고 말한다. */
    hooks.state = [];
    expect(render('00000000-0000-4000-8000-00000007ffff').props.pinnedOptions?.[1].label).toBe('삭제된 카테고리 · 지금은 연결할 수 없음');
    /* 활성 말단이면 따로 고정하지 않는다. */
    hooks.state = [];
    expect(render(PHOTO).props.pinnedOptions).toEqual([{ value: '', label: '연결 안 함' }]);
  });

  /* 사람 눈 시험(2026-11-10): 고른 값을 저장하지 않고 왼쪽 메뉴로 나가면 경고 없이 사라졌다. */
  describe('저장하지 않은 연결을 두고 떠날 때', () => {
    const MESSAGE = '저장하지 않은 ERP 분류 연결이 있습니다. 이 화면을 떠나면 고른 연결이 사라집니다. 이동할까요?';
    const guard = () => hooks.leaveGuard.mock.calls.at(-1)?.[0] as { dirty: boolean; message: string };
    const field = (tree: ReactNode) => find(tree, (element) => isSelect(element))[0];

    it('고르기만 하고 저장하지 않으면 묻고, 처음 값으로 되돌리면 묻지 않는다', async () => {
      let tree = await renderRow();
      expect(guard()).toEqual({ dirty: false, message: MESSAGE, survivesQueryChange: true });
      field(tree).props.onValueChange?.(PHOTO);
      tree = await renderRow();
      expect(guard()).toEqual({ dirty: true, message: MESSAGE, survivesQueryChange: true });
      expect(field(tree).props.value).toBe(PHOTO);
      field(tree).props.onValueChange?.('');
      tree = await renderRow();
      expect(guard().dirty).toBe(false);
      expect(field(tree).props.value).toBe('');
    });

    it('저장에 성공하면 묻지 않고, 실패하면 고른 값이 남아 계속 묻는다', async () => {
      hooks.save.mockResolvedValueOnce({ ok: false, error: '저장 실패' });
      let tree = await renderRow();
      field(tree).props.onValueChange?.(PHOTO);
      tree = await renderRow();
      button(tree, '연결 저장').props.onClick?.();
      await Promise.all(hooks.pending.splice(0));
      tree = await renderRow();
      expect(guard().dirty).toBe(true);
      expect(field(tree).props.value).toBe(PHOTO);

      hooks.save.mockResolvedValueOnce({ ok: true, changed: true, categoryId: PHOTO, message: '연결했습니다.' });
      button(tree, '연결 저장').props.onClick?.();
      await Promise.all(hooks.pending.splice(0));
      tree = await renderRow();
      expect(guard().dirty).toBe(false);
      expect(field(tree).props.value).toBe(PHOTO);
      expect(button(tree, '연결 저장').props.disabled).toBe(true);
    });

    it('여러 행을 고쳐도 표 전체에 경고를 하나만 등록한다', () => {
      const twoRows: Row[] = [rows[0], { ...rows[0], erpCategory: '문구 > 키링' }];
      hooks.stateIndex = 0;
      const panel = ErpCategoryMappingPanel({ rows: twoRows, categories, categoryErpMappings: [] });
      const rowElements = find(panel, (element) => Boolean(element.props.row)) as ReactElement<Props & { onDraftChange: (erpCategory: string, value: string) => void }>[];
      rowElements[0].props.onDraftChange('문구 > 포토카드', PHOTO);
      rowElements[1].props.onDraftChange('문구 > 키링', KEYRING);
      hooks.leaveGuard.mockClear();
      hooks.stateIndex = 0;
      ErpCategoryMappingPanel({ rows: twoRows, categories, categoryErpMappings: [] });
      expect(hooks.leaveGuard).toHaveBeenCalledOnce();
      expect(guard().dirty).toBe(true);
    });

    it('검색으로 행이 잠시 빠져도 고른 값과 경고가 남는다', async () => {
      const twoRows: Row[] = [rows[0], { ...rows[0], erpCategory: '문구 > 키링' }];
      const render = () => { hooks.stateIndex = 0; return ErpCategoryMappingPanel({ rows: twoRows, categories, categoryErpMappings: [] }); };
      const rowProps = (panel: ReactNode) => find(panel, (element) => Boolean(element.props.row)).map((element) => element.props as Props & { row: { erpCategory: string }; draft?: string; onDraftChange: (erpCategory: string, value: string) => void });
      let panel = render();
      rowProps(panel)[0].onDraftChange('문구 > 포토카드', PHOTO);
      const filter = find(panel, (element) => (element.props as { id?: string }).id === 'erp-category-filter')[0];
      (filter.props as unknown as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: '키링' } });
      panel = render();
      expect(rowProps(panel).map((row) => row.row.erpCategory)).toEqual(['문구 > 키링']);
      expect(guard().dirty).toBe(true);
      (filter.props as unknown as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: '' } });
      panel = render();
      expect(rowProps(panel)[0].draft).toBe(PHOTO);
    });
  });

  /* 2차 사람 눈 시험(2026-11-10): 저장 직후 값을 바꿔도 지난 초록 문구가 남아 저장된 줄로 읽혔다. */
  describe('저장 결과 문구는 그때 저장한 값에만 붙는다', () => {
    const OK = 'ERP 분류를 고객 카테고리에 연결했습니다.';
    const field = (tree: ReactNode) => find(tree, (element) => isSelect(element))[0];
    const saveDone = async (tree: ReactNode) => { button(tree, '연결 저장').props.onClick?.(); await Promise.all(hooks.pending.splice(0)); };

    it('값을 바꾸면 지난 결과를 지운다', async () => {
      hooks.save.mockResolvedValue({ ok: true, changed: true, categoryId: PHOTO, message: OK });
      let tree = await renderRow();
      field(tree).props.onValueChange?.(PHOTO);
      tree = await renderRow();
      await saveDone(tree);
      tree = await renderRow();
      expect(text(tree)).toContain(OK);
      field(tree).props.onValueChange?.(KEYRING);
      tree = await renderRow();
      expect(text(tree)).not.toContain(OK);
    });

    it('같은 값을 다시 고른 것은 바뀐 것이 아니다', async () => {
      hooks.save.mockResolvedValue({ ok: true, changed: true, categoryId: PHOTO, message: OK });
      let tree = await renderRow();
      field(tree).props.onValueChange?.(PHOTO);
      tree = await renderRow();
      await saveDone(tree);
      tree = await renderRow();
      field(tree).props.onValueChange?.(PHOTO);
      expect(text(await renderRow())).toContain(OK);
    });

    it('실패 문구도 값을 바꾸면 지운다', async () => {
      hooks.save.mockResolvedValue({ ok: false, error: '저장 실패' });
      let tree = await renderRow();
      field(tree).props.onValueChange?.(PHOTO);
      tree = await renderRow();
      await saveDone(tree);
      tree = await renderRow();
      expect(text(tree)).toContain('저장 실패');
      field(tree).props.onValueChange?.(KEYRING);
      expect(text(await renderRow())).not.toContain('저장 실패');
    });

    it('행마다 ERP 분류를 key로 두어 다른 행이 그 자리로 올라와도 문구를 물려받지 않는다', () => {
      const twoRows: Row[] = [rows[0], { ...rows[0], erpCategory: '문구 > 키링' }];
      hooks.stateIndex = 0;
      const panel = ErpCategoryMappingPanel({ rows: twoRows, categories, categoryErpMappings: [] });
      expect(find(panel, (element) => Boolean(element.props.row)).map((element) => element.key)).toEqual(['문구 > 포토카드', '문구 > 키링']);
    });
  });

  /* 사람 눈 시험(2026-11-10): 저장하면 행 높이가 줄었다. 저장으로 생기거나 사라지는 표시는 선택 칸 아래 한 줄에 모은다. */
  it('연결 필요·제안·저장 결과는 선택 칸 아래 같은 줄에 있어 저장해도 칸 구조가 변하지 않는다', async () => {
    hooks.save.mockResolvedValue({ ok: true, changed: true, categoryId: PHOTO, message: 'ERP 분류를 고객 카테고리에 연결했습니다.' });
    const note = (tree: ReactNode) => find(tree, (element) => (element.props as { className?: string }).className?.includes('min-h-5') === true && element.type === 'div')[0];
    let tree = await renderRow();
    expect(text(note(tree))).toContain('연결 필요');
    expect(text(note(tree))).toContain('같은 경로로 연결');
    button(tree, '같은 경로로 연결').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    tree = await renderRow();
    expect(text(note(tree))).toBe('ERP 분류를 고객 카테고리에 연결했습니다.');
  });
});

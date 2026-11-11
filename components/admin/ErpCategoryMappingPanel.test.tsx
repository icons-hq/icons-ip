import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  pending: [] as Promise<unknown>[],
  transitionPending: false,
  refresh: vi.fn(),
  save: vi.fn(),
  saveMany: vi.fn(),
  leaveGuard: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: hooks.refresh }),
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error; },
}));
vi.mock('@/app/admin/erp-item-actions', () => ({ setErpCategoryMappingAction: hooks.save, setErpCategoryMappingsAction: hooks.saveMany }));
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
    useTransition: () => [hooks.transitionPending, (callback: () => Promise<unknown>) => { hooks.pending.push(callback()); }],
  };
});

const { ErpCategoryMappingPanel } = await import('./ErpCategoryMappingPanel');
const { AdminSearchSelect } = await import('./console/AdminSearchSelect');
const { Button } = await import('./kit/ui/button');
const { ConsoleBulkActionBar } = await import('./console/ConsoleBulkActionBar');
/* kit 버튼도 네이티브와 같은 조작 부품으로 찾는다(ADR-0028). */
const isButton = (element: ReactElement) => element.type === 'button' || element.type === Button;
const isSelect = (element: ReactElement) => element.type === AdminSearchSelect;

type Option = { value: string; label: string };
type Props = { children?: ReactNode; row?: { erpCategory: string }; locked?: boolean; value?: string; disabled?: boolean; onClick?: () => void; onValueChange?: (value: string) => void; options?: readonly Option[]; pinnedOptions?: readonly Option[]; 'aria-label'?: string };

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

/* 패널의 useState 개수: 검색어·연결 필요만·저장 안 한 선택·체크·일괄 카테고리·일괄 결과·행 사유·저장 직후 값·일괄 횟수. 행의 훅은 그 뒤에 이어진다. */
const PANEL_STATE_COUNT = 9;

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
  hooks.transitionPending = false;
  hooks.refresh.mockReset();
  hooks.save.mockReset();
  hooks.saveMany.mockReset();
  hooks.leaveGuard.mockReset();
  vi.unstubAllGlobals();
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

  /* 사람 눈 시험(2026-11-10): 자동 연결된 분류의 칸이 '연결 안 함'으로 읽혀 257번 저장해야 하는 줄 알았다. */
  it('자동 연결이 있는 분류의 빈 값은 자동 연결된 카테고리로 표시하고, 없으면 연결 안 함이다', async () => {
    const auto: Row[] = [{ erpCategory: '문구>키링', itemCount: 2, categoryId: null, updatedAt: null, fallbackCategoryId: KEYRING }];
    expect(find(await renderRow({ rows: auto }), (element) => isSelect(element))[0].props.pinnedOptions).toEqual([{ value: '', label: '자동 연결 · 문구 > 키링' }]);
    hooks.state = [];
    const explicit: Row[] = [{ ...auto[0], categoryId: PHOTO }];
    expect(find(await renderRow({ rows: explicit }), (element) => isSelect(element))[0].props.pinnedOptions).toEqual([{ value: '', label: '자동 연결 · 문구 > 키링' }]);
    hooks.state = [];
    expect(find(await renderRow(), (element) => isSelect(element))[0].props.pinnedOptions).toEqual([{ value: '', label: '연결 안 함' }]);
  });
});

describe('ERP 분류 일괄 연결', () => {
  const needLink = (erpCategory: string): Row => ({ erpCategory, itemCount: 1, categoryId: null, updatedAt: null, fallbackCategoryId: null });
  const table: Row[] = [needLink('가'), needLink('나'), { ...needLink('다'), categoryId: PHOTO, updatedAt: 'x' }, { ...needLink('문구>키링'), fallbackCategoryId: KEYRING }];
  type RowProps = Props & { row: { erpCategory: string }; selected: boolean; saved: string; draft?: string; notice?: string; suggestion: unknown; onSelect: (name: string, selected: boolean) => void; onDraftChange: (name: string, value: string | undefined) => void };
  const render = (input: Row[] = table) => { hooks.stateIndex = 0; return ErpCategoryMappingPanel({ rows: input, categories, categoryErpMappings: [] }); };
  const rowsOf = (panel: ReactNode) => find(panel, (element) => Boolean(element.props.row)).map((element) => element.props as RowProps);
  const rowOf = (panel: ReactNode, name: string) => rowsOf(panel).find((row) => row.row.erpCategory === name)!;
  const headerBox = (panel: ReactNode) => find(panel, (element) => element.props['aria-label'] === '보이는 ERP 분류 전체 선택')[0] as unknown as { props: { checked: boolean; onChange: (event: { target: { checked: boolean } }) => void } };
  const bulkForm = (panel: ReactNode) => find(panel, (element) => element.type === 'form')[0] as unknown as { props: { onSubmit: (event: unknown) => void } };
  const bulkBar = (panel: ReactNode) => find(panel, (element) => element.type === ConsoleBulkActionBar)[0] as unknown as ReactElement<{ selectedCount: number; controls: ReactElement<{ onValueChange: (value: string) => void; value: string }>; actions: { name: string; disabled?: boolean }[] }>;
  /* 패널이 넘긴 값으로 행을 실제로 그린다. 값 전달뿐 아니라 행이 그 값을 쓰는지까지 본다. */
  const drawRow = (panel: ReactNode, name: string) => {
    const element = find(panel, (candidate) => (candidate.props as { row?: { erpCategory: string } }).row?.erpCategory === name)[0];
    hooks.stateIndex = PANEL_STATE_COUNT;
    return (element.type as (props: Props) => ReactNode)(element.props);
  };
  const box = (tree: ReactNode) => find(tree, (element) => element.type === 'input' && (element.props as { type?: string }).type === 'checkbox')[0];
  const submit = async (panel: ReactNode, name: 'link' | 'unlink') => {
    bulkForm(panel).props.onSubmit({ preventDefault: () => undefined, nativeEvent: { submitter: { name } } });
    await Promise.all(hooks.pending.splice(0));
  };
  const statusLine = (panel: ReactNode) => text(find(panel, (element) => (element.props as { role?: string }).role === 'status' && element.type === 'p')[0]);
  const stubConfirm = (answer: boolean) => { const confirm = vi.fn<(message: string) => boolean>(() => answer); vi.stubGlobal('window', { confirm }); return confirm; };
  const okResult = (changed: number, message = '저장했습니다.') => ({ ok: true, changed, unchanged: 0, rejected: [], message });

  it('체크한 행을 고른 카테고리로 한 번에 연결하고 표에 바로 반영한다', async () => {
    hooks.saveMany.mockResolvedValue(okResult(2, 'ERP 분류 2건의 연결을 저장했습니다.'));
    let panel = render();
    expect(find(panel, (element) => element.type === ConsoleBulkActionBar)).toHaveLength(0);
    expect(text(panel)).toContain('표 왼쪽 칸을 체크하면');
    rowOf(panel, '가').onSelect('가', true);
    rowOf(panel, '나').onSelect('나', true);
    panel = render();
    expect(bulkBar(panel).props.selectedCount).toBe(2);
    expect(bulkBar(panel).props.actions.map((action) => [action.name, action.disabled])).toEqual([['link', true], ['unlink', true]]);
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    panel = render();
    expect(bulkBar(panel).props.actions[0].disabled).toBe(false);
    await submit(panel, 'link');
    expect(hooks.saveMany).toHaveBeenCalledWith([{ erpCategory: '가', categoryId: KEYRING }, { erpCategory: '나', categoryId: KEYRING }]);
    panel = render();
    expect(rowOf(panel, '가').saved).toBe(KEYRING);
    expect(rowOf(panel, '가').selected).toBe(false);
    expect(find(panel, (element) => element.type === ConsoleBulkActionBar)).toHaveLength(0);
    expect(statusLine(panel)).toBe('ERP 분류 2건의 연결을 저장했습니다.');
    expect(text(panel)).toContain('ERP 분류 4개 중 4개 연결됨');
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('새 목록이 오면 저장 직후 값을 버리고 서버 값을 쓴다', async () => {
    hooks.saveMany.mockResolvedValue(okResult(1));
    const before: Row[] = [needLink('가')];
    let panel = render(before);
    rowOf(panel, '가').onSelect('가', true);
    panel = render(before);
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    await submit(render(before), 'link');
    expect(rowOf(render(before), '가').saved).toBe(KEYRING);
    expect(rowOf(render([{ ...needLink('가'), categoryId: PHOTO }]), '가').saved).toBe(PHOTO);
  });

  it('머리글 칸은 검색으로 좁힌 행만 고르고, 숨은 행은 체크가 남아도 보내지 않는다', async () => {
    hooks.saveMany.mockResolvedValue(okResult(1));
    let panel = render();
    rowOf(panel, '다').onSelect('다', true);
    (find(panel, (element) => (element.props as { id?: string }).id === 'erp-category-filter')[0].props as unknown as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: '가' } });
    panel = render();
    expect(rowsOf(panel).map((row) => row.row.erpCategory)).toEqual(['가']);
    expect(headerBox(panel).props.checked).toBe(false);
    headerBox(panel).props.onChange({ target: { checked: true } });
    panel = render();
    expect(headerBox(panel).props.checked).toBe(true);
    expect(bulkBar(panel).props.selectedCount).toBe(1);
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    await submit(render(), 'link');
    expect(hooks.saveMany).toHaveBeenCalledWith([{ erpCategory: '가', categoryId: KEYRING }]);
  });

  it('이미 다른 카테고리에 직접 연결한 행이 있으면 묻고, 취소하면 보내지 않는다', async () => {
    const confirm = stubConfirm(false);
    let panel = render();
    rowOf(panel, '가').onSelect('가', true);
    rowOf(panel, '다').onSelect('다', true);
    panel = render();
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    await submit(render(), 'link');
    expect(confirm.mock.calls[0]).toEqual(['이미 다른 카테고리에 연결된 1건(자동 연결 포함)이 들어 있습니다. 선택한 2건을 모두 ‘문구 > 키링’에 연결할까요?']);
    expect(hooks.saveMany).not.toHaveBeenCalled();
  });

  it('자동 연결된 행을 다른 카테고리로 바꿀 때도 묻고, 같은 카테고리면 묻지 않는다', async () => {
    const confirm = stubConfirm(false);
    let panel = render();
    rowOf(panel, '문구>키링').onSelect('문구>키링', true);
    panel = render();
    bulkBar(panel).props.controls.props.onValueChange(PHOTO);
    await submit(render(), 'link');
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain('이미 다른 카테고리에 연결된 1건(자동 연결 포함)');
    expect(hooks.saveMany).not.toHaveBeenCalled();
    confirm.mockClear();
    bulkBar(render()).props.controls.props.onValueChange(KEYRING);
    hooks.saveMany.mockResolvedValue(okResult(1));
    await submit(render(), 'link');
    expect(confirm).not.toHaveBeenCalled();
    expect(hooks.saveMany).toHaveBeenCalledWith([{ erpCategory: '문구>키링', categoryId: KEYRING }]);
  });

  it('새로 연결하기만 하면 묻지 않는다', async () => {
    const confirm = stubConfirm(true);
    hooks.saveMany.mockResolvedValue(okResult(1));
    let panel = render();
    rowOf(panel, '가').onSelect('가', true);
    panel = render();
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    await submit(render(), 'link');
    expect(confirm).not.toHaveBeenCalled();
    expect(hooks.saveMany).toHaveBeenCalledOnce();
  });

  it('연결 해제는 직접 연결한 행만 묻고 보낸다', async () => {
    const confirm = stubConfirm(true);
    hooks.saveMany.mockResolvedValue(okResult(1, 'ERP 분류 1건의 연결을 해제했습니다.'));
    let panel = render();
    rowOf(panel, '가').onSelect('가', true);
    rowOf(panel, '다').onSelect('다', true);
    panel = render();
    expect(bulkBar(panel).props.actions[1].disabled).toBe(false);
    await submit(panel, 'unlink');
    expect(confirm.mock.calls[0][0]).toContain('직접 연결한 1건의 연결을 해제할까요?');
    expect(hooks.saveMany).toHaveBeenCalledWith([{ erpCategory: '다', categoryId: null }]);
    expect(rowOf(render(), '다').saved).toBe('');
  });

  it('거절된 행은 체크를 남기고 그 행에 사유를 보이며, 나머지는 저장한다', async () => {
    hooks.saveMany.mockResolvedValue({ ok: true, changed: 1, unchanged: 0, rejected: [{ erpCategory: '나', error: '보관된 카테고리에는 연결할 수 없습니다.' }], message: 'ERP 분류 1건의 연결을 저장했습니다. 1건은 저장하지 못했습니다. 표에서 사유를 확인해주세요.' });
    let panel = render();
    rowOf(panel, '가').onSelect('가', true);
    rowOf(panel, '나').onSelect('나', true);
    panel = render();
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    await submit(render(), 'link');
    panel = render();
    expect(rowOf(panel, '가').saved).toBe(KEYRING);
    expect(rowOf(panel, '나').saved).toBe('');
    expect(rowOf(panel, '나').selected).toBe(true);
    expect(rowOf(panel, '나').notice).toBe('보관된 카테고리에는 연결할 수 없습니다.');
    expect(text(drawRow(panel, '나'))).toContain('보관된 카테고리에는 연결할 수 없습니다.');
    expect(statusLine(panel)).toContain('1건은 저장하지 못했습니다.');
    expect(hooks.refresh).toHaveBeenCalledOnce();
    /* 그 행을 고치면 사유가 지워진다. */
    rowOf(panel, '나').onDraftChange('나', KEYRING);
    expect(rowOf(render(), '나').notice).toBeUndefined();
  });

  /* 리뷰 재현: 개별 저장의 초록 문구가 남아 일괄 거절 사유를 가렸다. */
  it('지난 개별 저장 문구는 일괄 저장 뒤 보이지 않고 거절 사유를 가리지 않는다', async () => {
    const OK = 'ERP 분류를 고객 카테고리에 연결했습니다.';
    const REASON = '보관된 카테고리에는 연결할 수 없습니다.';
    const saveSingly = async () => {
      rowOf(render(), '가').onDraftChange('가', KEYRING);
      button(drawRow(render(), '가'), '연결 저장').props.onClick?.();
      await Promise.all(hooks.pending.splice(0));
    };
    const bulkLink = async () => {
      rowOf(render(), '가').onSelect('가', true);
      bulkBar(render()).props.controls.props.onValueChange(PHOTO);
      await submit(render(), 'link');
    };
    stubConfirm(true);
    hooks.save.mockResolvedValue({ ok: true, changed: true, categoryId: KEYRING, message: OK });
    await saveSingly();
    expect(text(drawRow(render(), '가'))).toContain(OK);
    hooks.saveMany.mockResolvedValue({ ok: true, changed: 0, unchanged: 0, rejected: [{ erpCategory: '가', error: REASON }], message: '1건은 저장하지 못했습니다.' });
    await bulkLink();
    expect(text(drawRow(render(), '가'))).toContain(REASON);
    expect(text(drawRow(render(), '가'))).not.toContain(OK);
    /* 다음 일괄 저장이 성공하면 사유도 지난 문구도 남지 않는다. */
    hooks.saveMany.mockResolvedValue(okResult(1));
    bulkBar(render()).props.controls.props.onValueChange(PHOTO);
    await submit(render(), 'link');
    const tree = text(drawRow(render(), '가'));
    expect(tree).not.toContain(REASON);
    expect(tree).not.toContain(OK);
  });

  it('응답을 못 받으면 체크와 고른 값을 지키고 다시 누르게 한다', async () => {
    hooks.saveMany.mockRejectedValue(new Error('Failed to fetch'));
    let panel = render();
    rowOf(panel, '가').onSelect('가', true);
    rowOf(panel, '나').onDraftChange('나', KEYRING);
    panel = render();
    button(panel, '고른 1건 저장').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    panel = render();
    expect(rowOf(panel, '가').selected).toBe(true);
    expect(rowOf(panel, '나').draft).toBe(KEYRING);
    expect(text(panel)).toContain('저장 결과를 확인하지 못했습니다.');
    expect(hooks.refresh).not.toHaveBeenCalled();
  });

  it('개별 저장도 응답을 못 받으면 다른 행의 고른 값을 잃지 않는다', async () => {
    hooks.save.mockRejectedValue(new Error('Failed to fetch'));
    let panel = render();
    rowOf(panel, '나').onDraftChange('나', KEYRING);
    rowOf(panel, '가').onDraftChange('가', PHOTO);
    panel = render();
    button(drawRow(panel, '가'), '연결 저장').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    panel = render();
    expect(rowOf(panel, '나').draft).toBe(KEYRING);
    expect(rowOf(panel, '가').draft).toBe(PHOTO);
    expect(text(drawRow(panel, '가'))).toContain('저장 결과를 확인하지 못했습니다.');
  });

  it('세션이 끝나 로그인으로 보내는 신호는 삼키지 않는다', async () => {
    hooks.saveMany.mockRejectedValue(new Error('NEXT_REDIRECT;replace;/login'));
    const panel = render();
    rowOf(panel, '가').onDraftChange('가', KEYRING);
    button(render(), '고른 1건 저장').props.onClick?.();
    await expect(Promise.all(hooks.pending.splice(0))).rejects.toThrow('NEXT_REDIRECT');
  });

  /* Codex 리뷰(PR #646): 검색을 오가며 고른 값이 500건을 넘으면 서버 상한에 걸려 하나도 저장되지 않았다. */
  it('고른 값이 500건을 넘으면 500건씩 나눠 차례로 저장한다', async () => {
    const many = Array.from({ length: 501 }, (_, index) => needLink(`분류 ${String(index).padStart(3, '0')}`));
    hooks.saveMany.mockImplementation(async (entries: unknown[]) => okResult(entries.length));
    let panel = render(many);
    const draft = rowsOf(panel)[0].onDraftChange;
    for (const row of many) draft(row.erpCategory, KEYRING);
    panel = render(many);
    button(panel, '고른 501건 저장').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(hooks.saveMany.mock.calls.map(([entries]) => (entries as unknown[]).length)).toEqual([500, 1]);
    panel = render(many);
    expect(find(panel, (element) => isButton(element) && text(element).includes('고른'))).toHaveLength(0);
    expect(statusLine(panel)).toBe('ERP 분류 501건의 연결을 저장했습니다.');
    expect((hooks.leaveGuard.mock.calls.at(-1)?.[0] as { dirty: boolean }).dirty).toBe(false);
  });

  it('나눠 보내다 실패하면 저장된 묶음만 반영하고 나머지 고른 값은 남긴다', async () => {
    const many = Array.from({ length: 501 }, (_, index) => needLink(`분류 ${String(index).padStart(3, '0')}`));
    hooks.saveMany.mockResolvedValueOnce(okResult(500)).mockResolvedValueOnce({ ok: false, error: 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.' });
    let panel = render(many);
    const draft = rowsOf(panel)[0].onDraftChange;
    for (const row of many) draft(row.erpCategory, KEYRING);
    button(render(many), '고른 501건 저장').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    panel = render(many);
    expect(button(panel, '고른 1건 저장')).toBeDefined();
    expect(rowOf(panel, '분류 000').saved).toBe(KEYRING);
    expect(statusLine(panel)).toBe('ERP 분류 500건의 연결을 저장했습니다. 나머지 1건은 저장하지 못했습니다. ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.');
    expect((hooks.leaveGuard.mock.calls.at(-1)?.[0] as { dirty: boolean }).dirty).toBe(true);
  });

  it('품목을 지워 목록에서 사라진 분류의 고른 값은 저장 버튼과 이탈 경고에 세지 않는다', () => {
    const panel = render();
    rowOf(panel, '가').onDraftChange('가', KEYRING);
    expect(button(render(), '고른 1건 저장')).toBeDefined();
    const gone = table.filter((row) => row.erpCategory !== '가');
    expect(find(render(gone), (element) => isButton(element) && text(element).includes('고른'))).toHaveLength(0);
    expect((hooks.leaveGuard.mock.calls.at(-1)?.[0] as { dirty: boolean }).dirty).toBe(false);
  });

  it('저장 자체가 실패하면 체크와 값을 그대로 두고 문구만 보인다', async () => {
    hooks.saveMany.mockResolvedValue({ ok: false, error: 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.' });
    let panel = render();
    rowOf(panel, '가').onSelect('가', true);
    panel = render();
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    await submit(render(), 'link');
    panel = render();
    expect(statusLine(panel)).toBe('ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.');
    expect(rowOf(panel, '가').selected).toBe(true);
    expect(rowOf(panel, '가').saved).toBe('');
    expect(hooks.refresh).not.toHaveBeenCalled();
  });

  it('제안 일괄 저장은 제안이 있는 행만 보내고, 자동 연결·직접 연결·고른 값이 있는 행은 뺀다', async () => {
    const confirm = stubConfirm(true);
    hooks.saveMany.mockResolvedValue(okResult(1));
    const rowsWithSuggestion: Row[] = [
      needLink('문구 > 포토카드'),
      needLink('문구 > 키링'),
      { ...needLink('문구>키링'), fallbackCategoryId: KEYRING },
      { ...needLink('문구 >  키링'), categoryId: PHOTO, updatedAt: 'x' },
      needLink('짝 없음'),
    ];
    let panel = render(rowsWithSuggestion);
    expect(button(panel, '제안대로 2건 연결')).toBeDefined();
    rowOf(panel, '문구 > 키링').onDraftChange('문구 > 키링', PHOTO);
    panel = render(rowsWithSuggestion);
    button(panel, '제안대로 1건 연결').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(confirm.mock.calls[0][0]).toContain('ERP 분류 1건을 연결할까요?');
    expect(hooks.saveMany).toHaveBeenCalledWith([{ erpCategory: '문구 > 포토카드', categoryId: PHOTO }]);
    expect(find(render(rowsWithSuggestion), (element) => isButton(element) && text(element).includes('제안대로'))).toHaveLength(0);
  });

  it('제안 일괄 저장을 취소하면 보내지 않는다', () => {
    stubConfirm(false);
    const panel = render([needLink('문구 > 포토카드')]);
    button(panel, '제안대로 1건 연결').props.onClick?.();
    expect(hooks.saveMany).not.toHaveBeenCalled();
  });

  it('고른 값 일괄 저장은 행마다 고른 값을 보내고(연결 안 함은 해제) 저장하면 떠날 때 묻지 않는다', async () => {
    hooks.saveMany.mockResolvedValue(okResult(2));
    let panel = render();
    rowOf(panel, '가').onDraftChange('가', KEYRING);
    rowOf(panel, '다').onDraftChange('다', '');
    panel = render();
    expect((hooks.leaveGuard.mock.calls.at(-1)?.[0] as { dirty: boolean }).dirty).toBe(true);
    button(panel, '고른 2건 저장').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(hooks.saveMany).toHaveBeenCalledWith([{ erpCategory: '가', categoryId: KEYRING }, { erpCategory: '다', categoryId: null }]);
    panel = render();
    expect((hooks.leaveGuard.mock.calls.at(-1)?.[0] as { dirty: boolean }).dirty).toBe(false);
    expect(rowOf(panel, '가').draft).toBeUndefined();
    expect(rowOf(panel, '가').saved).toBe(KEYRING);
    expect(rowOf(panel, '다').saved).toBe('');
    expect(find(panel, (element) => isButton(element) && text(element).includes('고른'))).toHaveLength(0);
  });

  /* 사람 눈 시험(2026-11-10): 제안대로 저장한 15행 모두에 '다른 ERP 분류에 매핑돼 있다'는 경고가 떴다. */
  it('제안된 카테고리를 그대로 고르면 표기가 달라도 어긋났다고 경고하지 않는다', async () => {
    const loose: Row[] = [needLink('zz 분류1')];
    const mappings = [{ categoryId: KEYRING, erpCode: 'M-1', erpName: 'ZZ분류1' }];
    hooks.saveMany.mockResolvedValue(okResult(1));
    const draw = () => { hooks.stateIndex = 0; return ErpCategoryMappingPanel({ rows: loose, categories, categoryErpMappings: mappings }); };
    const drawRow = () => {
      const element = find(draw(), (candidate) => Boolean(candidate.props.row))[0];
      hooks.stateIndex = PANEL_STATE_COUNT;
      return (element.type as (props: Props) => ReactNode)(element.props);
    };
    stubConfirm(true);
    button(draw(), '제안대로 1건 연결').props.onClick?.();
    await Promise.all(hooks.pending.splice(0));
    expect(hooks.saveMany).toHaveBeenCalledWith([{ erpCategory: 'zz 분류1', categoryId: KEYRING }]);
    expect(find(drawRow(), (element) => isSelect(element))[0].props.value).toBe(KEYRING);
    expect(text(drawRow())).not.toContain('다른 ERP 분류');
    /* 일괄 막대에서 같은 카테고리를 골라도 마찬가지다. */
    hooks.state = [];
    rowOf(draw(), 'zz 분류1').onSelect('zz 분류1', true);
    bulkBar(draw()).props.controls.props.onValueChange(KEYRING);
    expect(text(draw())).not.toContain('다른 ERP 분류');
  });

  it('고른 카테고리의 정본 매핑이 선택한 분류와 다르면 일괄 막대 아래에서 경고한다', () => {
    const mappings = [{ categoryId: KEYRING, erpCode: 'ST-01', erpName: '문구' }];
    const draw = () => { hooks.stateIndex = 0; return ErpCategoryMappingPanel({ rows: table, categories, categoryErpMappings: mappings }); };
    let panel = draw();
    rowOf(panel, '가').onSelect('가', true);
    panel = draw();
    expect(statusLine(panel)).toBe('');
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    expect(statusLine(draw())).toBe('고른 카테고리는 고객 카테고리 화면에서 다른 ERP 분류(‘문구’, ST-01)에 매핑돼 있습니다. 맞는 카테고리인지 확인해주세요.');
  });

  it('한 번에 500행까지 그리고, 일괄 저장 상한과 같다', () => {
    const many = Array.from({ length: 501 }, (_, index) => needLink(`분류 ${index}`));
    const panel = render(many);
    expect(rowsOf(panel)).toHaveLength(500);
    expect(text(panel)).toContain('앞 500개만 표시, 검색으로 좁혀주세요');
  });

  it('일괄 저장 중에는 행 조작을 잠그고 다시 보내지 않는다', async () => {
    let panel = render();
    expect(rowsOf(panel)[0].locked).toBe(false);
    rowOf(panel, '가').onSelect('가', true);
    panel = render();
    bulkBar(panel).props.controls.props.onValueChange(KEYRING);
    hooks.transitionPending = true;
    panel = render();
    expect(bulkBar(panel).props.actions[0].disabled).toBe(true);
    /* 행 자신의 저장은 진행 중이 아닐 때 그린다. 잠금이 일괄 저장에서 왔는지 본다. */
    hooks.transitionPending = false;
    const row = drawRow(panel, '가');
    expect(box(row).props.disabled).toBe(true);
    expect(find(row, (element) => isSelect(element))[0].props.disabled).toBe(true);
    hooks.transitionPending = true;
    await submit(panel, 'link');
    expect(hooks.saveMany).not.toHaveBeenCalled();
  });
});

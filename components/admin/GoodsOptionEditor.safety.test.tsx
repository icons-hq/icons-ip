import { Children, isValidElement, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { GOODS_OPTION_REMOVAL_NOTE, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';

/*
 * 2026-11-25 상품등록 UX(화면 규칙 7): 입력한 값이 조용히 사라지지 않는다.
 *   - 옵션 없음에서 재고를 넣어 둔 채 옵션을 만들면 그 재고가 나눠지지 않는다고 확인받는다.
 *   - 옵션을 다시 만들어 지금 옵션이 목록에서 빠지면 확인받는다. 빠지는 것이 없으면 묻지 않는다.
 *   - 저장된 옵션을 [삭제]·[선택삭제]로 빼면 저장 때 일어나는 일을 말하고 확인받는다. 아직 저장한 적 없는 새 줄은 묻지 않는다.
 * 화면 부품을 함수로 불러 React 요소 트리를 걷는다(DOM 없음, useState만 흉내 낸다).
 */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
vi.mock('@/app/admin/erp-item-picker-actions', () => ({ searchErpItemPickerAction: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.states[index]) : next; }];
  } };
});
const { GoodsOptionEditor } = await import('./GoodsOptionEditor');

type Element = ReactElement<Record<string, unknown>>;
type Part = (props: Record<string, unknown>) => ReactNode;
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }

const savedRed = '11111111-1111-4111-8111-111111111111';
const savedBlue = '22222222-2222-4222-8222-222222222222';
let rows: GoodsOptionRow[];
let axisValues: Record<string, string>;
let confirm: ReturnType<typeof stubAdminConfirm>;
const single = (changes: Partial<GoodsOptionRow> = {}): GoodsOptionRow => ({ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: Number.NaN, ...changes });
const option = (color: string, changes: Partial<GoodsOptionRow> = {}): GoodsOptionRow => ({ name: color, code: '', attributes: { 색상: color }, extraPrice: 0, stockQty: 3, ...changes });

/** 편집기와 그 안의 옵션 입력·옵션목록 부품을 늘 같은 순서로 부른다(상태 칸 순서를 지킨다). */
function render() {
  hooks.index = 0;
  const tree = GoodsOptionEditor({ rows, baseline: [], basePrice: 10000, axisValues, onRowsChange: (next: SetStateAction<GoodsOptionRow[]>) => { rows = typeof next === 'function' ? next(rows) : next; } });
  const editor = nodes(tree);
  const inputsPart = editor.find(node => Array.isArray(node.props.axes))!;
  const inputs = nodes((inputsPart.type as Part)(inputsPart.props));
  const listPart = editor.find(node => typeof node.props.setRows === 'function' && typeof node.props.basePrice === 'number');
  const list = listPart ? nodes((listPart.type as Part)(listPart.props)) : [];
  return { tree, editor, inputs, list };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const createButton = () => render().inputs.find(node => node.type === 'button' && node.props['data-good-option-create'] === '')!;
async function pressCreate() { (createButton().props.onClick as () => void)(); await settle(); }
function listButton(label: string) {
  const found = render().list.find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node.props.children as ReactNode) === label));
  if (!found) throw new Error(`Missing option list button: ${label}`);
  return found;
}
async function pressList(label: string) { (listButton(label).props.onClick as () => void)(); await settle(); }

beforeEach(() => { hooks.states = []; hooks.index = 0; axisValues = {}; confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });

describe('옵션을 만들 때 사라지는 입력', () => {
  beforeEach(() => { axisValues = { optionUsage: 'on', optionAxisName0: '색상', optionAxisValues0: '빨강, 파랑' }; });

  it('옵션 없이 넣어 둔 재고가 있으면 나눠지지 않는다고 확인받고, 취소하면 아무것도 바꾸지 않는다', async () => {
    rows = [single({ stockQty: 1000 })];
    confirm.mockReturnValue(false);
    expect(text(createButton().props.children as ReactNode)).toBe('옵션 2개 만들기');
    await pressCreate();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('입력한 재고수량 1,000개는 옵션별 재고로 나눠지지 않습니다. 옵션마다 재고를 다시 넣어야 합니다.');
    expect(rows).toEqual([single({ stockQty: 1000 })]);
    expect(text(render().tree)).not.toContain('옵션을 만들기 전 재고수량');
  });

  it('확인하면 옵션을 만들고, 재고 합계 옆에 이전 재고수량을 남겨 다시 넣기 쉽게 한다', async () => {
    rows = [single({ stockQty: 1000 })];
    await pressCreate();
    expect(confirm).toHaveBeenCalledOnce();
    expect(rows.map(row => row.name)).toEqual(['빨강', '파랑']);
    /* 새 옵션의 재고 칸은 비어 있다 — 1000이 어느 옵션으로도 조용히 옮겨지지 않는다. */
    expect(rows.every(row => Number.isNaN(row.stockQty))).toBe(true);
    const screen = text(render().tree);
    expect(screen).toContain('옵션 재고수량 합계');
    expect(screen).toContain('옵션을 만들기 전 재고수량 1,000개 · 옵션마다 다시 넣어 주세요');
  });

  it('재고를 넣지 않았거나 0이면 묻지 않고 바로 만든다', async () => {
    for (const stockQty of [Number.NaN, 0]) {
      hooks.states = []; confirm.mockClear();
      rows = [single({ stockQty })];
      await pressCreate();
      expect(confirm).not.toHaveBeenCalled();
      expect(rows).toHaveLength(2);
      expect(text(render().tree)).not.toContain('옵션을 만들기 전 재고수량');
    }
  });

  it('옵션값을 더하기만 하면 묻지 않고, 지금 옵션이 빠지면 몇 개가 빠지고 생기는지 확인받는다', async () => {
    rows = [option('빨강', { id: savedRed, expectedStockQty: 3 })];
    expect(text(createButton().props.children as ReactNode)).toBe('옵션 2개로 바꾸기');
    await pressCreate();
    expect(confirm).not.toHaveBeenCalled();
    expect(rows.map(row => row.name)).toEqual(['빨강', '파랑']);
    expect(rows[0].id).toBe(savedRed);

    /* 옵션명을 한 글자 고치면 옵션값 조합이 모두 달라진다. */
    hooks.states = []; axisValues = { optionUsage: 'on', optionAxisName0: '색', optionAxisValues0: '빨강, 파랑' };
    confirm.mockReturnValue(false);
    const before = rows;
    await pressCreate();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(`지금 옵션 2개 중 2개가 목록에서 빠지고 새 옵션 2개가 생깁니다. 빠지는 옵션의 재고 입력도 사라집니다. 빠지는 옵션: 빨강, 파랑. ${GOODS_OPTION_REMOVAL_NOTE}`);
    expect(rows).toBe(before);
    confirm.mockReturnValue(true);
    await pressCreate();
    expect(rows.map(row => row.attributes)).toEqual([{ 색: '빨강' }, { 색: '파랑' }]);
    expect(rows.every(row => !row.id)).toBe(true);
  });

  it('지금 옵션목록과 같으면 버튼을 누를 수 없다', () => {
    rows = [option('빨강'), option('파랑')];
    const button = createButton();
    expect(button.props.disabled).toBe(true);
    expect(text(button.props.children as ReactNode)).toBe('바뀐 내용 없음');
  });
});

describe('옵션목록에서 옵션을 뺄 때', () => {
  beforeEach(() => { rows = [option('빨강', { id: savedRed, expectedStockQty: 3 }), option('파랑', { id: savedBlue, expectedStockQty: 3 }), option('초록')]; });

  it('저장된 옵션의 [삭제]는 저장 때 일어나는 일을 말하고 확인받는다', async () => {
    confirm.mockReturnValue(false);
    await pressList('옵션 1 삭제');
    expect(confirm).toHaveBeenCalledExactlyOnceWith(`옵션(빨강)을 목록에서 뺍니다. ${GOODS_OPTION_REMOVAL_NOTE}`);
    expect(rows).toHaveLength(3);
    confirm.mockReturnValue(true);
    await pressList('옵션 1 삭제');
    expect(rows.map(row => row.name)).toEqual(['파랑', '초록']);
  });

  it('아직 저장한 적 없는 새 줄의 [삭제]는 묻지 않는다', async () => {
    await pressList('옵션 3 삭제');
    expect(confirm).not.toHaveBeenCalled();
    expect(rows.map(row => row.name)).toEqual(['빨강', '파랑']);
  });

  it('[선택삭제]도 저장된 옵션이 들어 있으면 확인받고, 새 줄만 고르면 묻지 않는다', async () => {
    const check = (label: string) => (render().list.find(node => node.type === 'input' && node.props['aria-label'] === label)!.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    check('옵션 2 선택'); check('옵션 3 선택');
    confirm.mockReturnValue(false);
    await pressList('선택삭제');
    expect(confirm).toHaveBeenCalledExactlyOnceWith(`옵션 2개(파랑, 초록)를 목록에서 뺍니다. ${GOODS_OPTION_REMOVAL_NOTE}`);
    expect(rows).toHaveLength(3);
    confirm.mockReturnValue(true);
    await pressList('선택삭제');
    expect(rows.map(row => row.name)).toEqual(['빨강']);
    expect(text(render().list)).toContain('옵션 2개를 목록에서 뺐습니다. 상품을 저장해야 반영됩니다.');

    hooks.states = []; confirm.mockClear();
    rows = [option('빨강', { id: savedRed, expectedStockQty: 3 }), option('초록')];
    check('옵션 2 선택');
    await pressList('선택삭제');
    expect(confirm).not.toHaveBeenCalled();
    expect(rows.map(row => row.name)).toEqual(['빨강']);
  });
});

describe("옵션 있음에서 '옵션 없음'으로 바꿀 때", () => {
  it('남는 것과 빠지는 것을 확인받고, 취소하면 그대로 둔다', async () => {
    rows = [option('빨강', { id: savedRed, expectedStockQty: 3 }), option('파랑')];
    const off = () => render().editor.find(node => node.props.name === 'optionUsage' && node.props.value === 'off')!;
    confirm.mockReturnValue(false);
    (off().props.onChange as () => void)(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith("'옵션 없음'으로 바꾸면 첫 옵션(빨강)만 옵션값 없이 남습니다. 첫 옵션의 재고수량·옵션 자동코드·ERP 정보는 그대로입니다. 나머지 옵션 1개(파랑)는 목록에서 빠지고 재고 입력도 사라집니다.");
    expect(rows).toHaveLength(2);
    expect(off().props.checked).toBe(false);
    confirm.mockReturnValue(true);
    (off().props.onChange as () => void)(); await settle();
    expect(rows).toEqual([{ ...option('빨강', { id: savedRed, expectedStockQty: 3 }), attributes: {} }]);
    expect(off().props.checked).toBe(true);
  });
});

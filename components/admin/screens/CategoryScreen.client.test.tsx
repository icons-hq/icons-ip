import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { setAdminConfirmHandler } from '@/lib/admin/confirm';
let confirm: ReturnType<typeof stubAdminConfirm>;

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, actionState: {} as unknown }));
const actions = vi.hoisted(() => ({ reorder: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    /* 그릴 때의 저장소를 잡아 둔다 — 부품을 따로 그린 뒤(child) 누른 버튼도 그 부품의 상태를 바꿔야 한다. */
    const store = hooks.state, index = hooks.index++;
    if (!(index in store)) store[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [store[index], (next: unknown) => { store[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(store[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useMemo: (factory: () => unknown) => factory(),
  useActionState: () => [hooks.actionState, 'FORM_ACTION', false],
}));
vi.mock('@/app/admin/category-actions', () => ({
  assignAdminGoodCategoryAction: vi.fn(), archiveAdminCategoryAction: vi.fn(), saveAdminCategoryAction: vi.fn(), saveAdminCategoryErpMappingAction: vi.fn(),
  reorderAdminCategoriesAction: actions.reorder, setAdminCategoryActivationAction: vi.fn(), unarchiveAdminCategoryAction: vi.fn(),
}));
vi.mock('../marketing/MarketingLinkIssuer', () => ({ MarketingLinkIssuer: () => null }));
vi.mock('../CategoryBulkCreatePanel', () => ({ CategoryBulkCreatePanel: () => null }));

import { AdminGoodsPicker, type AdminGoodsPickerRow } from '../AdminGoodsPicker';
import { CategoryTree } from '../CategoryTree';
import { GoodCategoryField } from '../GoodCategoryFields';
import { Button } from '../kit/ui/button';
import { CategoryScreen, categoryFormChanged } from './CategoryScreen';
import type { AdminCategoryNode } from '@/lib/admin/category';

const node = (id: string, name: string, sortOrder: number, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({
  id, code: `code-${sortOrder}`, name, parentId: null, depth: 1, sortOrder, archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 0, assignedGoodCount: 0, ...extra,
});
const first = node('00000000-0000-4000-8000-000000047401', '생활', 1);
const second = node('00000000-0000-4000-8000-000000047402', '문구', 2);
const off = { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null };
const field = (value: string) => ({ value });
const form = (values: Record<string, string>) => ({ elements: { namedItem: (name: string) => (name in values ? field(values[name]) : null) } }) as unknown as HTMLFormElement;
const saved = { name: first.name, code: first.code, parentId: '', sortOrder: '1' };

type Props = {
  children?: ReactNode; disabled?: boolean; name?: string; value?: unknown; type?: string; primary?: string; title?: string;
  onSelect?: (value: never) => unknown; onMove?: (category: AdminCategoryNode, direction: 'up' | 'down') => Promise<void>;
  onSubmit?: (event: unknown) => void; onClick?: () => void; onPrimaryChange?: (id: string) => void; onClose?: () => void;
  category?: AdminCategoryNode; categories?: AdminCategoryNode[];
};
type Element = ReactElement<Props>;
function all(value: ReactNode): Element[] {
  return Array.isArray(value) ? value.flatMap(all) : isValidElement(value) ? [value as Element, ...all((value.props as { children?: ReactNode }).children)] : [];
}
function text(value: ReactNode): string {
  return Array.isArray(value) ? value.map(text).join('') : isValidElement(value) ? text((value.props as { children?: ReactNode }).children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function screen(categories: AdminCategoryNode[] = [first, second]) {
  hooks.index = 0; hooks.refIndex = 0;
  return all(CategoryScreen({ data: { categories, mappings: [], activation: off }, canManagePlatform: false }));
}
const tree = (categories?: AdminCategoryNode[]) => screen(categories).find((item) => item.type === CategoryTree)!;
const named = (elements: Element[], name: string) => elements.find((item) => typeof item.type === 'function' && item.type.name === name)!;
/** 화면 안의 부품 하나를 자기 훅 저장소로 그린다(화면은 부품을 요소로만 갖고 있다). */
function child(element: Element, store: { state: unknown[]; refs: { current: unknown }[] }) {
  const outer = { state: hooks.state, refs: hooks.refs, index: hooks.index, refIndex: hooks.refIndex };
  hooks.state = store.state; hooks.refs = store.refs; hooks.index = 0; hooks.refIndex = 0;
  try { return all((element.type as (props: Props) => ReactNode)(element.props)); }
  finally { store.state = hooks.state; store.refs = hooks.refs; Object.assign(hooks, outer); }
}
/** 제출 이벤트 흉내. 작업 번호 칸 하나를 가진 폼과 누른 버튼을 싣는다. */
function submitEvent(submitterValue?: string) {
  const operation = field('');
  const target = { elements: { namedItem: (name: string) => (name === 'operationId' ? operation : null) }, isConnected: true, requestSubmit: vi.fn() };
  return { event: { currentTarget: target, preventDefault: vi.fn(), nativeEvent: { submitter: submitterValue === undefined ? null : { value: submitterValue } } }, operation, target };
}
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.actionState = {}; actions.reorder.mockReset(); confirm = stubAdminConfirm(false); });
afterEach(() => { setAdminConfirmHandler(null); });

it('수정 칸 값이 저장된 값과 같으면 변경 없음이고, 하나라도 다르면 변경 있음이다', () => {
  expect(categoryFormChanged(form(saved), first)).toBe(false);
  for (const change of [{ name: '생활잡화' }, { code: 'living' }, { parentId: second.id }, { sortOrder: '5' }] as Record<string, string>[]) expect(categoryFormChanged(form({ ...saved, ...change }), first)).toBe(true);
  /* ADR-0044: 상품 유형 연결 칸이 없으므로 옛 값이 폼에 남아 있어도 변경으로 보지 않는다. */
  expect(categoryFormChanged(form({ ...saved, goodType: '피규어' }), first)).toBe(false);
  expect(categoryFormChanged(null, first)).toBe(false);
});

/* 상위 카테고리는 숨은 칸이 지금 값을 그대로 싣는다. 보관한 상위도 그대로라 바꾼 것으로 치지 않고, [최상위로]를 누르면 바꾼 것이다. */
it('보관한 상위 아래의 카테고리는 상위를 건드리지 않으면 변경 없음이다', () => {
  const child_ = { ...first, parentId: second.id };
  expect(categoryFormChanged(form({ ...saved, parentId: second.id }), child_)).toBe(false);
  expect(categoryFormChanged(form({ ...saved, parentId: '' }), child_)).toBe(true);
});

it('수정 중인 입력이 있으면 다른 카테고리를 고를 때 묻고, 취소하면 고치던 항목에 머문다', async () => {
  hooks.refs[0] = { current: form({ ...saved, name: '입력 중' }) };
  await tree().props.onSelect?.(second as never);
  expect(confirm).toHaveBeenCalledOnce();
  expect(hooks.state[0]).toBe(first.id);
});

it('이동을 허락하면 다른 카테고리로 옮긴다', async () => {
  confirm.mockReturnValue(true);
  hooks.refs[0] = { current: form({ ...saved, name: '입력 중' }) };
  await tree().props.onSelect?.(second as never);
  expect(hooks.state[0]).toBe(second.id);
});

it('바꾼 값이 없거나 고치던 항목을 다시 누르면 묻지 않는다', async () => {
  hooks.refs[0] = { current: form(saved) };
  await tree().props.onSelect?.(second as never);
  expect(confirm).not.toHaveBeenCalled();
  expect(hooks.state[0]).toBe(second.id);
  hooks.state = [];
  hooks.refs[0] = { current: form({ ...saved, name: '입력 중' }) };
  await tree().props.onSelect?.(first as never);
  expect(confirm).not.toHaveBeenCalled();
});

/* C-07: 순서는 목록의 [위로]·[아래로]로 바꾸고 누르면 바로 저장한다. 같은 상위 아래의 카테고리 전체를 새 순서대로 보낸다. */
describe('순서 바꾸기', () => {
  it('[아래로]를 누르면 같은 상위 아래의 카테고리 전체를 새 순서로 한 번 보낸다', async () => {
    actions.reorder.mockResolvedValue({ ok: true, changed: true });
    await tree().props.onMove?.(first, 'down');
    expect(actions.reorder).toHaveBeenCalledOnce();
    expect(actions.reorder.mock.calls[0][0]).toMatchObject({ parentId: null, orderedIds: [second.id, first.id] });
    expect(actions.reorder.mock.calls[0][0].operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(text(screen())).not.toContain('순서를');
    /* 처음 열린 맨 위 항목을 아래로 내려도 고치던 항목이 그대로다(맨 위가 된 다른 항목으로 넘어가지 않는다). */
    expect((tree([{ ...first, sortOrder: 2 }, { ...second, sortOrder: 1 }]).props as { activeId?: string }).activeId).toBe(first.id);
  });

  it('맨 위에서 위로는 보낼 것이 없고, 저장하는 동안 다시 눌러도 한 번만 보낸다', async () => {
    await tree().props.onMove?.(first, 'up');
    expect(actions.reorder).not.toHaveBeenCalled();
    let finish: (value: unknown) => void = () => undefined;
    actions.reorder.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const firstPress = tree().props.onMove?.(first, 'down');
    const secondPress = tree().props.onMove?.(first, 'down');
    /* 저장하는 동안 목록의 두 버튼을 잠근다. */
    expect((tree().props as { moving?: boolean }).moving).toBe(true);
    finish({ ok: true, changed: true });
    await Promise.all([firstPress, secondPress]);
    expect(actions.reorder).toHaveBeenCalledOnce();
    expect((tree().props as { moving?: boolean }).moving).toBe(false);
  });

  it('거절되거나 결과를 모르면 목록 아래에 이유를 보이고, 다른 카테고리를 고르면 지운다', async () => {
    actions.reorder.mockResolvedValue({ ok: false, error: '다른 사람이 먼저 바꿨습니다. 새로고침한 뒤 다시 해주세요.' });
    await tree().props.onMove?.(first, 'down');
    expect(text(screen())).toContain('다른 사람이 먼저 바꿨습니다. 새로고침한 뒤 다시 해주세요.');
    hooks.refs[0] = { current: form(saved) };
    await tree().props.onSelect?.(second as never);
    expect(text(screen())).not.toContain('다른 사람이 먼저 바꿨습니다.');
    actions.reorder.mockRejectedValue(new Error('offline'));
    await tree().props.onMove?.(second, 'up');
    expect(text(screen())).toContain('순서를 바꿨는지 확인하지 못했습니다. 새로고침해 카테고리 목록을 확인해주세요.');
  });
});

/* C-08(상위 10개의 8번): 보관은 연결된 상품 수와 고객 화면에서 달라지는 것을 보여 주고 한 번 묻는다. */
describe('보관·복원', () => {
  const archiveForm = (category: AdminCategoryNode) => {
    const element = named(screen([category, second]), 'ArchiveForm');
    return child(element, { state: [], refs: [] });
  };
  const formOf = (elements: Element[]) => elements.find((item) => item.type === 'form')!;

  it('보관을 누르면 멈추고 연결된 상품 수를 적은 확인창을 띄운다. 취소하면 보내지 않는다', async () => {
    const { event, target, operation } = submitEvent();
    formOf(archiveForm({ ...first, assignedGoodCount: 12 })).props.onSubmit?.(event);
    await settle();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain('연결된 상품 12개는 그대로 판매됩니다.');
    expect(confirm.mock.calls[0][0]).toContain('고객 화면의 카테고리 목록에 이 카테고리로는 나오지 않고');
    expect(target.requestSubmit).not.toHaveBeenCalled();
    /* 작업 번호는 보내는 순간에 만든다. */
    expect(operation.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('확인하면 같은 폼을 다시 보내고, 작업 번호는 처음 만든 것을 그대로 쓴다', async () => {
    confirm.mockReturnValue(true);
    const { event, target, operation } = submitEvent();
    const element = formOf(archiveForm(first));
    element.props.onSubmit?.(event);
    const stamped = operation.value;
    await settle();
    expect(target.requestSubmit).toHaveBeenCalledOnce();
    element.props.onSubmit?.(event);
    expect(operation.value).toBe(stamped);
  });

  it('복원은 묻지 않고 바로 보낸다', async () => {
    const { event } = submitEvent();
    const elements = archiveForm({ ...first, archivedAt: '2026-10-01T00:00:00Z' });
    formOf(elements).props.onSubmit?.(event);
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(text(elements)).toContain('복원');
  });

  it('보관한 상위 아래의 카테고리는 복원 버튼을 잠그고 먼저 할 일을 적는다', () => {
    const parent = { ...second, archivedAt: '2026-10-01T00:00:00Z' };
    hooks.state = [first.id];
    const element = named(screen([{ ...first, archivedAt: '2026-10-01T00:00:00Z', parentId: parent.id }, parent]), 'ArchiveForm');
    const elements = child(element, { state: [], refs: [] });
    expect(elements.find((item) => item.type === Button)!.props.disabled).toBe(true);
    expect(text(elements)).toContain('상위 카테고리(문구)를 먼저 복원해야 복원할 수 있습니다.');
    /* 상위에 상품이 연결돼 있어도 DB가 복원을 거절한다(category_has_goods). */
    hooks.state = [first.id];
    const withGoods = child(named(screen([{ ...first, archivedAt: '2026-10-01T00:00:00Z', parentId: second.id }, { ...second, assignedGoodCount: 3 }]), 'ArchiveForm'), { state: [], refs: [] });
    expect(withGoods.find((item) => item.type === Button)!.props.disabled).toBe(true);
    expect(text(withGoods)).toContain('상위 카테고리(문구)에 상품이 연결돼 있어 복원할 수 없습니다. 그 상품을 다른 카테고리로 옮긴 뒤 복원해주세요.');
  });
});

/* C-01·C-02(상위 10개의 1번): 상품은 선택창으로 고르고, 카테고리를 골라야 저장된다. 지우는 일은 따로 이름 붙인 버튼이 한 번 묻고 한다. */
describe('대표 카테고리 바꾸기', () => {
  const leaf = node('00000000-0000-4000-8000-000000047403', '노트', 3);
  const good = (extra: Partial<AdminGoodsPickerRow> = {}): AdminGoodsPickerRow => ({ id: 'g100', code: 'HSQ-0100', name: '홍실 키링', categoryName: '문구', imageUrl: null, published: false, ...extra });
  /* AssignmentForm의 상태 순서: 고른 상품, 고른 카테고리, 선택창 열림, 방금 보낸 변경, 결과 줄을 내린 회차, 반영한 회차. */
  const assignment = (state: unknown[]) => {
    const store = { state, refs: [] as { current: unknown }[] };
    const element = named(screen([first, second, leaf]), 'AssignmentForm');
    return { render: () => child(element, store), store };
  };
  const submitButton = (elements: Element[]) => elements.find((item) => item.type === Button && item.props.type === 'submit');
  const clearButton = (elements: Element[]) => elements.find((item) => item.type === 'button' && item.props.name === 'intent' && item.props.value === 'clear');
  /** 저장 결과 줄(성공·거절 문구)이 받은 상태. */
  const notice = (elements: Element[]) => (named(elements, 'Notice').props as { state?: unknown }).state;

  it('상품을 고르기 전에는 [상품 고르기]만 있고, 누르면 공용 상품 선택창이 열려 고른 상품을 보인다', () => {
    const { render, store } = assignment([]);
    let elements = render();
    expect(submitButton(elements)).toBeUndefined();
    expect(elements.some((item) => item.type === GoodCategoryField)).toBe(false);
    elements.find((item) => item.type === Button && text(item) === '상품 고르기')!.props.onClick?.();
    elements = render();
    const picker = elements.find((item) => item.type === AdminGoodsPicker)!;
    expect(picker.props.title).toBe('상품 고르기');
    /* 상품 조회가 보관한 상품을 빼므로 뺐다고 한 줄로 알린다(화면 규칙 2, 동영상·연관상품의 같은 창과 같은 말). */
    expect((picker.props as { excludedNote?: string }).excludedNote).toBe('보관한 상품은 목록에서 뺐습니다.');
    picker.props.onSelect?.(good() as never);
    picker.props.onClose?.();
    elements = render();
    expect(store.state[0]).toMatchObject({ id: 'g100' });
    expect(elements.some((item) => item.type === AdminGoodsPicker)).toBe(false);
    expect(text(elements)).toContain('홍실 키링');
    expect(text(elements)).toContain('HSQ-0100 · 지금 대표 카테고리 문구 · 초안');
    expect(elements.find((item) => item.type === 'input' && item.props.name === 'goodId')!.props.value).toBe('g100');
  });

  it('카테고리를 고르기 전에는 [대표 카테고리 바꾸기]가 눌리지 않는다', () => {
    const { render } = assignment([good(), '']);
    let elements = render();
    expect(submitButton(elements)!.props.disabled).toBe(true);
    const category = elements.find((item) => item.type === GoodCategoryField)!;
    expect(category.props.primary).toBe('');
    category.props.onPrimaryChange?.(leaf.id);
    elements = render();
    expect(submitButton(elements)!.props.disabled).toBe(false);
    expect(elements.find((item) => item.type === GoodCategoryField)!.props.primary).toBe(leaf.id);
    /* 카테고리 칸에서 선택을 풀면 다시 잠긴다 — 빈 값으로 저장되는 길이 없다. */
    elements.find((item) => item.type === GoodCategoryField)!.props.onPrimaryChange?.('');
    expect(submitButton(render())!.props.disabled).toBe(true);
  });

  /* 리뷰 재현(T3B-RV-6): 카테고리가 없을 때의 안내가 같은 화면을 새 탭으로 열었다. 이 화면에서는 위의 등록 카드를 가리킨다. */
  it('고를 수 있는 카테고리가 없으면 카테고리 칸 대신 위 등록 카드를 가리키고, 저장 버튼은 눌리지 않는다', () => {
    const store = { state: [good(), ''] as unknown[], refs: [] as { current: unknown }[] };
    const archivedOnly = [{ ...first, archivedAt: '2026-10-01T00:00:00Z' }];
    const elements = child(named(screen(archivedOnly), 'AssignmentForm'), store);
    expect(elements.some((item) => item.type === GoodCategoryField)).toBe(false);
    expect(text(elements)).toContain('고를 수 있는 카테고리가 없습니다. 위 카테고리 일괄 등록이나 새 카테고리 등록에서 먼저 등록하세요.');
    expect(elements.some((item) => (item.props as { target?: string }).target === '_blank')).toBe(false);
    expect(submitButton(elements)!.props.disabled).toBe(true);
  });

  it('[미분류로 되돌리기]는 대표 카테고리가 있는 초안 상품에만 있다', () => {
    expect(clearButton(assignment([good(), '']).render())).toBeDefined();
    expect(clearButton(assignment([good({ categoryName: null }), '']).render())).toBeUndefined();
    /* 공개 중인 상품은 대표 카테고리를 비울 수 없다(DB가 막는다). 못 하는 일은 보이지 않는다. */
    expect(clearButton(assignment([good({ published: true }), '']).render())).toBeUndefined();
  });

  it('[미분류로 되돌리기]는 상품과 지금 카테고리를 보여 주고 한 번 묻는다. 그냥 바꾸기는 묻지 않는다', async () => {
    const { render } = assignment([good(), leaf.id]);
    const formElement = render().find((item) => item.type === 'form')!;
    const clearing = submitEvent('clear');
    formElement.props.onSubmit?.(clearing.event);
    await settle();
    expect(clearing.event.preventDefault).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain('지금 대표 카테고리는 문구입니다.');
    expect(confirm.mock.calls[0][0]).toContain('대표 카테고리를 다시 고르기 전에는 이 상품을 공개할 수 없습니다.');
    expect(clearing.target.requestSubmit).not.toHaveBeenCalled();
    confirm.mockClear();
    const changing = submitEvent('');
    formElement.props.onSubmit?.(changing.event);
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(changing.event.preventDefault).not.toHaveBeenCalled();
    expect(changing.operation.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('저장되면 고른 상품의 지금 대표 카테고리를 새 값으로 바꿔 보이고, 다음 저장 전에 카테고리를 다시 고르게 한다', () => {
    const { render, store } = assignment([good(), leaf.id]);
    render().find((item) => item.type === 'form')!.props.onSubmit?.(submitEvent('').event);
    hooks.actionState = { message: '대표 카테고리를 바꿨습니다.', changed: true, round: 1 };
    render();
    const elements = render();
    expect(store.state[0]).toMatchObject({ id: 'g100', categoryName: '노트' });
    expect(text(elements)).toContain('지금 대표 카테고리 노트');
    expect(notice(elements)).toMatchObject({ message: '대표 카테고리를 바꿨습니다.' });
    expect(submitButton(elements)!.props.disabled).toBe(true);
  });

  it('다른 상품을 고르면 앞 상품의 저장 결과 줄을 내린다', () => {
    const { render } = assignment([good(), leaf.id]);
    render().find((item) => item.type === 'form')!.props.onSubmit?.(submitEvent('').event);
    hooks.actionState = { message: '대표 카테고리를 바꿨습니다.', changed: true, round: 1 };
    render();
    render().find((item) => item.type === Button && text(item) === '다른 상품 고르기')!.props.onClick?.();
    render().find((item) => item.type === AdminGoodsPicker)!.props.onSelect?.(good({ id: 'g200', name: '홍실 엽서', categoryName: null }) as never);
    const elements = render();
    expect(text(elements)).toContain('홍실 엽서');
    expect(notice(elements)).toEqual({});
  });

  it('저장이 거절되면 고른 상품과 카테고리를 그대로 둔다', () => {
    const { render, store } = assignment([good(), leaf.id]);
    render().find((item) => item.type === 'form')!.props.onSubmit?.(submitEvent('').event);
    hooks.actionState = { errors: { form: '다른 사람이 먼저 바꿨습니다. 새로고침한 뒤 다시 해주세요.' }, round: 1 };
    render();
    const elements = render();
    expect(store.state[0]).toMatchObject({ categoryName: '문구' });
    expect(store.state[1]).toBe(leaf.id);
    expect(notice(elements)).toMatchObject({ errors: { form: '다른 사람이 먼저 바꿨습니다. 새로고침한 뒤 다시 해주세요.' } });
  });

  it('지운 뒤에는 미분류로 보이고 [미분류로 되돌리기]가 사라진다', async () => {
    confirm.mockReturnValue(true);
    const { render, store } = assignment([good(), '']);
    render().find((item) => item.type === 'form')!.props.onSubmit?.(submitEvent('clear').event);
    await settle();
    hooks.actionState = { message: '대표 카테고리를 지웠습니다. 이 상품은 지금 미분류입니다.', changed: true, round: 1 };
    render();
    const elements = render();
    expect(store.state[0]).toMatchObject({ categoryName: null });
    expect(text(elements)).toContain('지금 대표 카테고리 미분류');
    expect(clearButton(elements)).toBeUndefined();
  });
});

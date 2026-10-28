import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, effects: [] as Array<() => void | (() => void)> }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }];
  },
}));
vi.mock('@/app/admin/goods-option-sale-mode-actions', () => ({ readGoodsOptionSaleModeAction: mocks.read, setGoodsOptionSaleModeAction: mocks.save }));
import { GoodsOptionSaleModePanel } from './GoodsOptionSaleModePanel';

type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string; checked?: boolean;
  onChange?: (event: unknown) => void; onSubmit?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all)
    : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : [];
}
function text(node: ReactNode): string {
  return Array.isArray(node) ? node.map(text).join('')
    : isValidElement(node) ? text((node.props as { children?: ReactNode }).children)
    : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
let props: { goodId: string; disabled?: boolean } = { goodId: 'random-main' };
function render() { hooks.index = 0; hooks.effects = []; return GoodsOptionSaleModePanel(props); }
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }
async function mount() { render(); for (const effect of hooks.effects) effect(); await settle(); }
function radio(value: string) { const found = all(render()).find((element) => element.type === 'input' && element.props.value === value); if (!found) throw new Error(value); return found; }
function submitButton() { return all(render()).find((element) => element.type === 'button')!; }

const SELECT_STATE = { goodId: 'random-main', optionSaleMode: 'select', updatedAt: '2026-10-28T01:00:00+00:00', randomProblem: null, activeOptionCount: 3 };

beforeEach(() => {
  hooks.state = []; vi.clearAllMocks(); props = { goodId: 'random-main' };
  mocks.read.mockResolvedValue({ state: SELECT_STATE });
});

it('불러오기 전에는 안내만 보이고, 불러온 뒤 현재 판매 방식이 선택돼 있다', async () => {
  expect(text(render())).toContain('판매 방식을 불러오는 중입니다.');
  await mount();
  expect(mocks.read).toHaveBeenCalledWith('random-main');
  expect(radio('select').props.checked).toBe(true);
  expect(radio('random').props.checked).toBe(false);
  expect(submitButton().props.disabled).toBe(true);
});

it('랜덤 판매로 바꾸면 낙관 잠금 값과 함께 저장하고 결과 상태를 반영한다', async () => {
  await mount();
  radio('random').props.onChange?.({ target: { value: 'random' } });
  expect(submitButton().props.disabled).toBe(false);
  mocks.save.mockResolvedValue({ message: '랜덤 판매로 바꿨습니다.', state: { ...SELECT_STATE, optionSaleMode: 'random', updatedAt: '2026-10-28T01:05:00+00:00' } });
  all(render()).find((element) => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  const form = mocks.save.mock.calls[0][1] as FormData;
  expect(Object.fromEntries(form.entries())).toEqual({ id: 'random-main', mode: 'random', expectedUpdatedAt: SELECT_STATE.updatedAt });
  expect(text(render())).toContain('랜덤 판매로 바꿨습니다.');
  expect(radio('random').props.checked).toBe(true);
});

it('랜덤 조건을 못 맞추면 랜덤 선택을 막고 이유를 보여 준다', async () => {
  mocks.read.mockResolvedValue({ state: { ...SELECT_STATE, randomProblem: 'random_option_price_mismatch' } });
  await mount();
  expect(radio('random').props.disabled).toBe(true);
  expect(text(render())).toContain('판매가와 기간 할인이 같아야');
});

it('부모가 막으면(저장하지 않은 기본 정보) 바꿀 수 없다', async () => {
  props = { goodId: 'random-main', disabled: true };
  await mount();
  expect(all(render()).find((element) => element.type === 'fieldset')?.props.disabled).toBe(true);
});

it('불러오기 오류는 경고로 보이고 폼을 그리지 않는다', async () => {
  mocks.read.mockResolvedValue({ error: '상품 판매 방식을 바꿀 권한이 없습니다.' });
  await mount();
  expect(text(render())).toContain('권한이 없습니다');
  expect(all(render()).some((element) => element.type === 'form')).toBe(false);
});

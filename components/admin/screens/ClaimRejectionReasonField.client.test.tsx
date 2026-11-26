import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

/* R7: 프리셋을 고르면 사유 칸이 채워지고, 운영자가 그 문장을 고쳐 쓸 수 있다. */

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, focus: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useId: () => 'preset',
  useRef: () => ({ current: { focus: hooks.focus } }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
}));

import { ClaimRejectionReasonField } from './ClaimRejectionReasonField';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
}
function render() {
  hooks.index = 0;
  return ClaimRejectionReasonField({ claimType: 'return', id: 'note', label: '거부 사유' });
}
const input = () => all(render()).find((element) => element.type === 'input')!;
const select = () => all(render()).find((element) => element.type === 'select')!;

beforeEach(() => { hooks.state = []; hooks.focus.mockClear(); });

it('프리셋을 고르면 사유 칸을 채우고, 고쳐 쓰면 직접 입력으로 돌아간다', () => {
  expect(all(select()).filter((element) => element.type === 'option').map((element) => element.props.value))
    .toEqual(['', '회수한 상품에 사용 흔적이 있어 반품할 수 없습니다.', '반품 가능 기간이 지났습니다.']);
  (select().props.onChange as (event: unknown) => void)({ target: { value: '반품 가능 기간이 지났습니다.' } });
  expect(input().props.value).toBe('반품 가능 기간이 지났습니다.');
  expect(select().props.value).toBe('반품 가능 기간이 지났습니다.');

  (input().props.onChange as (event: unknown) => void)({ target: { value: '반품 가능 기간(수령 후 7일)이 지났습니다.' } });
  expect(input().props.value).toBe('반품 가능 기간(수령 후 7일)이 지났습니다.');
  expect(select().props.value).toBe('');
  expect(input().props.name).toBe('note');
  expect(input().props.maxLength).toBe(200);
});

it("프리셋을 고른 뒤 '직접 입력'을 다시 고르면 사유 칸을 비우고 입력 칸으로 옮긴다", () => {
  (select().props.onChange as (event: unknown) => void)({ target: { value: '반품 가능 기간이 지났습니다.' } });
  expect(hooks.focus).not.toHaveBeenCalled();

  (select().props.onChange as (event: unknown) => void)({ target: { value: '' } });
  expect(select().props.value).toBe('');
  expect(input().props.value).toBe('');
  expect(hooks.focus).toHaveBeenCalledOnce();
});

it("제어 값(onChange·value)으로 쓸 때도 '직접 입력'이 부모에 빈 값으로 전달된다", () => {
  const onChange = vi.fn();
  hooks.index = 0;
  const tree = ClaimRejectionReasonField({ claimType: 'cancel', id: 'note', label: '거부 사유', onChange, value: '이미 발송되어 취소할 수 없습니다.' });
  const controlled = all(tree).find((element) => element.type === 'select')!;
  expect(controlled.props.value).toBe('이미 발송되어 취소할 수 없습니다.');
  (controlled.props.onChange as (event: unknown) => void)({ target: { value: '' } });
  expect(onChange).toHaveBeenCalledWith('');
});

/* D-01: 사유는 필수이고 구매자에게 그대로 보인다. 칸 이름과 칸 아래 한 줄이 그것을 말하고, 길이가 맞지 않으면 이 칸 아래에서 알린다. */
it('칸 이름에 필수를, 칸 아래에 보이는 곳을 적고, 보내기 전에 걸린 이유를 알림으로 보인다', () => {
  const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
    : isValidElement(node) ? text((node as Element).props.children) : typeof node === 'string' ? node : '';
  hooks.index = 0;
  const plain = ClaimRejectionReasonField({ claimType: 'return', id: 'note' });
  expect(text(plain)).toContain('거부 사유 (필수)');
  expect(text(plain)).toContain('구매자에게 그대로 보입니다. 10~200자로 적어주세요.');
  expect(all(plain).some((element) => element.props.role === 'alert')).toBe(false);
  expect(all(plain).find((element) => element.type === 'input')!.props['aria-invalid']).toBeUndefined();

  hooks.index = 0;
  const failed = ClaimRejectionReasonField({ claimType: 'return', id: 'note', error: '거부 사유를 10자 이상 200자 이하로 입력해주세요.' });
  expect(text(all(failed).find((element) => element.props.role === 'alert'))).toBe('거부 사유를 10자 이상 200자 이하로 입력해주세요.');
  expect(all(failed).find((element) => element.type === 'input')!.props['aria-invalid']).toBe(true);
});

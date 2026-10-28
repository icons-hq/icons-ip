import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

/* R7: 프리셋을 고르면 사유 칸이 채워지고, 운영자가 그 문장을 고쳐 쓸 수 있다. */

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useId: () => 'preset',
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

beforeEach(() => { hooks.state = []; });

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

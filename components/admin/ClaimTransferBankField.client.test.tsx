import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 이 저장소의 화면 시험처럼 컴포넌트 함수를 직접 불러 요소 트리를 걷고, useState는 순서로 모킹한다. 걷기는 자식 부품(kit)을 펼치지 않는다. */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }];
  } }));

import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { CLAIM_TRANSFER_BANK_OTHER_VALUE, ClaimTransferBankField } from './ClaimTransferBankField';

type Node = ReactElement<{ children?: ReactNode; value?: string; name?: string; required?: boolean; disabled?: boolean; maxLength?: number; onChange?: (event: { target: { value: string } }) => void }>;
function all(node: ReactNode): Node[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Node, ...all((node as Node).props.children)] : [];
}

const changes: string[] = [];
function render(value: string, name: string | undefined = 'bankName') {
  hooks.index = 0;
  return all(ClaimTransferBankField({ id: 'bank', name, value, onChange: (next) => { changes.push(next); }, required: true }));
}
const selectOf = (value: string, name?: string) => render(value, name).find((node) => node.type === NativeSelect)!;
const inputOf = (value: string, name?: string) => render(value, name).find((node) => node.type === Input);
const pick = (value: string, picked: string) => selectOf(value).props.onChange!({ target: { value: picked } });
const type = (value: string, typed: string) => inputOf(value)!.props.onChange!({ target: { value: typed } });

beforeEach(() => { hooks.state = []; changes.length = 0; });

describe('ClaimTransferBankField 동작', () => {
  it('목록의 은행을 고르면 그 이름이 값이 되고, 직접 적는 칸은 열리지 않는다', () => {
    pick('', 'KB국민은행');
    expect(changes).toEqual(['KB국민은행']);
    expect(inputOf('KB국민은행')).toBeUndefined();
    expect(selectOf('KB국민은행').props.name).toBe('bankName');
    expect(selectOf('KB국민은행').props.value).toBe('KB국민은행');
  });

  it('목록에 없는 은행·증권사를 고르면 값을 비우고 직접 적는 칸이 열리며, 제출 이름은 적는 칸이 가진다', () => {
    pick('KB국민은행', CLAIM_TRANSFER_BANK_OTHER_VALUE);
    /* 앞서 고른 은행 이름을 직접 적는 칸에 끌고 오지 않는다 — 비운 채로 열어 적게 한다. */
    expect(changes).toEqual(['']);
    expect(selectOf('').props.value).toBe(CLAIM_TRANSFER_BANK_OTHER_VALUE);
    expect(selectOf('').props.name).toBeUndefined();
    const input = inputOf('')!;
    expect(input).toBeDefined();
    expect(input.props).toMatchObject({ name: 'bankName', required: true, maxLength: 40, value: '' });
  });

  it('직접 적는 칸에 적은 글이 그대로 값이 된다', () => {
    pick('', CLAIM_TRANSFER_BANK_OTHER_VALUE);
    type('', '미래에셋증권');
    expect(changes).toEqual(['', '미래에셋증권']);
    /* 값이 목록에 없는 글이어도 적는 칸이 닫히지 않는다(적는 도중 '미래에셋증권'이 아직 목록의 이름과 같아져도 마찬가지). */
    expect(inputOf('미래에셋증권')!.props.value).toBe('미래에셋증권');
    expect(selectOf('미래에셋증권').props.value).toBe(CLAIM_TRANSFER_BANK_OTHER_VALUE);
    type('미래에셋증권', '신한은행');
    expect(inputOf('신한은행')).toBeDefined();
  });

  it('직접 적던 중 목록의 은행으로 돌아가면 적는 칸이 닫히고 고른 칸이 이름을 되찾는다', () => {
    pick('', CLAIM_TRANSFER_BANK_OTHER_VALUE);
    type('', '미래에셋증권');
    pick('미래에셋증권', '신한은행');
    expect(changes.at(-1)).toBe('신한은행');
    expect(inputOf('신한은행')).toBeUndefined();
    expect(selectOf('신한은행').props).toMatchObject({ name: 'bankName', value: '신한은행' });
  });

  it('고른 칸을 비우면(은행 선택) 값이 비고, 목록에 없는 은행·증권사를 다시 고를 수 있다', () => {
    pick('KB국민은행', '');
    expect(changes).toEqual(['']);
    expect(inputOf('')).toBeUndefined();
    pick('', CLAIM_TRANSFER_BANK_OTHER_VALUE);
    expect(inputOf('')).toBeDefined();
  });

  it('미리 채운 값이 목록에 없는 글이면 직접 적는 상태로 시작한다', () => {
    expect(inputOf('미래에셋증권')).toBeDefined();
    expect(selectOf('미래에셋증권').props.value).toBe(CLAIM_TRANSFER_BANK_OTHER_VALUE);
  });
});

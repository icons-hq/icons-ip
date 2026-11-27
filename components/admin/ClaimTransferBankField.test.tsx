import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TOSS_REFUND_BANKS } from '@/lib/payments/toss-bank-codes';
import {
  CLAIM_TRANSFER_BANK_CUSTOM_LABEL, CLAIM_TRANSFER_BANK_MAX_LENGTH, CLAIM_TRANSFER_BANK_OTHER_LABEL, CLAIM_TRANSFER_BANK_OTHER_VALUE, CLAIM_TRANSFER_BANK_PLACEHOLDER,
  ClaimTransferBankField,
} from './ClaimTransferBankField';

/*
 * 운영자가 직접 송금하는 환불계좌의 은행 칸. 목록에서 고르되 목록에 없는 은행·증권사는 직접 적는다.
 * 제출되는 값은 늘 `name` 이름의 문자열 하나다 — 고른 칸과 적는 칸이 동시에 같은 이름을 갖지 않는다.
 * 눌러서 칸이 바뀌는 동작은 ClaimTransferBankField.client.test.tsx가 본다.
 */
const noop = () => undefined;
const render = (props: Partial<Parameters<typeof ClaimTransferBankField>[0]> = {}) => renderToStaticMarkup(
  <ClaimTransferBankField id="bank" name="bankName" onChange={noop} value="" {...props} />,
);
const select = (html: string) => html.match(/<select[^>]*>[\s\S]*?<\/select>/)?.[0] ?? '';
const opening = (html: string) => html.match(/<select[^>]*>/)?.[0] ?? '';
/* kit 옵션은 data-slot·class를 앞에 달고 나오므로 속성 순서에 기대지 않고 값·고른 여부·이름을 읽는다. */
const optionsOf = (html: string) => [...select(html).matchAll(/<option([^>]*)>([^<]*)<\/option>/g)]
  .map((match) => ({ value: /\bvalue="([^"]*)"/.exec(match[1])?.[1] ?? '', selected: /\bselected=""/.test(match[1]), label: match[2] }));

describe('ClaimTransferBankField', () => {
  it('처음에는 목록에서 고르는 칸뿐이다 — 은행 선택, 목록의 은행, 목록에 없는 은행·증권사 순서', () => {
    const html = render({ required: true });
    expect(html).not.toContain('<input');
    const options = optionsOf(html).map((option) => [option.value, option.label]);
    expect(options).toEqual([
      ['', CLAIM_TRANSFER_BANK_PLACEHOLDER],
      ...TOSS_REFUND_BANKS.map((bank) => [bank.name, bank.name]),
      [CLAIM_TRANSFER_BANK_OTHER_VALUE, CLAIM_TRANSFER_BANK_OTHER_LABEL],
    ]);
    expect(opening(html)).toContain('id="bank"');
    expect(opening(html)).toContain('name="bankName"');
    expect(opening(html)).toContain('required');
    expect(CLAIM_TRANSFER_BANK_PLACEHOLDER).toBe('은행 선택');
    expect(CLAIM_TRANSFER_BANK_OTHER_LABEL).toBe('목록에 없는 은행·증권사');
  });

  it('목록의 은행을 골라 둔 값이면 그 항목이 골라져 있고 직접 적는 칸은 없다', () => {
    const html = render({ value: 'KB국민은행' });
    expect(optionsOf(html).filter((option) => option.selected)).toEqual([{ value: 'KB국민은행', selected: true, label: 'KB국민은행' }]);
    expect(html).not.toContain('<input');
    expect(opening(html)).toContain('name="bankName"');
  });

  it('목록에 없는 이름이 이미 적혀 있으면 목록에 없는 은행·증권사가 골라져 있고, 적은 글을 직접 적는 칸에 둔다', () => {
    const html = render({ value: '미래에셋증권', required: true });
    expect(optionsOf(html).filter((option) => option.selected)).toEqual([{ value: CLAIM_TRANSFER_BANK_OTHER_VALUE, selected: true, label: CLAIM_TRANSFER_BANK_OTHER_LABEL }]);
    /* 제출 값은 하나다: 고르는 칸은 이름을 잃고, 적는 칸이 bankName을 가진다. 고르는 칸의 값('목록에 없는…')이 서버로 가지 않는다. */
    expect(opening(html)).not.toContain('name=');
    const input = html.match(/<input[^>]*>/)?.[0] ?? '';
    expect(input).toContain('name="bankName"');
    expect(input).toContain('value="미래에셋증권"');
    expect(input).toContain(`maxLength="${CLAIM_TRANSFER_BANK_MAX_LENGTH}"`);
    expect(input).toContain(`aria-label="${CLAIM_TRANSFER_BANK_CUSTOM_LABEL}"`);
    expect(input).toContain('required');
    expect(CLAIM_TRANSFER_BANK_MAX_LENGTH).toBe(40);
  });

  it('필수가 아니면 두 칸 모두 필수가 아니고, 잠그면 두 칸 모두 잠긴다', () => {
    const optional = render({ value: '미래에셋증권' });
    expect(opening(optional)).not.toContain('required');
    expect(optional.match(/<input[^>]*>/)?.[0]).not.toContain('required');
    const locked = render({ value: '미래에셋증권', disabled: true });
    expect(opening(locked)).toContain('disabled');
    expect(locked.match(/<input[^>]*>/)?.[0]).toContain('disabled');
  });

  it('이름을 주지 않으면(값을 상태로만 읽는 곳) 어느 칸에도 이름이 붙지 않는다', () => {
    expect(opening(render({ name: undefined }))).not.toContain('name=');
    expect(render({ name: undefined, value: '미래에셋증권' }).match(/<input[^>]*>/)?.[0]).not.toContain('name=');
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOSS_REFUND_BANKS, tossBankCodeForName, tossBankName } from './toss-bank-codes';
import { parseVirtualAccountRefundAccountCandidates, selectVirtualAccountRefundAccount } from './virtual-account-refund-account';

describe('tossBankCodeForName', () => {
  it('화면 목록의 이름은 모두 자기 코드로 돌아간다', () => {
    expect(TOSS_REFUND_BANKS.length).toBeGreaterThan(20);
    for (const bank of TOSS_REFUND_BANKS) {
      expect(tossBankCodeForName(bank.name)).toBe(bank.code);
      expect(tossBankName(bank.code)).toBe(bank.name);
    }
  });

  it('흔한 표기(띄어쓰기·은행 꼬리·옛 이름)를 같은 은행으로 읽는다', () => {
    expect(tossBankCodeForName('국민은행')).toBe('06');
    expect(tossBankCodeForName(' KB 국민 은행 ')).toBe('06');
    expect(tossBankCodeForName('신한')).toBe('88');
    expect(tossBankCodeForName('NH농협')).toBe('11');
    expect(tossBankCodeForName('단위농협')).toBe('12');
    expect(tossBankCodeForName('기업은행')).toBe('03');
    expect(tossBankCodeForName('카카오뱅크')).toBe('90');
    expect(tossBankCodeForName('iM뱅크(대구)')).toBe('31');
    expect(tossBankCodeForName('대구은행')).toBe('31');
    expect(tossBankCodeForName('Sh수협은행')).toBe('07');
    expect(tossBankCodeForName('수협중앙회')).toBe('30');
  });

  /* DB(set_my_order_claim_refund_account의 가상계좌 검증)가 받는 은행 이름과 화면 목록이 같아야 한다 — 다르면 고른 은행이 저장에서 거절된다. */
  it('DB가 받는 환불 은행 이름은 화면 목록과 같다', () => {
    const migration = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261125110000_virtual_account_refund_followups.sql'), 'utf8');
    const block = migration.slice(migration.indexOf('create function private.toss_refund_bank_name_known'));
    const list = block.slice(block.indexOf('array['), block.indexOf(']);'));
    const names = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
    expect(names).toEqual(TOSS_REFUND_BANKS.map((bank) => bank.name).sort());
  });

  it('모르거나 애매한 이름은 코드를 주지 않는다', () => {
    // 농협(NH농협은행 11 / 단위농협 12)·수협(Sh수협은행 07 / 수협중앙회 30)은 둘로 갈린다.
    expect(tossBankCodeForName('농협')).toBeNull();
    expect(tossBankCodeForName('수협')).toBeNull();
    expect(tossBankCodeForName('은행')).toBeNull();
    expect(tossBankCodeForName('합성은행')).toBeNull();
    expect(tossBankCodeForName('')).toBeNull();
    expect(tossBankCodeForName(null)).toBeNull();
  });
});

describe('selectVirtualAccountRefundAccount', () => {
  const checkout = { bankCode: '88', accountNumber: '110123456789', holderName: '김토스' };

  it('이 요청에서 구매자가 입력한 계좌를 먼저 쓰고, 하이픈을 지워 숫자만 싣는다', () => {
    expect(selectVirtualAccountRefundAccount({
      claim: { bankName: '국민은행', accountNumber: '123-456-789012', holderName: ' 김합성 ' },
      checkout,
    })).toEqual({ source: 'claim', account: { bankCode: '06', accountNumber: '123456789012', holderName: '김합성' } });
  });

  it('입력한 계좌를 쓸 수 없으면 결제 화면 계좌로 넘어가지 않고 계좌 없음으로 멈춘다', () => {
    expect(selectVirtualAccountRefundAccount({
      claim: { bankName: '합성은행', accountNumber: '123456789012', holderName: '김합성' },
      checkout,
    })).toBeNull();
    expect(selectVirtualAccountRefundAccount({
      claim: { bankName: '신한은행', accountNumber: '1234567890-1234567890-12', holderName: '김합성' },
      checkout,
    })).toBeNull();
  });

  it('입력한 계좌가 없으면 결제 화면 계좌를 쓴다', () => {
    expect(selectVirtualAccountRefundAccount({ claim: null, checkout })).toEqual({ source: 'checkout', account: checkout });
  });

  it('계좌번호 형식이 결제사 범위 밖이면 그 계좌를 쓰지 않는다', () => {
    expect(selectVirtualAccountRefundAccount({
      claim: { bankName: '신한은행', accountNumber: '1234-5', holderName: '김합성' },
      checkout: null,
    })).toBeNull();
    expect(selectVirtualAccountRefundAccount({ claim: null, checkout: { ...checkout, accountNumber: '12a456789' } })).toBeNull();
  });

  it('후보가 없거나 응답 모양이 다르면 null이다', () => {
    expect(selectVirtualAccountRefundAccount(null)).toBeNull();
    expect(selectVirtualAccountRefundAccount({ claim: null, checkout: null })).toBeNull();
    expect(parseVirtualAccountRefundAccountCandidates(null)).toBeNull();
    expect(parseVirtualAccountRefundAccountCandidates([])).toBeNull();
    expect(parseVirtualAccountRefundAccountCandidates({ claim: { bankName: '신한은행' }, checkout: null }))
      .toEqual({ claim: null, checkout: null });
    expect(parseVirtualAccountRefundAccountCandidates({
      claim: { bankName: '신한은행', accountNumber: '110987654321', holderName: '김합성' },
      checkout,
    })).toEqual({ claim: { bankName: '신한은행', accountNumber: '110987654321', holderName: '김합성' }, checkout });
  });
});

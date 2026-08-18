import { describe, expect, it } from 'vitest';
import {
  bankTransferDeadlineImminent,
  bankTransferDeadlineLabel,
  bankTransferDepositCode,
  bankTransferDepositName,
} from './bank-transfer';

const ORDER_ID = '9a3f21c0-1111-4000-8000-000000000abc';

describe('bankTransferDepositCode', () => {
  it('주문 id 앞 8자리를 대문자 코드로 만든다', () => {
    expect(bankTransferDepositCode(ORDER_ID)).toBe('9A3F21C0');
  });

  /*
   * DB private.bank_transfer_deposit_code와 같은 규칙이어야 한다. 어긋나면
   * 화면이 안내한 코드로 운영자가 검색해도 주문이 나오지 않는다.
   */
  it('하이픈을 먼저 걷어내고 자른다 — UUID 구분자가 코드에 섞이지 않는다', () => {
    expect(bankTransferDepositCode('9a-3f-21-c0-1111')).toBe('9A3F21C0');
  });
});

describe('bankTransferDepositName', () => {
  it('입금자명 뒤에 주문코드를 붙인다', () => {
    expect(bankTransferDepositName('홍길동', ORDER_ID)).toBe('홍길동9A3F21C0');
  });

  it('이름이 비면 코드만 안내한다', () => {
    expect(bankTransferDepositName('   ', ORDER_ID)).toBe('9A3F21C0');
  });
});

describe('bankTransferDeadlineLabel', () => {
  const now = Date.parse('2026-08-18T00:00:00.000Z');

  it('시간이 남으면 시간과 분을 함께 읽어 준다', () => {
    expect(bankTransferDeadlineLabel('2026-08-18T05:30:00.000Z', now)).toBe('5시간 30분 남음');
  });

  it('한 시간 미만은 분만 남긴다', () => {
    expect(bankTransferDeadlineLabel('2026-08-18T00:42:00.000Z', now)).toBe('42분 남음');
  });

  it('기한이 지났으면 남은 시간을 만들어 내지 않는다', () => {
    expect(bankTransferDeadlineLabel('2026-08-17T23:00:00.000Z', now)).toBe('기한 종료');
    expect(bankTransferDeadlineLabel(null, now)).toBe('기한 정보 없음');
  });
});

describe('bankTransferDeadlineImminent', () => {
  const now = Date.parse('2026-08-18T00:00:00.000Z');

  it('기본 3시간 안쪽만 임박으로 본다', () => {
    expect(bankTransferDeadlineImminent('2026-08-18T02:00:00.000Z', now)).toBe(true);
    expect(bankTransferDeadlineImminent('2026-08-18T09:00:00.000Z', now)).toBe(false);
  });

  it('이미 지난 기한은 임박이 아니다 — 강조가 아니라 만료 처리 대상이다', () => {
    expect(bankTransferDeadlineImminent('2026-08-17T23:00:00.000Z', now)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  bankTransferDeadlineImminent,
  bankTransferDeadlineLabel,
  bankTransferDepositCode,
  bankTransferDepositName,
  bankTransferDepositNameWithCode,
  bankTransferLegacyDepositCode,
} from './bank-transfer';

const ORDER_ID = '9a3f21c0-1111-4000-8000-000000000abc';

describe('bankTransferDepositCode', () => {
  /*
   * DB private.bank_transfer_deposit_code_for_number와 같은 벡터다(supabase/tests/bank_transfer_order_number_code.sql).
   * 어긋나면 화면이 안내한 코드로 운영자가 검색해도 주문이 나오지 않는다.
   */
  it('16자리 주문번호에서 주문일 10일 주기 자리 + 일련번호 끝 5자리를 만든다', () => {
    expect(['2026102710000001', '2026102810123456', '2026103110000001', '2026110110000001', '2000010110099999'].map(bankTransferDepositCode))
      .toEqual(['600001', '723456', '000001', '100001', '099999']);
  });

  it('연속한 10일의 같은 일련번호는 서로 다른 코드다', () => {
    const codes = Array.from({ length: 10 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 9, 27 + index)).toISOString().slice(0, 10).replaceAll('-', '');
      return bankTransferDepositCode(`${day}10000042`);
    });
    expect(new Set(codes).size).toBe(10);
    expect(codes.every(code => /^\d{6}$/.test(code))).toBe(true);
  });

  it('주문번호가 없는 옛 기록만 UUID 앞 8자리 옛 규칙을 쓴다', () => {
    expect(bankTransferDepositCode(ORDER_ID)).toBe('9A3F21C0');
    expect(bankTransferLegacyDepositCode('9a-3f-21-c0-1111')).toBe('9A3F21C0');
    // 상품주문·배송건번호는 주문번호가 아니다.
    expect(bankTransferDepositCode('2026102720000001')).toBe('20261027');
  });
});

describe('bankTransferDepositName', () => {
  it('입금자명 뒤에 주문코드를 붙이고 한글 4자 이름도 은행 입금자명 14바이트 안에 든다', () => {
    expect(bankTransferDepositName('홍길동', '2026102710000001')).toBe('홍길동600001');
    const name = bankTransferDepositName('남궁길동', '2026102710000001');
    expect([...name].reduce((bytes, char) => bytes + (/[가-힣]/.test(char) ? 2 : 1), 0)).toBeLessThanOrEqual(14);
  });

  it('이름이 비면 코드만 안내한다', () => {
    expect(bankTransferDepositName('   ', ORDER_ID)).toBe('9A3F21C0');
    expect(bankTransferDepositNameWithCode(' ', '600001')).toBe('600001');
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

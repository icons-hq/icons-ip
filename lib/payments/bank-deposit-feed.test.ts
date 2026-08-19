import { describe, expect, it } from 'vitest';
import {
  bankDepositConfidenceLabel,
  bankDepositNeedsSecondLook,
  normalizeBankDepositBatch,
  normalizeBankDepositConfidence,
  normalizeBankDepositRecord,
} from './bank-deposit-feed';
import { FakeBankDepositAdapter } from './fake-bank-deposit-adapter';

const valid = {
  externalId: 'dep-001',
  depositedAt: '2026-08-18T01:00:00.000Z',
  depositorName: '홍길동9A3F21C0',
  amount: 23000,
  rawReference: '기업 12345',
};

describe('normalizeBankDepositRecord', () => {
  it('시각을 ISO로 고정하고 공백을 다듬는다', () => {
    expect(normalizeBankDepositRecord({ ...valid, depositorName: '  홍길동  ' })).toEqual({
      externalId: 'dep-001',
      depositedAt: '2026-08-18T01:00:00.000Z',
      depositorName: '홍길동',
      amount: 23000,
      rawReference: '기업 12345',
    });
  });

  /*
   * 여기서 통과한 값이 곧 "돈이 들어왔다"는 근거가 된다. 빠진 값을 추측해 채우면
   * 잘못된 확정을 부른다 — 버리는 쪽이 안전하다. 버려진 입금은 수동 대조
   * 콘솔(#256)에서 사람이 처리할 수 있다.
   */
  it('금액·시각·식별자·이름 중 하나라도 없으면 버린다', () => {
    expect(normalizeBankDepositRecord({ ...valid, externalId: '  ' })).toBeNull();
    expect(normalizeBankDepositRecord({ ...valid, depositorName: '' })).toBeNull();
    expect(normalizeBankDepositRecord({ ...valid, depositedAt: '어제' })).toBeNull();
    expect(normalizeBankDepositRecord({ ...valid, amount: 0 })).toBeNull();
    expect(normalizeBankDepositRecord({ ...valid, amount: 1000.5 })).toBeNull();
    expect(normalizeBankDepositRecord(null)).toBeNull();
  });

  it('참조 문자열이 없으면 키 자체를 만들지 않는다', () => {
    const record = normalizeBankDepositRecord({ ...valid, rawReference: '   ' });
    expect(record).not.toBeNull();
    expect(record && 'rawReference' in record).toBe(false);
  });
});

describe('normalizeBankDepositBatch', () => {
  /* 한 건 때문에 배치가 통째로 실패하면 재수집이 같은 지점에서 영원히 막힌다. */
  it('깨진 항목을 버리고 나머지를 살린다', () => {
    const batch = normalizeBankDepositBatch([
      valid,
      { externalId: 'broken' },
      { ...valid, externalId: 'dep-002', amount: 5000 },
    ]);
    expect(batch.map((record) => record.externalId)).toEqual(['dep-001', 'dep-002']);
  });

  /* 같은 배치 안의 중복은 DB에 가기 전에 접는다 — on conflict가 받아 주긴 하지만
     한 요청 안에서 같은 행을 두 번 밀 이유가 없다. */
  it('배치 안의 중복 식별자를 접는다', () => {
    expect(normalizeBankDepositBatch([valid, { ...valid, amount: 999 }])).toHaveLength(1);
  });
});

describe('FakeBankDepositAdapter', () => {
  /* 어댑터가 스스로 입금을 만들어 내면 존재하지 않는 돈이 콘솔에 뜬다. */
  it('주입받은 기록만 돌려준다', async () => {
    const adapter = new FakeBankDepositAdapter([valid]);
    await expect(adapter.fetchSince(new Date('2026-08-17T00:00:00.000Z')))
      .resolves.toEqual([valid]);
    expect(new FakeBankDepositAdapter().name).toBe('fake');
  });

  it('기준 시각 이전 기록은 빼고 돌려준다', async () => {
    const adapter = new FakeBankDepositAdapter([valid]);
    await expect(adapter.fetchSince(new Date('2026-08-19T00:00:00.000Z'))).resolves.toEqual([]);
  });
});

describe('매칭 확신도 표기', () => {
  /* DB 경계에서 한 번만 좁힌다. 여기서 걸러진 값은 화면까지 `null`로 내려가
     "제안 없음"이 되고, 아래 라벨·경고 함수는 세 값만 알면 된다. */
  it('아는 세 값만 통과시키고 나머지는 제안 없음으로 버린다', () => {
    expect(normalizeBankDepositConfidence('code_amount')).toBe('code_amount');
    expect(normalizeBankDepositConfidence('code')).toBe('code');
    expect(normalizeBankDepositConfidence('amount_name')).toBe('amount_name');
    expect(normalizeBankDepositConfidence('made-up')).toBeNull();
    expect(normalizeBankDepositConfidence('')).toBeNull();
    expect(normalizeBankDepositConfidence(null)).toBeNull();
    expect(normalizeBankDepositConfidence(undefined)).toBeNull();
    expect(normalizeBankDepositConfidence(3)).toBeNull();
  });

  /* `value in LABELS`로 좁히면 여기가 통과하고, 라벨 조회가 문자열 대신
     Object.prototype의 함수를 돌려준다. */
  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    '프로토타입 키 %o를 확신도로 승격시키지 않는다',
    (key) => {
      expect(normalizeBankDepositConfidence(key)).toBeNull();
    },
  );

  it('DB가 주는 값을 운영자 문구로 옮긴다', () => {
    expect(bankDepositConfidenceLabel('code_amount')).toBe('주문코드·금액 일치');
    expect(bankDepositConfidenceLabel('amount_name')).toBe('금액·이름 일치 · 코드 없음');
    expect(bankDepositConfidenceLabel(null)).toBe('제안 없음');
  });

  /* 금액이 다른 제안은 부분 입금일 수도, 남의 주문일 수도 있다. */
  it('금액이 다른 제안만 한 번 더 보라고 표시한다', () => {
    expect(bankDepositNeedsSecondLook('code')).toBe(true);
    expect(bankDepositNeedsSecondLook('code_amount')).toBe(false);
    expect(bankDepositNeedsSecondLook(null)).toBe(false);
  });
});

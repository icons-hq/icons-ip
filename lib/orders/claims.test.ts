import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  buildKorpayCancellationForm,
  isOpenOrderClaimStage,
  normalizeRefundAccount,
  ORDER_CLAIM_STAGES,
  ORDER_CLAIM_TYPES,
  orderClaimAvailability,
  orderClaimNextStages,
  orderClaimReferenceLabel,
  orderClaimSlaState,
  orderClaimTypeForSlug,
} from './claims';

const NOW = new Date('2026-08-20T06:00:00.000Z');

describe('클레임 유형과 라우트 세그먼트', () => {
  it('콘솔 세그먼트를 유형으로 되돌린다', () => {
    expect(orderClaimTypeForSlug('cancels')).toBe('cancel');
    expect(orderClaimTypeForSlug('returns')).toBe('return');
    expect(orderClaimTypeForSlug('exchanges')).toBe('exchange');
  });

  /* 모르는 세그먼트를 통과시키면 라우트가 임의 문자열로 열린다. */
  it('모르는 세그먼트는 null이다', () => {
    expect(orderClaimTypeForSlug('claims')).toBeNull();
    expect(orderClaimTypeForSlug(undefined)).toBeNull();
  });

  it('클레임번호는 전화로 부를 수 있는 짧은 값이다', () => {
    expect(orderClaimReferenceLabel(12)).toBe('C00012');
  });
});

describe('단계 전이표', () => {
  /* 교환의 종결은 재출고다. 환불 단계가 끼면 화면이 없는 버튼을 그린다. */
  it('교환에는 환불 처리 단계가 없다', () => {
    expect(orderClaimNextStages('exchange', 'collected')).toContain('completed');
    expect(orderClaimNextStages('exchange', 'collected')).not.toContain('processing');
  });

  /* 취소는 회수할 물건이 없으므로 승인이 곧 환불 처리다. */
  it('취소에는 수거 단계가 없다', () => {
    expect(orderClaimNextStages('cancel', 'requested')).toContain('processing');
    expect(orderClaimNextStages('cancel', 'requested')).not.toContain('collecting');
  });

  it('반품은 수거와 입고를 지나야 환불로 간다', () => {
    expect(orderClaimNextStages('return', 'requested')).toContain('collecting');
    expect(orderClaimNextStages('return', 'collecting')).toContain('collected');
    expect(orderClaimNextStages('return', 'collected')).toContain('processing');
  });

  it('종결 단계에서는 더 갈 곳이 없다', () => {
    for (const claimType of ORDER_CLAIM_TYPES) {
      expect(orderClaimNextStages(claimType, 'completed')).toEqual([]);
      expect(orderClaimNextStages(claimType, 'rejected')).toEqual([]);
    }
  });

  /* on_hold는 운영 보류이고 needs_review는 provider 정합화 실패다. 둘 다 열린
     단계지만 같은 값이 아니다 — 합치면 자동 복구 큐와 사람 판단 큐가 섞인다. */
  it('보류와 정합화 실패는 서로 다른 열린 단계다', () => {
    expect(isOpenOrderClaimStage('on_hold')).toBe(true);
    expect(isOpenOrderClaimStage('needs_review')).toBe(true);
    expect(ORDER_CLAIM_STAGES).toContain('on_hold');
    expect(ORDER_CLAIM_STAGES).toContain('needs_review');
    expect(isOpenOrderClaimStage('completed')).toBe(false);
    expect(isOpenOrderClaimStage('rejected')).toBe(false);
  });
});

describe('환급 SLA', () => {
  /* 약관 제16조의 기산점은 "반환받은 날"이다. 접수일이 아니다. */
  it('입고 확인 전에는 기한을 지어내지 않는다', () => {
    expect(orderClaimSlaState(
      { claimType: 'return', stage: 'collecting', collectedAt: null, completedAt: null },
      NOW,
    )).toMatchObject({ tone: 'muted', dueAt: null, label: '입고 전' });
  });

  it('취소에는 회수가 없어 기산점이 없다', () => {
    expect(orderClaimSlaState(
      { claimType: 'cancel', stage: 'processing', collectedAt: null, completedAt: null },
      NOW,
    )).toMatchObject({ tone: 'muted', label: '회수 없음' });
  });

  it('교환은 환급이 아니라 재출고를 기다린다', () => {
    expect(orderClaimSlaState(
      {
        claimType: 'exchange',
        stage: 'collected',
        collectedAt: '2026-08-18T00:00:00.000Z',
        completedAt: null,
      },
      NOW,
    )).toMatchObject({ tone: 'muted', label: '재출고 대기' });
  });

  it('입고 확인부터 영업일 3일을 센다', () => {
    const state = orderClaimSlaState(
      {
        claimType: 'return',
        stage: 'processing',
        collectedAt: '2026-08-19T06:00:00.000Z',
        completedAt: null,
      },
      NOW,
    );
    expect(state.tone).toBe('ok');
    expect(state.dueAt).toBe('2026-08-24T06:00:00.000Z');
  });

  it('기한을 넘기면 danger로 강조한다', () => {
    expect(orderClaimSlaState(
      {
        claimType: 'return',
        stage: 'processing',
        collectedAt: '2026-08-01T06:00:00.000Z',
        completedAt: null,
      },
      NOW,
    )).toMatchObject({ tone: 'danger', label: '기한 초과' });
  });

  /* 주말은 영업일이 아니다. 공휴일 달력은 앱에 없으므로 있는 척하지 않는다. */
  it('영업일 계산이 주말을 건너뛴다', () => {
    // 2026-08-21은 금요일. +3영업일 = 2026-08-26(수).
    expect(addBusinessDays(new Date('2026-08-21T00:00:00.000Z'), 3).toISOString())
      .toBe('2026-08-26T00:00:00.000Z');
  });
});

describe('환불계좌 입력', () => {
  it('비어 있으면 수집하지 않는다', () => {
    expect(normalizeRefundAccount({})).toEqual({ ok: true, value: null });
  });

  /* 반쪽 계좌는 송금에 쓸 수 없다. 저장해 두면 환급 시점에 다시 물어야 한다. */
  it('세 칸 중 하나라도 비면 거절한다', () => {
    const result = normalizeRefundAccount({ bankName: '국민은행', accountNumber: '110123456789' });
    expect(result.ok).toBe(false);
  });

  it('계좌번호는 숫자와 하이픈만 받는다', () => {
    expect(normalizeRefundAccount({
      accountHolder: '홍길동',
      accountNumber: '110-1234-567890; drop',
      bankName: '국민은행',
    }).ok).toBe(false);
  });

  it('공백을 정리해 통과시킨다', () => {
    expect(normalizeRefundAccount({
      accountHolder: ' 홍길동 ',
      accountNumber: '110-1234-567890',
      bankName: ' 국민은행 ',
    })).toEqual({
      ok: true,
      value: { bankName: '국민은행', accountNumber: '110-1234-567890', accountHolder: '홍길동' },
    });
  });
});

describe('코페이 취소 접수 양식', () => {
  const form = buildKorpayCancellationForm({
    amount: 43000,
    merchantName: '확인 필요',
    orderId: '11111111-1111-4111-8111-111111111111',
    orderReference: '81111111',
    paidAt: '2026-08-14T05:00:00.000Z',
    reason: '단순 변심 반품',
  });

  it('접수에 필요한 여섯 칸을 모두 담는다', () => {
    for (const label of ['상호명', '결제일자', '주문번호', '취소금액', '승인번호', '카드사']) {
      expect(form).toContain(label);
    }
  });

  /* 승인번호는 결제사 원장에서만 확인되는 값이다. 지어내면 잘못된 건이 취소된다. */
  it('모르는 값은 지어내지 않고 확인 필요로 남긴다', () => {
    expect(form).toContain('승인번호: 확인 필요');
    expect(form).toContain('카드사: 확인 필요');
  });

  it('전액 취소임을 금액 옆에 명시한다', () => {
    expect(form).toContain('43,000원 (전액)');
  });
});

describe('구매자 접수 가능 여부', () => {
  it('반품·교환은 배송 완료 이후에만 열린다', () => {
    const shipping = orderClaimAvailability({ orderStatus: 'shipping', hasActiveClaim: false });
    expect(shipping.find((entry) => entry.claimType === 'return')?.available).toBe(false);
    expect(shipping.find((entry) => entry.claimType === 'exchange')?.available).toBe(false);
    expect(shipping.find((entry) => entry.claimType === 'cancel')?.available).toBe(true);

    const delivered = orderClaimAvailability({ orderStatus: 'delivered', hasActiveClaim: false });
    expect(delivered.every((entry) => entry.available)).toBe(true);
  });

  /* 주문당 활성 클레임은 하나다. 버튼을 감추지 않고 이유를 적는다. */
  it('활성 클레임이 있으면 이유와 함께 막는다', () => {
    const blocked = orderClaimAvailability({ orderStatus: 'delivered', hasActiveClaim: true });
    expect(blocked.every((entry) => entry.available)).toBe(false);
    expect(blocked[0].blockedReason).toContain('처리 중인 클레임');
  });
});

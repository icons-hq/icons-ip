import { describe, expect, it } from 'vitest';
import {
  customerOrderStatusMeta,
  customerOrderStepLabel,
  formatOrderDate,
  isOrderDetailStatus,
  isVisibleOrderStatus,
  orderClaimProgressLabel,
  orderReferenceLabel,
  refundStatusLabel,
  orderStatusMeta,
  summarizeOrderItems,
} from './orders';

describe('order presentation helpers', () => {
  it.each([
    ['pending', '결제대기', '결제 상태를 확인하고 있어요'],
    ['paid', '결제완료', '주문이 접수됐어요'],
    ['confirmed', '발주확인', '주문을 확인하고 준비 중이에요'],
    ['shipping', '배송중', '상품이 배송 중이에요'],
    ['delivered', '배송완료', '상품이 배송 완료됐어요'],
    // "완료"가 아니라 "거래확정"이다(CONTEXT.md) — 변심 청약철회 창이 닫혔다는 뜻이고
    // 하자 클레임은 남아 있다.
    ['done', '거래확정', '구매가 확정됐어요'],
    ['canceled', '취소', '취소된 주문이에요'],
  ] as const)('maps %s to stable Korean copy', (status, label, title) => {
    expect(orderStatusMeta(status)).toMatchObject({ label, title });
  });

  // 사다리가 늘어도 목록·상세가 보는 상태 집합이 함께 늘어야 confirmed·delivered
  // 주문이 조용히 사라지지 않는다(#250).
  it.each(['paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'] as const)(
    'treats %s as a visible order status',
    (status) => {
      expect(isVisibleOrderStatus(status)).toBe(true);
      expect(isOrderDetailStatus(status)).toBe(true);
    },
  );

  it('keeps pending out of the visible history but inside the detail set', () => {
    expect(isVisibleOrderStatus('pending')).toBe(false);
    expect(isOrderDetailStatus('pending')).toBe(true);
    expect(isOrderDetailStatus('settled')).toBe(false);
  });

  it.each([
    ['requested', '환불 요청 접수'],
    ['awaiting_transfer', '환불 송금 대기'],
    ['done', '환불 완료'],
    ['failed', '환불 확인 필요'],
    ['unknown', '환불 처리 확인 필요'],
  ])('maps refund status %s without exposing provider details', (status, label) => {
    expect(refundStatusLabel(status)).toBe(label);
  });

  it('formats a short non-sensitive order reference and a Seoul calendar date', () => {
    expect(orderReferenceLabel('7ad4c967-3d48-44da-a665-64731ac33f62')).toBe('1AC33F62');
    expect(formatOrderDate('2026-07-14T16:30:00.000Z')).toBe('2026. 7. 15.');
  });

  it('summarizes immutable item snapshots without consulting the current catalog', () => {
    expect(summarizeOrderItems([
      { name: '리락쿠마 낮잠 쿠션', qty: 2 },
      { name: '메이플스토리 키링', qty: 1 },
    ])).toEqual({ label: '리락쿠마 낮잠 쿠션 외 1건', itemCount: 3 });
    expect(summarizeOrderItems([])).toEqual({ label: '주문한 상품', itemCount: 0 });
  });
});

/* 10/14 회의 S20 — 목록 배지와 상세 헤더가 같은 함수로 진행 중 클레임을 말한다. */
describe('orderClaimProgressLabel', () => {
  it.each([
    ['cancel', 'requested', '취소 요청'],
    ['cancel', 'processing', '취소 처리 중'],
    ['cancel', 'needs_review', '취소 확인 중'],
    ['return', 'in_review', '반품 요청'],
    ['return', 'collecting', '반품 회수 중'],
    ['exchange', 'collected', '교환 입고 완료'],
    ['exchange', 'on_hold', '교환 보류'],
  ] as const)('labels an open %s claim at %s', (claimType, stage, label) => {
    expect(orderClaimProgressLabel('paid', { claimType, stage })).toBe(label);
  });

  it('adds no badge without an open claim or once the order itself is canceled', () => {
    expect(orderClaimProgressLabel('paid', null)).toBeNull();
    for (const stage of ['completed', 'rejected', 'withdrawn'] as const) {
      expect(orderClaimProgressLabel('paid', { claimType: 'cancel', stage })).toBeNull();
    }
    expect(orderClaimProgressLabel('canceled', { claimType: 'cancel', stage: 'processing' })).toBeNull();
  });
});

/* QA1 S-D2-12·S-D2-15·S-T06-01: 결제를 마치지 않은 주문은 결제수단으로 말한다. */
describe('customerOrderStatusMeta', () => {
  it('카드는 결제 대기, 무통장은 입금 대기와 그 제목이다', () => {
    expect(customerOrderStatusMeta('pending', 'card')).toMatchObject({ label: '결제 대기', tone: 'pending' });
    expect(customerOrderStatusMeta('pending', 'bank_transfer')).toMatchObject({ label: '입금 대기', title: '입금을 기다리고 있어요' });
  });

  it('토스 가상계좌 입금 대기 카드 주문은 입금 대기로 보인다(ADR-0049)', () => {
    expect(customerOrderStatusMeta('pending', 'card', { awaitingVirtualAccount: true }))
      .toMatchObject({ label: '입금 대기', title: '입금을 기다리고 있어요' });
    expect(customerOrderStatusMeta('pending', 'card', { awaitingVirtualAccount: false })).toMatchObject({ label: '결제 대기' });
    expect(customerOrderStepLabel('pending', { awaitingVirtualAccount: true })).toBe('입금 대기');
    expect(customerOrderStepLabel('pending')).toBe('결제 대기');
  });

  /* MD-0036 3번 — 고객 라벨. 제목·본문·톤은 공용 표 그대로고, 어드민이 쓰는 orderStatusMeta 라벨은 바뀌지 않는다. */
  it.each([
    ['paid', '주문 완료'],
    ['confirmed', '발주확인'],
    ['shipping', '배송중'],
    ['delivered', '배송완료'],
    ['done', '구매 확정'],
    ['canceled', '취소됨'],
  ] as const)('고객에게 %s는 %s로 보인다', (status, label) => {
    for (const paymentMethod of ['card', 'bank_transfer'] as const) {
      const meta = customerOrderStatusMeta(status, paymentMethod);
      expect(meta.label).toBe(label);
      expect(meta.title).toBe(orderStatusMeta(status).title);
      expect(meta.body).toBe(orderStatusMeta(status).body);
      expect(meta.tone).toBe(status);
    }
  });

  it('어드민 라벨은 그대로다(공용 표를 바꾸지 않는다)', () => {
    expect(orderStatusMeta('done').label).toBe('거래확정');
    expect(orderStatusMeta('paid').label).toBe('결제완료');
    expect(orderStatusMeta('canceled').label).toBe('취소');
    expect(orderStatusMeta('pending').label).toBe('결제대기');
    /* 고객 함수가 공용 객체를 덮어쓰지 않는다. */
    customerOrderStatusMeta('done', 'card');
    expect(orderStatusMeta('done').label).toBe('거래확정');
  });
});

describe('구매 확정 문구 통일(QA S2)', () => {
  it('구매 확정 주문의 배지(구매 확정)·제목·본문이 같은 말(구매가 확정)을 쓴다. 어드민 라벨(거래확정)은 그대로다', () => {
    const meta = customerOrderStatusMeta('done', 'card');
    expect(meta.label).toBe('구매 확정');
    expect(meta.title).toBe('구매가 확정됐어요');
    expect(meta.body).toBe('구매가 확정된 주문입니다. 반품·교환은 배송일과 사유별 신청 기한을 별도로 확인해주세요.');
    expect(`${meta.title}${meta.body}`).not.toContain('거래');
    expect(orderStatusMeta('done').label).toBe('거래확정');
  });
});

describe('customerOrderStepLabel', () => {
  it.each([
    ['pending', '결제 대기'],
    ['paid', '주문 완료'],
    ['confirmed', '발주확인'],
    ['shipping', '배송중'],
    ['delivered', '배송완료'],
    ['done', '구매 확정'],
    ['canceled', '취소됨'],
  ] as const)('배송 주문의 %s는 %s다', (status, label) => {
    expect(customerOrderStepLabel(status)).toBe(label);
    expect(customerOrderStepLabel(status, { digital: false })).toBe(label);
  });

  it('디지털 전용 주문은 파일 제공 흐름의 이름을 쓴다', () => {
    expect(customerOrderStepLabel('paid', { digital: true })).toBe('주문 완료');
    expect(customerOrderStepLabel('delivered', { digital: true })).toBe('파일 제공 시작');
    expect(customerOrderStepLabel('done', { digital: true })).toBe('구매 확정');
    /* 디지털에 없는 단계는 사다리처럼 '주문 완료'로 접는다. */
    expect(customerOrderStepLabel('confirmed', { digital: true })).toBe('주문 완료');
    expect(customerOrderStepLabel('shipping', { digital: true })).toBe('주문 완료');
    expect(customerOrderStepLabel('canceled', { digital: true })).toBe('취소됨');
  });
});

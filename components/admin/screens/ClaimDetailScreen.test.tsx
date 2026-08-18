import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { ClaimDetailScreen } from './ClaimDetailScreen';

const NOW = new Date('2026-08-20T06:00:00.000Z');
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CARRIERS = [
  {
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://example.test/{trackingNumber}',
  },
];

function detail(overrides: Partial<AdminClaimDetail> = {}): AdminClaimDetail {
  return {
    claim: {
      id: CLAIM_ID,
      reference: 12,
      orderId: ORDER_ID,
      claimType: 'return',
      stage: 'collected',
      status: 'requested',
      reason: '단순 변심 반품',
      reasonType: 'change_of_mind',
      decisionNote: null,
      holdReason: null,
      heldAt: null,
      requestedAt: '2026-08-18T01:00:00.000Z',
      decidedAt: '2026-08-18T02:00:00.000Z',
      collectingAt: '2026-08-18T02:00:00.000Z',
      collectedAt: '2026-08-19T06:00:00.000Z',
      completedAt: null,
      reshipCarrier: null,
      reshipTrackingNumber: null,
      reshippedAt: null,
      lastErrorCode: null,
      handlerName: 'cs_lead',
    },
    order: {
      id: ORDER_ID,
      status: 'delivered',
      total: 43000,
      shippingFee: 3000,
      createdAt: '2026-08-10T01:00:00.000Z',
      deliveredAt: '2026-08-17T01:00:00.000Z',
      shippingCarrier: 'hanjin',
      trackingNumber: 'LD00000000901',
      buyerName: 'maple_fan',
      buyerEmail: 'buyer@example.com',
      items: [{ name: '아크릴 블록', qty: 2, unitPrice: 20000 }],
    },
    payment: {
      id: '33333333-3333-4333-8333-333333333333',
      provider: 'korpay',
      status: 'paid',
      amount: 43000,
      createdAt: '2026-08-10T01:05:00.000Z',
    },
    refund: {
      status: 'requested',
      amount: 43000,
      method: 'pg_cancel',
      filedAt: '2026-08-19T07:00:00.000Z',
      completedAt: null,
      settlementNote: null,
      handlerName: 'cs_lead',
    },
    cardPacks: { issued: 2, consumed: 1, revoked: 0 },
    refundAccount: {
      maskedAccount: '국민은행 ***********7890',
      maskedHolder: '홍**',
      purgeAfter: null,
      purgedAt: null,
    },
    timeline: [
      {
        action: 'admin.order.claim_approved',
        createdAt: '2026-08-18T02:00:00.000Z',
        actorName: 'cs_lead',
        diff: { to: 'collecting' },
      },
    ],
    ...overrides,
  };
}

function render(overrides: Partial<AdminClaimDetail> = {}, cancellationForm: string | null = null) {
  return renderToStaticMarkup(
    <ClaimDetailScreen
      backHref="/admin/sales/claims/returns"
      cancellationForm={cancellationForm}
      carriers={CARRIERS}
      detail={detail(overrides)}
      now={NOW}
    />,
  );
}

describe('ClaimDetailScreen', () => {
  it('승인 전에 봐야 하는 주문 맥락을 한 화면에 모은다', () => {
    const html = render();

    expect(html).toContain('아크릴 블록');
    expect(html).toContain('Korpay');
    expect(html).toContain('43,000');
    expect(html).toContain('LD00000000901');
    expect(html).toContain('maple_fan (buyer@example.com)');
  });

  /* 취소·반품 완료는 미개봉 카드팩만 회수한다(약관 제17조). 개봉 이력이 있는 주문은
     사람이 한 번 더 봐야 한다. */
  it('이미 개봉된 카드팩이 회수되지 않는다는 사실을 알린다', () => {
    const html = render();

    expect(html).toContain('뽑기권 발급');
    expect(html).toContain('회수되지 않습니다');
  });

  it('교환은 카드팩을 회수하지 않는다고 말한다', () => {
    const html = render({
      claim: { ...detail().claim, claimType: 'exchange' },
      refund: null,
    });

    expect(html).toContain('교환은 카드팩을 회수하지 않습니다');
    expect(html).toContain('교환에는 환불 원장이 없습니다');
  });

  /* 환불계좌 원문은 어떤 경로로도 화면에 오지 않는다(#208 안전 기본값). */
  it('환불계좌는 마스킹된 값만 보여준다', () => {
    const html = render();

    expect(html).toContain('국민은행 ***********7890');
    expect(html).toContain('홍**');
    expect(html).not.toContain('1234-567890');
    expect(html).toContain('30일 뒤 원문은 자동 파기');
  });

  it('입고 확인 뒤에는 환급 기한이 계산된다', () => {
    const html = render();

    expect(html).toContain('환급 기한');
    expect(html).toContain('data-sla-tone');
  });

  /* 코페이 취소는 API가 아니라 이메일 접수다. 콘솔이 양식을 만들어야 손으로 옮겨
     적다가 금액이나 주문번호를 틀리지 않는다. */
  it('코페이 취소 양식을 붙여넣을 수 있게 그린다', () => {
    const html = render({}, '[결제 취소 요청]\n상호명: 확인 필요');

    expect(html).toContain('결제사 취소 접수 양식');
    expect(html).toContain('[결제 취소 요청]');
  });

  it('타임라인은 감사 로그를 그대로 읽는다', () => {
    const html = render();

    expect(html).toContain('승인');
    expect(html).toContain('@cs_lead');
  });

  it('부분 환불을 약속하지 않는다', () => {
    const html = render();

    expect(html).toContain('부분 환불을 약속하지 마세요');
  });

  it('목록으로 돌아가는 링크를 남긴다', () => {
    const html = render();

    expect(html).toContain('/admin/sales/claims/returns');
  });
});

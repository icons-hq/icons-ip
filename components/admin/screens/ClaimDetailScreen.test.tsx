import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { ClaimDetailScreen } from './ClaimDetailScreen';
import { ClaimProgressSummary } from './ClaimProgressSummary';

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
      origin: 'customer',
      staffReasonCode: null,
      staffNote: null,
      decisionNote: null,
      holdReason: null,
      heldAt: null,
      heldFrom: null,
      requestedAt: '2026-08-18T01:00:00.000Z',
      decidedAt: '2026-08-18T02:00:00.000Z',
      collectingAt: '2026-08-18T02:00:00.000Z',
      collectedAt: '2026-08-19T06:00:00.000Z',
      collectionPolicy: 'legacy',
      collectionComplete: true,
      collections: [],
      completedAt: null,
      reshipCarrier: null,
      reshipTrackingNumber: null,
      reshippedAt: null,
      reshipDeliveredAt: null,
      reshipDeliveredBy: null,
      reshipDeliveredByName: null,
      reshipDeliveryEvidence: null,
      lastErrorCode: null,
      handlerName: 'cs_lead',
      updatedAt: '2026-08-19T07:00:00.000Z',
      operationalFee: { kind: null, amount: null, note: null, evidence: null, confirmedBy: null, confirmedAt: null, updatedAt: '2026-08-19T07:00:00.000Z' },
    },
    order: {
      id: ORDER_ID,
      status: 'delivered',
      total: 43000,
      shippingFee: 3000,
      createdAt: '2026-08-10T01:00:00.000Z',
      deliveredAt: '2026-08-17T01:00:00.000Z',
      shipments: [shipmentFixture({trackingNumber:'LD00000000901', status:'delivered'})],
      buyerName: 'maple_fan',
      buyerEmail: 'buyer@example.com',
      items: [{ id: '00000000-0000-4000-8000-000000044041', goodId: 'good', name: '아크릴 블록', qty: 2, unitPrice: 20000,
        variantId: '00000000-0000-4000-8000-000000044010', variantName: '파랑', currentVariantId: '00000000-0000-4000-8000-000000044010',
        options: [{ id: '00000000-0000-4000-8000-000000044010', name: '파랑', code: 'A01', stockQty: 0 },
          { id: '00000000-0000-4000-8000-000000044011', name: '빨강', code: 'A02', stockQty: 3 }] }],
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
  it.each(['return', 'cancel', 'exchange'] as const)('%s 상세는 기존 입력과 원장을 중복하지 않고 반품에서만 작업 구역으로 옮긴다', claimType => {
    const html = render({ claim: { ...detail().claim, claimType } });
    expect(html.match(/id="claim-refund"/g)).toHaveLength(1);
    expect(html.match(/id="claim-process"/g)).toHaveLength(1);
    expect(html.includes('반품 단계별 처리')).toBe(claimType === 'return');
    expect(html.indexOf('id="claim-process"') < html.indexOf('id="claim-refund"')).toBe(claimType === 'return');
    const forms = html.match(/<\/?form\b[^>]*>/g) ?? [];
    let depth = 0;
    for (const form of forms) { depth += form.startsWith('</') ? -1 : 1; expect(depth).toBeGreaterThanOrEqual(0); expect(depth).toBeLessThanOrEqual(1); }
    expect(depth).toBe(0);
  });
  it('재출고 이력에는 구매 당시 이름과 실제 출고상품 이름을 구분하고 확인 전 출고 폼은 내리지 않는다', () => {
    const value = detail();
    value.claim.claimType = 'exchange';
    value.claim.reshippedItems = [{ orderItemId: 'old-line', goodId: 'replacement', originalGoodId: 'original', name: '실제 교환 파랑 상품', variantId: 'new-variant', variantName: '기본', variantCode: 'NEW-BLUE', qty: 2 }];
    value.order!.items[0].options = [{ id: 'new-variant', goodId: 'replacement', goodName: '실제 교환 파랑 상품', name: '기본', code: 'NEW-BLUE', stockQty: 3 }];
    value.order!.items[0].currentVariantId = 'new-variant';
    const html = renderToStaticMarkup(<ClaimDetailScreen detail={value} carriers={CARRIERS} now={NOW} backHref="/admin/sales/claims/exchanges" cancellationForm={null} />);
    expect(html).toContain('아크릴 블록 × 2');
    expect(html).toContain('재출고 상품');
    expect(html).toContain('실제 교환 파랑 상품 · 기본 · NEW-BLUE');
    expect(html).not.toContain('value="new-variant" selected=""');
  });

  it.each(['exchange', 'return', 'cancel'] as const)('%s 상세의 사유 정정 진입은 교환에만 제공한다', (claimType) => {
    const html = render({ claim: { ...detail().claim, claimType } });
    expect(html.includes('교환 사유 정정 및 이력')).toBe(claimType === 'exchange');
  });
  it('사유 정정 감사 이력을 업무 용어로 표시한다', () => {
    const html = render({ timeline: [{ action: 'admin.order.claim_reason_changed', createdAt: NOW.toISOString(), actorName: 'cs_lead', diff: {} }] });
    expect(html).toContain('교환 사유 정정');
    expect(html).not.toContain('admin.order.claim_reason_changed');
  });
  // 2026-10-12 점검 REF-2·REF-8: 토스 결제의 [환불 완료 확정]은 토스 전액 취소를 직접
  // 발행한다. "결제사 원장에서 먼저 확인하라"는 안내와 계좌 송금 선택지는 사실과 다르다.
  const tossPayment = { ...detail().payment!, provider: 'toss' };
  it('토스 결제의 환불 완료 확정은 결제사 취소를 발행한다고 안내하고 수단을 고르게 하지 않는다', () => {
    const html = render({
      payment: tossPayment,
      claim: { ...detail().claim, stage: 'processing', status: 'processing' },
      refund: { ...detail().refund!, method: null, filedAt: null },
    });
    expect(html).toContain('환불 완료 확정 (토스 전액 취소 발행 · 재고 복원 · 카드팩 회수)');
    expect(html).toContain('누르면 토스 전액 취소를 발행하고 결제사 조회로 결과를 확인합니다.');
    expect(html).not.toContain('결제사 원장에서 전액 취소를 확인한 뒤 눌러주세요');
    expect(html).toContain('결제사 취소 (토스 전액 취소)');
    expect(html).toContain('type="hidden" name="method" value="pg_cancel"');
    expect(html).not.toContain('<option value="bank_transfer"');
  });

  it('토스 결제의 환불 접수는 접수만 기록하고 취소는 완료 확정에서 나간다고 알린다', () => {
    const html = render({ payment: tossPayment, refund: { ...detail().refund!, method: null, filedAt: null } });
    expect(html).toContain('환불 접수 완료로 기록');
    expect(html).toContain('토스 전액 취소는 아래 [환불 완료 확정]을 누를 때 발행됩니다.');
    expect(html).not.toContain('<option value="bank_transfer"');
  });

  it('토스 결제 취소 클레임의 승인 버튼은 승인과 동시에 전액 취소가 나간다고 말한다', () => {
    const html = render({
      payment: tossPayment,
      claim: { ...detail().claim, claimType: 'cancel', stage: 'requested', collectedAt: null, collectingAt: null },
      refund: null,
    });
    expect(html).toContain('승인하고 토스 전액 취소');
    expect(html).toContain('승인하면 바로 토스 전액 취소를 발행하고 결제사 조회로 결과를 확인합니다.');
  });

  /* 2026-10-12 QA-4: 운영자 전액 취소의 헤더는 단순 변심이 아니라 운영 사유다. */
  it('운영자 전액 취소는 헤더에 운영 사유를, 요청 내용에 운영 메모를 보여준다', () => {
    const html = render({
      payment: tossPayment,
      claim: {
        ...detail().claim,
        claimType: 'cancel',
        stage: 'needs_review',
        status: 'needs_review',
        reason: '운영자 전액 취소 · 테스트 결제 정리',
        reasonType: 'staff',
        origin: 'staff',
        staffReasonCode: 'test_payment_cleanup',
        staffNote: '심사 창 테스트 결제',
        collectedAt: null,
        collectingAt: null,
      },
    });
    expect(html).toContain('결제확인필요 · 운영자 전액 취소 · 테스트 결제 정리');
    expect(html).not.toContain('단순 변심');
    expect(html).toContain('운영 메모');
    expect(html).toContain('심사 창 테스트 결제');
  });

  it('Korpay처럼 수단이 정해지지 않은 결제는 운영자가 고른다', () => {
    const html = render({ refund: { ...detail().refund!, method: null } });
    expect(html).toContain('<option value="bank_transfer"');
  });

  it('교환 재출고 뒤에는 배송완료 근거를 별도로 확인하고 기록한 뒤 잠근다', () => {
    const exchanged = { ...detail().claim, claimType: 'exchange' as const, stage: 'completed' as const,
      reshipCarrier: 'hanjin', reshipTrackingNumber: 'QA4530000001', reshippedAt: '2026-09-09T00:00:00Z',
      reshipDeliveredAt: null, reshipDeliveredBy: null, reshipDeliveredByName: null, reshipDeliveryEvidence: null };
    expect(render({ claim: exchanged })).toContain('교환품 배송완료 확인</button>');
    const completed = render({ claim: { ...exchanged, reshipDeliveredAt: '2026-09-09T01:00:00Z',
      reshipDeliveredBy: 'staff-1', reshipDeliveredByName: '배송담당', reshipDeliveryEvidence: '배송 조회 D-001: 전체 수령 확인' } });
    expect(completed).toContain('배송 조회 D-001: 전체 수령 확인');
    expect(completed).toContain('배송담당');
    expect(completed).not.toContain('교환품 배송완료 확인</button>');
  });
  const collections = [
    { shipmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', originId: 'gimpo', originName: '김포',
      returnAddress: '김포 시험 반송지', items: [{ orderItemId: 'item-1', name: '아크릴 블록', qty: 2 }],
      collectedAt: '2026-09-08T04:00:00Z', collectedBy: 'staff-1', collectorName: '김담당', evidence: '창고 회신 G-001, 수량 2개 확인' },
    { shipmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', originId: 'seowon', originName: '서원',
      returnAddress: '서원 시험 반송지', items: [{ orderItemId: 'item-2', name: '키링', qty: 1 }],
      collectedAt: null, collectedBy: null, collectorName: null, evidence: null },
  ];

  it('처리 완료 단계만으로 환불 완료를 표시하지 않는다', () => {
    const base = detail();
    const html = renderToStaticMarkup(<ClaimProgressSummary claim={{ ...base.claim, stage: 'completed' }}
      refund={{ ...base.refund!, status: 'done', completedAt: null }} />);
    expect(html).toContain('반품완료');
    expect(html).toContain('환불 완료 시각 미기록');
    expect(html).toContain('완료 시각 없음');
    expect(html).not.toContain('환불 완료 기록됨');
    expect(html).toContain('href="#claim-refund"');
    expect(render()).toContain('id="claim-refund" tabindex="-1"');
  });

  it('교환 재출고와 실제 배송완료 기록을 분리한다', () => {
    const claim = { ...detail().claim, claimType: 'exchange' as const, stage: 'completed' as const, reshippedAt: NOW.toISOString() };
    const pending = renderToStaticMarkup(<ClaimProgressSummary claim={claim} refund={null} />);
    expect(pending).toContain('재출고 기록됨');
    expect(pending).toContain('배송완료 미확인');
    expect(pending).not.toContain('배송완료 확인</strong>');
    const delivered = renderToStaticMarkup(<ClaimProgressSummary claim={{ ...claim, reshipDeliveredAt: NOW.toISOString() }} refund={null} />);
    expect(delivered).toContain('배송완료 확인');
    expect(delivered).not.toContain('환불 기록');
  });

  it('출고지 확인 수와 서버의 전체 회수 판정을 구분하고 보류 이유를 보존한다', () => {
    const claim = { ...detail().claim, stage: 'on_hold' as const, heldFrom: 'collecting' as const, holdReason: '두 번째 출고지 확인 중', collectionPolicy: 'origin' as const, collectionComplete: false, collections };
    const html = renderToStaticMarkup(<ClaimProgressSummary claim={claim} refund={null} />);
    expect(html).toContain('반품보류');
    expect(html).toContain('보류 전 수거중');
    expect(html).toContain('1 / 2개 출고지 확인');
    expect(html).toContain('전체 회수 확인 전');
    expect(html).toContain('두 번째 출고지 확인 중');
    expect(html).toContain('환불 원장 없음');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
  });

  it('회수 기준 미확인을 취소의 회수 불필요로 바꾸지 않는다', () => {
    const claim = { ...detail().claim, claimType: 'cancel' as const, collectionPolicy: null, collectionComplete: true, collections: [] };
    const html = renderToStaticMarkup(<ClaimProgressSummary claim={claim} refund={null} />);
    expect(html).toContain('회수 기준 확인 필요');
    expect(html).not.toContain('회수 대상 없음');
    const known = renderToStaticMarkup(<ClaimProgressSummary claim={{ ...claim, collectionPolicy: 'origin' }} refund={null} />);
    expect(known).toContain('회수 대상 없음');
  });

  it.each(['return', 'exchange'] as const)('이전 회수 방식의 %s는 전체 게이트 통과만으로 입고 완료라 표시하지 않는다', claimType => {
    const claim = { ...detail().claim, claimType, stage: 'collecting' as const, collectionPolicy: 'legacy' as const, collectionComplete: true, collectedAt: null };
    const waiting = renderToStaticMarkup(<ClaimProgressSummary claim={claim} refund={null} />);
    expect(waiting).toContain('회수 미확인');
    expect(waiting).toContain('입고 확인 기록 없음');
    expect(waiting).not.toContain('회수 확인 완료');
    const received = renderToStaticMarkup(<ClaimProgressSummary claim={{ ...claim, collectedAt: NOW.toISOString() }} refund={null} />);
    expect(received).toContain('회수 확인 완료');
    expect(received).not.toContain('입고 확인 기록 없음');
  });

  it('각 출고지의 회수 주소·품목·근거를 보여주고 미회수 건만 확인한다', () => {
    const html = render({ claim: { ...detail().claim, stage: 'collecting', collectionPolicy: 'origin',
      collectionComplete: false, collections } });
    expect(html).toContain('김포 시험 반송지');
    expect(html).toContain('서원 시험 반송지');
    expect(html).toContain('창고 회신 G-001, 수량 2개 확인');
    expect(html).toContain('김담당');
    expect(html).toContain('서원 회수 확인');
    expect(html).not.toContain('김포 회수 확인</button>');
    expect(html).not.toContain('환불 완료 확정');
    expect(html).not.toContain('반송 상품 입고 확인');
  });

  it.each(['return', 'exchange', 'cancel'] as const)('회수가 남은 %s는 과거 처리중 상태여도 환불·재출고와 결제사 양식을 열지 않는다', (claimType) => {
    const html = render({ claim: { ...detail().claim, claimType, stage: 'processing', collectionPolicy: 'origin',
      collectionComplete: false, collections } }, '[결제 취소 요청]');
    expect(html).toContain('서원 회수 확인');
    expect(html).not.toContain('환불 완료 확정');
    expect(html).not.toContain('환불 접수 완료로 기록');
    expect(html).not.toContain('교환 재출고로 완료');
    expect(html).not.toContain('결제사 취소 접수 양식');
  });

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
    expect(html).not.toContain('name="variant:00000000-0000-4000-8000-000000044041"');
    expect(html).not.toContain('재출고 등록하고 교환 종결');
  });

  it('연락처 원문과 실제 재출고 폼은 현재 운영자 세션과 주소를 확인한 뒤에만 연다', () => {
    const value = detail(); value.claim.claimType = 'exchange';
    const html = renderToStaticMarkup(<ClaimDetailScreen actorId="00000000-0000-4000-8000-000000000001" detail={value}
      carriers={CARRIERS} now={NOW} backHref="/admin/sales/claims/exchanges" cancellationForm={null} />);
    expect(html).toContain('연락처 정보를 확인하기 위해 로그인 상태를 확인');
    expect(html).not.toContain('재출고 등록하고 교환 종결');
    expect(html).not.toContain('name="trackingNumber"');
  });

  it('완료한 교환의 재출고 옵션 스냅샷을 보여준다', () => {
    const html = render({ claim: { ...detail().claim, claimType: 'exchange', stage: 'completed', reshippedItems: [
      { orderItemId: 'item', name: '아크릴 블록', variantId: 'red', variantName: '빨강', variantCode: 'A02', qty: 2 },
    ] } });
    expect(html).toContain('아크릴 블록 · 빨강 · A02 · 2개');
  });

  /* 환불계좌 원문은 어떤 경로로도 화면에 오지 않는다(#208 안전 기본값). */
  it('환불계좌는 마스킹된 값만 보여준다', () => {
    const html = render();

    expect(html).toContain('국민은행 ***********7890');
    expect(html).toContain('홍**');
    expect(html).not.toContain('1234-567890');
    expect(html).toContain('요청 종결 또는 교환 전환 후 30일이 지나면 원문을 파기');
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

  /* 2026-10-12 QA-1: 결제 가능 시간이 지난 결제 대기 주문을 구매자가 취소하면 결제 준비 건이
     결제 없이 닫힌다. 그 감사 행이 액션 코드 그대로 보이지 않게 이름을 붙인다. */
  it('구매자 취소가 닫은 결제 준비 건을 타임라인에서 이름으로 보여준다', () => {
    const html = render({
      timeline: [{
        action: 'order.prepared_goods_cancellation_completed',
        createdAt: '2026-08-18T02:00:00.000Z',
        actorName: 'buyer',
        diff: { outcome: 'expired_no_capture', trigger: 'customer_cancel_request' },
      }],
    });

    expect(html).toContain('결제 준비 건 취소 완료 (구매자 취소)');
    expect(html).not.toContain('order.prepared_goods_cancellation_completed');
  });

  it('부분 환불을 약속하지 않는다', () => {
    const html = render();

    expect(html).toContain('부분 환불을 약속하지 마세요');
  });

  /* [환불 완료 확정]은 이 화면에서 가장 위험한 버튼이다. 단계만 보고 그리면 레거시
     경로로 종결된 클레임(정합화는 끝났고 refunds.completed_at만 비어 있는 상태)에도
     떠서, 누르면 정합화 재시작이 cancellation_request_not_reconcilable로 항상
     실패한다 — 그리고 "주문과 재고는 그대로 유지됩니다"라는 거짓 문구가 뜬다. */
  it('이미 종결된 클레임에는 정합화가 다시 돈다고 말하지 않는다', () => {
    const base = detail();
    const html = render({
      claim: { ...base.claim, stage: 'completed', completedAt: '2026-08-20T01:00:00.000Z' },
      refund: { ...base.refund!, status: 'done', completedAt: null },
    });

    expect(html).toContain('환불 완료를 원장에 기록');
    expect(html).toContain('이 취소·반품·교환 요청은 이미 종결됐습니다');
    expect(html).not.toContain('주문과 재고는 그대로 유지됩니다');
    expect(html).not.toContain('재고 복원 · 카드팩 회수 포함');
  });

  /* 원장 행이 없으면 RPC가 claim_refund_ledger_missing으로 막는다. 버튼을 그려 두면
     운영자는 실패 문구로 그 사실을 배운다. */
  it('환불 원장이 없으면 완료 버튼 대신 사유를 보여준다', () => {
    const base = detail();
    const html = render({
      claim: { ...base.claim, stage: 'processing' },
      refund: null,
    });

    expect(html).not.toContain('환불 완료 확정');
    expect(html).toContain('환불 원장이 없어 완료를 기록할 수 없습니다');
  });

  /* 거부는 durable claim과 환불 intent가 열리기 전까지만 가능하다. processing에서
     거부하면 주문이 "취소 진행 중"인 채로 얼어붙는다(DB의 claim_not_rejectable). */
  it('처리에 착수한 클레임에는 거부 폼을 그리지 않는다', () => {
    const base = detail();
    const html = render({ claim: { ...base.claim, stage: 'processing' } });

    expect(html).not.toContain('거부 사유');
  });

  /* 보류는 단계가 아니라 그 위에 덮인 표시다. processing에서 건 보류를 "아직 착수
     전"으로 읽으면 같은 동결을 거부 버튼으로 만들 수 있다. */
  it('보류는 보류 직전 단계로 거부 가능 여부를 가른다', () => {
    const base = detail();
    const held = (heldFrom: 'collecting' | 'processing') => render({
      claim: { ...base.claim, stage: 'on_hold', heldFrom, holdReason: '반송비 정산 확인 중' },
    });

    expect(held('collecting')).toContain('거부 사유');
    expect(held('processing')).not.toContain('거부 사유');
  });

  /* R7: 거부 사유는 유형에 맞는 확정 프리셋을 고르면 채워지고 고쳐 쓸 수 있다. */
  it('거부 사유 프리셋을 요청 유형에 맞게 보인다', () => {
    const returns = render({ claim: { ...detail().claim, stage: 'requested' } });
    expect(returns).toContain('자주 쓰는 거부 사유');
    expect(returns).toContain('<option value="반품 가능 기간이 지났습니다.">반품 가능 기간이 지났습니다.</option>');
    expect(returns).not.toContain('이미 발송되어 취소할 수 없습니다.');
    expect(returns).toMatch(/<input id="claim-reject-note" maxLength="200" type="text" name="note" value=""\/>/);
    const cancel = render({ claim: { ...detail().claim, claimType: 'cancel', stage: 'requested' } });
    expect(cancel).toContain('<option value="이미 발송되어 취소할 수 없습니다.">이미 발송되어 취소할 수 없습니다.</option>');
  });

  /* R7: 철회는 구매자 몫이다(스마트스토어 기준). 운영자 화면에는 철회 버튼을 두지 않고 이력만 본다. */
  it('운영자 화면에 고객 요청 철회 버튼을 두지 않고 철회 이력은 남긴다', () => {
    const open = render({ claim: { ...detail().claim, stage: 'requested' } });
    expect(open).not.toContain('고객 요청으로 철회');
    expect(open).not.toContain('요청 철회하기');
    const withdrawn = render({ claim: { ...detail().claim, stage: 'withdrawn' } });
    expect(withdrawn).toContain('요청 철회 이력');
  });

  it('목록으로 돌아가는 링크를 남긴다', () => {
    const html = render();

    expect(html).toContain('/admin/sales/claims/returns');
  });

  /* R8: 목록 위 팝업에서는 대화상자가 제목·닫기를 맡는다. 같은 처리 패널을 그대로 쓴다. */
  it('팝업(embedded)에서는 뒤로가기·제목 대신 전체 화면 링크를 두고 처리 패널은 그대로 그린다', () => {
    const html = renderToStaticMarkup(
      <ClaimDetailScreen
        backHref="/admin/sales/claims/returns?stage=open&page=1"
        cancellationForm={null}
        carriers={CARRIERS}
        detail={detail()}
        detailHref={`/admin/sales/claims/returns/${CLAIM_ID}?back=stage%3Dopen`}
        embedded
        now={NOW}
      />,
    );
    expect(html).not.toContain('← 목록으로');
    expect(html).not.toContain('<h2>');
    expect(html).toContain(`href="/admin/sales/claims/returns/${CLAIM_ID}?back=stage%3Dopen"`);
    expect(html).toContain('전체 화면으로 열기');
    expect(html).toContain('id="claim-process"');
    expect(html).toContain('반품 단계별 처리');
    expect(html).toContain('반품·교환 전환 및 이력');
  });
});

it('shows the actual gift requester and separate COD without suggesting a recipient refund', async () => {
  const { transactionDisplay } = await import('@/test/fixtures/cart-transaction');
  const base = detail();
  const html = renderToStaticMarkup(<ClaimDetailScreen backHref="/admin?tab=returns" carriers={CARRIERS} cancellationForm={null}
    detail={{ ...base, gift: { giftId: ORDER_ID, requesterRole: 'recipient', requesterName: '받는분 별명' },
      order: { ...base.order!, total: 16000, transaction: transactionDisplay } }} now={NOW} />);
  expect(html).toContain('받는분 별명 · 선물 받는 분'); expect(html).toContain('구매자의 결제수단');
  expect(html).toContain('계약상 착불 배송비'); expect(html).toContain('온라인 환불금액에 포함되지 않음');
});

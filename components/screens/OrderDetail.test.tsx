import { orderReshipmentReceipt } from '@/test/fixtures/order-reshipment';
import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrderDetail as OrderDetailData } from '@/lib/orders';
import { OrderDetail } from './OrderDetail';
import { reasonReceipt } from '@/lib/orders/claim-reason-change.fixture';
import { parseClaimReasonHistory } from '@/lib/orders/claim-reason-change';
import { transactionDisplay, transactionLineId } from '@/test/fixtures/cart-transaction';

/* 회수 계획은 서버 액션으로 문서를 읽는다 — 여기서는 주문 상세가 넘기는 배송 건 이름표만 본다(m27 CUST-2). */
vi.mock('@/components/orders/ClaimCollectionPlan', () => ({
  ClaimCollectionPlan: ({ shipmentLabels }: { shipmentLabels?: Readonly<Record<string, string>> }) =>
    <ul aria-label="회수 계획 이름표">{Object.entries(shipmentLabels ?? {}).map(([id, label]) => <li key={id}>{`${id}=${label}`}</li>)}</ul>,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/orders/11111111-1111-4111-8111-111111111111',
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock('@/app/checkout/draft-actions', () => ({ createCartRetryDraftAction: vi.fn(), createDirectRetryDraftAction: vi.fn(), closeDirectOrderAction: vi.fn() }));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function order(overrides: Partial<OrderDetailData> = {}): OrderDetailData {
  return {
    id: ORDER_ID,
    status: 'shipping',
    total: 30000,
    shippingFee: 3000,
    discountTotal: 0,
  storeCreditTotal: 0,
    paymentMethod: 'card',
    expiresAt: null,
    address: {
      recipientName: '김팬',
      phone: '01012345678',
      postalCode: '04799',
      address1: '서울 성동구 성수이로 1',
      address2: '101호',
      deliveryNote: '',
    },
    createdAt: '2026-08-01T06:00:00.000Z',
    deliveredAt: null,
    items: [{ id: 'item-1', variantId: '00000000-0000-4000-8000-000000000001', goodId: 'g13', name: '홍실 아크릴 블록', type: '아크릴 블록', qty: 1, unitPrice: 27000 }],
    payment: { amount: 30000, status: 'paid', createdAt: '2026-08-01T06:01:00.000Z' },
    refund: null,
    cancellationRequest: null,
    claimEligibility: { cancel: false, return: false, exchange: false },
    shipments: [shipmentFixture()],
    cardPacks: { issuedCount: 0, availableCount: 0 },
    ...overrides,
  };
}

describe('OrderDetail', () => {
  /* MY-01(10/14 S16): 주문 상세도 데스크톱 좌 메뉴 셸 안에 선다 — 영수증 지면은 셸 안 콘텐츠로 유지한다. */
  it('sits inside the mypage shell with orders as the current menu, keeping the receipt surface', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} />);
    const aside = html.slice(html.indexOf('aria-label="마이페이지 메뉴"'), html.indexOf('wc-mypage__content'));

    expect(html).toContain('<main class="wc-root wc-mypage">');
    expect(aside).toMatch(/aria-current="page" href="\/orders"|href="\/orders"[^>]*aria-current="page"/);
    expect(html).toContain('class="wc-receipt order-detail-page"');
    expect(html.indexOf('wc-mypage__content')).toBeLessThan(html.indexOf('wc-receipt order-detail-page'));
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('keeps the original purchase and actual exchange product in separate labeled sections', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ reshipmentHistory: [orderReshipmentReceipt] })} />);
    expect(html).toContain('주문한 굿즈'); expect(html).toContain('홍실 아크릴 블록');
    expect(html).toContain('교환으로 받은 굿즈'); expect(html).toContain('교환 출고 파랑 상품');
    expect(html).not.toContain('REPLACEMENT-BLUE');
  });

  it('교환 소포를 배송 묶음마다 택배사·운송장·배송조회로 보이고 회수 없이 보낸 소포를 안내한다(TKT-166)', () => {
    const parcel = { claimId: '93942000-0000-4000-8000-000000000011', reshipmentId: '93942000-0000-4000-8000-000000000021', carrier: 'hanjin', carrierLabel: '한진택배',
      trackingNumber: 'EXCHANGE0001', trackingUrl: 'https://carrier.example.test/track?no=EXCHANGE0001', reshippedAt: '2026-11-10T01:00:00.000Z', deliveredAt: null,
      collectionWaived: false, items: [{ orderItemId: '93942000-0000-4000-8000-000000000013', name: '교환 출고 파랑 상품', variantName: '파랑', qty: 1 }] };
    const html = renderToStaticMarkup(<OrderDetail order={order({ reshipmentHistory: [orderReshipmentReceipt], reshipmentParcels: [parcel,
      { ...parcel, reshipmentId: '93942000-0000-4000-8000-000000000022', trackingNumber: 'EXCHANGE0002', trackingUrl: 'https://carrier.example.test/track?no=EXCHANGE0002',
        collectionWaived: true, deliveredAt: '2026-11-11T01:00:00.000Z' }] })} />);
    expect(html).toContain('교환 배송 2건'); expect(html).toContain('EXCHANGE0001'); expect(html).toContain('EXCHANGE0002');
    expect(html).toContain('href="https://carrier.example.test/track?no=EXCHANGE0001"'); expect(html).toContain('href="https://carrier.example.test/track?no=EXCHANGE0002"');
    expect(html).toContain('회수 없이 다시 보내드려요'); expect(html).toContain('도착 확인'); expect(html).toContain('배송 중');
    expect(html).not.toContain('교환으로 받은 굿즈');
    /* 소포로 오지 않은 다른 교환(선물 받은 분 화면의 이 기능 전 교환)의 굿즈 이력은 소포 목록 아래에 그대로 남는다. */
    const older = { ...orderReshipmentReceipt, claimId: '93942000-0000-4000-8000-000000000031' };
    const mixed = renderToStaticMarkup(<OrderDetail order={order({ reshipmentHistory: [orderReshipmentReceipt, older], reshipmentParcels: [parcel] })} />);
    expect(mixed).toContain('교환 배송'); expect(mixed).toContain('교환으로 받은 굿즈');
    expect(mixed.match(/교환 출고 파랑 상품/g)).toHaveLength(2);
  });

  it('주문 내역에서도 온라인 결제금액과 착불·복수할인 원영수증을 유지한다', () => {
    const value = order({ transaction: transactionDisplay, total: 16000, shippingFee: 0, discountTotal: 1000, storeCreditTotal: 1000, giftId: ORDER_ID, address: null,
      items: [{ ...order().items[0], id: transactionLineId, goodId: 'renamed-good', qty: 2, unitPrice: 10000 }], shipments: [] });
    const html = renderToStaticMarkup(<OrderDetail order={value} />);
    /* MD-0037: 주문 상세 결제 정보는 '온라인 결제금액'을 '총 결제 금액'으로 말한다(금액·착불 분리는 그대로). */
    expect(html).toContain('총 결제 금액</dt><dd>₩16,000'); expect(html).toContain('총 부담금액</dt><dd>₩19,000'); expect(html).not.toContain('<dt>온라인 결제금액</dt>');
    expect(html).toContain('홍실 아크릴 블록 · 선결제 ₩0 · 착불 별도 ₩3,000'); expect(html).toContain('주소와 연락처는 받는 분만'); expect(html).not.toContain('배송지 정보를 확인할 수 없습니다.');
  });
  it('교환 사유의 정정 전후와 원접수를 표시하고 내부 협의 근거는 노출하지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} claimReasonHistory={parseClaimReasonHistory([reasonReceipt])} />);
    expect(html).toContain('교환 사유 정정 이력'); expect(html).toContain('최초 접수:');
    expect(html).toContain(reasonReceipt.fromReason); expect(html).toContain(reasonReceipt.toReason);
    expect(html).not.toContain(reasonReceipt.agreement); expect(html).not.toContain(reasonReceipt.actorId);
  });
  it('결제할 수 있는 결제 대기 카드 주문은 결제 화면에서 결제를 이어가게 한다', () => {
    const html=renderToStaticMarkup(<OrderDetail cardPayment={{ state: 'payable', closure: null, reorderMode: null, provider: 'toss' }} order={order({status:'pending',payment:null,shipments:[]})}/>);
    expect(html).toContain('결제를 기다리고 있어요');
    expect(html).toContain(`href="/checkout/${ORDER_ID}"`);
    expect(html).toContain('결제 이어가기');
  });

  /* QA-2: 거절·시도 만료로 닫힌 결제를 '확인 중'으로 말하면 청구가 진행 중인 것처럼 읽히고,
     이어갈 수 없는 결제를 '이어가기'로 안내하게 된다. 결제 화면과 같은 사실을 말한다. */
  it('승인 거절된 결제 대기 카드 주문은 다시 결제할 수 없다고 말하고 정리 액션으로 보낸다', () => {
    const html = renderToStaticMarkup(<OrderDetail
      cardPayment={{ state: 'payment_closed', closure: 'not_approved', reorderMode: 'cancel_then_reorder', provider: 'toss' }}
      order={order({ status: 'pending', payment: null, shipments: [], expiresAt: '2026-08-01T06:15:00.000Z' })}
    />);

    expect(html).toContain('이 주문은 다시 결제할 수 없어요');
    expect(html).toContain('주문 정리하고 다시 주문하기');
    expect(html).toContain(`href="/checkout/${ORDER_ID}"`);
    expect(html).not.toContain('결제 상태를 확인하고 있어요');
    expect(html).not.toContain('승인 확인 중');
    expect(html).not.toContain('진행 중인 결제를 확인해주세요');
    expect(html).not.toContain('이어가기');
  });

  /* 2026-10-12 QA-1: 결제 준비 후 유효 시간이 지난 주문도 거절 주문처럼 결제 화면의
     "취소하고 다시 주문하기"로 즉시 정리한다. */
  it('결제 시도가 만료된 결제 대기 카드 주문은 청구 없음을 말하고 거절 주문처럼 정리 액션으로 보낸다', () => {
    const html = renderToStaticMarkup(<OrderDetail
      cardPayment={{ state: 'payment_closed', closure: 'attempt_expired', reorderMode: 'cancel_then_reorder', provider: 'toss' }}
      order={order({ status: 'pending', payment: null, shipments: [], expiresAt: '2026-10-12T07:41:00.000Z' })}
    />);

    expect(html).toContain('결제 가능 시간이 지났어요');
    expect(html).toContain('청구된 금액은 없어요');
    expect(html).toContain('이 주문을 취소하고 같은 굿즈로 다시 주문해주세요');
    expect(html).toContain('주문 정리하고 다시 주문하기');
    expect(html).toContain(`href="/checkout/${ORDER_ID}"`);
    expect(html).not.toContain('몇 분 안에 자동으로 취소');
    expect(html).not.toContain('결제 상태를 확인하고 있어요');
    expect(html).not.toContain('진행 중인 결제를 확인해주세요');
    expect(html).not.toContain('이어가기');
  });

  it('즉시 취소가 확실하지 않은 시도 만료 주문은 결제 기한 뒤 자동 취소를 말하고 결제 화면으로 보내지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail
      cardPayment={{ state: 'payment_closed', closure: 'attempt_expired', reorderMode: null, provider: 'toss' }}
      order={order({ status: 'pending', payment: null, shipments: [], expiresAt: '2026-10-12T07:41:00.000Z' })}
    />);

    expect(html).toContain('결제 기한(16:41)');
    expect(html).not.toContain('주문 정리하고 다시 주문하기');
    expect(html).not.toContain('이어가기');
  });

  it('결제 국면을 읽지 못한 결제 대기 카드 주문은 상태를 단정하지 않고 결제 화면으로 잇는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'pending', payment: null, shipments: [] })} />);

    expect(html).toContain('결제 화면 보기');
    expect(html).not.toContain('결제 상태를 확인하고 있어요');
    expect(html).not.toContain('이어가기');
  });
  /* 처리 중인 취소가 있으면 DB가 결제를 막고, 승인과 겹친 취소는 승인된 결제를 취소하는
     중이다(INT-5). 결제 이어가기·주문 취소로 정리 안내는 둘 다 사실과 다르다. */
  it('처리 중인 취소가 있는 결제 대기 카드 주문에는 결제 이어가기 안내를 띄우지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({
      status: 'pending',
      payment: { amount: 30000, status: 'paid', createdAt: '2026-08-01T06:01:00.000Z' },
      shipments: [],
      cancellationRequest: {
        id: 'claim-1',
        status: 'processing',
        claimType: 'cancel',
        stage: 'processing',
        reference: 12,
        requestedAt: '2026-08-01T06:00:30.000Z',
        decidedAt: '2026-08-01T06:01:00.000Z',
        decisionNote: null,
        reshipCarrier: null,
        reshipTrackingNumber: null,
      },
    })} />);

    expect(html).not.toContain('결제 상태 확인·이어가기');
    expect(html).not.toContain('진행 중인 결제를 확인해주세요');
    expect(html).toContain('결제 취소 처리 중');
  });
  it('운송장이 등록되면 택배사·운송장번호와 배송조회 링크를 노출한다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} />);

    expect(html).toContain('한진택배');
    expect(html).toContain('운송장번호');
    expect(html).toContain('123456789012');
    expect(html).toContain('href="https://carrier.example.test/track?no=123456789012"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('운송장이 없으면 배송조회를 지어내지 않는다 — 처리 막대의 배송조회도 비활성 안내다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ shipments: [] })} />);

    expect(html).not.toContain('운송장번호');
    expect(html).not.toContain('carrier.example.test');
    /* 배송조회 링크(`<a>`)는 없고, 막대에는 disabled 버튼과 안내 줄만 있다(MD-0037). */
    expect(html).not.toMatch(/<a [^>]*>배송조회<\/a>/);
    expect(html).toMatch(/<button [^>]*disabled=""[^>]*>배송조회<\/button>/);
    expect(html).toContain('배송조회: 운송장이 등록되면 볼 수 있어요.');
  });

  it('굿즈 금액과 배송비를 분리해 스냅샷 그대로 보여준다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} />);

    expect(html).toContain('₩27,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩30,000');
  });

  /* 배송비 스냅샷은 주문 시점 값이다 — 정책이 바뀌어도 과거 영수증은 변하지 않는다. */
  it('배송비 스냅샷이 0인 과거 주문은 무료로 남는다', () => {
    const html = renderToStaticMarkup(
      <OrderDetail order={order({ shippingFee: 0, total: 27000, payment: null, shipments: [shipmentFixture({shippingFee:0})] })} />,
    );

    expect(html).toContain('무료');
    expect(html).not.toContain('₩3,000');
  });

  /* 사다리 표기(#250). 상태 배지 하나로는 지금이 어느 칸인지 알 수 없다. */
  it('진행 단계를 사다리 순서대로 보여주고 현재 칸을 표시한다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'confirmed' })} />);

    expect(html).toContain('aria-label="주문 진행 단계"');
    expect(html).toContain('order-status--confirmed');
    expect(html).toContain('aria-current="step"');
    // 지나온 칸 · 현재 칸 · 남은 칸이 구분돼야 한다.
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-state="current"');
    expect(html).toContain('data-state="upcoming"');
  });

  /* pending은 결제가 끝나지 않은 선점, canceled는 사다리를 벗어난 종결이다.
     지나갈 일이 없는 단계를 남은 단계로 그리면 잘못된 약속이 된다. */
  it.each(['pending', 'canceled'] as const)('%s 주문에는 진행 사다리를 그리지 않는다', (status) => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status })} />);

    expect(html).not.toContain('aria-label="주문 진행 단계"');
  });

  /* 기산점은 delivered_at이다 — 주문일도 발송일도 아니다(#189). 공급 전에 남은
     일수를 지어내면 아직 시작하지 않은 창을 카운트다운하게 된다. */
  it('배송완료 전에는 청약철회 기한이 아직 시작하지 않았다고 말한다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'shipping' })} />);

    expect(html).toContain('배송이 완료된 날부터 시작됩니다');
    expect(html).not.toContain('일 남음');
  });

  it('배송완료 주문에는 공급받은 날 기준 변심 7일 기한과 남은 일수를 보여준다', () => {
    const html = renderToStaticMarkup(
      <OrderDetail
        now={new Date('2026-08-06T06:00:00.000Z')}
        order={order({ status: 'delivered', deliveredAt: '2026-08-03T06:00:00.000Z' })}
      />,
    );

    expect(html).toContain('dateTime="2026-08-03T06:00:00.000Z"');
    expect(html).toContain('dateTime="2026-08-10T06:00:00.000Z"');
    expect(html).toContain('약 4일 남음');
  });

  it('변심 기한이 지나면 남은 일수 대신 하자 3개월 경로를 안내한다', () => {
    const html = renderToStaticMarkup(
      <OrderDetail
        now={new Date('2026-08-20T06:00:00.000Z')}
        order={order({ status: 'done', deliveredAt: '2026-08-03T06:00:00.000Z' })}
      />,
    );

    expect(html).toContain('단순 변심 반품·교환 기한이 지났습니다');
    expect(html).toContain('공급받은 날부터 3개월');
    expect(html).not.toContain('일 남음');
  });
});

describe('OrderDetail 무통장 입금 대기', () => {
  /*
   * 지금까지 입금 안내로 돌아가는 길은 알림 링크와 결제 화면뿐이었다. 구매자가
   * "얼마를 어디로 보내야 하지"를 다시 찾는 자리는 주문 내역이다.
   */
  it('아직 입금이 안 된 무통장 주문에 안내로 가는 길을 연다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'pending', paymentMethod: 'bank_transfer', total: 23000 })} />);

    expect(html).toContain('입금을 기다리고 있어요');
    /* QA1 S-D2-12: 제목이 카드 승인 확인 문구('결제 상태를 확인하고 있어요')와 같았다. */
    expect(html).toContain('<h1 class="wc-receipt__title">입금을 기다리고 있어요</h1>');
    expect(html).not.toContain('결제 상태를 확인하고 있어요');
    expect(html).toContain('>입금 대기</span>');
    expect(html).toContain('23,000');
    expect(html).toContain(`href="/checkout/${ORDER_ID}"`);
  });

  /* 계좌 값은 서버 설정에서만 읽는다(#255). 주문 내역이 두 번째 출처가 되면 안 된다. */
  it('계좌 정보를 주문 내역에 복제하지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'pending', paymentMethod: 'bank_transfer' })} />);

    expect(html).not.toContain('예금주');
    expect(html).not.toContain('계좌번호');
  });

  it('확정된 무통장 주문에는 입금 안내를 남기지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'paid', paymentMethod: 'bank_transfer' })} />);

    expect(html).not.toContain('입금을 기다리고 있어요');
  });

  it('카드 주문은 그대로다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'pending' })} />);

    expect(html).not.toContain('입금을 기다리고 있어요');
  });
});

 it('회수 계획은 배송 건 머리와 같은 택배사 이름표를 받는다(m27 CUST-2)', () => {
  const gimpo = shipmentFixture({ status: 'delivered', deliveredAt: '2026-09-08T00:00:00Z' });
  const namyangju = shipmentFixture({ id: '00000000-0000-4000-8000-000000044702', originName: '남양주', status: 'delivered', deliveredAt: '2026-09-09T00:00:00Z',
    carrier: 'epost', carrierLabel: '우체국택배', trackingNumber: '9876543210', trackingUrl: 'https://carrier.example.test/9876543210' });
  const claim = { id: '22222222-2222-4222-8222-222222222222', status: 'requested' as const, claimType: 'return' as const, stage: 'requested' as const, reference: 3,
    requestedAt: '2026-09-10T00:00:00.000Z', decidedAt: null, decisionNote: null, reshipCarrier: null, reshipTrackingNumber: null };
  const html = renderToStaticMarkup(<OrderDetail viewerId="33333333-3333-4333-8333-333333333333"
    order={order({ status: 'delivered', shipments: [gimpo, namyangju], cancellationRequest: claim })} />);
  expect(html).toContain('한진택배 배송 · 배송 완료');
  expect(html).toContain('우체국택배 배송 · 배송 완료');
  expect(html).toContain(`<li>${gimpo.id}=한진택배 배송</li>`);
  expect(html).toContain(`<li>${namyangju.id}=우체국택배 배송</li>`);
  expect(html).not.toContain('배송 묶음');
 });

 it('회수 계획 이름표는 배송 건 머리와 같은 규칙이다 — 같은 택배사 번호·택배 아닌 수령·택배사 모름', () => {
  const pickup = { method: 'pickup' as const, policy: null, providerName: null, canIssueReceipt: false };
  const shipments = [
    shipmentFixture({ id: '00000000-0000-4000-8000-000000044711' }),
    shipmentFixture({ id: '00000000-0000-4000-8000-000000044712', delivery: pickup }),
    shipmentFixture({ id: '00000000-0000-4000-8000-000000044713' }),
    shipmentFixture({ id: '00000000-0000-4000-8000-000000044714', carrier: null, carrierLabel: null, status: 'ready', trackingNumber: null, trackingUrl: null, shippedAt: null }),
  ];
  const claim = { id: '22222222-2222-4222-8222-222222222222', status: 'requested' as const, claimType: 'exchange' as const, stage: 'requested' as const, reference: 4,
    requestedAt: '2026-09-10T00:00:00.000Z', decidedAt: null, decisionNote: null, reshipCarrier: null, reshipTrackingNumber: null };
  const html = renderToStaticMarkup(<OrderDetail viewerId="33333333-3333-4333-8333-333333333333"
    order={order({ status: 'delivered', shipments, cancellationRequest: claim })} />);
  const headings = [...html.matchAll(/<section class="order-receipt-section wc-shipment-details"><h3>(.+?) · /g)].map(match => match[1]);
  const labels = [...html.matchAll(/<li>([0-9a-f-]{36})=(.+?)<\/li>/g)].map(match => match[2]);
  expect(headings).toEqual(['한진택배 배송 1', '배송 묶음 2', '한진택배 배송 2', '배송 묶음 4']);
  expect(labels).toEqual(headings);
 });

 it('두 출고지 배송을 각각 추적하고 각 배송 완료시각을 분리한다', () => {
  const shipments = [shipmentFixture({status:'delivered',deliveredAt:'2026-09-08T00:00:00Z'}),shipmentFixture({id:'00000000-0000-4000-8000-000000044702',originName:'남양주',trackingNumber:'9876543210',trackingUrl:'https://carrier.example.test/9876543210'})];
  const html = renderToStaticMarkup(<OrderDetail order={order({shipments})} />);
  /* 고객 화면은 출고지 이름 대신 배송 건의 택배사로 부르고, 같은 택배사면 번호를 붙인다(10/14 회의 S7 · R26). */
  expect(html).toContain('한진택배 배송 1 · 배송 완료');
  expect(html).toContain('한진택배 배송 2 · 배송 중');
  expect(html).toContain('123456789012');
  expect(html).toContain('9876543210');
  expect(html).toContain('한진택배 배송 1 배송조회');
  expect(html).toContain('한진택배 배송 2 배송조회');
  expect(html).not.toContain('김포');
  expect(html).not.toContain('남양주');
 });

/* 2026-10-12 브라우저 QA QA-8: 결제 취소가 도는 결제완료 주문의 상단 카드는 "배송 준비를
   시작합니다"가 아니라 취소 단계를 말한다. 상태 배지는 실제 주문 상태 그대로다. */
describe('진행 중인 취소의 상단 상태 카드', () => {
  const request = (stage: 'processing' | 'needs_review' | 'requested' | 'completed') => ({
    id: '22222222-2222-4222-8222-222222222222',
    status: stage,
    claimType: 'cancel' as const,
    stage,
    reference: 12,
    requestedAt: '2026-08-01T07:00:00.000Z',
    decidedAt: null,
    decisionNote: null,
    reshipCarrier: null,
    reshipTrackingNumber: null,
  });

  it.each([
    ['needs_review', '주문 취소를 확인하고 있어요'],
    ['processing', '주문 취소를 진행하고 있어요'],
    ['requested', '주문 취소 요청을 접수했어요'],
  ] as const)('%s 취소가 있는 결제완료 주문은 배송 준비를 약속하지 않는다', (stage, title) => {
    const html = renderToStaticMarkup(<OrderDetail order={order({
      status: 'paid', shipments: [], cancellationRequest: request(stage),
    })} />);

    expect(html).toContain(title);
    expect(html).not.toContain('결제가 확인됐고 배송 준비를 시작합니다');
    expect(html).toContain('order-status--paid');
  });

  it('취소가 끝났거나 없는 주문은 기존 상태 문구를 쓴다', () => {
    const none = renderToStaticMarkup(<OrderDetail order={order({ status: 'paid', shipments: [] })} />);
    expect(none).toContain('결제가 확인됐고 배송 준비를 시작합니다');

    const done = renderToStaticMarkup(<OrderDetail order={order({
      status: 'canceled', shipments: [], cancellationRequest: request('completed'),
    })} />);
    expect(done).toContain('취소된 주문이에요');
  });
});

/* 10/14 회의 S20·S21 */
describe('OrderDetail claim badge and line totals', () => {
  it('shows the same claim badge as the order list in the header', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'paid', cancellationRequest: {
      id: '22222222-2222-4222-8222-222222222222', status: 'requested', claimType: 'cancel', stage: 'requested', reference: 1,
      requestedAt: '2026-08-01T07:00:00.000Z', decidedAt: null, decisionNote: null, reshipCarrier: null, reshipTrackingNumber: null,
    } })} />);
    expect(html).toMatch(/<div class="order-detail-status-row"><span class="order-status order-status--paid">주문 완료<\/span><span class="order-list-badge order-claim-badge">취소 요청<\/span><\/div>/);
  });

  /* MD-0037: 품목 줄은 주문내역 카드와 같은 OrderLineItem이다 — 줄 가격은 단가가 아니라 수량을 곱한 구매가격이다(주문 단위 쿠폰·적립금은 결제 정보에서만). */
  it('shows each item line price as the unit price times the quantity', () => {
    const single = renderToStaticMarkup(<OrderDetail order={order()} />);
    expect(single).toContain('<p class="wc-order-line__qty">1개</p>'); expect(single).toContain('<strong>₩27,000</strong>');
    const double = renderToStaticMarkup(<OrderDetail order={order({ items: [{ id: 'item-1', variantId: '00000000-0000-4000-8000-000000000001', goodId: 'g13', name: '홍실 아크릴 블록', type: '아크릴 블록', qty: 2, unitPrice: 27000 }] })} />);
    expect(double).toContain('<p class="wc-order-line__qty">2개</p>'); expect(double).toContain('<strong>₩54,000</strong>');
  });
});

/* 디지털 전용 주문은 교환을 받지 않는다 — 기한 안내도 실제 절차(취소·환불 검토 요청)로 말한다. */
describe('OrderDetail digital-only deadline wording', () => {
  const downloads = { orderId: ORDER_ID, canCancel: false, reviewRequired: false,
    items: [{ itemId: 'item-1', name: '디지털 파일', files: [], available: true, firstProvidedAt: '2026-08-03T06:00:00.000Z' }] };

  it('names the cancel and refund review instead of return or exchange', () => {
    const before = renderToStaticMarkup(<OrderDetail downloads={downloads} order={order({ status: 'paid' })} />);
    expect(before).toContain('단순 변심 취소·환불 검토 요청 기한');
    expect(before).not.toContain('반품·교환 기한');

    const expired = renderToStaticMarkup(<OrderDetail downloads={downloads} now={new Date('2026-08-20T06:00:00.000Z')}
      order={order({ status: 'done', deliveredAt: '2026-08-03T06:00:00.000Z' })} />);
    expect(expired).toContain('단순 변심 취소·환불 검토 요청 기한이 지났습니다. 파일 하자·오제공은');
  });
});

describe('OrderDetail 리뷰 칸 (ADR-0035 리뷰 등록 = 구매확정)', () => {
  it('구매확정할 수 없어 막힌 리뷰는 그 이유(보류 사유 포함)를 보이고, 작성 시작 전이면 시작일이 먼저다', () => {
    const target = { orderId: ORDER_ID, goodId: 'g13', goodName: '홍실 아크릴 블록', goodBg: null, orderedAt: '2026-08-01T06:00:00.000Z',
      deliveredAt: '2026-08-03T06:00:00.000Z', deadlineAt: '2026-09-02T06:00:00.000Z', writable: false, review: null, kind: 'ordinary' as const };
    const render = (purchaseConfirmation: unknown, opensAt?: string) => renderToStaticMarkup(<OrderDetail now={new Date('2026-08-05T06:00:00.000Z')}
      order={order({ status: 'delivered', deliveredAt: '2026-08-03T06:00:00.000Z' })}
      reviewTargets={[{ ...target, opensAt: opensAt ?? null, purchaseConfirmation } as never]} />);
    expect(render({ required: true, block: 'held', holdReason: '사진 확인 중' })).toContain('이 주문의 구매확정이 보류되어 있습니다(사유: 사진 확인 중).');
    expect(render({ required: true, block: 'claim_in_progress', holdReason: null })).toContain('취소·반품·교환 신청이 진행 중인 주문은 구매확정할 수 없어');
    expect(render({ required: false, block: null, holdReason: null })).toContain('현재 작성할 수 없습니다');
    expect(render({ required: true, block: 'held', holdReason: null }, '2026-08-10T06:00:00.000Z')).toContain('부터 작성 가능');
  });
});

/* QA1 S-D2-15: 결제 없이 취소된 주문의 상세에 다시 결제 진입이 없었다. */
describe('OrderDetail 다시 결제 진입', () => {
  it('결제 없이 취소된 장바구니 주문은 그 주문의 줄로 다시 결제한다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'canceled', payment: null })}
      retry={{ source: 'cart', awaitingPayment: false, paymentUnresolved: false, baseGoodId: null, retryOrderId: null }} />);
    expect(html).toContain('결제가 끝나지 않아 결제 없이 취소된 주문이에요');
    expect(html).toContain('이 주문의 굿즈 가운데 장바구니에 남은 것만 골라 주문서를 다시 열 수 있어요.');
    expect(html).toContain('<button class="btn btn-holo" type="button">다시 결제하기</button>');
  });

  it('결제 없이 취소된 바로구매 주문은 같은 구성으로 다시 구매하고 굿즈 상세로도 잇는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'canceled', payment: null })}
      retry={{ source: 'direct', awaitingPayment: false, paymentUnresolved: false, baseGoodId: 'g13', retryOrderId: null }} />);
    expect(html).toContain('<button class="btn btn-holo" type="button">다시 구매하기</button>');
    expect(html).toContain('href="/shop/g13">굿즈 상세에서 다시 고르기</a>');
  });

  it('진입이 없으면 그대로다', () => {
    expect(renderToStaticMarkup(<OrderDetail order={order({ status: 'canceled' })} />)).not.toContain('결제 없이 취소된 주문이에요');
  });
});

describe('OrderDetail 부분 취소 뒤 표시(QA2)', () => {
  const partial = {
    id: 'cccccccc-0000-4000-8000-000000000001', sequence: 1, state: 'completed' as const, provider: 'toss' as const, refundAmount: 9_500, goodsRefundAmount: 9_500,
    shippingRefundAmount: 0, storeCreditRestoreAmount: 0, createdAt: '2026-11-12T05:00:00Z', appliedAt: '2026-11-12T05:00:05Z',
    completedAt: '2026-11-12T05:00:05Z', transferredAt: null, closedShipmentCount: 0,
    items: [{ orderItemId: 'item-1', goodName: '홍실 아크릴 블록', variantName: null, qty: 1, goodsRefundAmount: 9_500 }],
  };
  const twoQty = order({ items: [{ id: 'item-1', variantId: '00000000-0000-4000-8000-000000000001', goodId: 'g13', name: '홍실 아크릴 블록', type: '아크릴 블록', qty: 2, unitPrice: 13_500 }] });

  it('굿즈 줄과 배송 묶음 카드는 남은 수량을 말하고 취소된 수량을 적는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={twoQty} partialCancellations={[partial]} />);
    /* 줄은 남은 수량과 그 수량의 구매가격(13,500 × 1)을 말하고, 취소된 몫은 줄 아래에 따로 적는다. */
    expect(html).toContain('<p class="wc-order-line__qty">1개</p>'); expect(html).toContain('<strong>₩13,500</strong>');
    expect(html).toContain('<p class="wc-order-line__canceled" data-order-item-canceled="1">· 1개 취소됨</p>');
    expect(html).toContain('홍실 아크릴 블록 × 1 (1개 취소됨)');
    expect(html).not.toContain('× 2');
  });

  it('결제 금액 칸에 부분 취소 환불 합계와 남은 결제 금액을 보인다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={twoQty} partialCancellations={[partial]} />);
    expect(html).toContain('부분 취소 환불 합계');
    expect(html).toContain('−₩9,500');
    expect(html).toContain('남은 결제 금액');
    expect(html).toContain('₩20,500');
  });

  it('부분 취소가 없으면 두 줄도 취소 표시도 없다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={twoQty} />);
    expect(html).not.toContain('부분 취소 환불 합계');
    expect(html).not.toContain('취소됨');
  });

  it("'송금 완료' 줄은 부분 취소 적용 시각이 아니라 송금 완료 시각을 쓴다", () => {
    const html = renderToStaticMarkup(<OrderDetail order={twoQty} partialCancellations={[{ ...partial, provider: 'bank_transfer', completedAt: '2026-11-13T01:00:00Z', transferredAt: '2026-11-13T02:30:00Z' }]} />);
    expect(html).toContain('환불계좌로 송금 완료');
    expect(html).toContain('dateTime="2026-11-13T02:30:00Z"');
    expect(html).not.toContain('dateTime="2026-11-12T05:00:05Z"');
  });
});

/* ---------------------------------------------------------------------------
 * MD-0037·0038 주문 상세 개편: 주문자 정보 → 주문 정보(+처리 막대) → 배송지 정보 → 결제 정보
 * ------------------------------------------------------------------------- */

const ORDERER = { name: '김팬', email: 'fan@example.test', maskedPhone: '010-****-5678' };
const tossPayment = { amount: 30000, status: 'paid', createdAt: '2026-08-01T06:01:00.000Z', provider: 'toss' };
const ORDER_ITEM = { id: 'item-1', variantId: '00000000-0000-4000-8000-000000000001', goodId: 'g13', name: '홍실 아크릴 블록', type: '아크릴 블록', qty: 1, unitPrice: 27000 };

describe('OrderDetail 주문자·주문 정보 카드(MD-0037)', () => {
  it('주문자 정보는 이름·이메일·휴대폰을 보이고, 값이 없는 행은 생략한다', () => {
    const full = renderToStaticMarkup(<OrderDetail order={order()} orderer={ORDERER} />);
    const card = full.slice(full.indexOf('id="orderer-info-heading"'), full.indexOf('id="order-info-heading"'));
    expect(card).toContain('주문자 정보'); expect(card).toContain('<dt>이름</dt><dd>김팬</dd>');
    expect(card).toContain('<dt>이메일</dt><dd>fan@example.test</dd>'); expect(card).toContain('<dt>휴대폰</dt><dd>010-****-5678</dd>');

    const bare = renderToStaticMarkup(<OrderDetail order={order()} orderer={{ name: '회원', email: null, maskedPhone: null }} />);
    expect(bare).toContain('<dt>이름</dt><dd>회원</dd>'); expect(bare).not.toContain('<dt>이메일</dt>'); expect(bare).not.toContain('<dt>휴대폰</dt>');
  });

  it('주문자 정보를 읽지 못했으면(null·미전달) 카드를 그리지 않고 주문 정보 카드만 전폭으로 둔다', () => {
    for (const html of [renderToStaticMarkup(<OrderDetail order={order()} />), renderToStaticMarkup(<OrderDetail order={order()} orderer={null} />)]) {
      expect(html).not.toContain('주문자 정보'); expect(html).toContain('order-detail-overview order-detail-overview--single');
    }
  });

  it('주문 정보는 주문번호·주문일시·주문 상태 세 행이다(헤더의 `ORDER ·` 줄은 없다)', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ orderNumber: 'ICN-20261117-0001' })} orderer={ORDERER} />);
    const card = html.slice(html.indexOf('id="order-info-heading"'), html.indexOf('aria-label="주문 처리"'));
    expect(card).toContain('<dt>주문번호</dt>'); expect(card).toContain('<dt>주문일시</dt>'); expect(card).toContain('<dt>주문 상태</dt><dd>배송중</dd>');
    expect(card).toContain('<time dateTime="2026-08-01T06:00:00.000Z">2026. 8. 1. 15:00</time>');
    expect(html).not.toContain('ORDER ·'); expect(html).not.toContain('order-detail-meta');
  });

  it('섹션 순서는 주문자 정보 → 주문 정보 → 배송지 정보 → 결제 정보다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} orderer={ORDERER} paymentDisplay={null} />);
    const positions = ['id="orderer-info-heading"', 'id="order-info-heading"', 'id="shipping-address-heading"', 'id="payment-summary-heading"'].map((marker) => html.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('>배송지 정보</h3>'); expect(html).not.toContain('>배송지</h3>');
  });

  it('처리 막대는 주문 정보 카드 안에 있고 pending·canceled 주문에는 없다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'delivered', deliveredAt: '2026-08-03T06:00:00.000Z', claimEligibility: { cancel: false, return: true, exchange: true } })} orderer={ORDERER} viewerId="user-1" />);
    expect(html.indexOf('id="order-info-heading"')).toBeLessThan(html.indexOf('aria-label="주문 처리"'));
    expect(html.indexOf('aria-label="주문 처리"')).toBeLessThan(html.indexOf('id="shipping-address-heading"'));
    for (const status of ['pending', 'canceled'] as const) {
      expect(renderToStaticMarkup(<OrderDetail order={order({ status, payment: null, shipments: [] })} />)).not.toContain('aria-label="주문 처리"');
    }
  });
});

describe('OrderDetail 처리 막대 앵커(MD-0037)', () => {
  const target = { orderId: ORDER_ID, goodId: 'g13', goodName: '홍실 아크릴 블록', goodBg: null, orderedAt: '2026-08-01T06:00:00.000Z',
    deliveredAt: '2026-08-03T06:00:00.000Z', deadlineAt: '2026-11-01T06:00:00.000Z', writable: true, review: null, kind: 'ordinary' as const };
  const delivered = () => order({ status: 'delivered', deliveredAt: '2026-08-03T06:00:00.000Z', claimEligibility: { cancel: false, return: true, exchange: true }, payment: tossPayment });

  it('막대가 가리키는 자리 id(리뷰·구매확정·반품교환·배송 묶음·결제 정보)가 모두 있다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={delivered()} reviewTargets={[target]} viewerId="user-1" now={new Date('2026-08-05T06:00:00.000Z')} />);
    for (const id of ['order-review', 'order-purchase-confirmation', 'order-claim-request', 'order-shipments', 'order-payment']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('href="#order-purchase-confirmation"'); expect(html).toContain('href="#order-claim-request"');
    /* 구매확정 버튼은 패널의 확인 절차를 거친다 — 막대는 확정하지 않고 패널로만 보낸다. */
    expect(html).toContain('<section class="purchase-confirmation" aria-label="구매확정">');
  });

  it('쓸 수 있는 리뷰 대상이 둘이면 리뷰 칸 앵커로, 하나면 작성 화면으로 보낸다', () => {
    const two = renderToStaticMarkup(<OrderDetail order={delivered()} reviewTargets={[target, { ...target, goodId: 'g14', goodName: '홍실 키링' }]} viewerId="user-1" />);
    expect(two).toContain('href="#order-review"');
    const one = renderToStaticMarkup(<OrderDetail order={delivered()} reviewTargets={[target]} viewerId="user-1" />);
    expect(one).toContain(`href="/my/reviews/new?orderId=${ORDER_ID}&amp;goodId=g13"`);
  });

  it('진행 중인 취소 클레임이 있으면 반품·교환 패널이 없으니 같은 앵커를 열어 두지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'paid', shipments: [], cancellationRequest: {
      id: '22222222-2222-4222-8222-222222222222', status: 'processing', claimType: 'cancel', stage: 'processing', reference: 1, requestedAt: '2026-08-01T07:00:00.000Z',
      decidedAt: null, decisionNote: null, reshipCarrier: null, reshipTrackingNumber: null } })} />);
    expect(html).not.toContain('id="order-claim-request"'); expect(html).not.toContain('href="#order-claim-request"');
  });
});

describe('OrderDetail 진행 단계·상태 라벨(고객 라벨)', () => {
  const ladder = (html: string) => [...html.slice(html.indexOf('aria-label="주문 진행 단계"'), html.indexOf('</ol>')).matchAll(/<li [^>]*>([^<]*)<\/li>/g)].map((match) => match[1]);

  it('사다리는 고객 라벨(주문 완료·발주확인·배송중·배송완료·구매 확정)을 쓴다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'confirmed' })} />);
    expect(ladder(html)).toEqual(['주문 완료', '발주확인', '배송중', '배송완료', '구매 확정']);
    /* 헤더·사다리·주문 정보 칸에는 어드민 이름('결제완료'·'거래확정')이 없다 — 결제 정보의 '결제 상태'는 결제 원장 용어라 따로다. */
    const upper = html.slice(0, html.indexOf('order-detail-layout'));
    expect(upper).not.toContain('결제완료'); expect(upper).not.toContain('거래확정'); expect(upper).toContain('<dt>주문 상태</dt><dd>발주확인</dd>');
  });

  it('디지털 전용 주문은 주문 완료 → 파일 제공 시작 → 구매 확정, 배지·주문 상태 칸도 같은 이름이다', () => {
    const downloads = { orderId: ORDER_ID, canCancel: false, reviewRequired: false,
      items: [{ itemId: 'item-1', name: '디지털 파일', files: [], available: true, firstProvidedAt: '2026-08-03T06:00:00.000Z' }] };
    const paid = renderToStaticMarkup(<OrderDetail downloads={downloads} order={order({ status: 'paid' })} orderer={ORDERER} />);
    expect(ladder(paid)).toEqual(['주문 완료', '파일 제공 시작', '구매 확정']);
    expect(paid).toContain('order-status order-status--paid">주문 완료</span>'); expect(paid).toContain('<dt>주문 상태</dt><dd>주문 완료</dd>');
    const done = renderToStaticMarkup(<OrderDetail downloads={downloads} order={order({ status: 'done', deliveredAt: '2026-08-03T06:00:00.000Z' })} orderer={ORDERER} />);
    expect(done).toContain('<dt>주문 상태</dt><dd>구매 확정</dd>'); expect(done).not.toContain('구매확정</span>');
    const started = renderToStaticMarkup(<OrderDetail downloads={downloads} order={order({ status: 'delivered', deliveredAt: '2026-08-03T06:00:00.000Z' })} orderer={ORDERER} />);
    expect(started).toContain('<dt>주문 상태</dt><dd>파일 제공 시작</dd>');
    /* 디지털 전용 주문의 처리 막대는 구매확정·리뷰작성만 둔다. */
    expect(started).toContain('data-count="2"'); expect(started).not.toContain('교환반품 접수');
  });
});

describe('OrderDetail 결제 정보(MD-0037·0038)', () => {
  const display = { provider: 'toss', method: '카드', detail: '4330********1234', approvedAt: '2026-08-01T06:01:00.000Z' };
  const paymentSection = (html: string) => html.slice(html.indexOf('id="order-payment"'), html.indexOf('</aside>'));

  it('결제수단 → 금액 → 결제 상태·일시 순서로 보이고 섹션은 영수증 실패 앵커 id를 가진다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ payment: tossPayment, status: 'paid' })} paymentDisplay={display} />);
    const section = paymentSection(html);
    expect(html).toContain('<section class="order-receipt-section" id="order-payment"');
    expect(section).toContain('<dt>결제수단</dt><dd>신용·체크카드 (4330********1234)</dd>');
    const positions = ['결제수단', '총 굿즈 금액', '총 결제 금액', '결제 상태', '결제 일시'].map((label) => section.indexOf(`<dt>${label}</dt>`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(section).toContain('<dt>결제 상태</dt><dd>결제완료</dd>'); expect(section).toContain('<time dateTime="2026-08-01T06:01:00.000Z">2026. 8. 1. 15:01</time>');
    expect(section).not.toContain('확인 시각'); expect(section).not.toContain('<dt>금액</dt>');
  });

  it('결제수단 라벨: 근거가 없으면 `카드·간편결제`, 간편결제는 결제사 이름, 무통장은 `무통장 입금`', () => {
    expect(paymentSection(renderToStaticMarkup(<OrderDetail order={order({ payment: tossPayment })} />))).toContain('<dt>결제수단</dt><dd>카드·간편결제</dd>');
    expect(paymentSection(renderToStaticMarkup(<OrderDetail order={order({ payment: tossPayment })} paymentDisplay={{ ...display, method: '간편결제', detail: '네이버페이' }} />))).toContain('<dd>간편결제 (네이버페이)</dd>');
    expect(paymentSection(renderToStaticMarkup(<OrderDetail order={order({ paymentMethod: 'bank_transfer', payment: null })} />))).toContain('<dt>결제수단</dt><dd>무통장 입금</dd>');
  });

  it('v1 주문(영수증 없음)은 총 굿즈 금액·쿠폰 할인 금액·보유 적립금 사용·총 결제 금액 네 라벨을 쓴다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ shippingFee: 3000, total: 24000, discountTotal: 2000, storeCreditTotal: 4000 })} />);
    const section = paymentSection(html);
    expect(section).toContain('<dt>총 굿즈 금액</dt><dd>₩27,000</dd>'); expect(section).toContain('<dt>쿠폰 할인 금액</dt><dd>−₩2,000</dd>');
    expect(section).toContain('<dt>보유 적립금 사용</dt><dd>−₩4,000</dd>'); expect(section).toContain('<dt>총 결제 금액</dt><dd>₩24,000</dd>');
    for (const old of ['<dt>굿즈 금액</dt>', '<dt>쿠폰 할인</dt>', '<dt>적립금 사용</dt>']) expect(section).not.toContain(old);
  });

  it('v2 주문(영수증 있음)은 합계 표의 같은 네 라벨을 쓴다', () => {
    const value = order({ transaction: transactionDisplay, total: 16000, shippingFee: 0, discountTotal: 1000, storeCreditTotal: 1000, payment: tossPayment,
      items: [{ ...ORDER_ITEM, id: transactionLineId, goodId: 'renamed-good', qty: 2, unitPrice: 10000 }] });
    const section = paymentSection(renderToStaticMarkup(<OrderDetail order={value} />));
    for (const label of ['총 굿즈 금액', '쿠폰 할인 금액', '보유 적립금 사용', '총 결제 금액']) expect(section).toContain(`<dt>${label}</dt>`);
    expect(section).not.toContain('<dt>온라인 결제금액</dt>');
  });

  it.each([
    ['토스 카드 결제완료', { payment: tossPayment, status: 'paid' as const }, true],
    ['취소된 토스 결제의 영수증도 남는다', { payment: { ...tossPayment, status: 'canceled' }, status: 'canceled' as const }, true],
    ['결제 provider가 영수증을 지원하지 않는 카드 주문', { payment: { ...tossPayment, provider: 'korpay' }, status: 'paid' as const }, false],
    ['provider를 모르는 옛 결제 응답', { payment: { amount: 30000, status: 'paid', createdAt: '2026-08-01T06:01:00.000Z' }, status: 'paid' as const }, false],
    ['결제 전 주문', { payment: null, status: 'pending' as const }, false],
  ])('결제 영수증 버튼: %s → %s', (_name, overrides, visible) => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ shipments: [], ...overrides })} />);
    const link = `<a class="btn btn-ghost btn-sm" href="/orders/${ORDER_ID}/receipt" rel="noopener noreferrer" target="_blank">결제 영수증</a>`;
    expect(html.includes(link)).toBe(visible);
  });

  it('거래명세서 버튼은 결제가 끝나고 취소되지 않은 주문(paid~done)에만 있다', () => {
    const link = `<a class="btn btn-ghost btn-sm" href="/orders/${ORDER_ID}/statement" rel="noopener" target="_blank">거래명세서</a>`;
    for (const status of ['paid', 'confirmed', 'shipping', 'delivered', 'done'] as const) {
      expect(renderToStaticMarkup(<OrderDetail order={order({ status, payment: tossPayment, shipments: [] })} />)).toContain(link);
    }
    for (const status of ['pending', 'canceled'] as const) {
      expect(renderToStaticMarkup(<OrderDetail order={order({ status, payment: status === 'canceled' ? { ...tossPayment, status: 'canceled' } : null, shipments: [] })} />)).not.toContain('거래명세서</a>');
    }
  });

  it('무통장 주문은 영수증 버튼 없이 거래명세서만 두고 안내 문장을 보인다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ paymentMethod: 'bank_transfer', status: 'paid', payment: { ...tossPayment, provider: 'bank_transfer' }, shipments: [] })} />);
    expect(html).not.toContain('>결제 영수증</a>'); expect(html).toContain('>거래명세서</a>');
    expect(html).toContain('무통장 입금 주문은 결제사 영수증 대신 거래명세서로 거래 내용을 확인할 수 있어요.');
    expect(renderToStaticMarkup(<OrderDetail order={order({ payment: tossPayment, shipments: [] })} />)).not.toContain('결제사 영수증 대신');
    /* 아직 입금 전이라 거래명세서가 없으면 없는 버튼을 가리키는 안내도 하지 않는다. */
    expect(renderToStaticMarkup(<OrderDetail order={order({ paymentMethod: 'bank_transfer', status: 'pending', payment: null, shipments: [] })} />)).not.toContain('결제사 영수증 대신');
  });

  it('?receipt=unavailable로 돌아오면 버튼 줄 위에 role=status 안내를 보인다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ payment: tossPayment, shipments: [] })} receiptNotice />);
    const notice = '<p class="order-payment-notice" role="status">결제 영수증을 지금 불러오지 못했어요. 잠시 후 다시 시도하거나 아래 &#x27;이 주문 문의하기&#x27;로 요청해주세요.</p>';
    expect(html).toContain(notice);
    expect(html.indexOf(notice)).toBeLessThan(html.indexOf('class="order-payment-actions"'));
    expect(html.indexOf('id="order-payment"')).toBeLessThan(html.indexOf(notice));
    expect(renderToStaticMarkup(<OrderDetail order={order({ payment: tossPayment, shipments: [] })} />)).not.toContain('order-payment-notice');
  });
});

describe('OrderDetail 품목 줄(MD-0036·0037 OrderLineItem 재사용)', () => {
  const line = { key: 'item-1', goodId: 'g13', name: '홍실 아크릴 블록', optionName: '파랑', qty: 1, ipName: '홍실', thumbnail: null, adultMasked: false, purchaseAmount: 24000, regularAmount: 27000 };

  it('읽기 모델의 줄이 있으면 IP명·옵션·구매가격과 정가 취소선을 그린다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ lines: [line] })} />);
    expect(html).toContain('class="wc-order-line__ip">홍실</p>'); expect(html).toContain('class="wc-order-line__option">옵션 파랑</p>');
    expect(html).toContain('<strong>₩24,000</strong>'); expect(html).toContain('<del>₩27,000</del>');
  });

  it('IP명이 없으면 굿즈 유형이 그 자리에 보이고, 있으면 유형은 보이지 않는다', () => {
    expect(renderToStaticMarkup(<OrderDetail order={order({ lines: [{ ...line, ipName: null }] })} />)).toContain('class="wc-order-line__ip">아크릴 블록</p>');
    expect(renderToStaticMarkup(<OrderDetail order={order({ lines: [line] })} />)).not.toContain('class="wc-order-line__ip">아크릴 블록</p>');
  });

  it('읽기 모델이 없는 품목은 스냅샷(이름·옵션·단가×수량)으로 줄을 만든다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ items: [{ ...ORDER_ITEM, qty: 3, variantName: '기본 옵션' }] })} />);
    expect(html).toContain('class="wc-order-line__name">홍실 아크릴 블록</p>'); expect(html).toContain('<strong>₩81,000</strong>'); expect(html).toContain('<p class="wc-order-line__qty">3개</p>');
    expect(html).not.toContain('wc-order-line__option');
  });

  it('부분 취소 뒤에는 남은 수량의 구매가격(정가 포함)을 말하고 취소 수량을 줄 아래에 적는다', () => {
    const partial = { id: 'cccccccc-0000-4000-8000-000000000001', sequence: 1, state: 'completed' as const, provider: 'toss' as const, refundAmount: 24000, goodsRefundAmount: 24000,
      shippingRefundAmount: 0, storeCreditRestoreAmount: 0, createdAt: '2026-11-12T05:00:00Z', appliedAt: '2026-11-12T05:00:05Z', completedAt: '2026-11-12T05:00:05Z',
      transferredAt: null, closedShipmentCount: 0, items: [{ orderItemId: 'item-1', goodName: '홍실 아크릴 블록', variantName: null, qty: 1, goodsRefundAmount: 24000 }] };
    const html = renderToStaticMarkup(<OrderDetail order={order({ items: [{ ...ORDER_ITEM, qty: 2 }], lines: [{ ...line, qty: 2, purchaseAmount: 48000, regularAmount: 54000 }] })} partialCancellations={[partial]} />);
    expect(html).toContain('<p class="wc-order-line__qty">1개</p>'); expect(html).toContain('<strong>₩24,000</strong>'); expect(html).toContain('<del>₩27,000</del>');
    expect(html).toContain('data-order-item-canceled="1">· 1개 취소됨</p>');
    /* 전부 취소된 줄은 0개 줄 없이 `{원래 수량}개 취소됨`만 말하고 없는 수량의 가격을 지어내지 않는다. */
    const all = renderToStaticMarkup(<OrderDetail order={order({ items: [{ ...ORDER_ITEM, qty: 1 }], lines: [line] })} partialCancellations={[{ ...partial, items: [{ ...partial.items[0], qty: 1 }] }]} />);
    expect(all).not.toContain('<p class="wc-order-line__qty">0개</p>'); expect(all).not.toContain('wc-order-line__qty');
    expect(all).toContain('<p class="wc-order-line__canceled" data-order-item-canceled="1">1개 취소됨</p>');
    expect(all).not.toContain('<strong>₩24,000</strong>'); expect(all).not.toContain('wc-order-line__price');
  });
});

import { shipmentDeliveryFixture } from '@/lib/shipment-delivery.fixture';
import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminOrderDetail } from '@/lib/admin/order-detail';
import { OrderDetailScreen } from './OrderDetailScreen';
import { ORDER_DETAIL_HELP } from '@/lib/admin/help/order-detail';
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false] };
});
vi.mock('@/app/admin/order-note-actions', () => ({ addOrderNoteAction: vi.fn() }));
vi.mock('@/app/admin/virtual-account-refund-actions', () => ({ resolveVirtualAccountRefundAction: vi.fn() }));
vi.mock('next/navigation', async () => ({ ...await vi.importActual<object>('next/navigation'), useRouter: () => ({ refresh: vi.fn() }) }));
const ORDER = '10000000-0000-4000-8000-000000004141';
const detail: AdminOrderDetail = {
  emailJobs: [],
  order: { id: ORDER, userId: 'buyer', buyerName: '주문자', buyerEmail: 'buyer@example.test',
    status: 'shipping', total: 12800, shippingFee: 3000, discountTotal: 200, storeCreditTotal: 0,
    createdAt: '2026-09-01T00:00:00Z',
    address: { recipientName: '수령자', phone: '01012345678', postalCode: '12345', address1: '서울시', address2: '101호' } },
  shipments: [shipmentFixture()],
  items: [{ variantId: '00000000-0000-4000-8000-000000000001', id: 'item', name: '주문 당시 상품명', qty: 2, unitPrice: 5000 }],
  timeline: [
    { id: 'one', source: 'payment', occurredAt: '2026-09-01T01:00:00Z', action: 'recorded', amount: 12800, status: 'paid', provider: 'korpay' },
    { id: 'two', source: 'status', occurredAt: '2026-09-01T02:00:00Z', action: 'admin.order.status_updated', fromStatus: 'paid', toStatus: 'confirmed', actorName: '수민' },
    { id: 'three', source: 'inquiry', occurredAt: '2026-09-01T03:00:00Z', action: 'created', title: '배송 확인', relatedId: '40000000-0000-4000-8000-000000004141', status: 'open' },
    { id: 'four', source: 'note', occurredAt: '2026-09-01T04:00:00Z', action: 'admin.order.note', body: '물류팀 확인 필요', actorName: '지우' },
  ],
};
describe('주문 상세', () => {
  /* m27 D5②: 랜덤 판매 품목은 배정된 옵션명 옆에 '랜덤 배정' 배지를 둔다. 고른 옵션 품목에는 두지 않는다. */
  it('랜덤 배정 품목은 배정된 옵션명 옆에 랜덤 배정 배지를 표시한다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, items: [
      { ...detail.items[0], id: 'random-item', variantName: 'B', variantCode: 'RANDOM-B', optionSaleMode: 'random' },
      { ...detail.items[0], id: 'select-item', variantName: '빨강', variantCode: 'RED', optionSaleMode: 'select' },
    ] }} noteOperationId="operation" />);
    const randomLine = html.slice(html.indexOf('id="item-random-item"'), html.indexOf('id="item-select-item"'));
    const selectLine = html.slice(html.indexOf('id="item-select-item"'), html.indexOf('</ul>', html.indexOf('id="item-select-item"')));
    expect(randomLine).toContain('B · RANDOM-B');
    expect(randomLine).toContain('랜덤 배정');
    expect(selectLine).toContain('빨강 · RED');
    expect(selectLine).not.toContain('랜덤 배정');
  });
  it('디지털 주문은 실제 제공 기록과 주소 불필요 상태를 표시하고 택배 발송 이력으로 오인시키지 않는다', () => {
    const shipment=shipmentFixture({delivery:shipmentDeliveryFixture({method:'digital'}),status:'delivered'});
    const at='2026-10-16T00:00:00Z';
    const html=renderToStaticMarkup(<OrderDetailScreen detail={{...detail,shipments:[shipment],timeline:[
      {id:'sent',source:'shipment',action:'shipped',occurredAt:at,shipmentId:shipment.id},
      {id:'provided',source:'shipment',action:'delivered',occurredAt:at,shipmentId:shipment.id},
    ]}} downloads={{orderId:ORDER,items:[{itemId:'10000000-0000-4000-8000-000000000001',name:'구매 당시 디지털 상품',files:[
      {id:'10000000-0000-4000-8000-000000000002',name:'original.txt',mimeType:'text/plain',size:35,providedCount:2,firstProvidedAt:at,lastProvidedAt:at},
    ]}]}} noteOperationId="operation"/>);
    for(const value of ['디지털 파일 제공 기록','구매 당시 디지털 상품','original.txt','35 B','2회','파일 제공 시작','전송 완료나 고객의 열람을 의미하지 않습니다','배송 주소가 필요하지 않은']) expect(html).toContain(value);
    expect(html).not.toContain('상품 발송');expect(html).not.toContain('다운로드</button>');
  });
  it('할인 주문은 품목별 쿠폰·적립금 배분과 배분 후 금액을 보여주고, 나눌 수 없으면 그렇다고 적는다', () => {
    const allocated = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, itemAllocations: { item: { source: 'legacy', volumeDiscount: 0, couponDiscount: 200, storeCreditDiscount: 0, paidGoodsTotal: 9800 } } }} noteOperationId="operation" />);
    expect(allocated).toContain('쿠폰 −₩200 · 적립금 −₩0');
    expect(allocated).toContain('배분 후 ₩9,800 · 배송비 제외');
    expect(renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />)).toContain('주문 당시 기록이 없어 나누지 않았습니다');
    // 배분 조회 실패는 기록이 없다고 안내하지 않는다.
    const unavailable = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, itemAllocations: {}, itemAllocationsUnavailable: true }} noteOperationId="operation" />);
    expect(unavailable).toContain('배분을 불러오지 못했습니다');
    expect(unavailable).not.toContain('주문 당시 기록이 없어');
    const plain = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, discountTotal: 0 } }} noteOperationId="operation" />);
    expect(plain).not.toContain('배분 후');
  });
  it('시스템 감사 기록을 출처로 구분해 자동 발주확인·결제 대기 자동 취소·장바구니 보류 해제로 적는다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, timeline: [
      { id: 'auto', source: 'status', occurredAt: '2026-10-27T07:30:00Z', action: 'admin.order.status_updated', fromStatus: 'paid', toStatus: 'confirmed', actorName: null, trigger: 'auto_order_confirmation' },
      { id: 'manual', source: 'status', occurredAt: '2026-10-27T08:00:00Z', action: 'admin.order.status_updated', fromStatus: 'paid', toStatus: 'confirmed', actorName: '수민' },
      { id: 'closed', source: 'status', occurredAt: '2026-10-27T09:00:00Z', action: 'system.order.unpaid_cart_order_closed', actorName: null },
      { id: 'detached', source: 'status', occurredAt: '2026-10-27T10:00:00Z', action: 'system.order.cart_hold_detached', actorName: null },
    ] }} noteOperationId="operation" />);
    expect(html).toContain('자동 발주확인 (시스템)');
    expect(html.split('주문 상태 변경').length - 1).toBe(1);
    expect(html).toContain('결제 대기 주문 자동 취소 (재주문·장바구니 복귀)');
    expect(html).toContain('장바구니 보류 해제 (결제 확인 필요 주문)');
  });
  /* 고객이 '결제 대기 주문 취소하고 계속'을 눌러 닫은 주문은 자동 정리가 아니다 — 고객 동작으로 적고 취소 주체도 구매자다(ADR-0030). */
  it('고객이 결제 대기 주문을 취소하고 계속한 기록은 고객 동작으로 적는다', () => {
    const released = { id: 'released', source: 'status', occurredAt: '2026-11-12T09:00:00Z', action: 'system.order.unpaid_cart_order_closed', actorName: null, trigger: 'customer_released' } as const;
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'canceled' }, timeline: [released] }} noteOperationId="operation" />);
    expect(html).toContain('고객이 진행 중인 미결제 주문을 취소하고 주문을 계속함');
    expect(html).not.toContain('결제 대기 주문 자동 취소 (재주문·장바구니 복귀)');
    expect(html).toContain('· 구매자');
    expect(html).not.toContain('시스템 자동 처리');
    const automatic = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'canceled' }, timeline: [{ ...released, trigger: 'new_direct_order' }] }} noteOperationId="operation" />);
    expect(automatic).toContain('결제 대기 주문 자동 취소 (재주문·장바구니 복귀)');
    expect(automatic).toContain('시스템 자동 처리');
  });
  /* 사람 눈 판정: 뭘 샀는지가 화면 아래 글머리 한 줄이었고, 금액은 나열만 돼 최종 결제금액 줄이 없었다. */
  it('주문 상품을 맨 위 표로 보이고 금액 칸은 최종 결제금액으로 끝난다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    expect(html.indexOf('>주문 상품<')).toBeLessThan(html.indexOf('>주문 정보<'));
    expect(html).toMatch(/<th[^>]*>상품명<\/th><th[^>]*>옵션<\/th>/);
    const facts = html.slice(html.indexOf('>주문 정보<'), html.indexOf('>배송 정보<'));
    expect(facts).toContain('상품 금액'); expect(facts).toContain('−₩200');
    expect(facts.indexOf('적립금 사용')).toBeLessThan(facts.indexOf('최종 결제금액'));
    /* 품목 합과 맞지 않으면 틀린 상품 금액을 지어내지 않는다. */
    expect(renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, total: 9999 } }} noteOperationId="operation" />)).not.toContain('상품 금액');
  });
  /* 사람 눈 판정: 운송장이 없다고 경고하면서 제일 눈에 띄는 버튼은 배송완료였다. */
  it('운송장이 빠진 배송 건이 있으면 주 버튼과 경고가 운송장 등록을 말한다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, shipments: [shipmentFixture({ status: 'shipping', trackingNumber: null } as never)] }} noteOperationId="operation" />);
    expect(html).toContain('주문 처리 · 운송장 등록'); expect(html).not.toContain('주문 처리 · 배송완료');
    const notice = html.slice(html.indexOf('data-admin-notice="warning"'));
    expect(notice).toMatch(/운송장이 없는 배송 건이 1건/);
    /* 사람 눈 판정: 머리의 주 버튼과 경고 안 버튼이 같은 일을 해서 어느 쪽을 눌러야 할지 망설였다. 등록은 주 버튼 하나로 간다. */
    expect(notice).not.toMatch(/>운송장 등록</);
    expect(html).toMatch(/<a[^>]*href="[^"]*#sales-order-detail"[^>]*>주문 처리 · 운송장 등록</);
    expect(html.indexOf('data-admin-notice="warning"')).toBeLessThan(html.indexOf('>주문 상품<'));
  });
  /* 사람 눈 판정: 취소 건에서 제일 궁금한 돈 이야기가 회색 작은 글씨였다. */
  it('취소 주문은 머리 아래에 환불 상태와 취소 경위를 말한다', () => {
    const canceled = { ...detail.order, status: 'canceled' as const };
    const payment = (status: string) => ({ id: 'pay', source: 'payment' as const, occurredAt: '2026-09-01T00:30:00Z', action: 'recorded', status, amount: 12800 });
    const cancelLog = { id: 'log', source: 'status' as const, occurredAt: '2026-09-02T01:00:00Z', action: 'admin.order.cancellation_completed', actorName: '지우', toStatus: 'canceled' };
    const render = (timeline: AdminOrderDetail['timeline']) => renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: canceled, timeline }} noteOperationId="operation" />);
    const unpaid = render([]);
    expect(unpaid).toContain('결제 전에 취소된 주문이라 환불할 금액이 없습니다');
    expect(unpaid).toMatch(/data-admin-notice="neutral"/); expect(unpaid).toContain('>주문금액<');
    const paid = render([payment('paid')]);
    expect(paid).toMatch(/data-admin-notice="warning"[\s\S]*결제 기록은 있는데 환불 기록이 없습니다/); expect(paid).toContain('>결제금액<');
    expect(render([payment('canceled')])).toContain('결제가 취소된 주문입니다');
    expect(render([payment('paid'), cancelLog])).toContain('취소 2026. 9. 2. 10:00 · 지우');
    /* 끝난 주문에는 배송지 수정 버튼을 두지 않는다. */
    expect(unpaid).not.toContain('배송지 수정');
  });
  /* MD 판정: 현재 상태가 작은 회색 글자였고, '주문 처리'가 무슨 동작인지 알 수 없었다. */
  it('머리에 현재 상태 배지를 두고 주문 처리 버튼이 지금 이어서 할 일을 말한다', () => {
    const paid = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'paid' } }} noteOperationId="operation" />);
    expect(paid.slice(paid.indexOf('data-order-status-strip'))).toMatch(/data-order-status="paid"/);
    expect(paid).toContain('주문 처리 · 발주확인');
    /* 위험한 대리 취소는 일반 버튼과 구분한다. */
    expect(paid).toMatch(/<button[^>]*text-destructive[^>]*>판매자 직접 취소 접수</);
    const shipping = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    expect(shipping).toContain('주문 처리 · 배송완료');
    /* 진행 중인 요청이 있으면 콘솔에서도 그 요청을 먼저 처리한다. */
    const claiming = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'paid' }, timeline: [
      { id: 'claim', source: 'claim', occurredAt: '2026-09-01T01:00:00Z', action: 'created', status: 'requested', claimType: 'cancel', relatedId: '40000000-0000-4000-8000-000000004142' },
    ] }} noteOperationId="operation" />);
    expect(claiming).toContain('주문 처리 · 요청 확인');
    expect(claiming).toContain('현재 상태 · 취소요청');
    const finished = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'done' } }} noteOperationId="operation" />);
    expect(finished).toContain('>주문 처리<');
  });

  it('배송완료 주문에서 별도 대리 접수 진입점을 제공한다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'delivered' } }} noteOperationId="operation" />);
    expect(html).toContain('판매자 직접 반품·교환 접수');
    expect(renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />)).toContain('판매자 직접 반품·교환 접수');
  });
  it('주문 당시 상품·정확한 금액·배송 정보와 출처별 시간순 이력을 보여준다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    for (const value of ['주문 당시 상품명', '₩12,800', '수령자', '101호', '결제', '상태 변경', '신규주문', '발주확인', '수민', '지우', '운영자 메모', '물류팀 확인 필요']) expect(html).toContain(value);
    expect(html.indexOf('2026-09-01T01')).toBeGreaterThan(-1);
    expect(html.indexOf('2026-09-01T01')).toBeLessThan(html.indexOf('2026-09-01T04'));
    expect(html).toContain('/admin/cs/inquiries/40000000-0000-4000-8000-000000004141');
    expect(html).toContain('/admin/customers/buyer');
    expect(html).toContain('href="/admin/sales/orders"');
    expect(html).toContain(`query=${ORDER}&amp;order=${ORDER}`);
    expect(html).not.toContain('admin.order.status_updated');
    expect(html).toContain('배송 방식·인계 확인');
    /* 운영자 메모는 서버 액션 폼 제출이다 — kit Button은 type이 없으면 button이 된다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>운영자 메모 저장</);
 });

 it('상세에서 목록으로 돌아갈 때 전달받은 필터와 선택 주문을 유지한다', () => {
  const html = renderToStaticMarkup(<OrderDetailScreen
    backHref={`/admin/sales/orders?status=done&page=2&order=${ORDER}`}
    backLabel="주문 목록"
    detail={detail}
    noteOperationId="operation"
  />);
  expect(html).toContain(`href="/admin/sales/orders?status=done&amp;page=2&amp;order=${ORDER}"`);
 });
});

 it('아직 메일 원장이 생기기 전 큐의 대기·확인 필요 상태를 배송건별로 보여준다',()=>{
  const shipment = shipmentFixture({ shipmentNumber: '2026112630000001' });
  const html=renderToStaticMarkup(<OrderDetailScreen detail={{...detail,shipments:[shipment],emailJobs:[{shipmentId:shipment.id,status:'review',attempts:2,lastErrorCode:'provider_network_error',updatedAt:'2026-09-08T00:00:00Z'}]}} noteOperationId="operation" />);
  expect(html).toContain('>배송 메일 처리 상태</h3>');expect(html).toContain('운영자 확인 필요');
  /* 배송 건은 배송건번호로 부른다. 시도 횟수와 영문 확인 코드는 운영자가 할 일이 없어 보이지 않는다. */
  expect(html).toContain('김포 · 2026112630000001');
  expect(html).not.toContain('provider_network_error');expect(html).not.toContain('시도 2회');expect(html).not.toContain('확인 코드');
  /* 번호가 없는 옛 배송 건도 내부 번호를 보이지 않는다. */
  const legacy=renderToStaticMarkup(<OrderDetailScreen detail={{...detail,emailJobs:[{shipmentId:detail.shipments[0].id,status:'pending',attempts:0,lastErrorCode:null,updatedAt:'2026-09-08T00:00:00Z'}]}} noteOperationId="operation" />);
  const mail=legacy.slice(legacy.indexOf('aria-label="배송 메일 처리 상태"'));
  expect(mail.slice(0,mail.indexOf('</section>'))).toContain('>김포</strong>');expect(mail.slice(0,mail.indexOf('</section>'))).not.toContain(detail.shipments[0].id);
 });

it('query-only detail does not mount any shipment or claim operation, note, or global customer link', () => {
  const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'delivered' } }} canManage={false} canViewCustomer={false} noteOperationId="operation" />);
  expect(html).toContain('주문 당시 상품명');
  for (const text of ['판매자 직접 반품·교환 접수', '배송 방식·인계 확인', '고객 상세 열기', '>주문 처리<', 'name="body"']) expect(html).not.toContain(text);
});

/* QA1 S-T04-05: 강제 배송완료는 접힌 카드에 주문번호 전체를 직접 넣어야 했다. 발주확인·배송중 주문의 상세(목록 위 팝업 포함)에서
   그 주문번호로 카드를 바로 연다. 권한이 없거나 처리할 수 없는 상태면 링크가 없다. */
it('발주확인·배송중 주문은 강제 배송완료 카드를 그 주문번호로 바로 여는 링크를 둔다', () => {
  const numbered = { ...detail, order: { ...detail.order, orderNumber: '20261112140010000034' } };
  const shipping = renderToStaticMarkup(<OrderDetailScreen detail={numbered} embedded noteOperationId="operation" />);
  expect(shipping).toContain('href="/admin/sales/dispatch?forceDelivery=20261112140010000034#forced-delivery"');
  const confirmed = renderToStaticMarkup(<OrderDetailScreen detail={{ ...numbered, order: { ...numbered.order, status: 'confirmed' } }} noteOperationId="operation" />);
  expect(confirmed).toContain('forceDelivery=20261112140010000034');
  for (const status of ['paid', 'delivered', 'canceled'] as const) {
    expect(renderToStaticMarkup(<OrderDetailScreen detail={{ ...numbered, order: { ...numbered.order, status } }} noteOperationId="operation" />)).not.toContain('forceDelivery=');
  }
  expect(renderToStaticMarkup(<OrderDetailScreen detail={numbered} canManage={false} noteOperationId="operation" />)).not.toContain('forceDelivery=');
});

/* S36-075 리뷰: 목록 위 팝업 안에서는 목록 돌아가기 버튼이 팝업 닫기와 겹치고 기록을 쌓으며 스크롤을 올리므로 숨긴다. */
it('embedded(목록 위 팝업)에서는 머리의 목록 버튼을 그리지 않고, 강제 배송완료 감사 기록에 이름을 붙인다', () => {
  const standalone = renderToStaticMarkup(<OrderDetailScreen backHref="/admin/sales/dispatch?tab=ready&page=1" backLabel="발주·발송 목록" detail={detail} noteOperationId="operation" />);
  expect(standalone).toContain('>발주·발송 목록<');
  const embedded = renderToStaticMarkup(<OrderDetailScreen backHref="/admin/sales/dispatch?tab=ready&page=1" backLabel="발주·발송 목록" detail={{ ...detail, timeline: [...detail.timeline,
    { id: 'five', source: 'status', occurredAt: '2026-09-01T05:00:00Z', action: 'admin.order.forced_delivered', actorName: '수민' }] }} embedded noteOperationId="operation" />);
  expect(embedded).not.toContain('>발주·발송 목록<');
  expect(embedded).toContain('>강제 배송완료<');
});

/* ADR-0045(SHP-048): 판매 관리 권한의 주문 상세는 택배 배송 건마다 한 단계 되돌리기를 두고, 끝난 주문·조회 권한에는 두지 않는다. 타임라인은 되돌리기·도착 일시 기록을 이름으로 적는다. */
it('배송 상태 정정 패널은 택배 배송 건의 발송·배송완료 되돌리기를 두고 감사 기록에 이름을 붙인다', () => {
  const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, shipments: [shipmentFixture(), shipmentFixture({ id: '00000000-0000-4000-8000-000000044702', status: 'delivered', deliveredAt: '2026-09-09T00:00:00Z' })],
    timeline: [...detail.timeline, { id: 'six', source: 'shipment', occurredAt: '2026-09-10T00:00:00Z', action: 'admin.shipment.delivery_reverted', actorName: '수민' },
      { id: 'seven', source: 'shipment', occurredAt: '2026-09-11T00:00:00Z', action: 'admin.shipment.arrival_recorded', actorName: '지우' }] }} noteOperationId="operation" />);
  expect(html).toContain('aria-label="배송 상태 정정"');
  expect(html).toContain('>발송 되돌리기<'); expect(html).toContain('>배송완료 되돌리기<'); expect(html).toContain('한진택배 123456789012');
  expect(html).toContain('>배송완료 되돌리기</h3>'); expect(html).toContain('>택배사 배송완료 일시 기록</h3>');
  expect(renderToStaticMarkup(<OrderDetailScreen detail={detail} canManage={false} noteOperationId="operation" />)).not.toContain('배송 상태 정정');
  expect(renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'done' } }} noteOperationId="operation" />)).not.toContain('배송 상태 정정');
});

describe('주문 상세 — 결제 전 확인 동의', () => {
  /* 결제 전 확인 동의(PAY-015) — 운영자가 주문 상세에서 동의 일시와 제한 굿즈를 본다. */
  it('결제 전 확인 동의 기록이 있으면 일시·문구 버전·청약철회 제한 굿즈를 보인다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" acknowledgement={{ orderId: ORDER, acknowledgedAt: '2026-11-19T01:02:03+00:00', noticeVersion: '2026-11-19',
      restrictedGoods: [{ goodId: 'g1', name: '각인 키링', returnAllowed: false, exchangeAllowed: null, reason: '각인 주문 제작' }] }} />);
    expect(html).toContain('결제 전 확인 동의');
    expect(html).toContain('data-order-acknowledgement="recorded"');
    expect(html).toContain('동의 일시');
    expect(html).toContain('청약철회·교환 제한 상품');
    expect(html).toContain('2026. 11. 19. 10:02');
    expect(html).toContain('각인 키링 — 각인 주문 제작');
    /* 고지 문구 버전은 운영자가 할 일이 없는 내부 값이다. 상품 이름이 없으면 상품 번호 대신 말로 적는다. */
    expect(html).not.toContain('고지 문구 버전');
    const unnamed = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" acknowledgement={{ orderId: ORDER, acknowledgedAt: '2026-11-19T01:02:03+00:00', noticeVersion: '2026-11-19',
      restrictedGoods: [{ goodId: 'internal-good-id', name: '', returnAllowed: false, exchangeAllowed: null, reason: null }] }} />);
    expect(unnamed).toContain('상품명 없음'); expect(unnamed).not.toContain('internal-good-id');
  });
  it('동의 기록이 없는 주문은 기록 없음으로 알리고 읽지 못했으면 칸을 그리지 않는다', () => {
    const missing = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" acknowledgement={null} />);
    expect(missing).toContain('data-order-acknowledgement="missing"');
    expect(missing).toContain('동의 기록이 없습니다.');
    /* 없는 이유 세 가지는 글로 늘어놓지 않고 이름 옆 "?"에 둔다. */
    expect(missing).toContain('aria-label="동의 기록이 없는 주문 도움말"'); expect(missing).not.toContain('도입하기 전에 만든 주문');
    expect(ORDER_DETAIL_HELP.acknowledgementMissing.what).toContain('정기구매 주문'); expect(ORDER_DETAIL_HELP.acknowledgementMissing.caution).toContain('정기구매 약관 동의');
    const unread = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    expect(unread).not.toContain('결제 전 확인 동의');
  });
});

/* 토스 가상계좌(ADR-0049): 주문 상세의 '가상계좌 입금' 칸과 주문 정보의 결제수단. 주문 처리 권한에만 보인다. */
describe('주문 상세 가상계좌 입금', () => {
  const account = { bankCode: '088', accountNumber: '56211234567890', dueAt: '2026-11-25T01:00:00.000Z', amount: 12800, useEscrow: null, state: 'checking' as const, escrow: null, refund: null };
  it('입금 은행·계좌번호·금액·기한·상태·에스크로 적용 여부와 결제수단(무통장입금(가상계좌))을 보인다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, virtualAccount: account }} noteOperationId="operation" />);
    for (const text of ['가상계좌 입금', '입금 확인 중', '신한은행', '56211234567890', '₩12,800', '2026. 11. 25. 10:00', '구매안전서비스 (에스크로)', '기록 없음', '<dd class="min-w-0 wrap-anywhere">무통장입금(가상계좌)</dd>']) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('data-order-virtual-account="checking"');
  });
  it('에스크로 배송 정보가 자동 등록되지 않았으면 직접 등록 안내를 띄운다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, virtualAccount: { ...account, state: 'deposited', useEscrow: true,
      escrow: { deliveryState: 'manual_required', escrowStatus: null, lastErrorCode: 'INVALID_COMPANY' } } }} noteOperationId="operation" />);
    for (const text of ['에스크로 배송 정보', '직접 등록 필요', '아직 확인 전', '배송 정보를 직접 등록해주세요']) expect(html, text).toContain(text);
    /* 결제사가 돌려준 영문 오류 코드는 운영자가 할 일이 없어 보이지 않는다. */
    expect(html).not.toContain('INVALID_COMPANY'); expect(html).not.toContain('확인 코드');
  });
  it('읽지 못했으면 그 사실을 적고, 조회 전용 권한에는 그리지 않는다', () => {
    expect(renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, virtualAccountUnavailable: true }} noteOperationId="operation" />)).toContain('가상계좌 입금 정보를 불러오지 못했습니다');
    const reader = renderToStaticMarkup(<OrderDetailScreen canManage={false} detail={{ ...detail, virtualAccount: account }} noteOperationId="operation" />);
    expect(reader).not.toContain('56211234567890');
    expect(reader).not.toContain('가상계좌 입금');
  });
  /* 환불 뒤 은행 송금 감시(ADR-0049 결정 5 보강): 실패면 확인 안내와 '처리 완료로 표시', 그 밖은 상태와 다음 일만. */
  it('환불 송금 실패를 알리고 처리 완료로 표시할 수 있게 한다', () => {
    const refund = { state: 'failed' as const, failureCode: 'refund_failed' as const, refundedAt: '2026-11-26T01:00:00.000Z', checkedAt: null, resolutionNote: null, completedVia: null };
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, virtualAccount: { ...account, state: 'deposited', refund } }} noteOperationId="operation" />);
    for (const text of ['환불 송금', '환불 송금 확인 필요', '환불 송금 확인이 필요합니다', '은행이 고객 계좌로 송금하지 못했습니다', '처리 완료로 표시']) expect(html, text).toContain(text);
    expect(html).toContain('data-order-virtual-account-refund="failed"');
    const resolved = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, virtualAccount: { ...account, state: 'deposited',
      refund: { ...refund, state: 'resolved', resolutionNote: '회사 계좌로 직접 송금' } } }} noteOperationId="operation" />);
    for (const text of ['처리 완료(운영자 확인)', '처리 내용 · 회사 계좌로 직접 송금']) expect(resolved, text).toContain(text);
    expect(resolved).not.toContain('환불 송금 확인이 필요합니다');
    // 에스크로 구매자 취소 환불을 시스템이 닫았으면(20261125130000) 그 근거로 보이고 처리 완료 버튼은 없다.
    const escrow = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, virtualAccount: { ...account, state: 'deposited',
      refund: { ...refund, state: 'completed', failureCode: null, completedVia: 'escrow_buyer_cancel' } } }} noteOperationId="operation" />);
    for (const text of ['토스 에스크로 환불로 닫힘', '환불 7일 뒤 시스템이 완료로 닫았습니다']) expect(escrow, text).toContain(text);
    expect(escrow).not.toContain('처리 완료로 표시');
  });
  /* 계좌이체 에스크로(20261125110100): 가상계좌가 아닌 계좌이체 주문의 에스크로 배송 등록 상태. */
  it('계좌이체 에스크로 배송 등록 상태와 직접 등록 안내를 보이고, 건너뛴 결제는 그리지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, virtualAccount: null, transferEscrow: { useEscrow: true,
      job: { deliveryState: 'manual_required', escrowStatus: 'IN_PROGRESS', lastErrorCode: 'carrier_unmapped' } } }} noteOperationId="operation" />);
    for (const text of ['계좌이체 구매안전서비스', '계좌이체', '적용(구매자가 선택)', '직접 등록 필요', '구매확정 대기', '배송 정보를 직접 등록해주세요']) expect(html, text).toContain(text);
    expect(html).not.toContain('carrier_unmapped'); expect(html).not.toContain('확인 코드');
    expect(html).toContain('data-order-transfer-escrow="manual_required"');
    const skipped = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, virtualAccount: null, transferEscrow: { useEscrow: false,
      job: { deliveryState: 'skipped', escrowStatus: null, lastErrorCode: null } } }} noteOperationId="operation" />);
    expect(skipped).not.toContain('계좌이체 구매안전서비스');
    const reader = renderToStaticMarkup(<OrderDetailScreen canManage={false} detail={{ ...detail, virtualAccount: null, transferEscrow: { useEscrow: null,
      job: { deliveryState: 'ready', escrowStatus: null, lastErrorCode: null } } }} noteOperationId="operation" />);
    expect(reader).not.toContain('계좌이체 구매안전서비스');
  });
  it('입금 오류 되돌림 출고 보류 기록은 결제 확인 필요 출고 보류로 적는다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, timeline: [{ id: 'hold', source: 'status', occurredAt: '2026-11-25T02:00:00Z', action: 'system.order.fulfillment_hold_placed', actorName: null }] }} noteOperationId="operation" />);
    expect(html).toContain('출고 보류 (결제 확인 필요)');
  });
});

/* 어드민 화면 규칙 PR 3(판매·배송) — 주문 상세 본체: 같은 것은 이름 하나(규칙 4), 내부 값을 보이지 않는다(규칙 8), 못 하는 일은 미리 알린다. */
describe('주문 상세 — 이름과 눈에 보이는 값', () => {
  const dt = (label: string) => new RegExp(`<dt[^>]*>${label}</dt>`);
  const withStatus = (status: AdminOrderDetail['order']['status'], extra: Partial<React.ComponentProps<typeof OrderDetailScreen>> = {}) =>
    renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status } }} noteOperationId="operation" {...extra} />);
  it('요약 칸 이름은 어드민 낱말이다(구매자·수령인·주문일시·배송 메모)', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    for (const label of ['주문일시', '구매자', '수령인', '배송 메모']) expect(html, label).toMatch(dt(label));
    for (const label of ['주문 일시', '주문자', '수령자', '배송 요청']) expect(html, label).not.toMatch(dt(label));
  });
  it('주소 형식 확인 안내는 무엇을 확인할지 말한다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, addressNeedsReview: true } }} noteOperationId="operation" />);
    expect(html).toContain('이 주문의 주소는 옛 형식으로 저장돼 있어 저장된 그대로 보입니다. 발송 전에 우편번호와 연락처가 맞는지 확인해주세요.');
    expect(html).not.toContain('원본 기록');
  });
  it('주문번호가 없는 옛 주문은 내부 번호 대신 말로 적고, 주문통합검색 링크는 주문번호를 싣는다', () => {
    const legacy = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    expect(legacy).toContain('>주문번호 없음</strong>'); expect(legacy).not.toContain(`>${ORDER}</strong>`);
    expect(legacy).toContain(`query=${ORDER}&amp;order=${ORDER}`);
    const numbered = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, orderNumber: '20261112140010000034' } }} noteOperationId="operation" />);
    expect(numbered).toContain('>20261112140010000034</strong>');
    expect(numbered).toMatch(new RegExp(`<a[^>]*href="/admin/sales/orders\\?status=all&amp;query=20261112140010000034&amp;order=${ORDER}"[^>]*>주문 처리 · 배송완료</a>`));
    expect(numbered).not.toContain(`query=${ORDER}`);
  });
  it('배송지 버튼은 신규주문·발주확인이면 [배송지 수정], 그 뒤 주문은 처음부터 [배송지 변경 이력]이고 이유가 버튼 설명에 있다', () => {
    for (const status of ['paid', 'confirmed'] as const) {
      const html = withStatus(status);
      expect(html, status).toMatch(/<button[^>]*>배송지 수정<\/button>/); expect(html, status).not.toContain('배송지 변경 이력');
    }
    for (const status of ['shipping', 'delivered', 'done'] as const) {
      const html = withStatus(status);
      expect(html, status).toMatch(/<button[^>]*title="신규주문이나 발주확인 상태의 주문만 배송지를 바꿀 수 있습니다\."[^>]*>배송지 변경 이력<\/button>/);
      expect(html, status).not.toContain('배송지 수정');
    }
    /* 끝난 주문·조회 권한·주소가 필요 없는 수령 방식에는 버튼이 없다. */
    for (const html of [withStatus('canceled'), renderToStaticMarkup(<OrderDetailScreen detail={detail} canManage={false} noteOperationId="operation" />),
      renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, shipments: [shipmentFixture({ delivery: shipmentDeliveryFixture({ method: 'pickup' }) })] }} noteOperationId="operation" />)]) {
      expect(html).not.toContain('배송지 수정'); expect(html).not.toContain('배송지 변경 이력');
    }
  });
  it('기록 줄의 현재 상태는 주문 처리 패널과 같은 결제·환불 이름이고, 배송 건은 배송건번호와 어드민 상태 이름으로 적는다', () => {
    const shipment = shipmentFixture({ shipmentNumber: '2026112630000001' });
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, shipments: [shipment], timeline: [
      { id: 'p1', source: 'payment', occurredAt: '2026-09-01T01:00:00Z', action: 'recorded', status: 'pending', amount: 12800, provider: 'toss' },
      { id: 'p2', source: 'payment', occurredAt: '2026-09-01T01:01:00Z', action: 'recorded', status: 'paid', amount: 12800, provider: 'toss' },
      { id: 'r1', source: 'refund', occurredAt: '2026-09-02T01:00:00Z', action: 'requested', status: 'requested', amount: 12800 },
      { id: 'r2', source: 'refund', occurredAt: '2026-09-02T02:00:00Z', action: 'completed', status: 'done', amount: 12800 },
      { id: 's1', source: 'shipment', occurredAt: '2026-09-03T00:00:00Z', action: 'shipped', shipmentId: shipment.id, originName: '김포' },
      { id: 's2', source: 'status', occurredAt: '2026-09-03T01:00:00Z', action: 'admin.shipment.status_updated', shipmentId: shipment.id, fromStatus: 'ready', toStatus: 'shipping', actorName: '수민' },
      { id: 'c1', source: 'status', occurredAt: '2026-09-04T00:00:00Z', action: 'order.purchase_confirmation.hold', actorName: '지우' },
      { id: 'c2', source: 'status', occurredAt: '2026-09-04T01:00:00Z', action: 'order.purchase_confirmation.request', actorName: '지우' },
      { id: 'c3', source: 'claim', occurredAt: '2026-09-04T02:00:00Z', action: 'admin.order.claim_intake_created', actorName: '지우' },
    ] }} noteOperationId="operation" />);
    for (const line of ['현재 상태 · 확인중', '현재 상태 · 결제완료', '현재 상태 · 환불 요청 접수', '현재 상태 · 환불 완료']) expect(html, line).toContain(line);
    for (const old of ['현재 상태 · 대기', '현재 상태 · 접수', '현재 상태 · 완료']) expect(html, old).not.toContain(old);
    expect(html).toContain('>김포 · 2026112630000001</p>'); expect(html).toContain('발송 대기 → 배송중'); expect(html).not.toContain('배송 준비');
    expect(html).toContain('>거래확정 보류</h3>'); expect(html).toContain('>거래확정 요청</h3>'); expect(html).toContain('>판매자 직접 접수</h3>');
    expect(html).not.toContain('구매확정 보류'); expect(html).not.toContain('판매자 대리 접수');
    /* 결제 기록 줄에 결제사 코드를 그대로 쓰지 않고, 줄마다 되풀이되던 타임라인 설명 문장은 없다. */
    expect(html).not.toContain('· toss'); expect(html).not.toContain('이른 기록부터 표시합니다');
    /* 배송 건 줄에 내부 번호 끝 8자를 쓰지 않는다. */
    expect(html).not.toMatch(/김포 · (<[^>]*>)?[0-9A-F]{8}(<|$)/);
  });
  it('거래확정 패널은 배송완료·거래확정 주문에만 있고, 카드 이름도 그에 맞춘다', () => {
    const delivered = withStatus('delivered', { actorId: 'actor-1' });
    expect(delivered).toContain('aria-label="거래확정·운영자 메모"'); expect(delivered).toContain('aria-label="거래확정"'); expect(delivered).toContain('거래확정 상태를 확인하고 있습니다.');
    expect(delivered).not.toContain('구매확정 상태');
    const shipping = withStatus('shipping', { actorId: 'actor-1' });
    expect(shipping).toContain('aria-label="운영자 메모"'); expect(shipping).not.toContain('거래확정·운영자 메모'); expect(shipping).not.toContain('aria-label="거래확정"');
  });
  it('운영자 메모 칸은 어디에 남고 누가 보는지 말하고 쓸 내용의 예를 보인다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    expect(html).toContain('저장하면 주문 타임라인에 남습니다. 운영팀만 보고, 고객에게는 보이지 않습니다.');
    expect(html).toMatch(/<textarea[^>]*placeholder="예: 11\/26 고객이 전화로/);
  });
});

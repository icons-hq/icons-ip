import { describe, expect, it } from 'vitest';
import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { shipmentDeliveryFixture } from '@/lib/shipment-delivery.fixture';
import type { AdminOrderRecord } from './orders';
import type { AdminClaimRow } from './claims';
import type { ShipmentConsoleRow } from './shipment-dispatch';
import {
  claimsListExportSheet,
  listExportContact,
  ordersListExportSheet,
  shipmentsListExportSheet,
  unpaidListExportSheet,
} from './list-export-sheets';
import { adminListExportClaimScreenId, type AdminListExportSheet } from './list-export';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function cells(sheet: AdminListExportSheet, rowIndex = 0) {
  return Object.fromEntries(sheet.columns.map((column, index) => [column.header, sheet.rows[rowIndex]?.[index]]));
}

function order(overrides: Partial<AdminOrderRecord> = {}): AdminOrderRecord {
  return {
    id: ORDER_ID,
    userId: '00000000-0000-4000-8000-000000000001',
    buyerName: 'maple_fan',
    buyerEmail: 'fan@example.test',
    status: 'shipping',
    total: 45_000,
    address: { recipientName: '김수취', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 1' },
    createdAt: '2026-10-06T15:10:00.000Z',
    updatedAt: '2026-10-06T15:10:00.000Z',
    items: [
      { id: 'item-1', variantId: 'v-1', variantName: '파랑', variantCode: '00123', name: '아크릴 키링', type: 'goods', qty: 2, unitPrice: 15_000 },
      { id: 'item-2', variantId: 'v-2', variantName: null, variantCode: null, name: '스티커', type: 'goods', qty: 1, unitPrice: 12_000 },
    ],
    payments: [{ id: 'pay-1', amount: 45_000, status: 'paid', createdAt: '2026-10-06T15:11:00.000Z' }],
    refunds: [],
    cancellationRequest: null,
    manualRecoveryAttempt: null,
    shipments: [shipmentFixture({ orderId: ORDER_ID, orderItemIds: ['item-1'] })],
    ...overrides,
  };
}

describe('주문 통합검색 목록 엑셀', () => {
  const filters = { field: 'recipient' as const, query: '김수취', status: 'all' as const, from: '2026-10-01', to: null, page: 3, orderId: null };

  it('상품 한 줄을 한 행으로 펼치고 화면 라벨과 KST 시각을 쓴다', () => {
    const sheet = ordersListExportSheet({ records: [order()], paymentMethods: new Map([[ORDER_ID, 'bank_transfer']]), filters });
    expect(sheet.screen).toBe('orders');
    expect(sheet.recordCount).toBe(1);
    expect(sheet.rows).toHaveLength(2);
    const first = cells(sheet);
    expect(first).toMatchObject({
      주문번호: '11111111',
      '전체 주문번호': ORDER_ID,
      주문일시: '2026-10-07 00:10',
      '주문 상태': '배송중',
      구매자: 'maple_fan',
      수취인: '김수취',
      결제수단: '무통장 입금',
      '결제 상태': '결제완료',
      결제금액: 45_000,
      상품명: '아크릴 키링',
      옵션: '파랑',
      옵션코드: '00123',
      수량: 2,
      판매가: 15_000,
      '상품 금액': 30_000,
      출고지: '김포',
      '배송 방식': '택배',
      택배사: '한진택배',
      운송장번호: '123456789012',
    });
    const second = cells(sheet, 1);
    expect(second.상품명).toBe('스티커');
    expect(second.출고지).toBeNull();
    expect(second.결제금액).toBe(45_000);
    /* 주문 통합검색은 수취인 이름만 싣고 연락처·주소는 담지 않는다. */
    expect(sheet.columns.map((column) => column.header)).not.toContain('연락처');
    expect(sheet.conditions).toEqual([
      ['검색 대상', '수취인'], ['검색어', '김수취'], ['주문 상태', '전체 상태'], ['주문일', '2026-10-01 ~ 종료 제한 없음'],
    ]);
    expect(sheet.filters).toEqual({ field: 'recipient', query: '김수취', status: 'all', from: '2026-10-01', to: null });
  });

  it('품목이 없는 주문도 한 행으로 남기고 요청 상태를 함께 적는다', () => {
    const sheet = ordersListExportSheet({
      records: [order({
        items: [],
        shipments: [],
        cancellationRequest: {
          id: 'req', status: 'requested', claimType: 'return', stage: 'collecting', reasonType: 'defect',
          requestedAt: '2026-10-06T00:00:00Z', decidedAt: null, decisionNote: null,
        },
      })],
      paymentMethods: new Map(),
      filters,
    });
    expect(sheet.rows).toHaveLength(1);
    expect(cells(sheet)).toMatchObject({ 상품명: null, 수량: null, '취소·반품·교환 요청': '반품 · 수거중', 결제수단: null });
  });
});

describe('미입금 확인 목록 엑셀', () => {
  it('입금 대조 칸만 싣고 주소·연락처는 담지 않는다', () => {
    const sheet = unpaidListExportSheet({
      rows: [{
        id: '9a3f21c0-1111-4000-8000-000000000abc', buyerName: '홍길동', buyerId: 'b', recipientName: '홍길동',
        total: 23_000, createdAt: '2026-08-17T09:00:00.000Z', expiresAt: '2026-08-18T02:00:00.000Z', extendedAt: null,
        depositCode: '9A3F21C0', itemSummary: '무통장 굿즈 × 1', attemptState: 'prepared',
      }],
      filters: { query: '', page: 2, selectedOrderId: null },
    });
    expect(cells(sheet)).toMatchObject({
      주문코드: '9A3F21C0', '안내된 입금자명': '홍길동9A3F21C0', 주문일시: '2026-08-17 18:00', '입금 기한': '2026-08-18 11:00',
      '기한 연장': null, 상태: '입금 대기', 입금액: 23_000,
    });
    expect(sheet.columns.map((column) => column.header)).not.toEqual(expect.arrayContaining(['연락처', '주소']));
    expect(sheet.filters).toEqual({ query: null });
  });
});

describe('발주·발송/배송현황 목록 엑셀', () => {
  const row: ShipmentConsoleRow = {
    id: '60000000-0000-4000-8000-0000000000aa', orderId: ORDER_ID, originId: 'one', originName: '김포', status: 'ready',
    createdAt: '2026-09-08T00:00:00Z', confirmedAt: '2026-09-08T01:00:00Z', buyerName: '구매자', recipientName: '받는 분',
    total: 30_000, paymentMethod: 'card', shippingFee: 3_000, carrier: 'hanjin', trackingNumber: null, shippedAt: null,
    deliveredAt: null, exportedAt: '2026-09-08T02:00:00Z', updatedAt: '2026-09-08T00:00:00Z', delayReason: '입고 지연',
    expectedShipDate: '2026-09-12', items: [{ id: 'i1', name: '상품', variantName: '파랑', qty: 2 }, { id: 'i2', name: '스티커', variantName: null, qty: 1 }],
  };
  const carriers = [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }];

  it('배송 건의 상품 줄마다 수령인·연락처·주소를 싣고 연락처·우편번호의 선행 0을 지킨다', () => {
    const contacts = new Map([[ORDER_ID, listExportContact({ recipientName: '받는 분', phone: '01000000001', postalCode: '01234', address1: '서울', address2: '101호', deliveryNote: '문 앞' })]]);
    const sheet = shipmentsListExportSheet({
      surface: 'dispatch', rows: [row], filters: { tab: 'ready', originId: 'one', query: '', from: null, to: null, page: 1 },
      contacts, origins: [{ id: 'one', name: '김포' }], carriers,
    });
    expect(sheet.screen).toBe('dispatch');
    expect(sheet.title).toBe('발주·발송 관리 - 발송 대기');
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.recordCount).toBe(1);
    expect(cells(sheet)).toMatchObject({
      배송건번호: '000000AA', 주문번호: '11111111', 출고지: '김포', '배송 방식': '택배', '배송 상태': '배송 준비',
      수취인: '받는 분', 연락처: '01000000001', 우편번호: '01234', 주소: '서울 101호', 배송메시지: '문 앞',
      상품명: '상품', 옵션: '파랑', 수량: 2, 결제금액: 30_000, 결제수단: '카드', 배송비: 3_000, 택배사: '한진택배',
      '출고지시 전달일시': '2026-09-08 11:00',
    });
    expect(sheet.columns.find((column) => column.header === '연락처')?.kind).toBe('code');
    expect(sheet.columns.find((column) => column.header === '우편번호')?.kind).toBe('code');
    expect(sheet.columns.map((column) => column.header)).not.toContain('지연 메모');
    expect(sheet.conditions).toContainEqual(['출고지', '김포']);
    expect(sheet.notes.join(' ')).toContain('출고지시 파일과 다른 확인용 목록');
  });

  it('발송 지연 탭은 지연 메모를, 배송현황은 출고지시 칸 없이 방식별 상태를 싣는다', () => {
    const delayed = shipmentsListExportSheet({
      surface: 'dispatch', rows: [row], filters: { tab: 'delayed', originId: null, query: '', from: null, to: null, page: 1 },
      contacts: new Map(), origins: [], carriers,
    });
    expect(cells(delayed)).toMatchObject({ '지연 메모': '입고 지연', '발송 예정일': '2026-09-12', 연락처: null });
    expect(delayed.conditions).toContainEqual(['출고지', '전체 출고지']);

    const shipping = shipmentsListExportSheet({
      surface: 'shipping',
      rows: [{ ...row, status: 'shipping', delivery: shipmentDeliveryFixture({ method: 'quick', providerName: '퀵' }) }],
      filters: { tab: 'transit', originId: null, query: '', from: null, to: null, page: 1 },
      contacts: new Map(), origins: [], carriers,
    });
    expect(shipping.columns.map((column) => column.header)).not.toContain('출고지시 전달일시');
    expect(cells(shipping)).toMatchObject({ '배송 방식': '퀵', '배송 상태': '퀵 배송 중' });
  });
});

describe('취소·반품·교환 목록 엑셀', () => {
  const claim: AdminClaimRow = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reference: 42, orderId: ORDER_ID, claimType: 'return', stage: 'collecting',
    reasonType: 'defect', buyerName: 'maple_fan', buyerEmail: null, orderStatus: 'delivered', orderTotal: 45_000,
    requestedAt: '2026-10-06T00:00:00Z', collectedAt: null, completedAt: null, refundMethod: null, handlerName: null,
  };
  const orders = new Map([[ORDER_ID, {
    items: [{ id: 'item-1', name: '아크릴 키링', variantName: '파랑', qty: 2 }],
    contact: listExportContact({ recipientName: '김수취', phone: '01012345678', postalCode: '04524', address1: '서울' }),
    shipments: [shipmentFixture({ orderId: ORDER_ID, orderItemIds: ['item-1'] })],
  }]]);
  const filters = { stage: 'open' as const, reasonType: 'all' as const, from: null, to: null, query: '', page: 1 };

  it('반품은 상품 줄마다 배송지와 원래 운송장을 싣는다', () => {
    const sheet = claimsListExportSheet({ claimType: 'return', rows: [claim], filters, orders, now: new Date('2026-10-07T00:00:00Z') });
    expect(sheet.screen).toBe('claims-returns');
    expect(cells(sheet)).toMatchObject({
      요청번호: 'C00042', 주문번호: '11111111', 유형: '반품', 사유: '상품 하자·오배송', '처리 상태': '수거중',
      접수일시: '2026-10-06 09:00', '환급 기한': '입고 전', '환불 수단': '미접수', 처리자: '미배정',
      상품명: '아크릴 키링', 수량: 2, 수취인: '김수취', 연락처: '01012345678', 우편번호: '04524', 운송장번호: '123456789012',
    });
    expect(sheet.conditions).toContainEqual(['처리 상태', '미처리 전체']);
  });

  it('취소는 출고 전 중단이라 배송지·운송장 칸을 싣지 않는다', () => {
    const sheet = claimsListExportSheet({ claimType: 'cancel', rows: [{ ...claim, claimType: 'cancel' }], filters, orders, now: new Date() });
    expect(sheet.screen).toBe('claims-cancels');
    expect(sheet.columns.map((column) => column.header)).not.toEqual(expect.arrayContaining(['연락처', '주소', '운송장번호']));
    expect(adminListExportClaimScreenId('exchange')).toBe('claims-exchanges');
  });
});

describe('배송지 칸 읽기', () => {
  it('있는 문자열만 꺼내고 비어 있으면 null이다', () => {
    expect(listExportContact({ recipientName: ' 김 ', phone: '010', extra: 1 })).toEqual({
      recipientName: '김', phone: '010', postalCode: '', address: '', deliveryNote: '',
    });
    expect(listExportContact(null)).toBeNull();
    expect(listExportContact({})).toBeNull();
    expect(listExportContact([])).toBeNull();
  });
});

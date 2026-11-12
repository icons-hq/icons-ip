import { describe, expect, it } from 'vitest';
import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import type { AdminOrderRecord } from './orders';
import type { AdminClaimRow } from './claims';
import {
  claimsListExportSheet,
  listExportContact,
  ordersListExportSheet,
  shipmentsListExportSheet,
  unpaidListExportSheet,
  refundTransfersListExportSheet,
  type RefundTransferExportAccount,
} from './list-export-sheets';
import type { RefundTransferClaimRow } from './refund-transfers';
import { adminListExportClaimScreenId, type AdminListExportSheet } from './list-export';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOM_INPUTS = {revision:1,fields:[{id:'22222222-2222-4222-8222-222222222222',name:'각인 문구',value:'합성 문구'}]};

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
      { id: 'item-1', variantId: 'v-1', variantName: '파랑', variantCode: '00123', name: '아크릴 키링', type: 'goods', qty: 2, unitPrice: 15_000, customInputs:CUSTOM_INPUTS },
      { id: 'item-2', variantId: 'v-2', variantName: null, variantCode: null, name: '스티커', type: 'goods', qty: 1, unitPrice: 12_000 },
    ],
    payments: [{ id: 'pay-1', provider: 'toss', amount: 45_000, status: 'paid', createdAt: '2026-10-06T15:11:00.000Z' }],
    refunds: [],
    cancellationRequest: null,
    manualRecoveryAttempt: null,
    shipments: [shipmentFixture({ orderId: ORDER_ID, orderItemIds: ['item-1'] })],
    ...overrides,
  };
}

describe('주문 통합검색 목록 엑셀', () => {
  const filters = { field: 'recipient' as const, query: '김수취', status: 'all' as const, from: '2026-10-01', to: null, page: 3, orderId: null };

  it('계산 버전 1 할인 주문도 공통 배분으로 품목 쿠폰·적립금·실결제액을 채운다', () => {
    const allocations = new Map([['item-1', { source: 'legacy' as const, volumeDiscount: 0, couponDiscount: 1200, storeCreditDiscount: 300, paidGoodsTotal: 28_500 }]]);
    const sheet = ordersListExportSheet({ records: [order()], paymentMethods: new Map(), filters, allocations });
    expect(cells(sheet)).toMatchObject({ '쿠폰 할인(품목)': 1200, '적립금 사용(품목)': 300, '품목 실결제액(배송비 제외)': 28_500, '복수구매 할인(품목)': 0 });
    expect(cells(sheet, 1)).toMatchObject({ '쿠폰 할인(품목)': null, '품목 실결제액(배송비 제외)': null });
    expect(sheet.notes.join(' ')).toContain('거래확정 엑셀과 같은 규칙');
  });

  it('상품 한 줄을 한 행으로 펼치고 화면 라벨과 KST 시각을 쓴다', () => {
    const sheet = ordersListExportSheet({ records: [order()], paymentMethods: new Map([[ORDER_ID, 'bank_transfer']]), filters });
    expect(sheet.screen).toBe('orders');
    expect(sheet.recordCount).toBe(1);
    expect(sheet.rows).toHaveLength(2);
    const first = cells(sheet);
    expect(first).toMatchObject({
      주문번호: '11111111',
      주문일시: '2026-10-07 00:10',
      '주문 상태': '배송중',
      구매자: 'maple_fan',
      수취인: '김수취',
      결제수단: '무통장 입금',
      '결제 상태': '결제완료',
      결제금액: 45_000,
      상품명: '아크릴 키링',
      옵션: '파랑',
      '직접 입력 옵션':'각인 문구: 합성 문구',
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
    expect(sheet.columns.map((column) => column.header)).not.toEqual(expect.arrayContaining(['전체 주문번호']));
    expect(sheet.columns.map((column) => column.header)).not.toContain('계산 버전');
    expect(sheet.columns.find((column) => column.header === '이메일')?.width).toBeGreaterThanOrEqual(34);
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
          id: 'req', status: 'requested', claimType: 'return', stage: 'collecting', reasonType: 'defect', staffReasonCode: null,
          requestedAt: '2026-10-06T00:00:00Z', decidedAt: null, decisionNote: null, lastErrorCode: null,
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
      입금확인코드: '9A3F21C0', 주문번호: '9a3f21c0-1111-4000-8000-000000000abc', '안내된 입금자명': '홍길동9A3F21C0', 주문일시: '2026-08-17 18:00', '입금 기한': '2026-08-18 11:00',
      '기한 연장': null, 상태: '입금 대기', 입금액: 23_000,
    });
    expect(sheet.columns.map((column) => column.header)).not.toEqual(expect.arrayContaining(['연락처', '주소']));
    expect(sheet.filters).toEqual({ query: null });
  });
});

describe('발주·발송/배송현황 목록 엑셀', () => {
  const origins = [{ id: 'one', name: '김포' }];

  it('화면·탭·조건과 확인용 목록 안내를 만든다(열과 행은 표준 양식이 채운다)', () => {
    const sheet = shipmentsListExportSheet({
      surface: 'dispatch', recordCount: 2, filters: { tab: 'ready', originId: 'one', query: '', from: null, to: null, page: 1 }, origins,
    });
    expect(sheet.screen).toBe('dispatch');
    expect(sheet.title).toBe('발주(주문)확인/발송관리 - 발송 대기');
    expect(sheet.recordCount).toBe(2);
    expect(sheet).not.toHaveProperty('columns');
    expect(sheet.conditions).toContainEqual(['출고지', '김포']);
    expect(sheet.conditions).toContainEqual(['발송지연 안내여부', '전체']);
    expect(sheet.notes.join(' ')).toContain('출고지시 파일과 다른 확인용 목록');
    expect(sheet.notes.join(' ')).toContain('엑셀 일괄 운송장 등록');
    expect(sheet.filters).toMatchObject({ tab: 'ready', originId: 'one' });
  });

  it('배송현황은 전체 출고지 표기를 쓰고 출고지시 안내를 뺀다', () => {
    const sheet = shipmentsListExportSheet({
      surface: 'shipping', recordCount: 1, filters: { tab: 'transit', originId: null, query: '', from: null, to: null, page: 1 }, origins: [],
    });
    expect(sheet.title).toBe('배송현황 관리 - 배송중');
    expect(sheet.conditions).toContainEqual(['출고지', '전체 출고지']);
    expect(sheet.conditions.map(([label]) => label)).not.toContain('발송지연 안내여부');
    expect(sheet.notes.join(' ')).not.toMatch(/출고지시 파일과 다른|네이버|스마트스토어/);
  });
});

describe('취소·반품·교환 목록 엑셀', () => {
  const claim: AdminClaimRow = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reference: 42, orderId: ORDER_ID, claimType: 'return', stage: 'collecting',
    reasonType: 'defect', staffReasonCode: null, buyerName: 'maple_fan', buyerEmail: null, orderStatus: 'delivered', orderTotal: 45_000,
    requestedAt: '2026-10-06T00:00:00Z', collectedAt: null, completedAt: null, refundMethod: null, handlerName: null,
  };
  const orders = new Map([[ORDER_ID, {
    items: [{ id: 'item-1', name: '아크릴 키링', variantName: '파랑', qty: 2, customInputs:CUSTOM_INPUTS }],
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
      '직접 입력 옵션':'각인 문구: 합성 문구',
    });
    expect(sheet.conditions).toContainEqual(['처리 상태', '미처리 전체']);
    expect(sheet.columns.map((column) => column.header)).not.toContain('전체 주문번호');
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

it('exports immutable volume/coupon/credit allocation while keeping COD outside the payment amount', async () => {
  const { transactionDisplay, transactionLineId, transactionInput } = await import('@/test/fixtures/cart-transaction');
  const sheet = ordersListExportSheet({ records: [order({ isGift: true, transaction: transactionDisplay, total: 16000,
    items: [{ id: transactionLineId, variantId: transactionInput.items[0].variantId!, variantName: null, name: '이름이 변경된 상품', type: 'goods', qty: 2, unitPrice: 10000 }] })],
    paymentMethods: new Map(), filters: { field: 'all', query: '', status: 'all', from: null, to: null, page: 1, orderId: null } });
  expect(cells(sheet)).toMatchObject({ 결제금액: 16000, '착불 배송비(주문)': 3000, '선불 배송비(주문)': 0,
    '복수구매 할인(주문)': 2000, '복수구매 할인(품목)': 2000, '쿠폰 할인(품목)': 1000, '적립금 사용(품목)': 1000, '품목 실결제액(배송비 제외)': 16000,
    '선물 주문': '선물 · 수령인용 가격표 제외' });
});

describe('환불 송금 대기 목록 엑셀(1007-047·048)', () => {
  const row = (overrides: Partial<RefundTransferClaimRow> = {}): RefundTransferClaimRow => ({
    claimId: 'c0000000-0000-4000-8000-000000000001', orderId: 'd0000000-0000-4000-8000-000000000001', orderNumber: '2026110810000001',
    reference: 45, claimType: 'return', amount: 12000, confirmedAt: '2026-11-07T14:30:00Z', filedAt: null, updatedAt: '2026-11-07T14:30:00Z',
    revision: 3, gift: true, payerName: '결제자별명', requesterName: null, ...overrides,
  });
  const second = row({ claimId: 'c0000000-0000-4000-8000-000000000002', orderId: 'd0000000-0000-4000-8000-000000000002', orderNumber: undefined,
    reference: 46, claimType: 'cancel', amount: 3000, filedAt: '2026-11-08T01:00:00Z', gift: false, payerName: null, requesterName: '요청자' });
  const accounts = new Map<string, RefundTransferExportAccount>([
    [row().claimId, { status: 'not_filed', bankName: null, accountNumber: null, accountHolder: null }],
    [second.claimId, { status: 'revealed', bankName: '합성은행', accountNumber: '0012-345-678901', accountHolder: '합성 예금주' }],
  ]);
  const now = new Date('2026-11-10T15:10:00Z');

  it('요청 한 건이 한 행이고 송금에 쓸 계좌·계좌 상태를 화면 열과 함께 싣는다', () => {
    const sheet = refundTransfersListExportSheet({ rows: [row(), second], accounts, accountExportId: 'e0000000-0000-4000-8000-000000000001', now });
    expect(sheet.columns.map(column => column.header)).toEqual(['요청번호', '송금 대기 금액', '결제자', '은행', '계좌번호', '예금주', '계좌 상태',
      '대기 일수', '유형', '주문번호', '취소 확정일', '환불 접수일', '요청자']);
    expect(sheet.columns.find(column => column.header === '계좌번호')?.kind).toBe('code');
    // 11/7 23:30(KST) 확정 → 11/11 00:10(KST) 내려받기는 한국 달력으로 4일째다.
    expect(cells(sheet, 0)).toMatchObject({ 요청번호: 'C00045', '송금 대기 금액': 12000, 결제자: '결제자별명', 은행: null, 계좌번호: null, 예금주: null,
      '계좌 상태': '환불 접수 전', '대기 일수': 4, 유형: '선물 · 반품', 주문번호: '2026110810000001', '취소 확정일': '2026-11-07 23:30', '환불 접수일': '미접수', 요청자: '이름 미등록' });
    // 계좌번호는 앞자리 0을 지키는 문자열 칸이다. 주문번호가 없는 옛 응답은 화면과 같은 짧은 참조를 쓴다.
    expect(cells(sheet, 1)).toMatchObject({ 결제자: '이름 미등록', 은행: '합성은행', 계좌번호: '0012-345-678901', 예금주: '합성 예금주', '계좌 상태': '확인됨',
      유형: '취소', 주문번호: '00000002', '환불 접수일': '2026-11-08 10:00', 요청자: '요청자' });
    expect(sheet.screen).toBe('refund-transfers');
    expect(sheet.title).toBe('환불 송금 대기');
    expect(sheet.recordCount).toBe(2);
    expect(sheet.filters).toEqual({ accountExportId: 'e0000000-0000-4000-8000-000000000001' });
    expect(sheet.notes.join(' ')).toContain('계좌 열람 기록');
    expect(sheet.notes.join(' ')).toContain('결제자 기준');
  });

  it('계좌 열을 켰는데 계좌·열람 기록이 빠지면 파일을 만들지 않는다', () => {
    expect(() => refundTransfersListExportSheet({ rows: [row()], accounts: null, accountExportId: null, now })).toThrow('환불 계좌');
    expect(() => refundTransfersListExportSheet({ rows: [row(), second], accounts: new Map([...accounts].slice(1)), accountExportId: 'x', now })).toThrow('환불 계좌');
    expect(() => refundTransfersListExportSheet({ rows: [row()], accounts, accountExportId: null, now })).toThrow('환불 계좌');
  });

  it('스위치를 끄면 계좌 열과 열람 안내 없이 화면과 같은 열만 남는다', () => {
    const sheet = refundTransfersListExportSheet({ rows: [row()], accounts: null, accountExportId: null, now, includeAccount: false });
    expect(sheet.columns.map(column => column.header)).toEqual(['요청번호', '송금 대기 금액', '결제자', '대기 일수', '유형', '주문번호', '취소 확정일', '환불 접수일', '요청자']);
    expect(sheet.filters).toEqual({});
    expect(sheet.notes.join(' ')).not.toContain('계좌 열람 기록');
  });
});

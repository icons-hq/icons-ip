import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminClaimConsoleData } from '@/lib/admin/claims';
import { ClaimQueueScreen } from './ClaimQueueScreen';

const NOW = new Date('2026-08-20T06:00:00.000Z');
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function data(overrides: Partial<AdminClaimConsoleData> = {}): AdminClaimConsoleData {
  return {
    claimType: 'return',
    counts: {
      requested: 2,
      in_review: 0,
      collecting: 1,
      collected: 0,
      on_hold: 1,
      processing: 0,
      needs_review: 0,
      completed: 0,
      rejected: 0,
    },
    filters: {
      from: null,
      page: 1,
      query: '',
      reasonType: 'all',
      stage: 'open',
      to: null,
    },
    pageSize: 20,
    total: 2,
    rows: [
      {
        id: CLAIM_ID,
        reference: 12,
        orderId: ORDER_ID,
        claimType: 'return',
        stage: 'processing',
        reasonType: 'change_of_mind',
        buyerName: 'maple_fan',
        buyerEmail: 'buyer@example.com',
        orderStatus: 'delivered',
        orderTotal: 43000,
        requestedAt: '2026-08-18T01:00:00.000Z',
        /* 입고 확인 + 3영업일이 이미 지났다 — 목록에서 가장 먼저 보여야 할 행이다. */
        collectedAt: '2026-08-01T01:00:00.000Z',
        completedAt: null,
        refundMethod: 'pg_cancel',
        handlerName: 'cs_lead',
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        reference: 11,
        orderId: '22222222-2222-4222-8222-222222222222',
        claimType: 'return',
        stage: 'collecting',
        reasonType: 'defect',
        buyerName: 'second_fan',
        buyerEmail: null,
        orderStatus: 'delivered',
        orderTotal: 21000,
        requestedAt: '2026-08-19T01:00:00.000Z',
        collectedAt: null,
        completedAt: null,
        refundMethod: null,
        handlerName: null,
      },
    ],
    ...overrides,
  };
}

describe('ClaimQueueScreen', () => {
  it('이슈가 요구한 그리드 컬럼을 순서대로 보여준다', () => {
    const html = renderToStaticMarkup(<ClaimQueueScreen data={data()} now={NOW} />);

    for (const column of [
      '클레임번호', '주문번호', '유형', '사유', '상태', '구매자', '접수일', '환급 기한', '환불 수단', '처리자',
    ]) {
      expect(html).toContain(column);
    }
    expect(html).toContain('C00012');
    expect(html).toContain('@maple_fan');
    expect(html).toContain('단순 변심');
    expect(html).toContain('상품 하자·오배송');
  });

  /* SLA는 목록에서 가장 먼저 보는 값이다. 색만이 아니라 톤 속성으로 강조가 남아야 한다. */
  it('환급 기한을 넘긴 행을 danger 톤으로 표시한다', () => {
    const html = renderToStaticMarkup(<ClaimQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('data-sla-tone="danger"');
    expect(html).toContain('기한 초과');
  });

  /* 입고 전에는 기한이 시작하지 않았다. 남은 일수를 지어내면 안 된다. */
  it('입고 전 클레임에는 기한을 지어내지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('입고 전');
  });

  /* 결제수단은 private.payment_provider_evidence에만 있고 staff 표면이 없다(#250).
     환불 수단은 refunds.method라 정직하게 말할 수 있는 값이다. */
  it('환불 수단은 원장에 적힌 값만 말한다', () => {
    const html = renderToStaticMarkup(<ClaimQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('결제사 취소');
    expect(html).toContain('미접수');
  });

  /* 0건 칩을 감추면 "정말 0건"과 "집계 실패"를 구분할 수 없다. */
  it('0건 단계도 칩으로 남긴다', () => {
    const html = renderToStaticMarkup(<ClaimQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('처리완료 0건');
    expect(html).toContain('보류 1건');
  });

  it('상세 링크가 목록 조건을 함께 들고 간다', () => {
    const html = renderToStaticMarkup(<ClaimQueueScreen data={data()} now={NOW} />);

    expect(html).toContain(`/admin/sales/claims/returns/${CLAIM_ID}?back=`);
  });

  /* 부분 환불은 계획의 명시적 제외 항목이다. 화면이 약속하는 순간 운영이 따라간다. */
  it('부분 환불을 약속하지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimQueueScreen data={data()} now={NOW} />);

    expect(html).toContain('주문 단위 전액');
    expect(html).toContain('일부만 환급하는 처리는 제공하지 않습니다');
  });

  it('행이 없으면 조건에 맞는 클레임이 없다고 알린다', () => {
    const html = renderToStaticMarkup(
      <ClaimQueueScreen data={data({ rows: [], total: 0 })} now={NOW} />,
    );

    expect(html).toContain('조건에 맞는 반품 클레임이 없습니다.');
  });

  it('교환 화면은 교환 경로로 링크한다', () => {
    const html = renderToStaticMarkup(
      <ClaimQueueScreen data={data({ claimType: 'exchange', rows: [], total: 0 })} now={NOW} />,
    );

    expect(html).toContain('/admin/sales/claims/exchanges');
    expect(html).toContain('조건에 맞는 교환 클레임이 없습니다.');
  });
});

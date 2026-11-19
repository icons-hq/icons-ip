import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ORDER_CLAIM_INTAKE_NOTICES, PARTIAL_RETURN_INTAKE_SENTENCE } from '@/lib/orders/claims';
import type { OrderPartialReturnContext } from '@/lib/orders/partial-return';

/* 접수 양식이 열린 상태('form')·일부 굿즈 고르기('partial')를 정적 렌더로 보려고 그 두 초기값만 바꿔 시작시킨다. */
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: ((initial: unknown) => actual.useState(initial === 'idle' ? 'form' : initial === 'whole' ? 'partial' : initial as never)) as typeof actual.useState,
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ITEM_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

function context(overrides: Partial<OrderPartialReturnContext> = {}): OrderPartialReturnContext {
  return {
    enabled: true,
    blocker: null,
    items: [
      { orderItemId: ITEM_A, goodName: '홍실 아크릴 블록', variantName: null, orderedQty: 2, activeQty: 2, returnedQty: 0, unitPrice: 10_000,
        shipmentId: null, shipmentNumber: null, originName: null, blocker: null, returnRestricted: true, restrictionReason: '개봉 시 반품 불가' },
      { orderItemId: ITEM_B, goodName: '홍실 포토카드', variantName: null, orderedQty: 1, activeQty: 1, returnedQty: 0, unitPrice: 5_000,
        shipmentId: null, shipmentNumber: null, originName: null, blocker: 'shipment_not_dispatched', returnRestricted: false, restrictionReason: null },
    ],
    ...overrides,
  };
}

async function render(partialReturn?: OrderPartialReturnContext) {
  const { OrderClaimRequest } = await import('./OrderClaimRequest');
  return renderToStaticMarkup(createElement(OrderClaimRequest, {
    orderId: ORDER_ID, claim: null, status: 'delivered', eligibility: { cancel: false, return: true, exchange: true },
    ...(partialReturn ? { partialReturn } : {}),
  }));
}

describe('반품 접수 — 부분 반품(ADR-0047)', () => {
  it('스위치가 꺼져 있으면(기본) 품목 선택이 없고 접수 안내도 지금 그대로다', async () => {
    const html = await render();
    expect(html).not.toContain('반품할 굿즈');
    expect(html).toContain(`<p class="money-caption">${ORDER_CLAIM_INTAKE_NOTICES.return}</p>`);
  });

  it('켜져 있으면 품목·수량을 고르고, 막힌 품목은 이유를, 반품 제한 굿즈는 제한 사유를 함께 보인다', async () => {
    const html = await render(context());
    expect(html).toContain('반품할 굿즈');
    expect(html).toContain('data-partial-return-scope="partial"');
    expect(html).toContain('aria-label="홍실 아크릴 블록 반품 수량"');
    expect(html).toContain('max="2"');
    expect(html).not.toContain('aria-label="홍실 포토카드 반품 수량"');
    expect(html).toContain('아직 발송되지 않은 굿즈입니다.');
    expect(html).toContain('반품 제한 굿즈입니다(개봉 시 반품 불가)');
    expect(html).toContain(PARTIAL_RETURN_INTAKE_SENTENCE);
    expect(html).not.toContain('일부 굿즈만 반품하는 처리는 제공하지 않습니다');
  });

  it('주문 단위로 막혀 있으면(선물·결제 수단) 일부 고르기를 열지 않고 이유를 보인다', async () => {
    const html = await render(context({ blocker: 'unsupported_payment' }));
    expect(html).toContain('이 결제 수단은 일부 금액만 취소할 수 없어 주문 전체로만 반품을 신청할 수 있습니다.');
    expect(html).not.toContain('반품 수량');
  });

  it('고른 품목을 items로 보내고, 서버가 막은 부분 반품은 별도 결과로 돌려준다', async () => {
    const { submitOrderClaim } = await import('./OrderClaimRequest');
    const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ error: { code: 'partial_return_item_unavailable' } }) }));
    await expect(submitOrderClaim(ORDER_ID, { claimType: 'return', reasonType: 'change_of_mind', items: [{ orderItemId: ITEM_A, qty: 1 }] }, fetcher))
      .resolves.toBe('partial_return_unavailable');
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({
      claimType: 'return', reasonType: 'change_of_mind', items: [{ orderItemId: ITEM_A, qty: 1 }],
    });
  });
});

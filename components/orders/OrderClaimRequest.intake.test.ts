import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ORDER_CLAIM_INTAKE_NOTICES } from '@/lib/orders/claims';

/* 접수 양식이 열린 상태('form')를 정적 렌더로 보려고 첫 useState(접수 상태)만 'form'으로 시작시킨다. */
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: ((initial: unknown) => actual.useState(initial === 'idle' ? 'form' : initial as never)) as typeof actual.useState,
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

async function render(returnFeePolicy?: { enabled: boolean; oneWayAmount: number | null } | null, extra: Record<string, unknown> = {}) {
  const { OrderClaimRequest } = await import('./OrderClaimRequest');
  return renderToStaticMarkup(createElement(OrderClaimRequest, {
    orderId: ORDER_ID, claim: null, status: 'delivered', eligibility: { cancel: false, return: true, exchange: true },
    ...(returnFeePolicy === undefined ? {} : { returnFeePolicy }),
    ...extra,
  }));
}

describe('반품 접수 안내 — 반품배송비 차감 정책 연결(ADR-0031)', () => {
  it('정책이 없거나 꺼져 있으면 기존 접수 안내와 같다', async () => {
    const html = await render();
    expect(html).toContain(`<p class="money-caption">${ORDER_CLAIM_INTAKE_NOTICES.return}</p>`);
    for (const policy of [null, { enabled: false, oneWayAmount: null }, { enabled: false, oneWayAmount: 3000 }]) {
      expect(await render(policy)).toBe(html);
    }
  });

  it('켜져 있으면 반품 안내에 반품배송비 차감 규칙이 들어간다', async () => {
    const html = await render({ enabled: true, oneWayAmount: 3000 });
    expect(html).toContain('반품배송비 3,000원');
    expect(html).toContain('왕복 6,000원');
    expect(html).not.toContain(ORDER_CLAIM_INTAKE_NOTICES.return);
  });
});

/* 웨이브 2 통합 5e: 재고 부족 부분 취소(ADR-0032)가 적용된 주문은 '결제금액 전액'이 아니라 남은 결제 금액을 돌려준다. */
describe('반품 접수 안내 — 재고 부족 부분 취소 뒤 남은 결제 금액(ADR-0032)', () => {
  it('부분 취소가 없으면(기본값·false) 지금 안내 그대로다', async () => {
    const html = await render();
    expect(await render(undefined, { partiallyCanceled: false })).toBe(html);
  });

  it('부분 취소가 있으면 결제금액 전액 대신 남은 결제 금액으로 안내한다', async () => {
    const html = await render(undefined, { partiallyCanceled: true });
    expect(html).toContain('승인된 환불은 이미 일부 취소한 금액을 뺀 남은 결제 금액으로 처리합니다.');
    expect(html).not.toContain('결제금액 전액');
  });

  it('반품배송비 차감이 켜져 있어도 남은 결제 금액 기준이고, 차감 규칙은 그대로 함께 보인다', async () => {
    const html = await render({ enabled: true, oneWayAmount: 3000 }, { partiallyCanceled: true });
    expect(html).toContain('이미 일부 취소한 금액을 뺀 남은 결제 금액으로 처리하며');
    expect(html).toContain('반품배송비 3,000원');
    expect(html).toContain('남은 결제 금액을 모두 환불하고');
    expect(html).not.toContain('전액');
  });
});

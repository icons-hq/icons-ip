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

async function render(returnFeePolicy?: { enabled: boolean; oneWayAmount: number | null } | null) {
  const { OrderClaimRequest } = await import('./OrderClaimRequest');
  return renderToStaticMarkup(createElement(OrderClaimRequest, {
    orderId: ORDER_ID, claim: null, status: 'delivered', eligibility: { cancel: false, return: true, exchange: true },
    ...(returnFeePolicy === undefined ? {} : { returnFeePolicy }),
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

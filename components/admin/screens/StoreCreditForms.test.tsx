import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('@/app/admin/store-credit-actions', () => ({ adjustStoreCreditAction: vi.fn(), saveStoreCreditPolicyAction: vi.fn() }));
import { StoreCreditPolicyForm } from './StoreCreditForms';

const policy = { enabled: true, earnKind: 'rate_bps', earnValue: 150, earnMaxPerOrder: 5000, maxBalance: 200000, validityDays: 365, minUse: 1000, maxUse: 50000, restoreGraceDays: 30, refundEarnedCreditMode: 'offset_future_credits', evidence: '승인', version: 2, updatedAt: '2026-10-12T00:00:00Z' } as never;

/* 1%에 1을 넣어 0.01%가 되는 돈 실수를 막는다 — 보이는 칸은 %이고, 제출 값은 저장 단위(0.01%) 그대로다. */
it('적립률은 %로 보이고 제출 값은 0.01% 단위 그대로다', () => {
  const html = renderToStaticMarkup(<StoreCreditPolicyForm operationId="11111111-1111-4111-8111-111111111111" policy={policy} />);
  expect(html).toContain('적립률 (%)');
  expect(html).toMatch(/<input[^>]*id="credit-earnValue"[^>]*value="1\.5"/);
  expect(html).toMatch(/<input[^>]*name="earnValue"[^>]*value="150"/);
  expect(html).toContain('상품 금액 50,000원이면 약 750원이 적립됩니다');
});

it('금액은 쉼표로 읽히고 제출 값은 숫자 그대로이며 저장은 바닥 줄에 있다', () => {
  const html = renderToStaticMarkup(<StoreCreditPolicyForm operationId="11111111-1111-4111-8111-111111111111" policy={policy} />);
  expect(html).toMatch(/<input[^>]*id="credit-maxBalance"[^>]*value="200,000"/);
  expect(html).toMatch(/<input[^>]*name="maxBalance"[^>]*value="200000"/);
  expect(html).toContain('저장하면 새 주문부터 바로 적용됩니다');
  expect(html).toMatch(/data-admin-savebar=""[^>]*>[\s\S]*정책 저장<\/button>/);
});

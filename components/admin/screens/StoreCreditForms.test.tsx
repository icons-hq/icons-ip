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

/* 잘못된 적립률은 hidden 값이 비어 기존 값을 NULL로 덮는다(비활성 정책은 서버가 빈 값을 받아 준다) — 고칠 때까지 저장을 막는다. */
it('적립률 칸이 잘못되면 칸 아래 안내와 함께 정책 저장을 막는다', () => {
  const html = renderToStaticMarkup(<StoreCreditPolicyForm operationId="11111111-1111-4111-8111-111111111111" policy={{ ...policy, enabled: false, earnValue: 12345 }} />);
  expect(html).toContain('적립률은 0~100 사이, 소수 둘째 자리까지 입력해주세요.');
  expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>[\s\S]*?정책 저장<\/button>/);
  const valid = renderToStaticMarkup(<StoreCreditPolicyForm operationId="11111111-1111-4111-8111-111111111111" policy={{ ...policy, enabled: false }} />);
  expect(valid).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>[\s\S]*?정책 저장<\/button>/);
});

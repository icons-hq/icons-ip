import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClaimFeePolicy } from '@/lib/orders/claim-fees';

vi.mock('@/app/admin/claim-fee-policy-actions', () => ({ readClaimFeePolicyAction: vi.fn(), saveClaimFeePolicyAction: vi.fn() }));
vi.mock('./GoodsGroupOperation', () => ({ useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: () => undefined }) }));

import { ClaimFeePolicyForm } from './ClaimFeePolicyForm';

const policy: ClaimFeePolicy = { revision: 3, enabled: true, returnAmount: 3000, exchangeAmount: null, evidence: '합성 정책 근거', updatedAt: '2026-11-01T00:00:00Z', accountReady: false };
const render = () => renderToStaticMarkup(<ClaimFeePolicyForm actorId="a1000000-0000-4000-8000-000000000001" initial={policy} sessionId="a1000000-0000-4000-8000-000000000002" />);
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

describe('반품·교환 배송비 정책 폼 (kit)', () => {
  it('저장은 양식 제출이고(kit 버튼은 type을 주지 않으면 button이다), 다시 불러오기는 제출하지 않는다', () => {
    const html = render();
    expect(button(html, '배송비 청구 정책 저장')).toContain('type="submit"');
    /* 개별 합의·계좌·수납 확인 전에는 저장할 수 없다. */
    expect(button(html, '배송비 청구 정책 저장')).toContain('disabled=""');
    expect(button(html, '현재 정책 다시 불러오기')).toContain('type="button"');
  });

  it('현재 정책 값을 kit 입력에 채우고, 고객 화면 공용 claim-fees 클래스를 쓰지 않는다', () => {
    const html = render();
    expect(html).toMatch(/<input[^>]*data-slot="input"[^>]*value="3000"/);
    expect(html).toContain('합성 정책 근거');
    expect(html).toMatch(/입금 받을 계좌 <span[^>]*data-tone="warning"[^>]*>미등록</);
    expect(html).not.toMatch(/class="[^"]*\bclaim-fees\b/);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';

vi.mock('@/app/admin/purchase-confirmation-actions', () => ({ readPurchaseConfirmationPolicyAction: vi.fn(), savePurchaseConfirmationPolicyAction: vi.fn() }));
vi.mock('./GoodsGroupOperation', () => ({ useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: () => undefined }) }));

import { PurchaseConfirmationPolicyForm } from './PurchaseConfirmationPolicyForm';

const policy: PurchaseConfirmationPolicy = { revision: 2, autoEnabled: true, autoAfterDays: 8, buyerExtensionDays: null, evidence: '합성 운영 메모', updatedAt: '2026-11-01T00:00:00Z' };
const render = () => renderToStaticMarkup(<PurchaseConfirmationPolicyForm actorId="b1000000-0000-4000-8000-000000000001" initial={policy} sessionId="b1000000-0000-4000-8000-000000000002" />);
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

describe('구매확정 정책 폼 (kit)', () => {
  it('저장은 양식 제출이고(kit 버튼은 type을 주지 않으면 button이다), 다시 불러오기는 제출하지 않는다', () => {
    const html = render();
    expect(button(html, '구매확정 정책 저장')).toContain('type="submit"');
    /* 적용 시점·적립금·반품 자격 확인 전에는 저장할 수 없다. */
    expect(button(html, '구매확정 정책 저장')).toContain('disabled=""');
    expect(button(html, '현재 정책 다시 불러오기')).toContain('type="button"');
  });

  it('기간 입력은 라벨과 이어진 kit 입력이고, 고객 화면 공용 purchase-confirmation 클래스를 쓰지 않는다', () => {
    const html = render();
    expect(html).toMatch(/<label[^>]*for="confirmation-auto-days"[^>]*>배송완료 후 자동 확정까지 \(일\)<\/label>/);
    const days = html.match(/<input[^>]*\bid="confirmation-auto-days"[^>]*>/)?.[0] ?? '';
    for (const attribute of ['data-slot="input"', 'type="number"', 'value="8"']) expect(days).toContain(attribute);
    expect(html).toContain('켜면 이미 배송완료된 주문도 배송완료일 기준으로 확정됩니다');
    expect(html).not.toMatch(/class="[^"]*\bpurchase-confirmation\b/);
  });
});

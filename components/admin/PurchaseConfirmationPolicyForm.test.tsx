import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';

vi.mock('@/app/admin/purchase-confirmation-actions', () => ({ previewPurchaseConfirmationAutoAction: vi.fn(), readPurchaseConfirmationPolicyAction: vi.fn(), savePurchaseConfirmationPolicyAction: vi.fn() }));
vi.mock('./GoodsGroupOperation', () => ({ useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: () => undefined }) }));

import { PurchaseConfirmationPolicyForm } from './PurchaseConfirmationPolicyForm';

const policy: PurchaseConfirmationPolicy = { revision: 2, autoEnabled: true, autoAfterDays: 8, buyerExtensionDays: null, evidence: '합성 운영 메모', updatedAt: '2026-11-01T00:00:00Z' };
const render = (initial: PurchaseConfirmationPolicy = policy) => renderToStaticMarkup(<PurchaseConfirmationPolicyForm actorId="b1000000-0000-4000-8000-000000000001" initial={initial} sessionId="b1000000-0000-4000-8000-000000000002" />);
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';
const radio = (html: string, value: string) => html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))?.[0] ?? '';

describe('거래확정 정책 폼 (kit)', () => {
  it('저장은 양식 제출이고(kit 버튼은 type을 주지 않으면 button이다), 다시 불러오기는 제출하지 않는다', () => {
    const html = render();
    expect(button(html, '저장')).toContain('type="submit"');
    /* 근거 글과 "확인했습니다" 체크 없이 바로 저장할 수 있다. 켤 때의 영향은 저장 전 확인창이 건수·금액으로 보인다. */
    expect(button(html, '저장')).not.toContain('disabled=""');
    expect(button(html, '저장된 정책 다시 불러오기')).toContain('type="button"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('확인했습니다');
    expect(html).not.toContain('근거');
    expect(html).not.toContain(policy.evidence);
  });

  it('자동 확정 안 함 / 배송완료 뒤 자동 확정 가운데 하나를 고르고, 켠 쪽을 골랐을 때만 기간 칸이 열린다', () => {
    const on = render();
    expect(radio(on, 'on')).toContain('type="radio"');
    expect(radio(on, 'on')).toContain('checked=""');
    expect(radio(on, 'off')).not.toContain('checked');
    expect(on).toMatch(/<label[^>]*for="confirmation-auto-days"[^>]*>배송완료 뒤 자동 확정까지 \(일\)<\/label>/);
    const days = on.match(/<input[^>]*\bid="confirmation-auto-days"[^>]*>/)?.[0] ?? '';
    for (const attribute of ['data-slot="input"', 'type="number"', 'value="8"', 'required=""']) expect(days).toContain(attribute);
    expect(on.match(/<input[^>]*\bid="confirmation-extension"[^>]*>/)?.[0]).toContain('placeholder="비우면 연장 없음"');

    /* 꺼져 있으면 기간·연장 칸은 쓸 일이 없어 보이지 않는다(켜 놓고 기간을 비워 저장이 거절되는 일이 없다). */
    const off = render({ ...policy, autoEnabled: false });
    expect(radio(off, 'off')).toContain('checked=""');
    expect(off).not.toContain('id="confirmation-auto-days"');
    expect(off).not.toContain('id="confirmation-extension"');
  });

  it('고른 값을 한 줄로 되읽고, 고객 화면 공용 purchase-confirmation 클래스와 옛 이름(구매확정)을 쓰지 않는다', () => {
    const readback = (html: string) => html.match(/<p[^>]*data-good-readback=""[^>]*>([^<]*)<\/p>/)?.[1] ?? '';
    expect(readback(render())).toBe('배송완료 뒤 8일이 지난 주문을 매일 03:00 (KST)에 거래확정하고 적립금을 지급합니다. 구매자는 자동 확정을 미룰 수 없습니다.');
    expect(readback(render({ ...policy, buyerExtensionDays: 3 }))).toContain('구매자는 자동 확정을 한 번, 3일 미룰 수 있습니다.');
    /* '자동 확정 안 함'은 고른 카드가 결과를 말한다. 같은 말을 한 번 더 적지 않는다. */
    const off = render({ ...policy, autoEnabled: false });
    expect(off).not.toContain('data-good-readback');
    expect(off).toContain('구매자가 직접 확정한 주문만 거래확정됩니다.');
    const html = render();
    expect(html).not.toMatch(/class="[^"]*\bpurchase-confirmation\b/);
    expect(html).not.toContain('구매확정');
  });
});

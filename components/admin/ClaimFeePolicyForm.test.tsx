import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClaimFeePolicy } from '@/lib/orders/claim-fees';

vi.mock('@/app/admin/claim-fee-policy-actions', () => ({ readClaimFeePolicyAction: vi.fn(), saveClaimFeePolicyAction: vi.fn() }));
vi.mock('./GoodsGroupOperation', () => ({ useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: () => undefined }) }));

import { ClaimFeePolicyForm } from './ClaimFeePolicyForm';

const policy: ClaimFeePolicy = { revision: 3, enabled: true, returnAmount: 3000, exchangeAmount: null, evidence: '합성 정책 근거', updatedAt: '2026-11-01T00:00:00Z', accountReady: true };
const render = (initial: ClaimFeePolicy = policy) => renderToStaticMarkup(<ClaimFeePolicyForm actorId="a1000000-0000-4000-8000-000000000001" initial={initial} sessionId="a1000000-0000-4000-8000-000000000002" />);
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';
const radio = (html: string, value: 'on' | 'off') => html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))?.[0] ?? '';

describe('배송비 청구 설정 폼 (kit)', () => {
  it('저장은 양식 제출이고(kit 버튼은 type을 주지 않으면 button이다), 근거 칸·확인 체크 없이 바로 누를 수 있다', () => {
    const html = render();
    expect(button(html, '설정 저장')).toContain('type="submit"');
    expect(button(html, '설정 저장')).not.toContain('disabled=""');
    /* 설정 근거와 확인 체크는 없다. 저장돼 있던 근거도 화면에 다시 내보이지 않는다. */
    for (const gone of ['정책 근거', '합성 정책 근거', '확인했습니다', '<textarea', 'type="checkbox"', '현재 정책 다시 불러오기']) expect(html).not.toContain(gone);
    /* 저장됐는지 모를 때만 나오는 버튼은 처음에는 없다. */
    expect(html).not.toContain('저장됐는지 확인');
  });

  it('쓸지 말지를 카드 둘로 고르고, 쓸 때만 기본 청구 금액 칸과 되읽기 한 줄이 열린다', () => {
    const on = render();
    expect(radio(on, 'on')).toContain('checked=""'); expect(radio(on, 'off')).not.toContain('checked');
    for (const text of ['쓰지 않음', '고객과 합의한 요청에만 직접 청구', '반품 기본 청구 금액 (원)', '교환 기본 청구 금액 (원)']) expect(on).toContain(text);
    expect(on).toMatch(/<input[^>]*data-slot="input"[^>]*value="3000"/);
    expect(on).toMatch(/data-good-readback=""[^>]*>\[새 배송비 청구\]를 누르면 반품은 금액 칸에 3,000원이 미리 채워지고, 교환은 금액을 직접 적습니다\.</);
    const off = render({ ...policy, enabled: false });
    expect(radio(off, 'off')).toContain('checked=""');
    for (const closed of ['기본 청구 금액', 'data-good-readback', 'data-slot="input"']) expect(off).not.toContain(closed);
  });

  it('입금 받을 계좌가 없으면 직접 청구를 고를 수 없게 잠그고, 계좌를 등록하러 가는 버튼을 그 아래에 둔다', () => {
    const html = render({ ...policy, enabled: false, accountReady: false });
    expect(radio(html, 'on')).toContain('disabled=""'); expect(radio(html, 'off')).not.toContain('disabled');
    expect(html).toMatch(/data-good-choice-blocked=""[^>]*>입금 받을 계좌를 등록해야 고를 수 있습니다\.</);
    expect(html).toMatch(/<a[^>]*data-slot="button"[^>]*href="\/admin\/settings\/store\?section=bank_transfer"[^>]*>무통장 계좌 등록하러 가기<\/a>/);
    /* '쓰지 않음'으로는 저장할 수 있다. */
    expect(button(html, '설정 저장')).not.toContain('disabled=""');
    /* 켜져 있는데 계좌가 없어진 설정은 켠 채로 저장할 수 없다(DB도 거절한다). */
    expect(button(render({ ...policy, accountReady: false }), '설정 저장')).toContain('disabled=""');
    /* 계좌가 있으면 잠금 안내와 버튼이 없다. */
    const ready = render();
    expect(ready).not.toContain('data-good-choice-blocked'); expect(ready).not.toContain('무통장 계좌 등록하러 가기');
  });

  it('고객 화면 공용 claim-fees 클래스를 쓰지 않는다', () => {
    expect(render()).not.toMatch(/class="[^"]*\bclaim-fees\b/);
  });
});

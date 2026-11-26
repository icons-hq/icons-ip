import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/shipment-tracking-actions', () => ({ swapShipmentTrackingAction: vi.fn() }));
vi.mock('@/app/admin/shipment-tracking-lookup-actions', () => ({ searchTrackingSwapCandidatesAction: vi.fn() }));
import { ShipmentTrackingSwapForm } from './ShipmentTrackingSwapForm';

describe('뒤바뀐 운송장 맞바꾸기 양식 (SHP-031)', () => {
  /* 상대 배송건번호(16자리)와 그 운송장번호를 글자로 적게 하지 않는다 — 운송장번호로 찾은 배송 건을 공용 선택창에서 고른다(화면 규칙 1). */
  it('상대 배송 건은 선택창으로 고르고 사유를 받는다. 번호를 손으로 적는 칸이 없다', () => {
    const html = renderToStaticMarkup(<ShipmentTrackingSwapForm shipmentId="s" reference="2026111830000001" trackingNumber="100000000001" />);
    expect(html).toContain('aria-label="배송 건 2026111830000001 운송장 맞바꾸기"');
    expect(html).toContain('>상대 배송 건</label>');
    expect(html).toContain('상대 배송 건 고르기');
    expect(html).toContain('placeholder="이 배송 건의 실제 운송장번호를 쓰는 배송 건을 골라주세요"');
    expect(html).toContain('readOnly');
    expect(html).not.toContain('상대 배송건번호');
    expect(html).not.toContain('상대 배송 건의 지금 운송장번호');
    expect(html).not.toContain('16자리 배송건번호');
    /* DB가 사유를 요구해(tracking_swap_reason_required) 필수로 남기되, 이름이 필수라는 것과 사유가 가는 곳을 말한다. */
    expect(html).toContain('>맞바꾸는 사유 (필수 · 감사 기록에 남습니다)</label>');
    /* 고르기 전에는 숨은 값이 비어 있고, 선택창은 누를 때만 연다. */
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="otherShipment"[^>]*value=""|<input[^>]*name="otherShipment"[^>]*type="hidden"[^>]*value=""/);
    expect(html).not.toContain('<dialog');
    expect(html).toContain('두 주문의 운송장이 서로 뒤바뀌어 등록됐을 때만 씁니다.');
    /* 운송장 수정이 '다른 주문이 쓰는 번호'로 거절된 자리에서 열리므로 한쪽만 틀린 경우의 안내는 따로 말하지 않는다. */
    expect(html).not.toContain('한쪽만 틀렸으면');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>운송장 맞바꾸기<\/button>/);
  });
});

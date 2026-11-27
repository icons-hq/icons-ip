// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/shipment-revert-actions', () => ({ revertShipmentDeliveryAction: vi.fn(), revertShipmentDispatchAction: vi.fn() }));
import { SHIPMENT_REVERT_RESULT, ShipmentStatusRevertPanel, shipmentRevertBlockedReason, type ShipmentStatusRevertTarget } from './ShipmentStatusRevertPanel';

const dispatchRow: ShipmentStatusRevertTarget = { id: 'c3a00000-0000-4002-8000-000000000031', reference: '2026112600010001', originName: '김포', kind: 'dispatch', expected: '123456789012', trackingLabel: '한진택배 123456789012' };
const deliveryRow: ShipmentStatusRevertTarget = { id: 'c3a00000-0000-4002-8000-000000000032', reference: '2026112600010002', originName: '남양주', kind: 'delivery', expected: '2026-11-25T01:00:00Z', trackingLabel: null };

describe('배송 상태 정정 패널', () => {
  it('설명 문단 대신 줄마다 무엇으로 되돌아가는지와, 발송 되돌리기는 회수되지 않는 배송 안내 메일을 말한다', () => {
    const html = renderToStaticMarkup(<ShipmentStatusRevertPanel targets={[dispatchRow, deliveryRow]} />);
    expect(html).toContain('aria-label="배송 상태 정정"');
    expect(html).toContain('김포 · 2026112600010001');
    expect(html).toContain('한진택배 123456789012');
    /* 배송건번호와 택배사 사이를 글자로 나눈다 — '2026112600010001한진택배'처럼 붙어 읽히지 않는다. */
    expect(html.replace(/<[^>]+>/g, '')).toContain('김포 · 2026112600010001 · 한진택배 123456789012');
    expect(html).toContain('발송 대기로 되돌립니다. 이미 보낸 배송 안내 메일은 회수되지 않습니다.');
    expect(html).toContain('배송중으로 되돌립니다.');
    expect(html).toContain('>발송 되돌리기<');
    expect(html).toContain('>배송완료 되돌리기<');
    for (const retired of ['엉뚱한 배송 건', '구매확정·리뷰·취소·반품·교환이 있는 주문은 되돌리지 않습니다']) expect(html, retired).not.toContain(retired);
  });
  it('발송 되돌리기가 말하는 메일 문장은 발송관리 처리 막대의 [발송처리] 안내와 같은 사실이다', () => {
    expect(SHIPMENT_REVERT_RESULT.dispatch).toContain('이미 보낸 배송 안내 메일은 회수되지 않습니다.');
  });
  it('지금 못 되돌리는 줄은 버튼을 잠그고 이유를 보인다', () => {
    const html = renderToStaticMarkup(<ShipmentStatusRevertPanel targets={[{ ...dispatchRow, blockedReason: '배송 안내 메일을 보내는 중입니다. 몇 분 뒤에 다시 시도해주세요.' }, deliveryRow]} />);
    expect(html).toContain('배송 안내 메일을 보내는 중입니다. 몇 분 뒤에 다시 시도해주세요.');
    expect(html).not.toContain('발송 대기로 되돌립니다.');
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="배송 건 2026112600010001 발송 되돌리기"[^>]*>발송 되돌리기<\/button>|<button[^>]*aria-label="배송 건 2026112600010001 발송 되돌리기"[^>]*disabled[^>]*>발송 되돌리기<\/button>/);
    expect(html.match(/data-shipment-revert="/g)).toHaveLength(1); /* 잠기지 않은 줄(배송완료 되돌리기)에만 실제 버튼이 있다 */
    expect(html).toContain('배송중으로 되돌립니다.');
  });
  it('배송완료 일시를 읽지 못한 줄은 서버가 받지 않으니 미리 잠그고 새로고침을 안내한다', () => {
    expect(shipmentRevertBlockedReason(deliveryRow)).toBeNull();
    expect(shipmentRevertBlockedReason({ ...deliveryRow, expected: null })).toBe('배송완료 일시를 읽지 못했습니다. 새로고침해주세요.');
    expect(shipmentRevertBlockedReason({ ...dispatchRow, expected: null })).toBeNull();
    expect(shipmentRevertBlockedReason({ ...deliveryRow, expected: null, blockedReason: '다른 이유' })).toBe('다른 이유');
    const html = renderToStaticMarkup(<ShipmentStatusRevertPanel targets={[{ ...deliveryRow, expected: null }]} />);
    expect(html).toContain('배송완료 일시를 읽지 못했습니다. 새로고침해주세요.');
    expect(html).not.toContain('data-shipment-revert="');
  });
  it('되돌릴 건도 결과도 없으면 그리지 않는다', () => {
    expect(renderToStaticMarkup(<ShipmentStatusRevertPanel targets={[]} />)).toBe('');
  });
});

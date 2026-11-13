import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * S36-075 통합(T04 needsOrchestrator): 목록 위 주문 상세 팝업(OrderPreviewDialog → ClaimPreviewKitDialog) 안의 처리 패널도
 * 서버 액션을 기다리는 동안 팝업에 처리 중을 알려 Esc·×·바깥 클릭으로 닫히지 않게 한다. 닫히면 서버에서 끝난 처리의 결과 문구가 사라진다.
 * 훅은 중립 모듈(components/orders/claim-preview-busy)에서 불러 고객 주문 화면과 같이 쓰는 패널이 어드민 대화상자 코드를 끌어오지 않는다.
 */
const PANELS: Record<string, number> = {
  'components/admin/ShipmentDeliveryPanel.tsx': 2, // 배송 방식 변경(MethodSelection)·인계·수령 기록(HandoffForm)
  'components/admin/screens/OrderNoteForm.tsx': 1,
  'components/admin/screens/OrderAddressEditor.tsx': 1,
  'components/admin/screens/SellerClaimIntakeForm.tsx': 1,
  'components/orders/PurchaseConfirmationPanel.tsx': 1,
  'components/admin/ShippingCollectPanel.tsx': 1,
  'components/admin/ShipmentPreorderPromisePanel.tsx': 1,
  'components/admin/OrderProductionPanel.tsx': 1,
};

describe('주문 상세 팝업 안 처리 패널의 대기 신호', () => {
  it.each(Object.entries(PANELS))('%s는 처리 중(pending)을 팝업에 알린다', (file, count) => {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    expect(source).toContain("import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';");
    expect(source.match(/useClaimPreviewBusy\(pending\);/g)?.length).toBe(count);
  });
});

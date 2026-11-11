import { OrderDetailScreen } from './OrderDetailScreen';
import { OrderPreviewDialog } from './OrderPreview';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { adminOrderDetailHrefFromBack } from '@/lib/admin/orders';
import type { AdminOrderPreview } from '@/lib/admin/order-preview.server';
import { orderReferenceLabel } from '@/lib/orders';

/**
 * 목록 위 주문 상세 팝업의 본문(S36-075). 전용 상세 라우트와 같은 화면(OrderDetailScreen)을 팝업 안(embedded)에 그린다 —
 * 클레임 팝업처럼 머리의 목록 돌아가기 버튼은 숨긴다(팝업 닫기와 겹치고, 누르면 기록을 쌓고 스크롤을 맨 위로 올린다).
 */
export function OrderPreviewPopup({ preview, orderId, closeHref, actorId, canManageSales = true, canReadOrders = true }: {
  preview: AdminOrderPreview; orderId: string; closeHref: string; actorId?: string;
  /** 판매 관리 권한. 없으면 팝업 안 상세의 처리 패널을 감춘다(로더가 읽은 권한과 함께 본다). */
  canManageSales?: boolean;
  /** 주문 상세 열람 권한. 없으면 팝업을 열지 않는다. */
  canReadOrders?: boolean;
}) {
  if (!canReadOrders) return null;
  const detailHref = adminOrderDetailHrefFromBack(orderId, closeHref);
  if (preview.kind !== 'loaded') {
    return <OrderPreviewDialog closeHref={closeHref} detailHref={detailHref} title="주문 상세">
      <AdminNotice role="alert" tone={preview.kind === 'error' ? 'danger' : 'warning'}>{preview.kind === 'forbidden'
        ? '주문 상세를 볼 권한이 없습니다. 로그인 계정의 판매 관리 권한을 확인해주세요.'
        : preview.kind === 'not_found' ? '주문을 찾을 수 없습니다. 목록을 새로고침해주세요.'
        : '주문 상세를 불러오지 못했습니다. 잠시 후 다시 열거나 새 탭으로 열어주세요.'}</AdminNotice>
    </OrderPreviewDialog>;
  }
  const { detail } = preview;
  return <OrderPreviewDialog closeHref={closeHref} detailHref={detailHref} title={`주문 ${orderReferenceLabel(detail.order.id, detail.order.orderNumber)} 상세`}>
    <OrderDetailScreen actorId={actorId} backHref={closeHref} canManage={preview.canManage && canManageSales} canViewCustomer={preview.canViewCustomer}
      detail={detail} downloads={preview.downloads} embedded noteOperationId={crypto.randomUUID()} production={preview.production} />
  </OrderPreviewDialog>;
}

// DB의 notifications.type CHECK 제약과 같은 목록이어야 한다.
// order_confirmed는 없다 — 발주확인은 운영 내부 단계라 구매자에게 알릴 것이 없다(#250).
export type NotificationType =
  | 'order_paid'
  | 'order_shipping'
  | 'order_delivered'
  | 'draw_ticket_issued'
  | 'drop_published'
  | 'event_published'
  | 'announcement'
  /* 1:1 문의 답변(#253). 발송은 admin_answer_inquiry가 같은 트랜잭션에서 남긴다. */
  | 'inquiry_answered'
  /* 무통장 입금 안내(#256). place_order가 주문을 만든 트랜잭션에서 함께 남긴다 —
     금액·입금자명 코드·기한이 그때 정해지고, 이 알림을 놓치면 구매자는 어디로
     얼마를 보낼지 알 수 없다. */
  | 'order_bank_transfer_pending'
  /* 클레임 단계 변화(#252) — 접수·승인·거부·보류·입고·환불·재출고를 한 타입으로
     묶는다. 단계마다 타입을 나누면 DB CHECK와 이 union이 아홉 번 갈라진다. */
  | 'claim_updated'
  /* 리뷰 운영자 답글(#254). 첫 답글에서만 나간다 — 답글을 다듬을 때마다 알리면
     "운영자가 또 뭐라고 했다"로 읽혀 알림 자체의 신뢰가 깎인다. */
  | 'review_replied'
  /* 재입고 알림(#326). goods 의 판매 가능 전이 트리거가 restock_alerts 의
     pending 신청을 notified 로 넘기면서 같은 트랜잭션에서 남긴다. */
  | 'restock_available'
  /* 회원 등급 승급(#329). 재산정·수동 보정이 승급을 확정한 트랜잭션에서 남긴다 —
     강등은 알리지 않고, 재승급은 같은 dedupe 키를 재부상시킨다. */
  | 'loyalty_grade_upgraded'
  /* 상품 Q&A 답변(#330). admin_answer_product_question RPC 가 답변을 저장한
     트랜잭션에서 남긴다 — 재답변도 같은 dedupe 키를 다시 띄운다. */
  | 'product_question_answered';

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link_path: string;
  read_at: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath: string;
  readAt: string | null;
  createdAt: string;
  isUnread: boolean;
}

export function isSafeNotificationLink(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function notificationOpenedPath(linkPath: string, openSignal: string) {
  const url = new URL(linkPath, 'https://icons.local');
  url.searchParams.set('notification_opened', openSignal);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function toNotificationItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkPath: isSafeNotificationLink(row.link_path) ? row.link_path : '/notifications',
    readAt: row.read_at,
    createdAt: row.created_at,
    isUnread: row.read_at === null,
  };
}

/**
 * 상태 → 색 tone의 단일 진실원(ADR-0029).
 *
 * 같은 상태는 모든 화면에서 같은 색이다. 화면은 tone을 직접 고르지 않고 이 표를 거쳐 AdminStatusBadge에 넘긴다.
 * 색만으로 뜻을 전하지 않도록 배지는 항상 상태 이름을 글자로 함께 보인다.
 *
 * - neutral: 끝났거나 조용한 상태(초안·종결·보관·거래확정)
 * - info: 진행 중(배송중·검토중·예약)
 * - success: 정상 완료(배송완료·답변 완료·공개)
 * - warning: 사람이 곧 처리해야 함(입금 대기·미답변·임박)
 * - danger: 문제·중단(취소·거부·품절·실패)
 */
export type AdminTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONES = {
  /** 주문 상태 — lib/admin/orders ADMIN_ORDER_STATUS_LABELS */
  order: { pending: 'warning', paid: 'warning', confirmed: 'info', shipping: 'info', delivered: 'success', done: 'neutral', canceled: 'danger' },
  /** 티켓 예매 상태 */
  ticketOrder: { pending: 'warning', paid: 'success', canceled: 'danger' },
  /** 결제 상태 */
  payment: { pending: 'warning', paid: 'success', canceled: 'danger', failed: 'danger', refunded: 'neutral' },
  /** 클레임 단계 — lib/orders/claims ORDER_CLAIM_STAGE_LABELS */
  claim: { requested: 'warning', in_review: 'info', collecting: 'info', collected: 'info', on_hold: 'warning', processing: 'info', needs_review: 'danger', completed: 'success', rejected: 'danger', withdrawn: 'neutral' },
  /** 고객문의 */
  inquiry: { open: 'warning', answered: 'success', closed: 'neutral' },
  /** 상품문의 */
  question: { awaiting: 'warning', answered: 'success', hidden: 'neutral' },
  /** 리뷰 */
  review: { visible: 'success', hidden: 'neutral' },
  /** 신고 */
  report: { open: 'warning', reviewing: 'info', resolved: 'success', dismissed: 'neutral' },
  /** 게시 상태(상품·IP 등) */
  publication: { draft: 'neutral', published: 'success', archived: 'neutral', unknown: 'warning' },
  /** 판매 상태(운영) */
  operation: { active: 'success', stopped: 'danger', unknown: 'warning' },
  /** 재고 */
  stock: { ok: 'success', low: 'warning', soldout: 'danger' },
  /** 전시·노출 */
  display: { active: 'success', scheduled: 'info', ended: 'neutral', inactive: 'neutral' },
  /** 쇼핑스토리 */
  story: { scheduled: 'info', active: 'success', ended: 'neutral' },
  /** 캠페인 */
  campaign: { draft: 'neutral', published: 'success', ended: 'neutral' },
  /** 쿠폰 */
  coupon: { active: 'success', archived: 'neutral', scheduled: 'info', ended: 'neutral' },
  /** 마케팅 메시지 */
  marketing: { draft: 'neutral', queued: 'info', processing: 'info', completed: 'success', blocked: 'warning', canceled: 'neutral', expired: 'warning' },
  /** 선물 */
  gift: { awaiting_acceptance: 'warning', accepted: 'info', ordered: 'success', declined: 'neutral', expired: 'neutral', canceled: 'danger' },
  /** 티켓 */
  ticket: { valid: 'success', used: 'neutral', refunded: 'neutral' },
  /** 판매 준비 */
  readiness: { ready: 'success', blocked: 'warning', review_required: 'warning', unknown: 'warning' },
  /* 화면군별 상태. 새 상태는 자기 화면군 줄 아래에만 더한다(병렬 작업 합칠 때 겹치지 않게). */
  // [sales]
  /** 배송 건 — lib/orders/shipments ShipmentStatus */
  shipment: { ready: 'info', shipping: 'info', delivered: 'success', canceled: 'danger' },
  /** 환불 원장 — lib/orders refundStatusLabel */
  refund: { requested: 'warning', awaiting_transfer: 'warning', done: 'success', failed: 'danger' },
  /** 무통장 환불 송금 단계 — lib/admin/bank-transfer-refund phase */
  refundTransfer: { not_confirmed: 'warning', awaiting_transfer: 'warning', completed: 'success' },
  /** 미결제 무통장의 결제 시도. 입금 대기는 이 목록의 평상 상태라 조용히 둔다(전 행이 주의색이면 기한 임박 신호가 죽는다). missing은 원장이 없는 주문 */
  unpaid: { prepared: 'neutral', confirming: 'info', needs_review: 'danger', unknown: 'danger', missing: 'danger' },
  /** 반품·교환 배송비 청구 — lib/orders/claim-fees */
  claimFee: { unpaid: 'warning', reported: 'warning', paid: 'success', waived: 'neutral', voided: 'neutral', refund_due: 'danger', refunded: 'success' },
  /** 정기구매 신청 — lib/subscriptions/model */
  subscription: { draft: 'neutral', awaiting_first_payment: 'info', active: 'success', paused: 'neutral', needs_confirmation: 'warning', canceled: 'danger' },
  /** 정기구매 회차 결제 */
  subscriptionCycle: { draft: 'neutral', ready: 'info', prepared: 'info', dispatching: 'info', unknown: 'warning', needs_review: 'danger', approved: 'success', declined: 'danger', canceled: 'danger', skipped: 'neutral' },
  /** 배송 건별 지연 안내 결과 — lib/admin/shipment-delay-notice */
  delayNotice: { sent: 'success', partial_failed: 'warning', pending: 'info', unknown: 'warning', not_sent: 'neutral' },
  /** 지연 안내 채널별 결과 — lib/admin/order-delay-notices */
  delayNoticeChannel: { prepared: 'neutral', queued: 'info', processing: 'info', sent: 'success', failed: 'danger', unknown: 'warning', suppressed: 'neutral' },
  /** 배송 안내 메일 작업 */
  shipmentEmail: { pending: 'info', processing: 'info', completed: 'success', review: 'danger' },
  /** 착불 배송비 수납 — lib/admin/shipping-collect-events */
  shippingCollect: { planned: 'info', collected: 'success', void: 'neutral', refund_review: 'warning', refunded: 'neutral', mismatch: 'danger' },
  /** 주문제작 — lib/order-production */
  production: { pending: 'warning', started: 'info', completed: 'success', canceled: 'danger' },
  // [cs]
  // [catalog]
  // [ops]
} as const satisfies Record<string, Record<string, AdminTone>>;

export type AdminStatusDomain = keyof typeof STATUS_TONES;

/** 도메인·상태값의 tone. 표에 없는 값은 눈에 띄지 않게 neutral로 둔다(모르는 상태를 초록·빨강으로 보이지 않는다). */
export function statusTone(domain: AdminStatusDomain, status: string | null | undefined): AdminTone {
  if (!status) return 'neutral';
  const tones: Record<string, AdminTone> = STATUS_TONES[domain];
  return tones[status] ?? 'neutral';
}

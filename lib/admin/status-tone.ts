/**
 * 상태 → 색 tone의 단일 진실원(ADR-0029).
 *
 * 같은 상태는 모든 화면에서 같은 색이다. 화면은 tone을 직접 고르지 않고 이 표를 거쳐 AdminStatusBadge에 넘긴다.
 * 색만으로 뜻을 전하지 않도록 배지는 항상 상태 이름을 글자로 함께 보인다.
 *
 * - neutral: 끝났거나 조용한 상태(초안·종결·보관·거래확정)
 * - info: 진행 중(배송중·검토중·예약)
 * - success: 정상 완료(배송완료·답변 완료·공개)
 * - warning: 우리가 곧 처리해야 함(신규주문·미답변·임박). 고객을 기다리는 상태(입금 대기·선물 수락 대기)는 neutral이다
 * - danger: 문제·중단(취소·거부·품절·실패)
 */
export type AdminTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONES = {
  /** 주문 상태 — lib/admin/orders ADMIN_ORDER_STATUS_LABELS */
  order: { pending: 'neutral', paid: 'warning', confirmed: 'info', shipping: 'info', delivered: 'success', done: 'neutral', canceled: 'danger' },
  /** 티켓 예매 상태 */
  ticketOrder: { pending: 'warning', paid: 'success', canceled: 'danger' },
  /** 결제 상태 */
  payment: { pending: 'warning', paid: 'success', canceled: 'danger', failed: 'danger', refunded: 'neutral' },
  /** 클레임 단계 — lib/orders/claims ORDER_CLAIM_STAGE_LABELS */
  claim: { requested: 'warning', in_review: 'info', collecting: 'info', collected: 'warning', on_hold: 'neutral', processing: 'info', needs_review: 'danger', completed: 'success', rejected: 'neutral', withdrawn: 'neutral' },
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
  gift: { awaiting_acceptance: 'neutral', accepted: 'info', ordered: 'success', declined: 'neutral', expired: 'neutral', canceled: 'danger' },
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
  /** 정기구매 신청 — lib/subscriptions/model. 해지는 이미 끝난 건이라 조용히 두고 처리할 '변경 내용 확인 필요'만 띄운다 */
  subscription: { draft: 'neutral', awaiting_first_payment: 'info', active: 'success', paused: 'neutral', needs_confirmation: 'warning', canceled: 'neutral' },
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
  /** PG 정산 거래 구분 — lib/settlements/report. 승인은 평상 상태라 조용히 두고 취소 줄만 구분한다 */
  pgSettlementKind: { approval: 'neutral', cancel: 'danger' },
  /** PG 정산 수집 시점 대조 — lib/settlements/report */
  pgSettlementMatch: { matched: 'success', unlinked: 'warning', mismatch: 'danger' },
  // [cs]
  /** 상담하기 대화 상태 — lib/admin/inquiry-chat CHAT_STATUS_OPTIONS. 답변 뒤 대화가 이어지는 '진행중'은 진행 색이고, 고객문의의 '답변 완료'와 뜻이 달라 별도 줄이다 */
  inquiryChat: { open: 'warning', answered: 'info', closed: 'neutral' },
  /** 고객문의 답변 만족도 — lib/inquiry-satisfaction */
  inquirySatisfaction: { satisfied: 'success', dissatisfied: 'danger', unrated: 'neutral' },
  /** 상품문의 노출 */
  questionVisibility: { visible: 'success', hidden: 'neutral' },
  /** BEST 리뷰 선정 — lib/review-best */
  reviewBest: { selected: 'success', not_selected: 'neutral', needs_review: 'warning' },
  /** BEST 리뷰 적립금 보상 — lib/admin/customer-rewards */
  reviewBestReward: { none: 'neutral', disabled: 'neutral', pending: 'info', paid: 'success', revoked: 'neutral', capped: 'warning', skipped: 'neutral' },
  /** 리뷰이벤트 — lib/review-events */
  reviewEvent: { scheduled: 'info', active: 'success', closed: 'warning', ready: 'warning', announced: 'neutral', archived: 'neutral' },
  /** 회원 계정 */
  member: { active: 'success', suspended: 'danger' },
  /** 회원 권한(profiles.role). 관리자만 눈에 띄게 한다 */
  memberRole: { admin: 'info', staff: 'neutral', user: 'neutral' },
  /** 매니저 역할 — lib/admin/access MANAGER_ROLES. 통합 매니저만 눈에 띄게 한다 */
  managerRole: { owner: 'info', primary: 'neutral', deputy: 'neutral', influencer: 'neutral', agency: 'neutral', logistics: 'neutral' },
  /** 메일 발송 — lib/email/dedupe */
  emailDelivery: { pending: 'info', sent: 'success', failed: 'danger' },
  /** 매니저 초대 — lib/admin/operator-invitations */
  operatorInvitation: { pending: 'warning', accepted: 'success', cancelled: 'neutral', replaced: 'neutral', expired: 'neutral' },
  /** 매니저 초대 메일 — invitationEmailLabel이 돌려주는 상태 이름 */
  operatorInvitationEmail: { '전달 완료': 'success', '발송 접수': 'info', '발송 처리 중': 'info', '발송 대기': 'neutral', '전달 지연': 'warning', '재초대 필요': 'warning', '결과 확인 필요': 'warning', '발송 설정 확인 필요': 'warning', '발송 실패': 'danger' },
  // [catalog]
  /** 카드풀 운영 기간 */
  cardPool: { scheduled: 'info', active: 'success', ended: 'neutral' },
  /** 참여형 게임 */
  game: { scheduled: 'info', active: 'success', ended: 'neutral', 'pool-unavailable': 'danger' },
  /** 카드팩 발급 정책 */
  rewardPolicy: { inactive: 'neutral', scheduled: 'info', active: 'success', ended: 'neutral', 'pool-unavailable': 'danger' },
  /** 이벤트 — 화면 이름 그대로 저장된 값이다. 아직 안 연 것(예정)은 파랑, 지금 팔거나 열려 있는 것(예매중·진행중)은 초록이다 */
  event: { 예정: 'info', 예매중: 'success', 진행중: 'success', 종료: 'neutral' },
  /** 티켓 회차 정원 */
  ticketAllocation: { open: 'success', full: 'danger', empty: 'neutral' },
  /** 상품공지사항 전시 */
  goodsAnnouncement: { waiting: 'info', shown: 'success', stopped: 'neutral' },
  /** 연관상품 편성 전시 */
  goodsRelation: { scheduled: 'info', active: 'success', stopped: 'neutral', ended: 'neutral' },
  /** 그룹상품 연결 */
  goodsGroup: { active: 'success', archived: 'neutral' },
  /** 카드팩 교환처 노출 */
  coinOffer: { active: 'success', disabled: 'neutral' },
  /** 상품 엑셀 검증 분류 */
  goodsImport: { new: 'success', update: 'info', unchanged: 'neutral', error: 'danger' },
  /** 사방넷 열 인식 */
  sabangnetColumn: { confirmed: 'success', guessed: 'warning', remembered: 'neutral', known: 'neutral', unknown: 'warning', duplicate: 'warning', manual: 'neutral' },
  /** 카테고리 일괄 등록 줄별 결과 */
  categoryBulk: { created: 'success', skipped: 'neutral', failed: 'danger' },
  /** 할인 프로모션 — lib/admin/discount-promotions DiscountPromotionPhase. 중지는 끝난 것과 같은 조용한 색이다 */
  discountPromotion: { scheduled: 'info', running: 'success', ended: 'neutral', stopped: 'neutral' },
  /** 전시 상품 여러 줄·엑셀 추가의 줄별 결과 — components/admin/GoodBulkAddPanel. 못 찾은 줄만 확인을 부른다 */
  goodReference: { ready: 'success', blocked: 'neutral', missing: 'warning' },
  // [ops]
  /** 쿠폰 혜택상태(lib/admin/coupons couponPhase) — 중지는 coupon.archived(보관)와 같은 색이다. */
  couponPhase: { scheduled: 'info', live: 'success', ended: 'neutral', stopped: 'neutral' },
  /** 쿠폰 지정 발급 작업 */
  couponIssue: { prepared: 'info', invalid: 'warning', completed: 'success', failed: 'danger' },
  /** 설정 항목(출고지·배송비 묶음그룹·템플릿 등)의 사용 상태 */
  setting: { active: 'success', inactive: 'neutral', archived: 'neutral' },
  /** 지역 추가 배송비 정책 버전. 중단은 신규 주문 차단과 이어져 확인이 필요하다(초안과 다른 색이다). */
  regionPolicy: { draft: 'neutral', active: 'success', retired: 'warning' },
  /** 적립금 일괄 지급 작업 */
  creditBatch: { prepared: 'warning', invalid: 'warning', completed: 'success', failed: 'danger' },
} as const satisfies Record<string, Record<string, AdminTone>>;

export type AdminStatusDomain = keyof typeof STATUS_TONES;

/** 도메인·상태값의 tone. 표에 없는 값은 눈에 띄지 않게 neutral로 둔다(모르는 상태를 초록·빨강으로 보이지 않는다). */
export function statusTone(domain: AdminStatusDomain, status: string | null | undefined): AdminTone {
  if (!status) return 'neutral';
  const tones: Record<string, AdminTone> = STATUS_TONES[domain];
  return tones[status] ?? 'neutral';
}

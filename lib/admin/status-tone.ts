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
  // [cs]
  // [catalog]
  /** 카드풀 운영 기간 */
  cardPool: { scheduled: 'info', active: 'success', ended: 'neutral' },
  /** 참여형 게임 */
  game: { scheduled: 'info', active: 'success', ended: 'neutral', 'pool-unavailable': 'danger' },
  /** 카드팩 발급 정책 */
  rewardPolicy: { inactive: 'neutral', scheduled: 'info', active: 'success', ended: 'neutral', 'pool-unavailable': 'danger' },
  /** 이벤트 — 화면 이름 그대로 저장된 값이다 */
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
  // [ops]
} as const satisfies Record<string, Record<string, AdminTone>>;

export type AdminStatusDomain = keyof typeof STATUS_TONES;

/** 도메인·상태값의 tone. 표에 없는 값은 눈에 띄지 않게 neutral로 둔다(모르는 상태를 초록·빨강으로 보이지 않는다). */
export function statusTone(domain: AdminStatusDomain, status: string | null | undefined): AdminTone {
  if (!status) return 'neutral';
  const tones: Record<string, AdminTone> = STATUS_TONES[domain];
  return tones[status] ?? 'neutral';
}

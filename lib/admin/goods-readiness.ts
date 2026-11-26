/** Serializable server-owned decisions. This module contains presentation only. */
export const GOODS_READINESS_REASONS = {
  archived: { label: '보관된 상품', detail: '상품을 복원한 뒤 공개 준비를 확인하세요.', target: 'publish' },
  draft: { label: '초안 · 공개 전', detail: '필요한 입력과 KC 검토 후 공개를 요청하세요.', target: 'publish' },
  stopped: { label: '판매상태가 판매중지', detail: '추가 설정의 판매상태가 판매중지입니다. 재고수량이 남아 있어도 팔리지 않습니다. 팔려면 판매상태를 판매중으로 바꿔 저장하세요.', target: 'basic' },
  ip_unpublished: { label: '연결 IP 비공개', detail: '연결 IP의 게시 상태를 확인하세요.', target: 'ip' },
  ip_archived: { label: '연결 IP 보관', detail: '연결 IP를 복원하거나 다른 IP 연결을 검토하세요.', target: 'ip' },
  /* ADR-0044: 상품 유형은 없다. 공개하려면 대표 카테고리가 있어야 한다. 초안은 blocking, 공개 중은 review다(DB가 정한다). */
  category_missing: { label: '대표 카테고리 없음', detail: '대표 카테고리를 골라야 공개할 수 있습니다. 공개 중인 상품도 대표 카테고리를 정해 두세요.', target: 'basic' },
  image_missing: { label: '대표 이미지 미입력', detail: '대표 이미지를 등록하고 기본 상품 정보를 저장하세요.', target: 'basic' },
  notice_missing: { label: '고시정보 미입력', detail: '상품정보제공고시의 필수 항목을 확인하세요.', target: 'notice' },
  no_active_options: { label: '사용 중인 옵션 없음', detail: '사용 중인 옵션이 없습니다. ‘옵션 사용 중지·다시 사용’에서 팔 옵션의 [다시 사용]을 누르거나 새 옵션을 더하세요. 옵션을 바꾸면 KC 검토 범위도 함께 확인하세요.', target: 'variants' },
  stock_unavailable: { label: '판매 가능 수량 없음', detail: '팔 수 있는 수량이 없습니다. 사용 중인 옵션의 재고수량과, 예약판매라면 예약 수량·판매 기간을 확인하세요.', target: 'variants' },
  payment_disabled: { label: '결제수단 모두 중지', detail: '현재 상품에서 허용하는 결제수단을 확인하세요.', target: 'sale' },
  restricted_sale: { label: '판매 제한 상품', detail: '현재 판매 제한 상품의 공개·구매는 닫혀 있습니다.', target: 'restriction' },
  shipping_unavailable: { label: '출고지 사용 불가', detail: '상품에 연결한 출고지의 사용 상태를 확인하세요.', target: 'shipping' },
  kc_required: { label: 'KC 검토 필요', detail: '초안 저장 후 KC 정보에서 검토하세요. KC 대상이 아니면 상품 전체 KC 해당 없음으로 끝낼 수 있습니다.', target: 'kc' },
  kc_legacy_unrecorded: { label: '기존 공개 · KC 미기록', detail: 'KC 검토 기록 없이 공개된 상품입니다. 지금 공개 상태는 그대로 유지됩니다. 초안으로 돌리거나 다시 공개하기 전에 KC 정보에서 검토를 마치세요.', target: 'kc' },
  readiness_unknown: { label: '준비 상태 확인 필요', detail: '현재 준비 정보를 읽지 못했습니다. 새로고침 후 다시 확인하세요.', target: 'publish' },
} as const;
export type GoodsReadinessReasonCode = keyof typeof GOODS_READINESS_REASONS;
export type GoodsReadinessTarget = typeof GOODS_READINESS_REASONS[GoodsReadinessReasonCode]['target'];
export type GoodsReadinessFilter = 'all' | 'review_required' | 'ready' | GoodsReadinessReasonCode;
export interface AdminGoodsReadiness {
  state: 'ready' | 'blocked' | 'review_required' | 'unknown';
  checkedAt: string | null;
  publication: 'draft' | 'published' | 'archived' | 'unknown';
  operation: 'active' | 'stopped' | 'unknown';
  availableQty: number | null;
  publicReview: 'current' | 'required' | 'legacy_unrecorded' | 'unknown';
  saleSettings: 'ready' | 'blocked' | 'unknown';
  reviewRequired: boolean;
  reasons: { code: GoodsReadinessReasonCode; label: string; detail: string; target: GoodsReadinessTarget; kind: 'blocking' | 'review' | 'info' }[];
}
export const GOODS_READINESS_STATE_LABELS: Record<AdminGoodsReadiness['state'], string> = {
  ready: '설정 준비 완료', blocked: '판매 준비 중', review_required: '검토 필요', unknown: '확인 필요',
};
export function goodsReadinessAnchor(target: GoodsReadinessTarget): string {
  if (target === 'kc' || target === 'publish') return `good-operation-${target}`;
  return `good-section-${target === 'ip' ? 'basic' : target}`;
}
/**
 * 준비 사유를 눌렀을 때 닿는 상품 수정 화면의 자리. 편집기의 판매 준비 카드와 상품 목록의 사유 링크가 함께 쓴다 — 한 곳에서 정해야
 * 같은 사유가 화면마다 다른 곳으로 가지 않는다. 사유 표의 대상(`target`)이 기본이고, 입력이 다른 카드로 옮겨 간 세 사유만 그 칸으로 보낸다:
 * 대표 카테고리(기본 정보 맨 위 칸), 판매상태(접혀 있는 '추가 설정'), 대표 이미지('상품이미지' 카드).
 */
export function goodReadinessReasonAnchor(reason: { code: GoodsReadinessReasonCode; target: GoodsReadinessTarget }): string {
  if (reason.code === 'category_missing') return 'good-section-category';
  return reason.code === 'stopped' ? 'good-section-information' : reason.code === 'image_missing' ? 'good-section-images' : goodsReadinessAnchor(reason.target);
}
export function unknownGoodsReadiness(): AdminGoodsReadiness {
  return { state: 'unknown', checkedAt: null, publication: 'unknown', operation: 'unknown', availableQty: null,
    publicReview: 'unknown', saleSettings: 'unknown', reviewRequired: true,
    reasons: [{ code: 'readiness_unknown', ...GOODS_READINESS_REASONS.readiness_unknown, kind: 'review' }] };
}

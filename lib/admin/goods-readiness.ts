/** Serializable server-owned decisions. This module contains presentation only. */
export const GOODS_READINESS_REASONS = {
  archived: { label: '보관된 상품', detail: '상품을 복원한 뒤 공개 준비를 확인하세요.', target: 'publish' },
  draft: { label: '초안 · 공개 전', detail: '필요한 입력과 KC 검토 후 공개를 요청하세요.', target: 'publish' },
  stopped: { label: '운영자가 판매 중지', detail: '기본 정보의 운영 상태를 확인하세요. 실제 할당 재고와 별개입니다.', target: 'basic' },
  ip_unpublished: { label: '연결 IP 비공개', detail: '연결 IP의 게시 상태를 확인하세요.', target: 'ip' },
  ip_archived: { label: '연결 IP 보관', detail: '연결 IP를 복원하거나 다른 IP 연결을 검토하세요.', target: 'ip' },
  type_missing: { label: '상품 유형 미입력', detail: '공개에 필요한 상품 유형을 선택하세요.', target: 'basic' },
  image_missing: { label: '대표 이미지 미입력', detail: '대표 이미지를 등록하고 기본 상품 정보를 저장하세요.', target: 'basic' },
  notice_missing: { label: '고시정보 미입력', detail: '상품정보제공고시의 필수 항목을 확인하세요.', target: 'notice' },
  no_active_options: { label: '사용 중인 옵션 없음', detail: '기존 옵션과 KC 검토 범위를 확인하고 필요한 옵션을 사용하세요.', target: 'variants' },
  stock_unavailable: { label: '판매 가용 수량 없음', detail: '사용 옵션의 할당 재고와 예약판매 가용 수량·기간을 확인하세요.', target: 'variants' },
  payment_disabled: { label: '결제수단 모두 중지', detail: '현재 상품에서 허용하는 결제수단을 확인하세요.', target: 'sale' },
  restricted_sale: { label: '판매 제한 상품', detail: '현재 판매 제한 상품의 공개·구매는 닫혀 있습니다.', target: 'sale' },
  shipping_unavailable: { label: '출고지 사용 불가', detail: '상품에 연결한 출고지의 사용 상태를 확인하세요.', target: 'shipping' },
  kc_required: { label: 'KC 검토 필요', detail: '초안 저장 후 실제 모델·옵션과 근거를 검토하세요.', target: 'kc' },
  kc_legacy_unrecorded: { label: '기존 공개 · KC 미기록', detail: '기존 공개 상태는 유지됩니다. 초안 전환·재공개 전에 KC 검토를 확인하세요.', target: 'kc' },
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
export function unknownGoodsReadiness(): AdminGoodsReadiness {
  return { state: 'unknown', checkedAt: null, publication: 'unknown', operation: 'unknown', availableQty: null,
    publicReview: 'unknown', saleSettings: 'unknown', reviewRequired: true,
    reasons: [{ code: 'readiness_unknown', ...GOODS_READINESS_REASONS.readiness_unknown, kind: 'review' }] };
}

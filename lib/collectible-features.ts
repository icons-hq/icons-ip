/* 카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치(2026-11-18).
 *
 * 세 기능은 판매·운영하지 않기로 해 DB 스위치(`private.collectible_feature_control`, 기본 꺼짐)가
 * 노출과 동작을 함께 닫는다. 꺼진 기능은 셸 진입점(GNB 메가메뉴·메뉴시트·푸터 스태프 시연 블록)과
 * 화면 안 링크에서 사라지고, 라우트는 누구에게나(스태프 포함) 404다. 다시 켜기는 관리자 화면
 * `/admin/settings/features` 하나뿐이다 — 켜면 이전 동작(바인더, 마켓·트레이드 플레이스홀더와
 * 스태프 시연)이 그대로 돌아온다.
 *
 * 이 모듈은 의존성이 없어 `lib/routes.ts`·클라이언트 화면·서버 게이트가 순환 없이 함께 읽는다.
 * 값을 읽는 경로는 `collectible-features.server.ts`(셸 캐시 읽기·라우트 신선 읽기)다. 읽지 못한
 * 값은 언제나 꺼짐이다(fail-closed). */

export const COLLECTIBLE_FEATURE_IDS = ['binder', 'market', 'exchange'] as const;
export type CollectibleFeature = (typeof COLLECTIBLE_FEATURE_IDS)[number];
export type CollectibleFeatures = Record<CollectibleFeature, boolean>;

export const COLLECTIBLE_FEATURES_OFF: CollectibleFeatures = Object.freeze({ binder: false, market: false, exchange: false });

/** 셸 캐시 태그 — 관리자 저장이 즉시 만료시킨다(`app/admin/collectible-features-actions.ts`). */
export const COLLECTIBLE_FEATURES_CACHE_TAG = 'collectible-features';

/** 어드민·고객 화면이 같은 이름을 쓰도록 한 곳에서 정한다(CONTEXT.md: 바인더·마켓·트레이드). */
export const COLLECTIBLE_FEATURE_LABELS: Record<CollectibleFeature, string> = {
  binder: '카드 바인더',
  market: '굿즈 마켓',
  exchange: '카드 트레이드',
};

export function isCollectibleFeature(value: unknown): value is CollectibleFeature {
  return typeof value === 'string' && (COLLECTIBLE_FEATURE_IDS as readonly string[]).includes(value);
}

/** 공개 읽기 RPC 응답을 그대로 믿지 않는다 — 세 키가 정확히 불리언일 때만 통과, 아니면 null(호출부가 꺼짐으로 읽는다). */
export function parseCollectibleFeatures(value: unknown): CollectibleFeatures | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== COLLECTIBLE_FEATURE_IDS.length || !COLLECTIBLE_FEATURE_IDS.every((id) => typeof record[id] === 'boolean')) return null;
  return { binder: record.binder as boolean, market: record.market as boolean, exchange: record.exchange as boolean };
}

/** 내비 항목 id 가 꺼진 수집·거래 기능을 가리키는가. 다른 id 는 이 스위치와 무관하다. */
export function isHiddenCollectibleRoute(routeId: string, features: CollectibleFeatures): boolean {
  return isCollectibleFeature(routeId) && !features[routeId];
}

import { SHOP_DEFAULT_SORT, type ShopListQuery } from '@/lib/shop-catalog';

/* 컬렉션 필터 draft·URL 직렬화 순수 함수 (#326, LFS 패리티 2차 L4).
 * 굿즈샵·NEW·BEST·검색·IP관이 같은 사이드바와 바텀시트를 쓰므로 조합 규칙도 한 곳에 둔다.
 * jsdom 없는 이 저장소에서 조합 규칙을 단언할 수 있는 지점이 이 함수들뿐이라 화면과 분리했다. */

export interface ShopFilterDraft {
  ips: string[];
  categories?: string[];
  types: string[];
  priceMin: number | null;
  priceMax: number | null;
}

export const EMPTY_SHOP_FILTER_DRAFT: ShopFilterDraft = {
  ips: [],
  types: [],
  priceMin: null,
  priceMax: null,
};

export function shopFilterDraftFromQuery(query: ShopListQuery): ShopFilterDraft {
  return {
    ips: [...query.ips],
    ...(query.categories ? { categories: [...query.categories] } : {}),
    types: [...query.types],
    priceMin: query.priceMin,
    priceMax: query.priceMax,
  };
}

export function toggleDraftValue(
  draft: ShopFilterDraft,
  group: 'ips' | 'types' | 'categories',
  value: string,
): ShopFilterDraft {
  const current = draft[group] ?? [];
  return {
    ...draft,
    [group]: current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value],
  };
}

/* 두 핸들이 서로를 넘어설 수 있으므로 낮은 쪽·높은 쪽을 값으로 다시 정한다.
   양 끝에 붙은 핸들은 "제한 없음"이라 null 로 접어 URL 에서 아예 뺀다. */
export function setDraftPriceRange(
  draft: ShopFilterDraft,
  bounds: { min: number; max: number },
  priceCeil: number,
): ShopFilterDraft {
  const ceil = Math.max(0, Math.round(priceCeil));
  const clamp = (value: number) => Math.min(Math.max(0, Math.round(value)), ceil);
  const low = Math.min(clamp(bounds.min), clamp(bounds.max));
  const high = Math.max(clamp(bounds.min), clamp(bounds.max));

  return {
    ...draft,
    priceMin: low <= 0 ? null : low,
    priceMax: high >= ceil ? null : high,
  };
}

/** 컨트롤이 만들 다음 URL 의 쿼리 문자열. 뷰 기본 정렬은 싣지 않아 기본 상태 URL 이 깨끗하다. */
export function shopQueryString(query: ShopListQuery): string {
  const params = new URLSearchParams();
  if (query.displayCategory) params.set('displayCategory', query.displayCategory);
  for (const id of query.categories ?? []) params.append('category', id);
  for (const id of query.ips) params.append('ip', id);
  for (const type of query.types) params.append('type', type);
  if (query.priceMin !== null) params.set('min', String(query.priceMin));
  if (query.priceMax !== null) params.set('max', String(query.priceMax));
  if (query.sort !== SHOP_DEFAULT_SORT[query.view]) params.set('sort', query.sort);
  return params.toString();
}

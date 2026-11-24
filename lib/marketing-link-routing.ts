import { isMarketingLinkSource, validMarketingTarget, MARKETING_LINK_TOKEN } from '@/lib/admin/marketing-links';
import { goodDetailHref } from '@/lib/goods-display';
export const MARKETING_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
/**
 * Rebuild from known internal targets. Never accept a destination URL from data or queries.
 * 굿즈 링크는 상품 URL(내부 id)로 저장된다 — 정식 주소 끝 값(상품 자동코드, ADR-0050)을 알면 그 주소로 바로 보내고,
 * 모르면 옛 주소로 보내 상세가 코드 주소로 옮긴다.
 */
export function marketingDestination(value: unknown, search: URLSearchParams, verifiedToken?: string, goodSegment?: string | null): string | null {
  if (!value || typeof value !== 'object') return null;
  const { source, targetId } = value as Record<string, unknown>;
  if (!isMarketingLinkSource(source) || !validMarketingTarget(source, targetId)) return null;
  const path = source === 'home' ? '/' : source === 'good' ? goodDetailHref(goodSegment || targetId) : source === 'story' ? `/stories/${encodeURIComponent(targetId)}` : '/shop';
  const query = new URLSearchParams(source === 'category' ? { category: targetId } : undefined);
  for (const key of MARKETING_UTM_KEYS) {
    const values = search.getAll(key);
    if (values.length !== 1 || !values[0].trim() || values[0].length > 200 || [...values[0]].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) continue;
    query.set(key, values[0]);
  }
  if (verifiedToken && MARKETING_LINK_TOKEN.test(verifiedToken)) query.set('icm', verifiedToken);
  return `${path}${query.size ? `?${query}` : ''}`;
}

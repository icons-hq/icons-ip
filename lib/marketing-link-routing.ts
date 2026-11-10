import { isMarketingLinkSource, validMarketingTarget, MARKETING_LINK_TOKEN } from '@/lib/admin/marketing-links';
export const MARKETING_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
/** Rebuild from known internal targets. Never accept a destination URL from data or queries. */
export function marketingDestination(value: unknown, search: URLSearchParams, verifiedToken?: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const { source, targetId } = value as Record<string, unknown>;
  if (!isMarketingLinkSource(source) || !validMarketingTarget(source, targetId)) return null;
  const path = source === 'home' ? '/' : source === 'good' ? `/shop/${encodeURIComponent(targetId)}` : source === 'story' ? `/stories/${encodeURIComponent(targetId)}` : '/shop';
  const query = new URLSearchParams(source === 'category' ? { category: targetId } : undefined);
  for (const key of MARKETING_UTM_KEYS) {
    const values = search.getAll(key);
    if (values.length !== 1 || !values[0].trim() || values[0].length > 200 || [...values[0]].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) continue;
    query.set(key, values[0]);
  }
  if (verifiedToken && MARKETING_LINK_TOKEN.test(verifiedToken)) query.set('icm', verifiedToken);
  return `${path}${query.size ? `?${query}` : ''}`;
}

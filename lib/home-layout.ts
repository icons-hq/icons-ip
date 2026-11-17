const ORIGINAL_HOME_BLOCK_KEYS = ['hero', 'editor_picks', 'category_best', 'popular', 'benefits'] as const;
/* `stories`는 쇼핑스토리, `new_arrivals`·`strip_banner`는 X SQUARE 홈(ADR-0043)이 더한 고정 블록이다. 저장 레이아웃의 필수 키는
   ORIGINAL 다섯 개 그대로라 새 키가 없는 옛 저장값·옛 요청도 계속 읽힌다. DB `private.is_valid_home_layout_blocks`가 같은 목록을 검증한다. */
export const HOME_FIXED_BLOCK_KEYS = [...ORIGINAL_HOME_BLOCK_KEYS, 'stories', 'new_arrivals', 'strip_banner'] as const;
export type HomeFixedBlockKey = typeof HOME_FIXED_BLOCK_KEYS[number];
export type HomeRankingBlockKey = `sales:${string}` | `reviews:${string}` | `mosaic:${string}` | `products:${string}`;
export type HomeBlockKey = HomeFixedBlockKey | `band:${string}` | HomeRankingBlockKey;
export interface HomeLayoutBlock { key: HomeBlockKey; enabled: boolean }

const BAND_KEY = /^(band|sales|reviews|mosaic|products):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isHomeBlockKey(value: unknown): value is HomeBlockKey {
  return typeof value === 'string' && ((HOME_FIXED_BLOCK_KEYS as readonly string[]).includes(value) || BAND_KEY.test(value));
}

/**
 * Null configuration order (X SQUARE 홈 — 대응표 스펙 B §3): 히어로 → IP 바로가기 → NEW ARRIVAL → 스트립 배너 → IP 상품 섹션(상품 모음)
 * → ICONS PICK(기획전 배너) → 카테고리 BEST·인기템·혜택 → 판매·리뷰 랭킹·모자이크 → 쇼핑스토리. 상품 모음은 받은 순서(표시 순서)를 지킨다.
 */
export function defaultHomeBlockKeys(bandIds: readonly string[], rankingKeys: readonly HomeRankingBlockKey[] = []): HomeBlockKey[] {
  const collections = rankingKeys.filter((key) => key.startsWith('products:'));
  const rankings = rankingKeys.filter((key) => !key.startsWith('products:'));
  return ['hero', 'editor_picks', 'new_arrivals', 'strip_banner', ...collections, ...bandIds.map((id): HomeBlockKey => `band:${id}`),
    'category_best', 'popular', 'benefits', ...rankings, 'stories'];
}

/** Stale campaign references disappear; campaigns created after configuration append at the end. */
export function resolveHomeLayoutBlocks(saved: readonly HomeLayoutBlock[] | null, bandIds: readonly string[], rankingKeys: readonly HomeRankingBlockKey[] = []): HomeLayoutBlock[] {
  const defaults = defaultHomeBlockKeys(bandIds, rankingKeys);
  if (saved === null) return defaults.map((key) => ({ key, enabled: true }));
  const available = new Set(defaults);
  const seen = new Set<HomeBlockKey>();
  const blocks: HomeLayoutBlock[] = [];
  for (const block of saved) {
    if (!available.has(block.key) || seen.has(block.key)) continue;
    seen.add(block.key);
    blocks.push(block);
  }
  return [...blocks, ...defaults.filter((key) => !seen.has(key)).map((key) => ({ key, enabled: true }))];
}

/** The public RPC returns only visible render keys, never admin revision or hidden records. */
export function readPublicHomeLayoutOrder(value: unknown): HomeBlockKey[] | null {
  if (value === null) return null;
  return Array.isArray(value) ? [...new Set(value.filter(isHomeBlockKey))] : [];
}

export function parseHomeLayoutBlocks(value: unknown): HomeLayoutBlock[] | null {
  if (!Array.isArray(value) || value.length < ORIGINAL_HOME_BLOCK_KEYS.length || value.length > 1000) return null;
  const seen = new Set<HomeBlockKey>();
  const blocks: HomeLayoutBlock[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (Object.keys(entry).some((key) => key !== 'key' && key !== 'enabled')
      || !isHomeBlockKey(entry.key) || typeof entry.enabled !== 'boolean' || seen.has(entry.key)) return null;
    seen.add(entry.key);
    blocks.push({ key: entry.key, enabled: entry.enabled });
  }
  return ORIGINAL_HOME_BLOCK_KEYS.every((key) => seen.has(key)) ? blocks : null;
}

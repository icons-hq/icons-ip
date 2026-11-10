const ORIGINAL_HOME_BLOCK_KEYS = ['hero', 'editor_picks', 'category_best', 'popular', 'benefits'] as const;
export const HOME_FIXED_BLOCK_KEYS = [...ORIGINAL_HOME_BLOCK_KEYS, 'stories'] as const;
export type HomeFixedBlockKey = typeof HOME_FIXED_BLOCK_KEYS[number];
export type HomeRankingBlockKey = `sales:${string}` | `reviews:${string}` | `mosaic:${string}` | `products:${string}`;
export type HomeBlockKey = HomeFixedBlockKey | `band:${string}` | HomeRankingBlockKey;
export interface HomeLayoutBlock { key: HomeBlockKey; enabled: boolean }

const BAND_KEY = /^(band|sales|reviews|mosaic|products):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isHomeBlockKey(value: unknown): value is HomeBlockKey {
  return typeof value === 'string' && ((HOME_FIXED_BLOCK_KEYS as readonly string[]).includes(value) || BAND_KEY.test(value));
}

/** Null configuration preserves the current public section order, including each campaign. */
export function defaultHomeBlockKeys(bandIds: readonly string[], rankingKeys: readonly HomeRankingBlockKey[] = []): HomeBlockKey[] {
  return ['hero', 'editor_picks', 'category_best', ...bandIds.map((id): HomeBlockKey => `band:${id}`), 'popular', 'benefits', ...rankingKeys, 'stories'];
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

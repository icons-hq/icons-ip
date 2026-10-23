import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { getCatalogGoodsByIds } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';

/* 상세 보조 목록(관심·배송비 절약)은 인증 성인에게만 19금 굿즈를 싣는다. 가림 카드는 쓰지 않는다. */
async function fullAdultGoodsOrHidden() {
  return await getAdultGoodsAccess() === 'full' ? 'full' as const : 'hidden' as const;
}
import { emptyInterestCollection, normalizeExperienceGoodsIds, parseExperienceSection, parseOwnedInterestIds, parsePublicDetailExperience, parseShippingSavings, type DetailDiscovery, type InterestCollection, type PublicDetailExperience, type ShippingSavings } from './product-detail-experiences';

export async function loadPublicDetailExperienceConfig(): Promise<DetailDiscovery> {
  if (!getSupabaseConfig().isConfigured) return { interests: false, shippingSavings: false };
  try { const client = await createClient(); const { data, error } = await client.rpc('get_product_detail_experience_config');
    if (!error) { const config = parseExperienceSection('discovery', data); if (config) return config; }
  } catch { /* Optional public modules fail closed. */ }
  return { interests: false, shippingSavings: false };
}
export async function loadPublicDetailExperience(goodId: string): Promise<PublicDetailExperience | null> {
  if (!getSupabaseConfig().isConfigured) return null;
  try { const client = await createClient(); const { data, error } = await client.rpc('get_product_detail_experience', { p_good_id: goodId });
    return error ? null : parsePublicDetailExperience(data);
  } catch { return null; }
}
export async function loadProductInterestCollection(recent: unknown, guestCart: unknown): Promise<InterestCollection> {
  if (!getSupabaseConfig().isConfigured) return emptyInterestCollection();
  let ownerId: string | null = null;
  try {
    const client = await createClient();
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError && identity?.user) throw new Error('Unable to verify interest owner');
    ownerId = identity?.user?.id ?? null;
    const [configResult, ownedResult] = await Promise.all([client.rpc('get_product_detail_experience_config'), client.rpc('get_my_product_detail_interests')]);
    const config = configResult.error ? null : parseExperienceSection('discovery', configResult.data);
    if (!config) throw new Error('Interest settings unavailable');
    if (!config.interests) return emptyInterestCollection(ownerId);
    const owned = ownedResult.error ? null : parseOwnedInterestIds(ownedResult.data);
    if (!owned || owned.ownerId !== ownerId) throw new Error('Interest identity changed');
    const ids = { repurchase: owned.repurchase, cart: ownerId ? owned.cart : normalizeExperienceGoodsIds(guestCart), wishlist: owned.wishlist, recent: normalizeExperienceGoodsIds(recent) };
    const goods = await getCatalogGoodsByIds(Object.values(ids).flat(), { adultGoods: await fullAdultGoodsOrHidden() }); const byId = new Map(goods.map(good => [good.id, good]));
    const select = (kind: keyof typeof ids) => ids[kind].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    return { ownerId, enabled: true, groups: { repurchase: select('repurchase'), cart: select('cart'), wishlist: select('wishlist'), recent: select('recent') } };
  } catch { return { ...emptyInterestCollection(ownerId), unavailable: true }; }
}
export async function loadProductShippingSavings(goodId: string, variantId: string, qty: number): Promise<ShippingSavings> {
  try {
    const client = await createClient(); const { data, error } = await client.rpc('get_product_shipping_savings', { p_good_id: goodId, p_variant_id: variantId, p_qty: qty });
    const parsed = error ? null : parseShippingSavings(data); if (!parsed) throw new Error('Shipping savings unavailable');
    const goods = await getCatalogGoodsByIds(parsed.items.map(item => item.goodId), { adultGoods: await fullAdultGoodsOrHidden() }); const byId = new Map(goods.map(good => [good.id, good]));
    return { ...parsed, items: parsed.items.flatMap(item => {
      const good = byId.get(item.goodId), option = good?.options?.find(value => value.id === item.variantId);
      return good && option && option.stockQty >= item.qty ? [{ ...item, good }] : [];
    }) };
  } catch { return { items: [], nextChangeAt: null, unavailable: true }; }
}

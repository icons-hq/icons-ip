import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsTransactionOffers, type GoodsTransactionOffer } from './goods-transaction-offers';
import { GOODS_TRANSACTION_MAX_LINES, transactionGoodId } from './goods-transaction-values';

/**
 * null means unavailable, never an empty set of financial terms.
 * 쇼핑 화면 표시만 `storefrontReadCache`로 짧게 공유한다 — 결제 경로는 매번 새로 읽는다.
 */
export async function loadGoodsTransactionOffers(
  goodIds: readonly string[],
  options: { storefrontReadCache?: boolean } = {},
): Promise<GoodsTransactionOffer[] | null> {
  if (goodIds.length > GOODS_TRANSACTION_MAX_LINES || goodIds.some(id => !transactionGoodId(id))) return null;
  const ids = [...new Set(goodIds)];
  if (!ids.length) return [];
  try {
    const client = await createClient({ storefrontReadCache: options.storefrontReadCache === true });
    const result: GoodsTransactionOffer[] = [];
    for (let offset = 0; offset < ids.length; offset += 1000) {
      const batch = ids.slice(offset, offset + 1000);
      const { data, error } = await client.rpc('get_goods_transaction_offers_v3', { p_good_ids: batch });
      const offers = error ? null : parseGoodsTransactionOffers(data);
      const receivedIds = new Set(offers?.map(offer => offer.goodId));
      if (!offers || receivedIds.size !== batch.length || offers.length !== batch.length || batch.some(id => !receivedIds.has(id))) return null;
      result.push(...offers);
    }
    return result;
  } catch { return null; }
}

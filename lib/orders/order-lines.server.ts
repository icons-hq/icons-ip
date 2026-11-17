import 'server-only';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import type { AdultGoodsAccess } from '@/lib/adult-goods';
import { parseCheckoutTransactionReceipt } from '@/lib/checkout-transaction';
import type { GoodsTransactionDisplay } from '@/lib/goods-transaction';
import { publicMediaUrl } from '@/lib/media';
import type { createClient } from '@/lib/supabase/server';
import { buildOrderLines, type OrderLineGoodInfo, type OrderLineInputItem, type OrderLineView } from './order-lines';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface OrderLineOrderInput {
  orderId: string;
  items: ReadonlyArray<OrderLineInputItem>;
  /** 영수증이 아직 없고 v2(거래 영수증이 있는) 주문이면 true — 그때만 영수증 RPC를 부른다. */
  tryReceipt: boolean;
  /** 이미 읽은 영수증. 있으면 다시 읽지 않는다(주문 상세는 이미 `transaction`을 읽었다). */
  receipt?: GoodsTransactionDisplay | null;
}

/** PostgREST `in()` 한 번에 보내는 id 수. URL 길이 한도 안에서 나눈다. */
const ID_CHUNK = 1000;
const RECEIPT_CONCURRENCY = 6;

/** 보강 실패는 줄을 없애지 않는다. 결과 코드만 한 줄 남긴다 — 메시지·id·행 내용은 남기지 않는다. */
function logEnrichmentFailure(stage: string, error: unknown) {
  const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'unknown';
  console.error('[orders] line enrichment failed', `${stage}:${code}`);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

interface GoodRow { id: string; ip_id: string | null; image_path: string | null; bg: string | null; sale_restriction: string | null }
interface IpRow { id: string; title: string | null }

async function readGoods(supabase: SupabaseServerClient, goodIds: readonly string[]): Promise<{ goods: Map<string, OrderLineGoodInfo>; failed: boolean }> {
  const goods = new Map<string, OrderLineGoodInfo>();
  let failed = false;
  for (const ids of chunks(goodIds, ID_CHUNK)) {
    try {
      const { data, error } = await supabase.from('goods').select('id,ip_id,image_path,bg,sale_restriction').in('id', ids);
      if (error || !Array.isArray(data)) { failed = true; logEnrichmentFailure('goods', error); continue; }
      for (const row of data as GoodRow[]) {
        if (typeof row?.id !== 'string') continue;
        goods.set(row.id, {
          ipId: typeof row.ip_id === 'string' ? row.ip_id : null,
          imagePath: typeof row.image_path === 'string' && row.image_path ? row.image_path : null,
          bg: typeof row.bg === 'string' && row.bg ? row.bg : null,
          saleRestriction: row.sale_restriction === 'adult' ? 'adult' : 'none',
        });
      }
    } catch (error) {
      failed = true;
      logEnrichmentFailure('goods', error);
    }
  }
  return { goods, failed };
}

async function readIpTitles(supabase: SupabaseServerClient, ipIds: readonly string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (const ids of chunks(ipIds, ID_CHUNK)) {
    try {
      const { data, error } = await supabase.from('ips').select('id,title').in('id', ids);
      if (error || !Array.isArray(data)) { logEnrichmentFailure('ips', error); continue; }
      for (const row of data as IpRow[]) {
        if (typeof row?.id === 'string' && typeof row.title === 'string' && row.title) titles.set(row.id, row.title);
      }
    } catch (error) {
      logEnrichmentFailure('ips', error);
    }
  }
  return titles;
}

async function readReceipt(supabase: SupabaseServerClient, orderId: string): Promise<GoodsTransactionDisplay | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_goods_transaction_receipt', { p_order_id: orderId });
    if (error) { logEnrichmentFailure('receipt', error); return null; }
    const receipt = parseCheckoutTransactionReceipt(data);
    /* 다른 주문의 영수증이 섞여 들어오면 가격을 잘못 붙이므로 버린다. */
    return receipt && receipt.orderId === orderId ? receipt.display : null;
  } catch (error) {
    logEnrichmentFailure('receipt', error);
    return null;
  }
}

/** 동시에 `limit`개까지만 실행한다. 한 작업의 실패가 다른 작업을 멈추지 않는다(작업은 스스로 throw하지 않는다). */
async function mapWithLimit<T, R>(values: readonly T[], limit: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await task(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function readAdultAccess(): Promise<AdultGoodsAccess> {
  try {
    return await getAdultGoodsAccess();
  } catch (error) {
    logEnrichmentFailure('adult', error);
    /* 확인하지 못한 방문자에게 19금 굿즈 이미지를 보이지 않는다. */
    return 'masked';
  }
}

/**
 * 주문 품목 줄에 썸네일·IP명·정가를 보강한다(MD-0036). 굿즈·IP 행과 거래 영수증을 읽는 어떤 단계가 실패해도 그 단계의 값만
 * 비고 줄은 스냅샷 이름·수량·단가로 남는다 — 이 함수는 throw하지 않는다(보강은 장식이라 주문 목록·상세 전체를 막지 않는다).
 * 고객 세션 클라이언트로 읽으므로 `goods`·`ips`(공개 읽기)와 본인 주문 영수증만 보인다.
 */
export async function loadOrderLineViews(
  supabase: SupabaseServerClient,
  orders: ReadonlyArray<OrderLineOrderInput>,
): Promise<Map<string, OrderLineView[]>> {
  const result = new Map<string, OrderLineView[]>();
  if (!orders.length) return result;
  try {
    const goodIds = [...new Set(orders.flatMap((order) => order.items.map((item) => item.goodId)))];
    const [{ goods, failed: goodsFailed }, adultAccess] = await Promise.all([readGoods(supabase, goodIds), readAdultAccess()]);
    const ipIds = [...new Set([...goods.values()].flatMap((good) => (good.ipId ? [good.ipId] : [])))];
    const pending = orders.filter((order) => order.receipt === undefined && order.tryReceipt && order.items.length > 0);
    const [ipTitles, fetched] = await Promise.all([
      readIpTitles(supabase, ipIds),
      mapWithLimit(pending, RECEIPT_CONCURRENCY, (order) => readReceipt(supabase, order.orderId)),
    ]);
    const receipts = new Map(pending.map((order, index) => [order.orderId, fetched[index]] as const));
    /* 굿즈 행을 못 읽었으면 19금 여부를 모른다 — 품목 자체의 이미지 경로(선물 스냅샷)도 인증 전에는 쓰지 않는다. */
    const hideOwnImages = goodsFailed && adultAccess !== 'full';
    for (const order of orders) {
      const items = hideOwnImages ? order.items.map((item) => ({ ...item, imagePath: null })) : order.items;
      const receipt = order.receipt !== undefined ? order.receipt : receipts.get(order.orderId) ?? null;
      try {
        result.set(order.orderId, buildOrderLines({ items, receipt, goods, ipTitles, adultAccess, imageUrl: (path) => publicMediaUrl(path) }));
      } catch (error) {
        logEnrichmentFailure('build', error);
      }
    }
  } catch (error) {
    logEnrichmentFailure('lines', error);
  }
  /* 보강 전체가 막혔어도 주문마다 스냅샷 줄은 남긴다 — 화면이 줄이 없어 요약으로 물러나는 일을 줄인다. */
  for (const order of orders) {
    if (result.has(order.orderId)) continue;
    try {
      result.set(order.orderId, buildOrderLines({
        items: order.items.map((item) => ({ ...item, imagePath: null })),
        receipt: order.receipt ?? null,
        goods: new Map(),
        ipTitles: new Map(),
        adultAccess: 'masked',
        imageUrl: () => null,
      }));
    } catch (error) {
      logEnrichmentFailure('build', error);
    }
  }
  return result;
}

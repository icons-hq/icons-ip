import 'server-only';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import type { AdultGoodsAccess } from '@/lib/adult-goods';
import { parseCheckoutTransactionReceipt } from '@/lib/checkout-transaction';
import type { GoodsTransactionDisplay } from '@/lib/goods-transaction';
import { publicMediaUrl } from '@/lib/media';
import type { createClient } from '@/lib/supabase/server';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { buildOrderLines, type OrderItemDisplay, type OrderLineGoodInfo, type OrderLineInputItem, type OrderLineView } from './order-lines';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface OrderLineOrderInput {
  orderId: string;
  items: ReadonlyArray<OrderLineInputItem>;
  /**
   * 영수증이 아직 없고 v2(거래 영수증이 있는) 주문이면 true — 그때만 주문별 영수증 RPC를 부른다. 본인 직접 주문의 목록은
   * `itemDisplay`로 한꺼번에 읽으므로 false다. 배치 RPC가 덮지 못하는 선물 주문만 이 경로를 쓴다.
   */
  tryReceipt: boolean;
  /** 이미 읽은 영수증. 있으면 다시 읽지 않는다(주문 상세는 이미 `transaction`을 읽었다). */
  receipt?: GoodsTransactionDisplay | null;
  /**
   * 본인 직접 주문(선물 제외)이면 true — 정가·복수구매 단가 할인·부분 취소 뒤 남은 수량을 배치 RPC `my_order_item_display` 한 번으로
   * 읽는다. 품목의 `lineId`는 `my_order_items`가 준 id여야 한다(랜덤 판매 합친 줄 포함).
   */
  itemDisplay?: boolean;
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

/**
 * 본인 주문에 담긴 굿즈의 보강 값. goods 공개 읽기는 공개 상품만 열므로(20261118160000) 나중에 내려가거나
 * 19금 인증이 만료된 상품도 본인 주문 줄이면 돌려주는 RPC로 읽는다. 19금 가림은 아래 buildOrderLines가 계속 한다.
 */
async function readGoods(supabase: SupabaseServerClient, goodIds: readonly string[]): Promise<{ goods: Map<string, OrderLineGoodInfo>; failed: boolean }> {
  const goods = new Map<string, OrderLineGoodInfo>();
  let failed = false;
  for (const ids of chunks(goodIds, ID_CHUNK)) {
    try {
      const { data, error } = await supabase.rpc('my_order_line_goods', { p_good_ids: ids });
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

interface ItemDisplayRow {
  id: string;
  regular_unit_price: number | null;
  volume_unit_discount: number | null;
  active_qty: number;
}
interface DisplayPage { data: ItemDisplayRow[] | null; error: { message: string; code?: string } | null; count: number | null }
interface DisplayFilter extends PromiseLike<DisplayPage> {
  select(columns: string): DisplayFilter;
  order(column: string, options: { ascending: boolean }): DisplayFilter;
  limit(count: number): DisplayFilter;
  gt(column: string, value: string): DisplayFilter;
}

const nullableAmount = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);

/**
 * 본인 주문 품목의 표시값을 읽는다. RPC는 한 번에 주문 1000개까지, PostgREST는 한 번에 행 수를 잘라 돌려줄 수 있어서
 * `my_order_items`와 같은 id 커서·정확한 개수 방식으로 끝까지 읽는다(잘리면 그 묶음은 실패로 닫혀 줄이 스냅샷으로 남는다).
 */
async function readItemDisplays(supabase: SupabaseServerClient, orderIds: readonly string[]): Promise<Map<string, OrderItemDisplay>> {
  const displays = new Map<string, OrderItemDisplay>();
  for (const ids of chunks(orderIds, ID_CHUNK)) {
    try {
      const { data, error } = await readCompleteIdPages<ItemDisplayRow>((afterId, pageSize) => {
        let query = (supabase.rpc('my_order_item_display', { p_order_ids: [...ids] }, { count: 'exact' }) as unknown as DisplayFilter)
          .select('id:item_id,regular_unit_price,volume_unit_discount,active_qty')
          .order('item_id', { ascending: true })
          .limit(pageSize);
        if (afterId) query = query.gt('item_id', afterId);
        return query;
      });
      if (error || !data) { logEnrichmentFailure('item_display', error); continue; }
      for (const row of data) {
        if (typeof row.id !== 'string' || !nullableAmount(row.regular_unit_price) || !nullableAmount(row.volume_unit_discount)
          || typeof row.active_qty !== 'number' || !Number.isSafeInteger(row.active_qty) || row.active_qty < 0) {
          logEnrichmentFailure('item_display_row', null);
          continue;
        }
        displays.set(row.id, { regularUnitPrice: row.regular_unit_price, volumeUnitDiscount: row.volume_unit_discount, activeQty: row.active_qty });
      }
    } catch (error) {
      logEnrichmentFailure('item_display', error);
    }
  }
  return displays;
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
 * 고객 세션 클라이언트로 읽으므로 본인 주문의 굿즈(`my_order_line_goods`)·`ips`(공개 읽기)와 본인 주문 영수증만 보인다.
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
    const displayOrderIds = orders.filter((order) => order.itemDisplay && order.items.length > 0).map((order) => order.orderId);
    const [ipTitles, fetched, displays] = await Promise.all([
      readIpTitles(supabase, ipIds),
      mapWithLimit(pending, RECEIPT_CONCURRENCY, (order) => readReceipt(supabase, order.orderId)),
      displayOrderIds.length ? readItemDisplays(supabase, displayOrderIds) : Promise.resolve(new Map<string, OrderItemDisplay>()),
    ]);
    const receipts = new Map(pending.map((order, index) => [order.orderId, fetched[index]] as const));
    /* 굿즈 행을 못 읽었으면 19금 여부를 모른다 — 품목 자체의 이미지 경로(선물 스냅샷)도 인증 전에는 쓰지 않는다. */
    const hideOwnImages = goodsFailed && adultAccess !== 'full';
    for (const order of orders) {
      const items = hideOwnImages ? order.items.map((item) => ({ ...item, imagePath: null })) : order.items;
      const receipt = order.receipt !== undefined ? order.receipt : receipts.get(order.orderId) ?? null;
      try {
        result.set(order.orderId, buildOrderLines({ items, receipt, display: order.itemDisplay ? displays : undefined, goods, ipTitles, adultAccess, imageUrl: (path) => publicMediaUrl(path) }));
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

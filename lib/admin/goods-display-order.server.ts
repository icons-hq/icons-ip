import 'server-only';
import { imageUrlFromBg, publicMediaUrl } from '@/lib/media';
import { createClient } from '@/lib/supabase/server';
import {
  GOODS_DISPLAY_ORDER_PAGE_SIZE, GOODS_DISPLAY_ORDER_SLOT_NAMES, type GoodsDisplayOrderPage, type GoodsDisplayOrderRequest, type GoodsDisplayOrderRow, type GoodsDisplayOrderSlot,
} from './goods-display-order';

export const GOODS_DISPLAY_ORDER_LOOKUP_ERROR = '진열 순서를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.';
const COLUMNS = 'id,name,image_path,bg,display_order,published_at';
type GoodRow = { id: string; name: string; image_path: string | null; bg: string | null; display_order: number | null; published_at: string | null };
type Client = Awaited<ReturnType<typeof createClient>>;

/** ilike의 와일드카드(% _ \ *)는 글자 그대로 찾는다. */
const likePattern = (query: string) => `%${query.replace(/[\\%_*]/g, (character) => `\\${character}`)}%`;
/** 필터 문법에서 쉼표·괄호가 값에 섞여도 한 값으로 읽히게 큰따옴표로 감싼다. */
const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** 보관하지 않았고 진열 순서를 넣은 상품. `pattern`을 주면 상품명에 그 글자가 든 것만 남긴다. */
function numbered(client: Client, columns: string, options?: { count?: 'exact'; head?: boolean }, pattern?: string | null) {
  const query = client.from('goods').select(columns, options).is('archived_at', null).not('display_order', 'is', null);
  return pattern ? query.ilike('name', pattern) : query;
}

/** 이 줄 바로 앞 줄(번호, 같으면 상품 URL 순으로 한 칸 앞)의 번호. 맨 앞이면 null. */
async function previousOrderOf(client: Client, row: { id: string; order: number }): Promise<number | null> {
  const { data, error } = await numbered(client, 'display_order')
    .or(`display_order.lt.${row.order},and(display_order.eq.${row.order},id.lt.${quoted(row.id)})`)
    .order('display_order', { ascending: false }).order('id', { ascending: false }).limit(1);
  if (error || !Array.isArray(data)) throw new Error(GOODS_DISPLAY_ORDER_LOOKUP_ERROR);
  const order = (data[0] as { display_order?: unknown } | undefined)?.display_order;
  return typeof order === 'number' ? order : null;
}

/**
 * '지금 순서 보기' 한 쪽(20개). 고객 화면 추천순과 같은 순서(번호 오름차순, 같으면 상품 URL 순)로 읽고, 검색어는 상품명에 든 것만 남긴다.
 * 줄마다 바로 앞 줄의 번호(`previousOrder`)를 함께 준다 — 첫 쪽 밖이거나 검색으로 줄이 이어지지 않아도 [이 앞에 두기]가 한 칸 앞 번호가
 * 비었는지 알 수 있어야 해서다. 검색이 없으면 쪽 안의 줄은 앞 줄의 번호를 그대로 쓰고 첫 줄만 따로 읽는다.
 */
export async function listGoodsDisplayOrder(request: GoodsDisplayOrderRequest): Promise<GoodsDisplayOrderPage> {
  const client = await createClient();
  const pattern = request.query ? likePattern(request.query) : null;
  const counted = await numbered(client, 'id', { count: 'exact', head: true }, pattern);
  if (counted.error || typeof counted.count !== 'number') throw new Error(GOODS_DISPLAY_ORDER_LOOKUP_ERROR);
  const total = counted.count;
  if (total === 0) return { rows: [], total: 0, page: 1, pageSize: GOODS_DISPLAY_ORDER_PAGE_SIZE };
  /* 보관 등으로 마지막 쪽이 비어도 빈 쪽에 갇히지 않게 마지막 유효 쪽으로 보정한다. */
  const page = Math.min(request.page, Math.ceil(total / GOODS_DISPLAY_ORDER_PAGE_SIZE));
  const from = (page - 1) * GOODS_DISPLAY_ORDER_PAGE_SIZE;
  const listed = await numbered(client, COLUMNS, undefined, pattern).order('display_order', { ascending: true }).order('id', { ascending: true })
    .range(from, from + GOODS_DISPLAY_ORDER_PAGE_SIZE - 1);
  if (listed.error || !Array.isArray(listed.data)) throw new Error(GOODS_DISPLAY_ORDER_LOOKUP_ERROR);
  const base = (listed.data as unknown as GoodRow[]).map((row) => {
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || !Number.isSafeInteger(row.display_order)) throw new Error(GOODS_DISPLAY_ORDER_LOOKUP_ERROR);
    return { id: row.id, name: row.name, order: row.display_order as number, published: typeof row.published_at === 'string',
      imageUrl: row.image_path ? publicMediaUrl(row.image_path) : imageUrlFromBg(row.bg) };
  });
  const previous: (number | null)[] = base.map(() => null);
  const lookups = pattern ? base.map((_, index) => index) : from > 0 && base.length ? [0] : [];
  await Promise.all(lookups.map(async (index) => { previous[index] = await previousOrderOf(client, base[index]); }));
  if (!pattern) for (let index = 1; index < base.length; index += 1) previous[index] = base[index - 1].order;
  const rows: GoodsDisplayOrderRow[] = base.map((row, index) => ({ ...row, previousOrder: previous[index] }));
  return { rows, total, page, pageSize: GOODS_DISPLAY_ORDER_PAGE_SIZE };
}

/** 이 번호를 이미 쓰는 다른 상품(보관하지 않은 것). `goodId`는 지금 편집 중인 상품이라 뺀다. */
export async function readGoodsDisplayOrderSlot(order: number, goodId: string | null): Promise<GoodsDisplayOrderSlot> {
  const client = await createClient();
  let query = numbered(client, 'name', { count: 'exact' }).eq('display_order', order);
  if (goodId) query = query.neq('id', goodId);
  const { data, count, error } = await query.order('id', { ascending: true }).limit(GOODS_DISPLAY_ORDER_SLOT_NAMES);
  if (error || !Array.isArray(data) || typeof count !== 'number') throw new Error(GOODS_DISPLAY_ORDER_LOOKUP_ERROR);
  return { order, names: (data as unknown as { name: string }[]).map((row) => row.name), total: count };
}

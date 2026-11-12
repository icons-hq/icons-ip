'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { normalizeAdminStockAdjustmentForm, type AdminStockAdjustmentFormValue } from '@/lib/admin/catalog';
import { validGoodsGroupGoodId } from '@/lib/admin/goods-groups';
import type { GoodsListOptionStock, OptionStockOutcome, OptionStockRequest } from '@/lib/admin/goods-list-inline';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { sendRestockAlertEmails } from '@/lib/email/transactional.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/*
 * 상품 목록 옵션별 재고 창(1014-106·107)의 서버 쪽.
 * - 저장(adjustGoodsOptionStocksAction): 옵션마다 기존 실재고 조정 RPC(admin_adjust_stock, SECURITY DEFINER)를 서버에서 차례로 부른다.
 *   RPC 한 번이 옵션 하나의 트랜잭션이라 옵션별 원자성·기대값 비교·요청번호 멱등은 그대로이고, 다른 곳에서 먼저 바뀐 옵션만 거절된다
 *   (부분 실패는 옵션별 결과). 목록·고객 화면 갱신(revalidate)과 재입고 알림 예약은 묶음 끝에 한 번만 한다 — 옵션마다 화면을 다시
 *   그리지 않는다. 거절된 옵션이 있으면 같은 응답에 그 상품의 현재 수량을 함께 돌려준다. 권한은 기존 재고 조정 액션과 같은 판정을
 *   매 요청 서버에서 한다(catalog.manage).
 * - 조회(readGoodsOptionStocksAction): '다시 확인' 줄의 현재 수량을 아직 읽지 못했을 때 그 상품의 사용 옵션만 다시 읽는다(쓰지 않음).
 * 창은 목록 페이지와 따로 남아 있어(필터·정렬로 그 상품이 목록에서 빠져도) 목록이 다시 그린 값에 기대지 않는다.
 */
type Client = Awaited<ReturnType<typeof createClient>>;
const READ_FAILED = '현재 옵션 수량을 읽지 못했습니다. 잠시 후 다시 시도해주세요.';
const UNCERTAIN = '저장 결과를 확인하지 못했습니다. 같은 수량으로 다시 저장하면 한 번만 반영됩니다.';
/** 한 번에 저장할 수 있는 옵션 수. 목록이 한 상품에 싣는 사용 옵션보다 넉넉하다('use server' 파일이라 내보내지 않는다). */
const OPTION_STOCK_BATCH_LIMIT = 300;

async function readActiveOptionStocks(client: Client, goodId: string): Promise<GoodsListOptionStock[] | null> {
  const { data, error } = await client.from('goods_variants').select('id,name,code,stock_qty')
    .eq('good_id', goodId).is('archived_at', null).order('sort_order').order('id').limit(1000);
  if (error || !Array.isArray(data)) return null;
  const rows = data as { id: unknown; name: unknown; code: unknown; stock_qty: unknown }[];
  if (rows.some(row => typeof row.id !== 'string' || !Number.isSafeInteger(row.stock_qty) || (row.stock_qty as number) < 0)) return null;
  return rows.map(row => ({ variantId: row.id as string, name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '이름 없는 옵션',
    code: typeof row.code === 'string' ? row.code : '', stockQty: row.stock_qty as number }));
}

export type GoodsOptionStockReadResult = { ok: true; options: GoodsListOptionStock[] } | { ok: false; error: string };

export async function readGoodsOptionStocksAction(goodId: unknown): Promise<GoodsOptionStockReadResult> {
  try {
    if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.read' })) return { ok: false, error: '상품을 조회할 권한이 필요합니다.' };
    if (!validGoodsGroupGoodId(goodId)) return { ok: false, error: '상품을 확인하지 못했습니다.' };
    const options = await readActiveOptionStocks(await createClient(), goodId);
    return options ? { ok: true, options } : { ok: false, error: READ_FAILED };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: READ_FAILED };
  }
}

/**
 * 묶음 전체의 결과. `ok:false`는 권한·입력 문제로 아무 옵션도 조정하지 않았다는 뜻이다.
 * `options`는 거절된 옵션이 있을 때 조정을 마친 뒤 다시 읽은 그 상품의 사용 옵션 수량이다(읽지 못했으면 없음).
 */
export type GoodsOptionStockSaveResult =
  | { ok: true; outcomes: OptionStockOutcome[]; options?: GoodsListOptionStock[] }
  | { ok: false; error: string };

/** 기존 재고 조정 액션(app/admin/actions.ts adjustAdminStockAction)과 같은 운영자 문구. 'catalog_archived'는 보관 상품 안내를 더한다. */
function stockAdjustmentFailure(message: string) {
  if (message.includes('stock_changed')) return '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.';
  if (message.includes('adjustment_conflict')) return '이미 사용된 재고 조정 요청입니다. 최신 수량을 확인해주세요.';
  if (message.includes('stock_out_of_range')) return '재고는 0개 미만이거나 허용 범위를 넘도록 조정할 수 없습니다.';
  if (message.includes('goods_variant_not_found')) return '재고를 조정할 옵션을 찾을 수 없습니다. 최신 옵션 목록을 확인해주세요.';
  if (message.includes('good_not_found')) return '상품을 찾을 수 없습니다.';
  if (message.includes('catalog_archived') || message.includes('catalog_item_archived')) return '보관된 상품은 재고를 조정할 수 없습니다. 상품을 먼저 복원해주세요.';
  return '실재고를 조정하지 못했습니다. 다시 시도해주세요.';
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const REQUEST_KEYS = ['expectedStockQty', 'nextStockQty', 'reason', 'requestId', 'variantId'];

/** 화면이 보낸 줄을 기존 재고 조정 입력 규칙(normalizeAdminStockAdjustmentForm) 그대로 검증한다. 하나라도 틀리면 전체를 거절한다. */
function parseRequests(goodId: string, value: unknown): AdminStockAdjustmentFormValue[] | string {
  if (!Array.isArray(value) || value.length < 1 || value.length > OPTION_STOCK_BATCH_LIMIT) return '저장할 옵션을 확인해주세요.';
  const parsed: AdminStockAdjustmentFormValue[] = [];
  for (const raw of value as unknown[]) {
    /* 새 수량은 화면과 같은 범위(0 이상 정수)만 받는다 — 음수 목표는 DB까지 보내지 않는다. */
    if (!record(raw) || Object.keys(raw).sort().join() !== REQUEST_KEYS.join() || !isUuid(raw.requestId) || !isUuid(raw.variantId)
      || !Number.isSafeInteger(raw.expectedStockQty) || !Number.isSafeInteger(raw.nextStockQty) || (raw.nextStockQty as number) < 0
      || (raw.nextStockQty as number) > 2_147_483_647 || typeof raw.reason !== 'string') return '저장할 옵션을 확인해주세요.';
    const request = raw as unknown as OptionStockRequest;
    const data = new FormData();
    data.set('adjustmentId', request.requestId); data.set('goodId', goodId); data.set('variantId', request.variantId);
    data.set('expectedStockQty', String(request.expectedStockQty)); data.set('delta', String(request.nextStockQty - request.expectedStockQty));
    data.set('reason', request.reason);
    const result = normalizeAdminStockAdjustmentForm(data);
    if (!result.ok) return Object.values(result.errors).find(Boolean) ?? '저장할 옵션을 확인해주세요.';
    parsed.push(result.value);
  }
  if (new Set(parsed.map(item => item.variantId)).size !== parsed.length || new Set(parsed.map(item => item.adjustmentId)).size !== parsed.length) return '저장할 옵션을 확인해주세요.';
  return parsed;
}

export async function adjustGoodsOptionStocksAction(goodId: unknown, ipId: unknown, requests: unknown): Promise<GoodsOptionStockSaveResult> {
  /* 조정을 하나라도 보내기 전까지의 실패는 '아무것도 바꾸지 않음'이다. */
  let parsed: AdminStockAdjustmentFormValue[], client: Client;
  try {
    if (!await requireAdminActionAccess('/admin', { capability: 'catalog.manage' })) return { ok: false, error: '관리자 권한이 필요합니다.' };
    if (!validGoodsGroupGoodId(goodId)) return { ok: false, error: '상품을 확인하지 못했습니다.' };
    const result = parseRequests(goodId, requests);
    if (typeof result === 'string') return { ok: false, error: result };
    parsed = result;
    client = await createClient();
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '재고수량을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
  const outcomes: OptionStockOutcome[] = [];
  /* 한 옵션씩 차례로 — 같은 상품 행을 잠그는 조정이 서로 기다리지 않고, 옵션마다 결과가 따로 남는다. */
  for (const value of parsed) {
    try {
      const { data, error } = await client.rpc('admin_adjust_stock', {
        target_adjustment_id: value.adjustmentId, target_good_id: value.goodId, target_variant_id: value.variantId,
        target_expected_stock_qty: value.expectedStockQty, target_delta: value.delta, target_reason: value.reason,
      });
      /* RPC 오류는 그 옵션의 트랜잭션이 되돌려졌다는 뜻이라 반영되지 않은 것이 확실하다. */
      outcomes.push(error ? { variantId: value.variantId, state: 'rejected', message: stockAdjustmentFailure(error.message) }
        : { variantId: value.variantId, state: 'saved', stockQty: typeof data === 'number' ? data : value.expectedStockQty + value.delta });
    } catch {
      /* 응답을 받지 못한 옵션은 반영됐을 수 있다 — 같은 요청번호로 다시 보내면 한 번만 반영된다. */
      outcomes.push({ variantId: value.variantId, state: 'uncertain', message: UNCERTAIN });
    }
  }
  /* 조정을 보낸 뒤의 일(현재 수량 다시 읽기·재입고 알림·화면 갱신)이 실패해도 옵션별 결과는 그대로 돌려준다. */
  const options = outcomes.some(outcome => outcome.state === 'rejected') ? await readActiveOptionStocks(client, goodId).catch(() => null) : null;
  try {
    if (outcomes.some(outcome => outcome.state === 'saved')) after(() => sendRestockAlertEmails(goodId));
    /* 화면 갱신은 묶음 끝에 한 번. 거절(그사이 바뀐 수량)도 목록이 최신 수량을 보이게 갱신한다. */
    revalidateGoodsSurfaces();
    if (typeof ipId === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(ipId.trim())) revalidatePath(`/ip/${ipId.trim()}`);
  } catch (error) {
    unstable_rethrow(error);
  }
  return { ok: true, outcomes, ...(options ? { options } : {}) };
}

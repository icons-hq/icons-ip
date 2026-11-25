'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  GOODS_DISPLAY_ORDER_PATH, parseGoodsDisplayOrderRequest, parseGoodsDisplayOrderSlotRequest,
  type GoodsDisplayOrderPage, type GoodsDisplayOrderSlot,
} from '@/lib/admin/goods-display-order';
import { GOODS_DISPLAY_ORDER_LOOKUP_ERROR, listGoodsDisplayOrder, readGoodsDisplayOrderSlot } from '@/lib/admin/goods-display-order.server';

/** '지금 순서 보기' 선택창이 부르는 읽기. 진열 순서를 넣은 상품을 번호 오름차순으로 20개씩 준다. */
export async function listGoodsDisplayOrderAction(input: unknown): Promise<{ ok: true; data: GoodsDisplayOrderPage } | { ok: false; error: string }> {
  const auth = await requireAdminActionAccess(GOODS_DISPLAY_ORDER_PATH);
  if (!auth?.user) return { ok: false, error: '상품을 편집할 권한이 필요합니다.' };
  const request = parseGoodsDisplayOrderRequest(input);
  if (!request) return { ok: false, error: '검색어가 너무 깁니다. 100자 안으로 줄여 다시 검색해주세요.' };
  try { return { ok: true, data: await listGoodsDisplayOrder(request) }; }
  catch (error) { unstable_rethrow(error); return { ok: false, error: GOODS_DISPLAY_ORDER_LOOKUP_ERROR }; }
}

/**
 * 진열 순서 칸에 넣은 번호를 이미 쓰는 다른 상품이 있는지 읽는다. `goodId`는 지금 편집 중인 상품(새 상품은 null)이라 뺀다.
 * 번호를 적는 동안 화면이 백그라운드로 부르는 읽기라, 로그인이 끝났어도 입력 중인 화면을 로그인으로 옮기지 않는다(거절 결과만 돌려준다).
 */
export async function readGoodsDisplayOrderSlotAction(input: unknown): Promise<{ ok: true; slot: GoodsDisplayOrderSlot } | { ok: false; error: string }> {
  const auth = await requireAdminActionAccess(GOODS_DISPLAY_ORDER_PATH, { onUnauthenticated: 'error' });
  if (!auth?.user) return { ok: false, error: '상품을 편집할 권한이 필요합니다.' };
  const request = parseGoodsDisplayOrderSlotRequest(input);
  if (!request) return { ok: false, error: '진열 순서는 0 이상의 숫자로 넣어주세요.' };
  try { return { ok: true, slot: await readGoodsDisplayOrderSlot(request.order, request.goodId) }; }
  catch (error) { unstable_rethrow(error); return { ok: false, error: GOODS_DISPLAY_ORDER_LOOKUP_ERROR }; }
}

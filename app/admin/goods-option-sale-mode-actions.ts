'use server';

import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import {
  goodsOptionSaleModeErrorMessage,
  isGoodsOptionSaleMode,
  parseGoodsOptionSaleModeState,
  type GoodsOptionSaleModeState,
} from '@/lib/goods-option-sale-mode';
import { createClient } from '@/lib/supabase/server';

/*
 * 상품 판매 방식(옵션 선택 / 랜덤 판매, D5②).
 *
 * 판매 제한(good-sale-restriction-actions.ts)과 같은 층위의 전용 감사 setter다. 상품 저장 폼에 넣지 않는 이유는
 * 랜덤 조건(활성 옵션 2개 이상·가격 동일·옵션별 제한 없음 등)을 저장 시점마다 다시 판정해야 해서다 — 조건은 DB가
 * 판정하고(admin_set_goods_option_sale_mode, 커밋 지연 제약), 여기서는 입력 모양만 거른다.
 * 낙관 잠금은 goods.updated_at이다. 상품을 저장하면 값이 바뀌므로 패널은 저장 뒤 다시 읽어야 한다.
 */

export interface GoodsOptionSaleModeActionState {
  error?: string;
  message?: string;
  state?: GoodsOptionSaleModeState;
}

const MODE_MESSAGES = {
  random: '랜덤 판매로 바꿨습니다. 고객은 옵션 대신 \'랜덤\'으로 주문하고, 주문할 때 재고에서 옵션이 정해집니다.',
  select: '옵션 선택 판매로 바꿨습니다. 고객이 옵션을 골라 주문합니다.',
} as const;

const GOODS_PATH = '/admin/catalog/goods';

async function readState(goodId: string): Promise<GoodsOptionSaleModeActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_goods_option_sale_mode', { p_good_id: goodId });
  if (error) return { error: goodsOptionSaleModeErrorMessage(error.message ?? '') };
  const state = parseGoodsOptionSaleModeState(data);
  return state ? { state } : { error: '판매 방식을 불러오지 못했습니다.' };
}

export async function readGoodsOptionSaleModeAction(goodId: string): Promise<GoodsOptionSaleModeActionState> {
  const auth = await requireAdminActionAccess(GOODS_PATH);
  if (!auth) return { error: '관리자 권한이 필요합니다.' };
  const id = typeof goodId === 'string' ? goodId.trim() : '';
  if (!id) return { error: '상품을 찾지 못했습니다.' };
  return readState(id);
}

export async function setGoodsOptionSaleModeAction(
  _state: GoodsOptionSaleModeActionState,
  formData: FormData,
): Promise<GoodsOptionSaleModeActionState> {
  const auth = await requireAdminActionAccess(GOODS_PATH);
  if (!auth) return { error: '관리자 권한이 필요합니다.' };

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '상품을 찾지 못했습니다.' };
  const mode = formData.get('mode');
  if (!isGoodsOptionSaleMode(mode)) return { error: '지원하지 않는 판매 방식입니다.' };
  const expectedUpdatedAt = String(formData.get('expectedUpdatedAt') ?? '').trim();
  if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return { error: '상품 정보를 다시 불러온 뒤 시도하세요.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_goods_option_sale_mode', {
    p_good_id: id,
    p_mode: mode,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return { error: goodsOptionSaleModeErrorMessage(error.message ?? '') };

  revalidateGoodsSurfaces();
  const refreshed = await readState(id);
  return refreshed.state ? { message: MODE_MESSAGES[mode], state: refreshed.state } : { message: MODE_MESSAGES[mode] };
}

import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  parseClaimDefectiveStock,
  parseDefectiveQtyByVariant,
  parseDefectiveStockList,
  type ClaimDefectiveStock,
  type DefectiveStockList,
} from './defective-stock';

const LOAD_ERROR = '불량 재고를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';

/** 반품 클레임의 품목과 지금의 재고 처리 선택. 반품이 아니거나 읽지 못하면 빈 배열이라 화면은 선택 칸을 그리지 않는다. */
export async function loadClaimDefectiveStock(claimIds: readonly string[]): Promise<ClaimDefectiveStock[]> {
  if (claimIds.length === 0) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_claim_defective_items', { p_claim_ids: [...claimIds] });
    return error ? [] : parseClaimDefectiveStock(data);
  } catch {
    return [];
  }
}

export async function loadDefectiveStockList(limit = 200): Promise<DefectiveStockList> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_defective_stock', { p_limit: limit });
  const list = error ? null : parseDefectiveStockList(data);
  if (!list) throw new Error(LOAD_ERROR);
  return list;
}

export async function loadDefectiveQtyByVariant(variantIds: readonly string[]): Promise<Record<string, number>> {
  if (variantIds.length === 0) return {};
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_defective_stock_by_variant', { p_variant_ids: [...variantIds] });
    return error ? {} : parseDefectiveQtyByVariant(data);
  } catch {
    return {};
  }
}

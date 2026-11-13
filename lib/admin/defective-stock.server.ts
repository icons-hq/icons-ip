import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  parseClaimDefectiveStock,
  parseDefectiveQtyByVariant,
  defectiveStockRecordError,
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

/**
 * 재고가 정해진 반품 클레임의 불량 선택을 원장에 기록한다(감사 RPC, 멱등). 'use server' 파일 밖에 둬 서버 액션으로 노출되지 않는다.
 * 실패해도 호출한 쪽의 확정(환불·취소 확정)은 되돌리지 않는다 — 선택은 planned로 남아 '불량 기록 필요'가 된다.
 */
export async function recordClaimDefectiveStock(claimId: string): Promise<{ recorded: number; error?: string }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_record_claim_defective_stock', { p_claim_id: claimId });
    if (error) return { recorded: 0, error: defectiveStockRecordError(error.message) };
    const total = data && typeof data === 'object' && 'total' in data ? Number((data as { total: unknown }).total) : 0;
    return { recorded: Number.isFinite(total) ? total : 0 };
  } catch {
    return { recorded: 0, error: defectiveStockRecordError('') };
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

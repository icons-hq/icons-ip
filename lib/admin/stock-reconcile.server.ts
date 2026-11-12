import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import {
  parseStockDispatchWarnings,
  parseStockReconcileDocument,
  parseStockReconcileSummaries,
  type StockDispatchWarnings,
  type StockReconcileDocument,
  type StockReconcileSummary,
} from './stock-reconcile';

const LOAD_ERROR = '재고 대조 기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';

export interface StockReconcileWorkspace {
  history: StockReconcileSummary[];
  /** `?snapshot=<id>`로 다시 연 미리보기·기록. 없거나 못 찾으면 null. */
  snapshot: StockReconcileDocument | null;
}

export async function loadStockReconcileWorkspace(snapshotId: string | null): Promise<StockReconcileWorkspace> {
  const supabase = await createClient();
  const [list, detail] = await Promise.all([
    supabase.rpc('admin_list_stock_reconciles', { p_limit: 20 }),
    snapshotId && isUuid(snapshotId) ? supabase.rpc('admin_get_stock_reconcile', { p_snapshot_id: snapshotId }) : Promise.resolve(null),
  ]);
  const history = list.error ? null : parseStockReconcileSummaries(list.data);
  if (!history) throw new Error(LOAD_ERROR);
  const snapshot = detail && !detail.error ? parseStockReconcileDocument(detail.data) : null;
  return { history, snapshot };
}

/**
 * 출고지시 전 경고 데이터. 출고 화면(발주확인/발송관리)이 출고지 필터와 함께 부른다.
 * 실패해도 출고 작업을 막지 않도록 null을 돌려준다 — 경고 부품은 null이면 그리지 않는다.
 */
export async function loadStockDispatchWarnings(originId: string | null, minDifference = 1): Promise<StockDispatchWarnings | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_stock_dispatch_warnings', {
      p_origin_id: originId && isUuid(originId) ? originId : null,
      p_min_difference: minDifference,
    });
    return error ? null : parseStockDispatchWarnings(data);
  } catch {
    return null;
  }
}

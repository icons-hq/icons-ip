'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { DEFECTIVE_STOCK_PATH } from '@/lib/admin/defective-stock';
import { loadDefectiveQtyByVariant } from '@/lib/admin/defective-stock.server';
import { isUuid } from '@/lib/uuid';

/** 재고 대조 미리보기의 옵션 가운데 불량 재고가 있는 옵션의 수량(참고 칸). 읽지 못하면 빈 값이라 칸을 그리지 않는다. */
export async function readDefectiveQtyForVariantsAction(variantIds: unknown): Promise<Record<string, number>> {
  try {
    if (!Array.isArray(variantIds) || variantIds.length > 2000) return {};
    const ids = [...new Set(variantIds.filter((id): id is string => typeof id === 'string' && isUuid(id)))];
    if (ids.length === 0) return {};
    if (!await requireAdminActionAccess(DEFECTIVE_STOCK_PATH, { capability: 'catalog.manage' })) return {};
    return await loadDefectiveQtyByVariant(ids);
  } catch (error) {
    unstable_rethrow(error);
    return {};
  }
}

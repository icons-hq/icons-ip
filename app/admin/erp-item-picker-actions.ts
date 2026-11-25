'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { normalizeErpText } from '@/lib/admin/erp-item-import';
import { ERP_ITEM_SEARCH_QUERY_MAX, parseErpItemListPage, type ErpItemMatch } from '@/lib/admin/erp-items';
import { ADMIN_PICKER_PAGE_SIZE, type AdminPickerPage } from '@/lib/admin/picker';
import { createClient } from '@/lib/supabase/server';

/* 상품 등록·수정 화면에서 부른다. 권한은 DB 함수(admin_list_erp_items)와 같은 상품 관리(catalog.manage)다. */
const GOODS_PATH = '/admin/catalog/goods';
const DENIED = 'ERP 품목을 고르려면 상품 관리 권한이 필요합니다.';
const FAILED = 'ERP 품목을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';
/* DB 함수가 받는 건너뛰기 상한(1,000,000줄) 안쪽의 마지막 쪽. */
const LAST_ALLOWED_PAGE = 1_000_000 / ADMIN_PICKER_PAGE_SIZE;

export type ErpItemPickerResult = { ok: true; data: AdminPickerPage<ErpItemMatch> } | { ok: false; error: string };

function pickerRequest(input: unknown): { query: string; page: number } {
  const { query, page } = input && typeof input === 'object' && !Array.isArray(input) ? input as { query?: unknown; page?: unknown } : {};
  return {
    query: typeof query === 'string' ? normalizeErpText(query, true).slice(0, ERP_ITEM_SEARCH_QUERY_MAX) : '',
    page: typeof page === 'number' && Number.isSafeInteger(page) ? Math.min(Math.max(1, page), LAST_ALLOWED_PAGE) : 1,
  };
}

/**
 * 옵션의 [ERP 품목 고르기] 선택창 조회. ERP 품목 메뉴에 올린 품목을 ERP 품명·ERP 코드로 찾아 20개씩 돌려준다(ERP 코드 순).
 * 검색어가 없으면 전체를 보인다. 그사이 품목이 줄어 고른 쪽이 비면 마지막 쪽을 다시 읽는다.
 */
export async function searchErpItemPickerAction(input: unknown): Promise<ErpItemPickerResult> {
  try {
    if (!await requireAdminActionAccess(GOODS_PATH, { capability: 'catalog.manage' })) return { ok: false, error: DENIED };
    const { query, page } = pickerRequest(input);
    const supabase = await createClient();
    const read = async (target: number) => {
      const { data, error } = await supabase.rpc('admin_list_erp_items', {
        p_query: query || null,
        p_offset: (target - 1) * ADMIN_PICKER_PAGE_SIZE,
        p_limit: ADMIN_PICKER_PAGE_SIZE,
      });
      if (error) {
        const code = typeof error.code === 'string' ? error.code : '';
        const message = typeof error.message === 'string' ? error.message : '';
        return code === '42501' || code === '28000' || /staff_required|operator_capability_required/.test(message) ? 'denied' as const : null;
      }
      const parsed = parseErpItemListPage(data);
      return parsed && { page: target, ...parsed };
    };
    let list = await read(page);
    if (list && list !== 'denied') {
      const lastPage = Math.max(1, Math.ceil(list.total / ADMIN_PICKER_PAGE_SIZE));
      if (list.page > lastPage) list = await read(lastPage);
    }
    if (list === 'denied') return { ok: false, error: DENIED };
    if (!list) return { ok: false, error: FAILED };
    return {
      ok: true,
      data: {
        rows: list.items.map(({ code, name, category, salePrice, barcode, mappedCategoryId }) => ({ code, name, category, salePrice, barcode, mappedCategoryId })),
        total: list.total,
        page: list.page,
        pageSize: ADMIN_PICKER_PAGE_SIZE,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: FAILED };
  }
}

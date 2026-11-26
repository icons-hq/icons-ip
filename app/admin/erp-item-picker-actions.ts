'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { normalizeErpText } from '@/lib/admin/erp-item-import';
import { ERP_ITEM_SEARCH_QUERY_MAX, parseErpItemListPage, type ErpItemMatch, type ErpItemUsage } from '@/lib/admin/erp-items';
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

type Supabase = Awaited<ReturnType<typeof createClient>>;
const identityKey = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
/** 저장된 값과 글자 크기만 다른 경우까지 찾도록 원문·소문자·대문자를 함께 묻는다(DB의 유일 규칙은 대소문자를 가리지 않는다). */
const identityVariants = (values: readonly string[]) => [...new Set(values.flatMap((value) => { const text = value.trim(); return text ? [text, text.toLowerCase(), text.toUpperCase()] : []; }))];

/**
 * 이 쪽의 품목을 이미 쓰는 옵션을 찾는다(화면 규칙 2 — 고를 수 없는 품목은 고르기 전에 막는다).
 * ERP 코드·바코드는 옵션 전체에서 하나뿐이어야 저장되는데, 다른 상품이나 사용 중지한 옵션이 쓰는 품목도 선택창에 [선택]으로 보여
 * 고른 뒤 상품 전체 저장이 거절됐다(2026-11-26 QA-B F1). 옵션 편집이 이미 쓰는 조회(admin_list_goods_variant_external_identities)로 읽는다.
 * 확인하지 못하면 막지 않는다 — 저장할 때의 검사가 그대로 남아 있다.
 */
async function erpItemUsage(supabase: Supabase, items: readonly ErpItemMatch[]): Promise<Map<string, ErpItemUsage>> {
  const usage = new Map<string, ErpItemUsage>();
  try {
    const codes = identityVariants(items.map((item) => item.code));
    const barcodes = identityVariants(items.flatMap((item) => item.barcode ? [item.barcode] : []));
    if (!codes.length) return usage;
    const identities = () => supabase.rpc('admin_list_goods_variant_external_identities', { target_good_id: null });
    const [byCode, byBarcode] = await Promise.all([identities().in('erp_code', codes), barcodes.length ? identities().in('barcode', barcodes) : null]);
    if (byCode.error || byBarcode?.error) return usage;
    const linked = [...(byCode.data ?? []), ...(byBarcode?.data ?? [])] as { variant_id?: unknown; good_id?: unknown; erp_code?: unknown; barcode?: unknown }[];
    const variantIds = [...new Set(linked.flatMap((row) => typeof row.variant_id === 'string' ? [row.variant_id] : []))];
    const goodIds = [...new Set(linked.flatMap((row) => typeof row.good_id === 'string' ? [row.good_id] : []))];
    if (!variantIds.length) return usage;
    const [variants, goods] = await Promise.all([
      supabase.from('goods_variants').select('id,name').in('id', variantIds),
      supabase.from('goods').select('id,name').in('id', goodIds),
    ]);
    const optionNames = new Map((variants.data ?? []).map((row) => [row.id as string, typeof row.name === 'string' ? row.name : '']));
    const goodNames = new Map((goods.data ?? []).map((row) => [row.id as string, typeof row.name === 'string' ? row.name : '']));
    const describe = (row: typeof linked[number], via: ErpItemUsage['via']): ErpItemUsage => ({
      variantId: row.variant_id as string, via,
      goodName: goodNames.get(row.good_id as string) || '이름을 읽지 못한 상품', optionName: optionNames.get(row.variant_id as string) || '이름 없는 옵션',
    });
    for (const item of items) {
      const code = identityKey(item.code), barcode = identityKey(item.barcode);
      /* ERP 코드가 겹치는 옵션을 먼저 본다. 바코드만 겹치면 그 사실을 따로 알린다(빈 바코드 칸에 들어갈 때만 문제다). */
      const sameCode = linked.find((row) => typeof row.variant_id === 'string' && identityKey(row.erp_code) === code);
      const sameBarcode = barcode ? linked.find((row) => typeof row.variant_id === 'string' && identityKey(row.barcode) === barcode) : undefined;
      if (sameCode) usage.set(item.code, describe(sameCode, 'erpCode'));
      else if (sameBarcode) usage.set(item.code, describe(sameBarcode, 'barcode'));
    }
  } catch (error) {
    unstable_rethrow(error);
  }
  return usage;
}

/**
 * 옵션의 [ERP 품목 고르기] 선택창 조회. ERP 품목 메뉴에 올린 품목을 ERP 품명·ERP 코드로 찾아 20개씩 돌려준다(ERP 코드 순).
 * 검색어가 없으면 전체를 보인다. 그사이 품목이 줄어 고른 쪽이 비면 마지막 쪽을 다시 읽는다.
 * 줄마다 그 품목을 이미 쓰는 옵션(`usedBy`)을 함께 싣는다. 지금 편집 중인 상품의 옵션인지는 화면이 표의 지금 값으로 가린다.
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
    const usage = await erpItemUsage(supabase, list.items);
    return {
      ok: true,
      data: {
        rows: list.items.map(({ code, name, category, salePrice, barcode, mappedCategoryId }) => ({ code, name, category, salePrice, barcode, mappedCategoryId, ...(usage.has(code) ? { usedBy: usage.get(code) } : {}) })),
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

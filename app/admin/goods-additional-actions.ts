'use server';

import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { imageUrlFromBg, publicMediaUrl } from '@/lib/media';
import { GOODS_OPTION_IMPORT_PAGE_SIZE, parseGoodsOptionImportFilters, type GoodsOptionImportPage } from '@/lib/admin/goods-option-import';
import { goodsPickerLastPage, goodsPickerPageFromSearch } from '@/lib/admin/goods-option-import.server';
import { createClient } from '@/lib/supabase/server';
import {
  additionalCandidateVerdict, parseAdditionalGoodCandidates, parseAdditionalGoodIds, parseAdminAdditionalGoods,
  type AdditionalCandidateVerdict, type AdminAdditionalGood, type AdminAdditionalGoods,
} from '@/lib/admin/goods-additional';

type Failure = { ok: false; error: string };
const STAFF_REQUIRED = adminGoodsCopy('추가상품 설정은 운영자만 변경할 수 있습니다.');
/* 후보 검색 RPC는 검색어를 100자까지만 받는다. 상품 URL이 그보다 길면 이 방법으로는 가릴 수 없다. */
const SEARCH_QUERY_MAX = 100;
function goodId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 200 ? id : null;
}
/** 연결한 상품에 상품 자동코드와 사진을 덧붙인다. 덧붙이지 못해도 연결 정보는 그대로 돌려준다. */
async function withDisplay(client: Awaited<ReturnType<typeof createClient>>, items: AdminAdditionalGood[]): Promise<AdminAdditionalGood[]> {
  if (!items.length) return items;
  try {
    const { data, error } = await client.from('goods').select('id,code,image_path,bg').in('id', items.map((item) => item.goodId));
    if (error || !Array.isArray(data)) return items;
    const rows = new Map((data as { id: string; code: string | null; image_path: string | null; bg: string | null }[]).map((row) => [row.id, row]));
    return items.map((item) => {
      const row = rows.get(item.goodId);
      return row ? { ...item, code: row.code, imageUrl: row.image_path ? publicMediaUrl(row.image_path) : imageUrlFromBg(row.bg) } : item;
    });
  } catch (cause) { unstable_rethrow(cause); return items; }
}
export async function readGoodsAdditionalAction(goodIdValue: unknown): Promise<{ ok: true; configuration: AdminAdditionalGoods } | Failure> {
  if (!await requireAdminActionAccess('/admin/catalog/goods')) return { ok: false, error: STAFF_REQUIRED };
  const id = goodId(goodIdValue);
  if (!id) return { ok: false, error: '상품을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_goods_additional', { p_good_id: id });
    const configuration = error ? null : parseAdminAdditionalGoods(data);
    return configuration ? { ok: true, configuration: { ...configuration, items: await withDisplay(client, configuration.items) } }
      : { ok: false, error: adminGoodsCopy('추가상품 설정을 불러오지 못했습니다.') };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: adminGoodsCopy('추가상품 설정을 불러오지 못했습니다.') }; }
}
/**
 * 상품 선택창에서 고른 상품을 새로 연결할 수 있는지 저장 전에 가린다.
 * 선택창의 상품 조회는 보관하지 않은 모든 상품을 보여 주므로, 후보 검색(`admin_search_goods_additional` — 공개 중·재고 있음·판매 제한 없음처럼
 * 저장 함수와 같은 조건으로 고객이 지금 살 수 있는 상품만 돌려준다)에 상품 URL로 물어 그 결과에 있는지 본다.
 * 저장 전인 새 상품은 기준 상품이 없다(null). 저장된 상품은 자기 자신을 후보에서 뺀다.
 */
export async function checkGoodsAdditionalCandidateAction(baseGoodIdValue: unknown, candidateValue: unknown): Promise<{ ok: true; verdict: AdditionalCandidateVerdict } | Failure> {
  if (!await requireAdminActionAccess('/admin/catalog/goods')) return { ok: false, error: STAFF_REQUIRED };
  const base = baseGoodIdValue === null ? '' : goodId(baseGoodIdValue);
  const candidate = goodId(candidateValue);
  if (base === null || !candidate) return { ok: false, error: '상품을 다시 선택해주세요.' };
  if (candidate.length > SEARCH_QUERY_MAX) return { ok: true, verdict: 'unknown' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_search_goods_additional', { p_base_good_id: base, p_query: candidate });
    const items = error ? null : parseAdditionalGoodCandidates(data);
    return items ? { ok: true, verdict: additionalCandidateVerdict(items, candidate) } : { ok: false, error: '연결할 수 있는 상품인지 확인하지 못했습니다. 잠시 뒤 다시 골라주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '연결할 수 있는 상품인지 확인하지 못했습니다. 잠시 뒤 다시 골라주세요.' }; }
}
const CANDIDATE_SEARCH_FAILED = '연결할 수 있는 상품을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';
/**
 * 추가구성상품 선택창의 상품 조회. 지금 연결할 수 있는 상품만 등록일 최신순으로 20개씩 돌려준다 —
 * 고를 수 없는 상품(공개 전·판매기간 밖·품절·판매 중지·판매 제한)과 지금 편집 중인 상품은 조회에서 뺀다(화면 규칙 2). 총 개수도 걸러 낸 뒤의 수다.
 * 입력은 공용 상품 선택창과 같은 `{ query, field, categoryId, page }`다. 저장 전인 새 상품은 기준 상품이 없다(null).
 */
export async function searchGoodsAdditionalCandidatesAction(baseGoodIdValue: unknown, input: unknown): Promise<{ ok: true; data: GoodsOptionImportPage } | Failure> {
  if (!await requireAdminActionAccess('/admin/catalog/goods')) return { ok: false, error: STAFF_REQUIRED };
  const base = baseGoodIdValue === null ? null : goodId(baseGoodIdValue);
  const filters = parseGoodsOptionImportFilters(input);
  if ((baseGoodIdValue !== null && !base) || !filters) return { ok: false, error: '상품 검색 조건을 확인해주세요.' };
  try {
    const client = await createClient();
    const read = async (page: number) => {
      const { data, error } = await client.rpc('admin_search_goods_additional_candidates', {
        p_base_good_id: base, p_query: filters.query, p_field: filters.field, p_category_id: filters.categoryId || null,
        p_limit: GOODS_OPTION_IMPORT_PAGE_SIZE, p_offset: (page - 1) * GOODS_OPTION_IMPORT_PAGE_SIZE,
      });
      return error ? null : goodsPickerPageFromSearch(data, page);
    };
    let page = await read(filters.page);
    /* 마지막 페이지를 넘겨 물었으면(그사이 품절 등으로 줄었으면) 마지막 페이지를 다시 읽는다. */
    if (page && filters.page > goodsPickerLastPage(page.total)) page = await read(goodsPickerLastPage(page.total));
    return page ? { ok: true, data: page } : { ok: false, error: CANDIDATE_SEARCH_FAILED };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: CANDIDATE_SEARCH_FAILED }; }
}
export async function saveGoodsAdditionalAction(goodIdValue: unknown, idsValue: unknown, revisionValue: unknown): Promise<{ ok: true; message: string } | Failure> {
  if (!await requireAdminActionAccess('/admin/catalog/goods')) return { ok: false, error: STAFF_REQUIRED };
  const id = goodId(goodIdValue);
  const ids = parseAdditionalGoodIds(idsValue);
  const revisionValid = revisionValue === null || (typeof revisionValue === 'number' && Number.isInteger(revisionValue)
    && revisionValue >= 1 && revisionValue <= 2147483647);
  if (!id || !ids || ids.includes(id) || !revisionValid) return { ok: false, error: adminGoodsCopy('추가상품과 저장된 설정을 다시 확인해주세요.') };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_additional', {
      p_good_id: id, p_target_good_ids: ids, p_expected_revision: revisionValue,
    });
    if (error) return { ok: false, error: error.message === 'additional_goods_changed'
      ? adminGoodsCopy('추가상품 설정이 변경되었습니다. 새로고침한 뒤 다시 저장해주세요.')
      : error.message === 'additional_goods_cycle' ? '상품이 서로 순환하여 연결될 수 없습니다. 연결 관계를 확인해주세요.'
        : error.message === 'additional_good_unavailable' ? '현재 판매 중인 상품만 새로 연결할 수 있습니다. 상품 상태를 확인해주세요.'
          : adminGoodsCopy('추가상품을 저장하지 못했습니다.') };
    if (!data || typeof data.changed !== 'boolean') return { ok: false, error: adminGoodsCopy('추가상품 저장 결과를 확인하지 못했습니다. 설정을 새로고침해주세요.') };
    revalidateGoodsSurfaces();
    return { ok: true, message: ids.length ? adminGoodsCopy('추가상품 연결과 표시 순서를 저장했습니다.') : adminGoodsCopy('추가상품 연결을 모두 해제했습니다.') };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: adminGoodsCopy('추가상품을 저장하지 못했습니다.') }; }
}

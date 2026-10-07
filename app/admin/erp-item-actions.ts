'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { isCategoryId } from '@/lib/admin/category';
import {
  ERP_ITEM_FILE_BYTES_LIMIT,
  ERP_ITEM_IMPORT_CHUNK_SIZE,
  ERP_ITEM_IMPORT_ROW_LIMIT,
  erpImportRowPayload,
  normalizeErpImportRowInput,
  normalizeErpText,
  type ErpImportIssue,
} from '@/lib/admin/erp-item-import';
import {
  ERP_ITEMS_PATH,
  ERP_ITEM_LIMITS,
  ERP_ITEM_SEARCH_MIN_LENGTH,
  ERP_ITEM_SEARCH_QUERY_MAX,
  ERP_ITEM_SUGGESTION_LIMIT,
  isErpItemRejectReason,
  parseErpItemMatch,
  type ErpItemMatch,
} from '@/lib/admin/erp-items';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

const STAFF_ONLY = 'ERP 품목은 운영자만 관리할 수 있습니다.';

function rpcCode(error: { code?: unknown; message?: unknown }) {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return { code, descriptor: `${code} ${message}` };
}

function isPermissionError(code: string, descriptor: string) {
  return code === '42501' || code === '28000' || descriptor.includes('staff_required');
}

export type ErpItemSearchResult = { ok: true; items: ErpItemMatch[] } | { ok: false; error: string };

/**
 * 상품 옵션 ERP 품명 입력의 제안 검색. 운영자만, 2자 미만이면 빈 결과.
 * 저장 전인 상품 편집 화면에서 백그라운드로 부르므로 세션이 끝나도 로그인 화면으로
 * 옮기지 않는다 — 입력은 그대로 두고, 저장할 때 상품 저장 액션의 공통 가드가 이동시킨다.
 */
export async function searchErpItemsAction(queryValue: unknown): Promise<ErpItemSearchResult> {
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user || !auth.isStaff) return { ok: false, error: STAFF_ONLY };
    const query = typeof queryValue === 'string' ? normalizeErpText(queryValue, true).slice(0, ERP_ITEM_SEARCH_QUERY_MAX) : '';
    if (Array.from(query).length < ERP_ITEM_SEARCH_MIN_LENGTH) return { ok: true, items: [] };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_search_erp_items', { p_query: query, p_limit: ERP_ITEM_SUGGESTION_LIMIT });
    if (error || !Array.isArray(data)) return { ok: false, error: 'ERP 품목을 불러오지 못했습니다.' };
    return { ok: true, items: data.map(parseErpItemMatch).filter((item): item is ErpItemMatch => item !== null) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: 'ERP 품목을 불러오지 못했습니다.' };
  }
}

export type ErpItemFileResult =
  | { ok: true; fileName: string; sheetName: string | null; table: string[][]; numericColumns: number[]; warnings: string[] }
  | { ok: false; error: string };

/** 업로드 파일을 문자열 표로 읽어 돌려준다. 열 짝짓기와 미리보기는 화면에서 한다. */
export async function readErpItemFileAction(formData: FormData): Promise<ErpItemFileResult> {
  try {
    if (!await requireAdminActionAccess(ERP_ITEMS_PATH)) return { ok: false, error: STAFF_ONLY };
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: '반입할 파일을 선택해주세요.' };
    if (/\.xls$/i.test(file.name)) {
      return { ok: false, error: 'XLS 파일은 엑셀에서 XLSX로 다시 저장하거나, 표를 복사해 붙여넣어 주세요.' };
    }
    if (!/\.(xlsx|csv|tsv|txt)$/i.test(file.name)) return { ok: false, error: 'XLSX 또는 CSV 파일을 올려주세요.' };
    if (file.size > ERP_ITEM_FILE_BYTES_LIMIT) {
      return { ok: false, error: '파일은 900KB 이하로 올려주세요. 크면 필요한 열만 남겨 저장하거나 표를 복사해 붙여넣어 주세요.' };
    }
    const { readErpItemFile } = await import('@/lib/admin/erp-item-file.server');
    const read = await readErpItemFile(file.name, Buffer.from(await file.arrayBuffer()));
    return { ok: true, fileName: file.name.slice(0, 200), ...read };
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '';
    return { ok: false, error: message || '파일을 읽지 못했습니다. 형식을 확인한 뒤 다시 올려주세요.' };
  }
}

export type ErpItemImportResult =
  | { ok: true; inserted: number; updated: number; unchanged: number; rejected: ErpImportIssue[] }
  | { ok: false; error: string };

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseImportResult(value: unknown): Omit<Extract<ErpItemImportResult, { ok: true }>, 'ok'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const inserted = count(result.inserted);
  const updated = count(result.updated);
  const unchanged = count(result.unchanged);
  if (inserted === null || updated === null || unchanged === null || !Array.isArray(result.rejected)) return null;
  const rejected: ErpImportIssue[] = [];
  for (const raw of result.rejected) {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(entry.row)) return null;
    rejected.push({
      row: entry.row as number,
      code: typeof entry.code === 'string' ? entry.code : '',
      reason: isErpItemRejectReason(entry.reason) ? entry.reason : 'invalid_row',
    });
  }
  return { inserted, updated, unchanged, rejected };
}

/**
 * 미리보기에서 확정한 반입 행을 ERP 코드 기준으로 upsert한다. 서버 액션 요청 본문
 * 상한 때문에 화면이 최대 500행씩 나눠 부른다. 같은 내용을 다시 보내면 '같음'으로 처리돼
 * 중간에 끊겨도 처음부터 다시 반입하면 된다.
 */
export async function importErpItemsAction(rowsValue: unknown): Promise<ErpItemImportResult> {
  try {
    if (!await requireAdminActionAccess(ERP_ITEMS_PATH)) return { ok: false, error: STAFF_ONLY };
    if (!Array.isArray(rowsValue) || rowsValue.length === 0 || rowsValue.length > ERP_ITEM_IMPORT_CHUNK_SIZE) {
      return { ok: false, error: '반입할 행을 확인한 뒤 다시 시도해주세요.' };
    }
    const rejected: ErpImportIssue[] = [];
    const payload: Record<string, string | number | null>[] = [];
    rowsValue.forEach((value, index) => {
      const normalized = normalizeErpImportRowInput(value, index + 1);
      if (normalized.ok) payload.push(erpImportRowPayload(normalized.row));
      else rejected.push(normalized.issue);
    });
    if (!payload.length) return { ok: true, inserted: 0, updated: 0, unchanged: 0, rejected };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_import_erp_items', { p_rows: payload });
    if (error) {
      const { code, descriptor } = rpcCode(error);
      if (isPermissionError(code, descriptor)) return { ok: false, error: STAFF_ONLY };
      if (descriptor.includes('invalid_erp_item_rows')) {
        return { ok: false, error: `한 번에 ${ERP_ITEM_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}행까지 반입할 수 있습니다.` };
      }
      return { ok: false, error: 'ERP 품목을 반입하지 못했습니다. 같은 내용으로 다시 반입하면 이어서 반영됩니다.' };
    }
    const parsed = parseImportResult(data);
    revalidatePath(ERP_ITEMS_PATH);
    if (!parsed) return { ok: false, error: '반입 결과를 확인하지 못했습니다. 목록을 확인하고 같은 내용으로 다시 반입해주세요.' };
    return { ok: true, ...parsed, rejected: [...rejected, ...parsed.rejected].sort((left, right) => left.row - right.row) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: 'ERP 품목을 반입하지 못했습니다. 같은 내용으로 다시 반입하면 이어서 반영됩니다.' };
  }
}

export type ErpCategoryMappingResult =
  | { ok: true; changed: boolean; categoryId: string | null; message: string }
  | { ok: false; error: string };

/** ERP 분류 ↔ 고객 카테고리 말단 연결. 카테고리를 비우면 연결을 해제한다. */
export async function setErpCategoryMappingAction(input: { erpCategory: unknown; categoryId: unknown }): Promise<ErpCategoryMappingResult> {
  try {
    if (!await requireAdminActionAccess(ERP_ITEMS_PATH)) return { ok: false, error: STAFF_ONLY };
    const erpCategory = typeof input?.erpCategory === 'string' ? normalizeErpText(input.erpCategory, true) : '';
    if (!erpCategory || erpCategory.length > ERP_ITEM_LIMITS.category) return { ok: false, error: 'ERP 분류 이름을 확인해주세요.' };
    const rawCategoryId = typeof input?.categoryId === 'string' ? input.categoryId.trim() : input?.categoryId ?? null;
    if (rawCategoryId !== null && rawCategoryId !== '' && !isCategoryId(rawCategoryId)) {
      return { ok: false, error: '연결할 고객 카테고리를 다시 골라주세요.' };
    }
    const categoryId = rawCategoryId ? rawCategoryId as string : null;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_set_erp_category_mapping', { p_erp_category: erpCategory, p_category_id: categoryId });
    if (error) {
      const { code, descriptor } = rpcCode(error);
      if (isPermissionError(code, descriptor)) return { ok: false, error: STAFF_ONLY };
      if (descriptor.includes('category_archived')) return { ok: false, error: '보관된 카테고리에는 연결할 수 없습니다.' };
      if (descriptor.includes('category_not_leaf')) return { ok: false, error: '하위 카테고리가 있는 분류에는 연결할 수 없습니다. 말단 카테고리를 골라주세요.' };
      if (descriptor.includes('category_not_found')) return { ok: false, error: '카테고리를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.' };
      if (descriptor.includes('invalid_erp_category')) return { ok: false, error: 'ERP 분류 이름을 확인해주세요.' };
      return { ok: false, error: 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.' };
    }
    const changed = Boolean(data && typeof data === 'object' && (data as Record<string, unknown>).changed === true);
    if (changed) revalidatePath(ERP_ITEMS_PATH);
    return {
      ok: true,
      changed,
      categoryId,
      message: !changed ? '이미 같은 연결입니다.' : categoryId ? 'ERP 분류를 고객 카테고리에 연결했습니다.' : 'ERP 분류 연결을 해제했습니다.',
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.' };
  }
}

'use server';

import { randomUUID } from 'node:crypto';
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
  ERP_CATEGORY_MAPPING_BATCH_LIMIT,
  ERP_ITEMS_PATH,
  ERP_ITEM_DELETE_LIMIT,
  ERP_ITEM_LIMITS,
  addErpItemClears,
  emptyErpItemClears,
  erpCategoryMappingBatchMessage,
  erpCategoryMappingErrorLabel,
  erpItemBlankFields,
  isErpItemRejectReason,
  parseErpCategoryMappingBatch,
  type ErpCategoryMappingEntry,
  type ErpItemBlankField,
  type ErpItemClears,
} from '@/lib/admin/erp-items';
import {
  ERP_LINKED_GOODS_PREVIEW_LIMIT,
  ERP_LINKED_GOODS_SCOPE_LIMIT,
  erpLinkedGoodsErrorLabel,
  erpLinkedGoodsReceiptMessage,
  parseErpLinkedGoodsPreview,
  parseErpLinkedGoodsReceipt,
  type ErpLinkedGoodsPreview,
  type ErpLinkedGoodsReceipt,
} from '@/lib/admin/erp-linked-goods';
import { hasAdminCapability } from '@/lib/admin/access';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

const STAFF_ONLY = 'ERP 품목은 운영자만 관리할 수 있습니다.';
/* 1027T-016 MD 반입 권한: 읽기·반입·분류 연결은 상품 관리(catalog.manage), 품목 삭제는 요청 범위 밖이라 플랫폼 관리에 남는다. */
const DELETE_ONLY = 'ERP 품목 삭제는 계정 주매니저·통합 매니저만 할 수 있습니다.';
const MAPPING_FAILED = 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.';

function rpcCode(error: { code?: unknown; message?: unknown }) {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return { code, descriptor: `${code} ${message}` };
}

function isPermissionError(code: string, descriptor: string) {
  return code === '42501' || code === '28000' || descriptor.includes('staff_required');
}

export type ErpItemFileResult =
  | { ok: true; fileName: string; sheetName: string | null; table: string[][]; numericColumns: number[]; warnings: string[] }
  | { ok: false; error: string };

/** 업로드 파일을 문자열 표로 읽어 돌려준다. 열 짝짓기와 미리보기는 화면에서 한다. */
export async function readErpItemFileAction(formData: FormData): Promise<ErpItemFileResult> {
  try {
    if (!await requireAdminActionAccess(ERP_ITEMS_PATH)) return { ok: false, error: STAFF_ONLY };
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: '올릴 파일을 선택해주세요.' };
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
      return { ok: false, error: '올릴 품목이 없거나 한 번에 보낸 줄이 너무 많습니다. 새로고침한 뒤 표를 다시 붙여넣어 올려주세요.' };
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
        return { ok: false, error: `한 번에 ${ERP_ITEM_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}줄까지 올릴 수 있습니다. 파일을 나누어 올려주세요.` };
      }
      return { ok: false, error: 'ERP 품목을 올리지 못했습니다. 같은 내용으로 다시 올리면 이미 올라간 품목은 그대로 두고 나머지를 이어서 올립니다.' };
    }
    const parsed = parseImportResult(data);
    revalidatePath(ERP_ITEMS_PATH);
    if (!parsed) return { ok: false, error: '올린 결과를 확인하지 못했습니다. 아래 올린 품목 목록에서 들어갔는지 먼저 확인하고, 빠진 품목이 있으면 같은 내용으로 다시 올려주세요.' };
    return { ok: true, ...parsed, rejected: [...rejected, ...parsed.rejected].sort((left, right) => left.row - right.row) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: 'ERP 품목을 올리지 못했습니다. 같은 내용으로 다시 올리면 이미 올라간 품목은 그대로 두고 나머지를 이어서 올립니다.' };
  }
}

export type ErpItemClearsResult = { ok: true; clears: ErpItemClears } | { ok: false; error: string };

const CLEARS_FAILED = '올려 둔 값과 비교하지 못했습니다.';
/* 조회 주소가 너무 길어지지 않게 ERP 코드를 나눠 읽는다(코드는 120자까지이고 한글은 주소에서 9배로 늘어난다). */
const CLEARS_LOOKUP_SIZE = 50;
const CLEARS_LOOKUP_CHARS = 3_000;

function lookupChunks(codes: readonly string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const code of codes) {
    const length = encodeURIComponent(code).length + 3;
    if (current.length && (current.length >= CLEARS_LOOKUP_SIZE || size + length > CLEARS_LOOKUP_CHARS)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(code);
    size += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/* PostgREST `in.(…)` 목록. 쉼표·괄호·따옴표가 든 ERP 코드도 글자 그대로 찾게 큰따옴표로 감싸고 `\`와 `"`는 역슬래시로 표시한다. */
function quotedInList(values: readonly string[]): string {
  return `(${values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
}

/**
 * 품목 올리기 전 확인(화면 규칙 7): 열을 골랐는데 칸이 비어 있는 줄 가운데, 이미 올려 둔 값이 있어 그 값이 지워지는 품목을 센다.
 * 읽기만 하고 아무것도 바꾸지 않는다. 화면은 칸이 빈 줄만 한 번에 500줄까지 보내고, 지워지는 값이 있을 때만 올리기 전에 한 번 묻는다.
 * 올려 둔 품목은 상품 관리 권한의 읽기 정책(erp_items_staff_read)으로 ERP 코드가 같은 것만 읽는다(코드는 올릴 때처럼 글자 그대로 비교한다).
 */
export async function countErpItemClearsAction(rowsValue: unknown): Promise<ErpItemClearsResult> {
  try {
    if (!await requireAdminActionAccess(ERP_ITEMS_PATH)) return { ok: false, error: STAFF_ONLY };
    if (!Array.isArray(rowsValue) || rowsValue.length === 0 || rowsValue.length > ERP_ITEM_IMPORT_CHUNK_SIZE) return { ok: false, error: CLEARS_FAILED };
    /* 올릴 때와 같은 규칙으로 줄을 다시 읽는다. 올리지 못할 줄은 아무것도 지우지 않으므로 뺀다. 같은 코드는 마지막 줄이 이긴다. */
    const blanks = new Map<string, ErpItemBlankField[]>();
    rowsValue.forEach((value, index) => {
      const normalized = normalizeErpImportRowInput(value, index + 1);
      if (!normalized.ok) return;
      const fields = erpItemBlankFields(normalized.row);
      if (fields.length) blanks.set(normalized.row.code, fields);
      else blanks.delete(normalized.row.code);
    });
    let clears = emptyErpItemClears();
    if (!blanks.size) return { ok: true, clears };
    const supabase = await createClient();
    for (const codes of lookupChunks([...blanks.keys()])) {
      const { data, error } = await supabase.from('erp_items').select('code,name,category,sale_price,barcode')
        .filter('code', 'in', quotedInList(codes));
      if (error || !Array.isArray(data)) return { ok: false, error: CLEARS_FAILED };
      for (const raw of data as Record<string, unknown>[]) {
        const fields = typeof raw.code === 'string' ? blanks.get(raw.code) : undefined;
        if (!fields) continue;
        clears = addErpItemClears(clears, {
          code: raw.code as string,
          name: typeof raw.name === 'string' ? raw.name : '',
          category: typeof raw.category === 'string' ? raw.category : null,
          salePrice: typeof raw.sale_price === 'number' ? raw.sale_price : null,
          barcode: typeof raw.barcode === 'string' ? raw.barcode : null,
        }, fields);
      }
    }
    return { ok: true, clears };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: CLEARS_FAILED };
  }
}

export type ErpItemDeleteResult =
  | { ok: true; deleted: number; missing: number; message: string }
  | { ok: false; error: string };

const DELETE_FAILED = 'ERP 품목을 지우지 못했습니다. 다시 시도해주세요.';

/**
 * 목록에서 고른 ERP 품목을 ERP 코드로 지운다(잘못 반입한 품목·단종 품목 정리).
 * 코드는 목록의 키를 그대로 쓴다. 상품·옵션에 이미 넣은 ERP 코드·품명과 ERP 분류 연결은 바뀌지 않고,
 * 지운 행의 값은 DB가 감사 기록에 남긴다.
 */
export async function deleteErpItemsAction(codesValue: unknown): Promise<ErpItemDeleteResult> {
  try {
    const access = await requireAdminActionAccess(ERP_ITEMS_PATH);
    if (!access) return { ok: false, error: STAFF_ONLY };
    if (!hasAdminCapability(access, 'platform.manage')) return { ok: false, error: DELETE_ONLY };
    const codes = Array.isArray(codesValue) ? [...new Set(codesValue)] : [];
    if (!codes.length || codes.length > ERP_ITEM_DELETE_LIMIT
      || codes.some((code) => typeof code !== 'string' || !code || code.length > ERP_ITEM_LIMITS.code)) {
      return { ok: false, error: `지울 ERP 품목을 다시 골라주세요. 한 번에 ${ERP_ITEM_DELETE_LIMIT.toLocaleString('ko-KR')}개까지 지울 수 있습니다.` };
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_delete_erp_items', { p_codes: codes as string[] });
    if (error) {
      const { code, descriptor } = rpcCode(error);
      return { ok: false, error: isPermissionError(code, descriptor) ? DELETE_ONLY : DELETE_FAILED };
    }
    revalidatePath(ERP_ITEMS_PATH);
    const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const deleted = count(result.deleted);
    const missing = count(result.missing);
    if (deleted === null || missing === null) return { ok: false, error: '삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.' };
    return {
      ok: true,
      deleted,
      missing,
      message: `ERP 품목 ${deleted.toLocaleString('ko-KR')}건을 지웠습니다.${missing ? ` ${missing.toLocaleString('ko-KR')}건은 이미 지워진 품목입니다.` : ''}`,
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: DELETE_FAILED };
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
    if (!erpCategory || erpCategory.length > ERP_ITEM_LIMITS.category) return { ok: false, error: 'ERP 분류 이름이 비어 있거나 너무 깁니다. 새로고침한 뒤 다시 연결해주세요.' };
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
      return { ok: false, error: erpCategoryMappingErrorLabel(descriptor) ?? MAPPING_FAILED };
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
    return { ok: false, error: MAPPING_FAILED };
  }
}

export type ErpCategoryMappingsResult =
  | { ok: true; changed: number; unchanged: number; rejected: { erpCategory: string; error: string }[]; message: string }
  | { ok: false; error: string };

/* 화면은 표의 행을 그대로 보낸다. 형식이 어긋난 묶음은 잘못된 요청이므로 DB에 보내지 않는다. */
function normalizeMappingEntries(value: unknown): (ErpCategoryMappingEntry & { original: string })[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > ERP_CATEGORY_MAPPING_BATCH_LIMIT) return null;
  const entries: (ErpCategoryMappingEntry & { original: string })[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const { erpCategory: rawCategory, categoryId: rawId } = raw as { erpCategory?: unknown; categoryId?: unknown };
    if (typeof rawCategory !== 'string') return null;
    const erpCategory = normalizeErpText(rawCategory, true);
    if (!erpCategory || erpCategory.length > ERP_ITEM_LIMITS.category) return null;
    if (rawId !== null && !isCategoryId(rawId)) return null;
    entries.push({ original: rawCategory, erpCategory, categoryId: rawId as string | null });
  }
  return entries;
}

/**
 * ERP 분류 연결을 여러 건 저장한다(연결 표의 선택 연결·제안 저장·고른 값 저장). categoryId가 null이면 연결 해제.
 * DB가 행마다 단건과 같은 규칙으로 처리하고 거절된 행의 사유만 돌려준다.
 * 같은 내용을 다시 보내면 변경 없음으로 끝나 결과를 못 받았을 때 다시 눌러도 된다.
 */
export async function setErpCategoryMappingsAction(entriesValue: unknown): Promise<ErpCategoryMappingsResult> {
  try {
    if (!await requireAdminActionAccess(ERP_ITEMS_PATH)) return { ok: false, error: STAFF_ONLY };
    const entries = normalizeMappingEntries(entriesValue);
    if (!entries) return { ok: false, error: `연결할 ERP 분류를 다시 골라주세요. 한 번에 ${ERP_CATEGORY_MAPPING_BATCH_LIMIT.toLocaleString('ko-KR')}개까지 저장할 수 있습니다.` };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_set_erp_category_mappings', {
      p_entries: entries.map(({ erpCategory, categoryId }) => ({ erp_category: erpCategory, category_id: categoryId })),
    });
    if (error) {
      const { code, descriptor } = rpcCode(error);
      return { ok: false, error: isPermissionError(code, descriptor) ? STAFF_ONLY : MAPPING_FAILED };
    }
    const parsed = parseErpCategoryMappingBatch(data);
    if (!parsed) {
      revalidatePath(ERP_ITEMS_PATH);
      return { ok: false, error: '저장됐는지 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.' };
    }
    if (parsed.changed) revalidatePath(ERP_ITEMS_PATH);
    const rejected = parsed.rejected.map(({ index, reason }) => ({
      erpCategory: entries[index]?.original ?? '',
      error: erpCategoryMappingErrorLabel(reason) ?? MAPPING_FAILED,
    }));
    return {
      ok: true,
      changed: parsed.changed,
      unchanged: parsed.unchanged,
      rejected,
      message: erpCategoryMappingBatchMessage({ ...parsed, rejected }, entries.every((entry) => entry.categoryId === null)),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: MAPPING_FAILED };
  }
}

export type ErpLinkedGoodsPreviewResult = { ok: true; preview: ErpLinkedGoodsPreview } | { ok: false; error: string };

const PREVIEW_FAILED = '연결 상품과 비교하지 못했습니다. 다시 시도해주세요.';

/**
 * 연결 상품 반영 미리보기(1027T-X04). 반입한 ERP 판매가·바코드가 같은 ERP 코드를 넣은 상품 옵션과 다른 행을
 * DB가 계산해 operation에 고정한다. codes가 없으면 반입한 전체 ERP 품목, 있으면 방금 반입한 품목만 비교한다.
 * 상품은 바꾸지 않는다.
 */
export async function previewErpLinkedGoodsAction(codesValue: unknown): Promise<ErpLinkedGoodsPreviewResult> {
  try {
    if (!await requireAdminActionAccess(ERP_ITEMS_PATH)) return { ok: false, error: STAFF_ONLY };
    let codes: string[] | null = null;
    if (codesValue !== null && codesValue !== undefined) {
      if (!Array.isArray(codesValue) || codesValue.length === 0 || codesValue.length > ERP_LINKED_GOODS_SCOPE_LIMIT
        || codesValue.some((code) => typeof code !== 'string' || !code || code.length > ERP_ITEM_LIMITS.code)) {
        return { ok: false, error: `비교할 ERP 품목을 다시 확인해주세요. 한 번에 ${ERP_LINKED_GOODS_SCOPE_LIMIT.toLocaleString('ko-KR')}개까지 비교합니다.` };
      }
      codes = [...new Set(codesValue as string[])];
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_preview_erp_linked_goods', { p_operation_id: randomUUID(), p_codes: codes });
    if (error) {
      const { code, descriptor } = rpcCode(error);
      if (isPermissionError(code, descriptor)) return { ok: false, error: STAFF_ONLY };
      return { ok: false, error: erpLinkedGoodsErrorLabel(descriptor) ?? PREVIEW_FAILED };
    }
    const preview = parseErpLinkedGoodsPreview(data);
    return preview ? { ok: true, preview } : { ok: false, error: PREVIEW_FAILED };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: PREVIEW_FAILED };
  }
}

export type ErpLinkedGoodsCommitResult =
  | { ok: true; receipt: ErpLinkedGoodsReceipt; message: string }
  | { ok: false; error: string };

const COMMIT_FAILED = '반영 결과를 확인하지 못했습니다. 같은 미리보기에서 다시 반영해도 이미 반영된 줄은 다시 바꾸지 않습니다.';
const ROW_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(price|barcode)$/i;

/**
 * 미리보기에서 고른 행만 연결 상품에 반영한다. DB가 잠근 뒤 같은 계산을 다시 해 미리보기 뒤 값이 바뀌었으면
 * 아무것도 바꾸지 않고, 같은 operation을 다시 보내면 남겨 둔 결과를 돌려준다(이중 반영 없음).
 */
export async function commitErpLinkedGoodsAction(input: { operationId: unknown; keys: unknown }): Promise<ErpLinkedGoodsCommitResult> {
  try {
    if (!await requireAdminActionAccess(ERP_ITEMS_PATH)) return { ok: false, error: STAFF_ONLY };
    const keys = Array.isArray(input?.keys) ? [...new Set(input.keys)] : [];
    if (!isUuid(input?.operationId) || !keys.length || keys.length > ERP_LINKED_GOODS_PREVIEW_LIMIT
      || keys.some((key) => typeof key !== 'string' || !ROW_KEY.test(key))) {
      return { ok: false, error: '반영할 줄을 다시 골라주세요.' };
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_commit_erp_linked_goods', { p_operation_id: input.operationId, p_keys: keys as string[] });
    if (error) {
      const { code, descriptor } = rpcCode(error);
      if (isPermissionError(code, descriptor) && !descriptor.includes('erp_goods_apply_unavailable')) return { ok: false, error: STAFF_ONLY };
      const detail = typeof (error as { details?: unknown }).details === 'string' ? (error as { details: string }).details : null;
      return { ok: false, error: erpLinkedGoodsErrorLabel(descriptor, detail) ?? COMMIT_FAILED };
    }
    const receipt = parseErpLinkedGoodsReceipt(data);
    if (!receipt) return { ok: false, error: COMMIT_FAILED };
    if (receipt.state === 'completed' && (receipt.applied.price || receipt.applied.barcode)) {
      revalidatePath(ERP_ITEMS_PATH);
      revalidateGoodsSurfaces();
    }
    return { ok: true, receipt, message: erpLinkedGoodsReceiptMessage(receipt) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: COMMIT_FAILED };
  }
}

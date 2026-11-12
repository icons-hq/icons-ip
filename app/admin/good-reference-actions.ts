'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { ERP_ITEM_FILE_BYTES_LIMIT } from '@/lib/admin/erp-item-import';
import { GOOD_REFERENCE_LIMIT, GOOD_REFERENCE_MAX_LENGTH, SYSTEM_NUMBER_COLUMN_NOTICE, isGoodReferenceKeyHeader, isSystemProductNumberHeader, type GoodReferenceMatch } from '@/lib/admin/good-references';
import type { GoodDisplayVisibilityRow } from '@/lib/admin/good-visibility';

/*
 * 전시 상품 선택기(홈 큐레이션·카테고리 전시·쇼핑스토리·캠페인 굿즈 블록·할인 프로모션)의 여러 줄·엑셀 추가(1014-112).
 * 조회만 한다 — 실제 편성 저장은 각 화면의 저장 경로가 그대로 맡는다. 상품 조회 권한(catalog.read)이면 쓸 수 있다.
 */
const ACCESS_DENIED = '상품을 조회할 권한이 필요합니다.';

export type GoodReferenceResolveResult = { ok: true; matches: GoodReferenceMatch[] } | { ok: false; error: string };
export async function resolveGoodReferencesAction(refs: unknown): Promise<GoodReferenceResolveResult> {
  try {
    if (!await requireAdminActionAccess('/admin', { capability: 'catalog.read' })) return { ok: false, error: ACCESS_DENIED };
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > GOOD_REFERENCE_LIMIT
      || refs.some(ref => typeof ref !== 'string' || ref !== ref.trim() || !ref || [...ref].length > GOOD_REFERENCE_MAX_LENGTH)
      || new Set(refs).size !== refs.length) return { ok: false, error: '조회할 상품 URL·판매자상품코드를 확인해주세요.' };
    const { resolveGoodReferences } = await import('@/lib/admin/good-references.server');
    return { ok: true, matches: await resolveGoodReferences(refs as string[]) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '상품을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

export type GoodDisplayVisibilityResult = { ok: true; goods: GoodDisplayVisibilityRow[] } | { ok: false; error: string };
/** 저장된 전시 구성(카테고리 전시·캠페인 상품 묶음·홈 전시)의 상품 이름과 고객 화면에 보이지 않는 이유를 다시 읽는다(QA1 MD). */
export async function readGoodsDisplayVisibilityAction(ids: unknown): Promise<GoodDisplayVisibilityResult> {
  try {
    if (!await requireAdminActionAccess('/admin', { capability: 'catalog.read' })) return { ok: false, error: ACCESS_DENIED };
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > GOOD_REFERENCE_LIMIT
      || ids.some(id => typeof id !== 'string' || id !== id.trim() || !id || [...id].length > GOOD_REFERENCE_MAX_LENGTH)
      || new Set(ids).size !== ids.length) return { ok: false, error: '조회할 상품 URL을 확인해주세요.' };
    const { readGoodsDisplayVisibility } = await import('@/lib/admin/good-references.server');
    return { ok: true, goods: await readGoodsDisplayVisibility(ids as string[]) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '상품을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

export type GoodReferenceFileResult = { ok: true; cells: string[]; warnings: string[] } | { ok: false; error: string };
/** 엑셀·CSV의 한 열(값이 있는 첫 번째 열)을 칸 순서대로 읽는다. 머리글 판정과 URL 해석은 화면이 붙여넣기와 같은 규칙으로 한다. */
export async function readGoodReferenceFileAction(formData: FormData): Promise<GoodReferenceFileResult> {
  try {
    if (!await requireAdminActionAccess('/admin', { capability: 'catalog.read' })) return { ok: false, error: ACCESS_DENIED };
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: '읽을 파일을 선택해주세요.' };
    if (/\.xls$/i.test(file.name)) return { ok: false, error: 'XLS 파일은 엑셀에서 XLSX로 다시 저장하거나, 열을 복사해 붙여넣어 주세요.' };
    if (!/\.(xlsx|csv|tsv|txt)$/i.test(file.name)) return { ok: false, error: 'XLSX 또는 CSV 파일을 올려주세요.' };
    if (file.size > ERP_ITEM_FILE_BYTES_LIMIT) return { ok: false, error: '파일은 900KB 이하로 올려주세요. 판매자상품코드·상품 URL 한 열만 남겨 저장해주세요.' };
    const { readErpItemFile } = await import('@/lib/admin/erp-item-file.server');
    const read = await readErpItemFile(file.name, Buffer.from(await file.arrayBuffer()));
    const width = Math.max(0, ...read.table.map(row => row.length));
    const columns = Array.from({ length: width }, (_, index) => index);
    /* 상품 엑셀(v8)의 첫 열은 시스템 상품번호다. 머리글이 있으면 판매자상품코드·상품 URL 열을 골라 읽고, 번호 열은 읽지 않는다(T22i). */
    const header = read.table[0] ?? [];
    const firstWithValues = columns.find(index => read.table.some(row => (row[index] ?? '').trim()));
    const keyColumn = columns.find(index => isGoodReferenceKeyHeader(header[index] ?? ''));
    const column = keyColumn ?? firstWithValues;
    if (column === undefined) return { ok: false, error: '파일에 읽을 값이 없습니다.' };
    if (keyColumn === undefined && isSystemProductNumberHeader(header[column] ?? '')) return { ok: false, error: SYSTEM_NUMBER_COLUMN_NOTICE };
    const cells = read.table.map(row => (row[column] ?? '').trim()).filter(Boolean);
    const warnings = [...read.warnings];
    if (read.table.some(row => row.some((cell, index) => index !== column && cell.trim()))) {
      warnings.push(keyColumn === undefined ? `값이 있는 첫 번째 열(${column + 1}열)만 읽었습니다. 다른 열은 쓰지 않았습니다.` : `머리글을 보고 ${column + 1}열(${(header[column] ?? '').trim()})만 읽었습니다. 다른 열은 쓰지 않았습니다.`);
    }
    if (cells.length > GOOD_REFERENCE_LIMIT + 1) {
      warnings.push(`한 번에 ${GOOD_REFERENCE_LIMIT.toLocaleString('ko-KR')}줄까지 읽습니다. 나머지는 나눠서 추가해주세요.`);
    }
    return { ok: true, cells: cells.slice(0, GOOD_REFERENCE_LIMIT + 1), warnings };
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '';
    return { ok: false, error: message || '파일을 읽지 못했습니다. 형식을 확인한 뒤 다시 올려주세요.' };
  }
}

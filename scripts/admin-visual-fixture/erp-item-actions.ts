/** Synthetic ERP item boundary. The picker reads fixed in-memory rows; never contacts Auth or the database. */
import type { ErpItemMatch } from '../../lib/admin/erp-items';
import type {
  ErpCategoryMappingResult,
  ErpCategoryMappingsResult,
  ErpItemDeleteResult,
  ErpItemFileResult,
  ErpItemImportResult,
} from '../../app/admin/erp-item-actions';
import type { ErpItemPickerResult } from '../../app/admin/erp-item-picker-actions';

/* mappedCategoryId는 good-editor.tsx의 합성 카테고리 '문구'다. */
export const fixtureErpItems: ErpItemMatch[] = [
  { code: '000123', name: '합성 아크릴 키링', category: '합성 문구 > 키링', salePrice: 12000, barcode: '0880000000123', mappedCategoryId: '00000000-0000-4000-8000-000000051120' },
  { code: 'ERP-FX-0002', name: '합성 키링 거치대', category: '합성 문구 > 키링', salePrice: 8000, barcode: null, mappedCategoryId: '00000000-0000-4000-8000-000000051120' },
  { code: 'ERP-FX-0003', name: '합성 포토카드 세트', category: null, salePrice: null, barcode: null, mappedCategoryId: null },
];

/** 옵션의 [ERP 품목 고르기] 선택창 조회. 검색어가 ERP 품명·ERP 코드에 든 줄만 돌려준다(검색어가 없으면 전체). */
export async function searchErpItemPickerAction(input: unknown): Promise<ErpItemPickerResult> {
  const raw = input && typeof input === 'object' ? (input as { query?: unknown }).query : '';
  const query = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const rows = fixtureErpItems.filter((item) => !query || item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query));
  return { ok: true, data: { rows, total: rows.length, page: 1, pageSize: 20 } };
}

const blocked = '합성 fixture에서는 ERP 품목을 저장하지 않습니다.';
export async function readErpItemFileAction(): Promise<ErpItemFileResult> {
  return { ok: false, error: blocked };
}
export async function importErpItemsAction(): Promise<ErpItemImportResult> {
  return { ok: false, error: blocked };
}
export async function deleteErpItemsAction(): Promise<ErpItemDeleteResult> {
  return { ok: false, error: blocked };
}
export async function setErpCategoryMappingAction(): Promise<ErpCategoryMappingResult> {
  return { ok: false, error: blocked };
}
export async function setErpCategoryMappingsAction(): Promise<ErpCategoryMappingsResult> {
  return { ok: false, error: blocked };
}

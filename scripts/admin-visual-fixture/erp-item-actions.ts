/** Synthetic ERP item boundary. Suggestions come from fixed in-memory rows; never contacts Auth or the database. */
import type { ErpItemMatch } from '../../lib/admin/erp-items';
import type {
  ErpCategoryMappingResult,
  ErpItemDeleteResult,
  ErpItemFileResult,
  ErpItemImportResult,
  ErpItemSearchResult,
} from '../../app/admin/erp-item-actions';

/* mappedCategoryId는 good-editor.tsx의 합성 카테고리 '문구'다. */
export const fixtureErpItems: ErpItemMatch[] = [
  { code: '000123', name: '합성 아크릴 키링', category: '합성 문구 > 키링', salePrice: 12000, barcode: '0880000000123', mappedCategoryId: '00000000-0000-4000-8000-000000051120' },
  { code: 'ERP-FX-0002', name: '합성 키링 거치대', category: '합성 문구 > 키링', salePrice: 8000, barcode: null, mappedCategoryId: '00000000-0000-4000-8000-000000051120' },
  { code: 'ERP-FX-0003', name: '합성 포토카드 세트', category: null, salePrice: null, barcode: null, mappedCategoryId: null },
];

export async function searchErpItemsAction(queryValue: unknown): Promise<ErpItemSearchResult> {
  const query = typeof queryValue === 'string' ? queryValue.trim().toLowerCase() : '';
  if (Array.from(query).length < 2) return { ok: true, items: [] };
  return { ok: true, items: fixtureErpItems.filter((item) => item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query)) };
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

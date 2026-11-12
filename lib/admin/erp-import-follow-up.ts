/*
 * ERP 품목 반입 뒤 할 일(1027T-016·1027T-X04). 반입이 끝나면 방금 반입한 품목으로 연결 상품과 비교하고,
 * 붙여넣은 ERP 분류 중 고객 카테고리에 연결되지 않은 분류를 '미연결 분류 N건'으로 알린다.
 */
import { normalizeErpText, type ErpImportIssue, type ErpImportRow } from './erp-item-import';
import type { ErpCategoryMappingRow } from './erp-items';

export interface ErpImportFollowUp {
  /** 반입된 ERP 코드(거부된 행 제외, 중복 없음). 연결 상품 비교 범위다. */
  codes: string[];
  /** 반입된 행의 ERP 분류(열을 고른 행만, 중복 없음). */
  categories: string[];
}

/** 반입한 행에서 서버가 거부한 행을 빼고 비교 범위와 분류를 뽑는다. */
export function erpImportFollowUp(rows: readonly ErpImportRow[], rejected: readonly Pick<ErpImportIssue, 'row'>[]): ErpImportFollowUp {
  const rejectedRows = new Set(rejected.map((issue) => issue.row));
  const kept = rows.filter((row) => !rejectedRows.has(row.row));
  return {
    codes: [...new Set(kept.map((row) => row.code))],
    categories: [...new Set(kept.flatMap((row) => {
      const category = row.category ? normalizeErpText(row.category, true) : '';
      return category ? [category] : [];
    }))],
  };
}

/**
 * 연결 표에서 '연결 필요'로 보이는 ERP 분류: 품목이 있고, 직접 연결도 자동 연결(정본 매핑·같은 경로)도 없는 분류.
 * 화면 표의 판정(ErpCategoryMappingPanel)과 같다.
 */
export function unlinkedErpCategories(rows: readonly Pick<ErpCategoryMappingRow, 'erpCategory' | 'itemCount' | 'categoryId' | 'fallbackCategoryId'>[]): string[] {
  return rows.filter((row) => row.itemCount > 0 && !row.categoryId && !row.fallbackCategoryId).map((row) => row.erpCategory);
}

/** 붙여넣은 분류 중 연결 필요인 분류. 공백 차이는 DB 정규화와 같이 무시한다. */
export function unlinkedPastedCategories(pasted: readonly string[], unlinked: readonly string[]): string[] {
  const keys = new Set(unlinked.map((name) => normalizeErpText(name, true)));
  return pasted.filter((name) => keys.has(normalizeErpText(name, true)));
}

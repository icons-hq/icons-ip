import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { kstDateTimeText } from './list-export';
export interface CategoryExportRow {
  code: string;
  name: string;
  path: string;
  depth: number;
  status: string;
  assignedGoods: number;
  /** 이 카테고리에 연결한 상품 유형. 없으면 ''(상위를 따른다). */
  goodType?: string;
  /** 상품에 적용되는 상품 유형(연결 또는 가까운 상위). 없으면 ''. */
  effectiveGoodType?: string;
  erpCode?: string;
  erpName?: string;
  erpSource?: string;
  erpVerifiedAt?: string;
}

const HEADERS = [
  '고객 카테고리 코드',
  '고객 카테고리 이름',
  '고객 카테고리 경로',
  '깊이',
  '상태',
  adminGoodsCopy('연결 굿즈 수'),
  'ERP 코드',
  'ERP 품명',
  'ERP 출처',
  'ERP 검증 시각',
] as const;
/* SHEET-003(ADR-0037): 카테고리 상품 유형은 두 판 모두 맨 뒤에 둔다(앞 열의 위치를 바꾸지 않는다). */
const GOOD_TYPE_HEADERS = ['상품 유형 연결', '적용 상품 유형'] as const;

function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function categoryExportCsv(rows: readonly CategoryExportRow[], includeErp = true): string {
  const values = rows.map((row) => [
    row.code,
    row.name,
    row.path,
    row.depth,
    row.status,
    row.assignedGoods,
    ...(includeErp ? [row.erpCode ?? '', row.erpName ?? '', row.erpSource ?? '', kstDateTimeText(row.erpVerifiedAt) || (row.erpVerifiedAt ?? '')] : []),
    row.goodType || '연결 안 함',
    row.effectiveGoodType || '없음',
  ] satisfies readonly (string | number)[]);
  return `\uFEFF${[[...(includeErp ? HEADERS : HEADERS.slice(0, 6)), ...GOOD_TYPE_HEADERS], ...values].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

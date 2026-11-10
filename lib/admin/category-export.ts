import { adminGoodsCopy } from '@/lib/admin/vocabulary';
export interface CategoryExportRow {
  code: string;
  name: string;
  path: string;
  depth: number;
  status: string;
  assignedGoods: number;
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
    ...(includeErp ? [row.erpCode ?? '', row.erpName ?? '', row.erpSource ?? '', row.erpVerifiedAt ?? ''] : []),
  ] satisfies readonly (string | number)[]);
  return `\uFEFF${[includeErp ? HEADERS : HEADERS.slice(0, 6), ...values].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

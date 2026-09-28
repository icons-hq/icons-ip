import { describe, expect, it } from 'vitest';
import { categoryExportCsv, type CategoryExportRow } from './category-export';
const row: CategoryExportRow = { code: '001', name: '분류', path: '문구 > 분류', depth: 2, status: '활성', assignedGoods: 0, erpCode: '00002', erpName: '문구', erpSource: 'ERP', erpVerifiedAt: '2026-09-28' };
describe('카테고리 CSV', () => {
  it.each(['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', ' \t=1', '\r\n+1'])('수식 접두 %j는 텍스트로 내보낸다', value => {
    const csv = categoryExportCsv([{ ...row, name: value }]);
    expect(csv).toContain(`"'${value}"`);
  });
  it('BOM·CRLF·따옴표와 선행 0을 보존한다', () => {
    const csv = categoryExportCsv([{ ...row, name: '문구, "메모"\n노트' }]);
    expect(csv.startsWith('\uFEFF"고객 카테고리 코드"')).toBe(true);
    expect(csv).toContain('\r\n"001","문구, ""메모""\n노트"');
    expect(csv).toContain('"2","활성","0","00002"');
  });
});

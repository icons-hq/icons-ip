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
  /* SHEET-003(ADR-0037): 카테고리 상품 유형 연결과 상품에 적용되는 유형(상위 포함)을 두 판 모두 맨 뒤 열로 내보낸다. */
  it('상품 유형 연결과 적용 유형을 맨 뒤 열로 내보낸다', () => {
    const csv = categoryExportCsv([{ ...row, goodType: '', effectiveGoodType: '피규어' }]);
    expect(csv.split('\r\n')[0].endsWith('"상품 유형 연결","적용 상품 유형"')).toBe(true);
    expect(csv).toContain('"연결 안 함","피규어"');
    const basic = categoryExportCsv([{ ...row, goodType: '키링', effectiveGoodType: '키링' }], false);
    expect(basic.split('\r\n')[0]).toBe('\uFEFF"고객 카테고리 코드","고객 카테고리 이름","고객 카테고리 경로","깊이","상태","연결 상품 수","상품 유형 연결","적용 상품 유형"');
    expect(categoryExportCsv([{ ...row }], false)).toContain('"연결 안 함","없음"');
  });
  it('ERP 검증 시각은 KST 문자열로 쓰고 미설정 표기는 그대로 둔다', () => {
    expect(categoryExportCsv([{ ...row, erpVerifiedAt: '2026-09-28T15:10:00+00:00' }])).toContain('"2026-09-29 00:10"');
    expect(categoryExportCsv([{ ...row, erpVerifiedAt: '미설정' }])).toContain('"미설정"');
  });
});

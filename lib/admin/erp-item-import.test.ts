import { describe, expect, it } from 'vitest';
import {
  ERP_ITEM_IMPORT_ROW_LIMIT,
  assignErpColumnTarget,
  boundErpTable,
  buildErpImportPlan,
  chunkErpImportRows,
  decodeErpTextBytes,
  defaultErpColumnMapping,
  detectErpHeaderRow,
  erpImportRowPayload,
  normalizeErpHeader,
  normalizeErpImportRowInput,
  parseErpDelimitedText,
  parseErpSalePrice,
} from './erp-item-import';

describe('붙여넣기·CSV 표 읽기', () => {
  it('엑셀 복사(탭 구분)를 행과 열로 나누고 마지막 빈 줄을 버린다', () => {
    expect(parseErpDelimitedText('품번\t품명\r\n000123\t아크릴 키링\r\n')).toEqual([
      ['품번', '품명'],
      ['000123', '아크릴 키링'],
    ]);
  });

  it('따옴표 안의 구분자·줄바꿈·"" 이스케이프를 셀 값으로 읽는다', () => {
    expect(parseErpDelimitedText('﻿품번,품명\n"A,1","키링 ""한정""\n세트"\n')).toEqual([
      ['품번', '품명'],
      ['A,1', '키링 "한정"\n세트'],
    ]);
  });

  it('탭이 하나라도 있으면 탭 구분으로 본다', () => {
    expect(parseErpDelimitedText('A,1\tB')).toEqual([['A,1', 'B']]);
  });

  it('UTF-8이 아니면 EUC-KR로 읽는다', () => {
    const eucKr = new Uint8Array([0xc7, 0xb0, 0xb9, 0xf8]); // "품번"
    expect(decodeErpTextBytes(eucKr)).toBe('품번');
    expect(decodeErpTextBytes(new TextEncoder().encode('﻿품명'))).toBe('품명');
  });

  it('열 수와 셀 길이를 묶는다', () => {
    const bounded = boundErpTable([[...Array.from({ length: 120 }, () => 'x'), 'y'.repeat(2000)]]);
    expect(bounded[0]).toHaveLength(100);
    expect(boundErpTable([['y'.repeat(2000)]])[0][0]).toHaveLength(1000);
  });
});

describe('머리글 탐지와 열 짝짓기', () => {
  it('공백·괄호·대소문자를 무시하고 별칭을 비교한다', () => {
    expect(normalizeErpHeader(' 바코드 (EAN) ')).toBe('바코드ean');
    expect(normalizeErpHeader('품목 코드*')).toBe('품목코드');
  });

  it('제목 행이 있어도 처음 10행 안에서 별칭이 가장 많은 행을 머리글로 고른다', () => {
    const table = [['품목 생성 현황 2026-10-07'], [], ['No', '품목코드', '품목명', '품목그룹1', '출고단가']];
    expect(detectErpHeaderRow(table)).toBe(2);
    expect(detectErpHeaderRow([['A', 'B'], ['1', '2']])).toBe(-1);
  });

  it('같은 항목 후보가 여럿이면 우선 별칭을 고르고 나머지는 가져오지 않는다', () => {
    expect(defaultErpColumnMapping(['코드', '품번', '상품명', '단가', '판매가', 'EAN', '비고']))
      .toEqual(['ignore', 'code', 'name', 'ignore', 'salePrice', 'barcode', 'ignore']);
  });

  it('대·중·소분류가 따로 있으면 모두 ERP 분류로 잇고, 하나뿐이면 단일 분류 열을 고른다', () => {
    expect(defaultErpColumnMapping(['품번', '품명', '대분류', '중분류', '소분류', '카테고리']))
      .toEqual(['code', 'name', 'category', 'category', 'category', 'ignore']);
    expect(defaultErpColumnMapping(['품번', '품명', '대분류', '카테고리']))
      .toEqual(['code', 'name', 'ignore', 'category']);
  });

  it('미리보기에서 한 항목은 한 열만 갖고, ERP 분류만 여러 열을 허용한다', () => {
    expect(assignErpColumnTarget(['code', 'name', 'ignore'], 2, 'code')).toEqual(['ignore', 'name', 'code']);
    expect(assignErpColumnTarget(['code', 'category', 'ignore'], 2, 'category')).toEqual(['code', 'category', 'category']);
  });
});

describe('값 정규화', () => {
  it('판매가의 쉼표·원·₩·공백을 지우고 정수로 읽는다', () => {
    expect(parseErpSalePrice(' 12,000원 ')).toEqual({ ok: true, value: 12000 });
    expect(parseErpSalePrice('₩8,500')).toEqual({ ok: true, value: 8500 });
    expect(parseErpSalePrice('12000.00')).toEqual({ ok: true, value: 12000 });
    expect(parseErpSalePrice('')).toEqual({ ok: true, value: null });
    expect(parseErpSalePrice('-')).toEqual({ ok: true, value: null });
    expect(parseErpSalePrice('-100')).toEqual({ ok: false });
    expect(parseErpSalePrice('12.5')).toEqual({ ok: false });
    expect(parseErpSalePrice('3000000000')).toEqual({ ok: false });
  });

  it('브라우저에서 받은 행을 다시 검증하고 지정한 열만 키로 보낸다', () => {
    expect(normalizeErpImportRowInput({ row: 4, code: ' 000123 ', name: '키링\n세트', salePrice: 12000, barcode: '' }, 1)).toEqual({
      ok: true, row: { row: 4, code: '000123', name: '키링 세트', salePrice: 12000, barcode: null },
    });
    expect(normalizeErpImportRowInput({ row: 5, code: 'A\u0000B', name: '키링' }, 1)).toMatchObject({ ok: false, issue: { row: 5, reason: 'invalid_code', code: 'A B' } });
    expect(normalizeErpImportRowInput({ code: 'A', name: 'B', salePrice: '1,000' }, 7)).toEqual({ ok: true, row: { row: 7, code: 'A', name: 'B', salePrice: 1000 } });
    expect(normalizeErpImportRowInput({ code: 'A', name: 'B', category: 3 }, 7)).toMatchObject({ ok: false, issue: { reason: 'invalid_category' } });
    expect(normalizeErpImportRowInput('x', 9)).toMatchObject({ ok: false, issue: { row: 9, reason: 'invalid_row' } });
    expect(erpImportRowPayload({ row: 4, code: 'A', name: 'B', salePrice: null })).toEqual({ row: 4, code: 'A', name: 'B', sale_price: null });
  });

  it('반입 행을 서버 액션 크기에 맞춰 나눈다', () => {
    expect(chunkErpImportRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('반입 계획', () => {
  const table = [
    ['ERP 품목 생성'],
    ['품번', '품명', '대분류', '소분류', '판매가', '바코드'],
    ['000123', ' 아크릴\n키링 ', '문구', '키링', '12,000원', '0088012345678'],
    ['K-2', '키링 거치대', '문구', '', '', ''],
    ['', '품번 빠짐', '', '', '', ''],
    ['X1', '가격 오류', '', '', '무료', ''],
    ['000123', '아크릴 키링 v2', '문구', '키링', '13,000', '0088012345678'],
    ['', '', '', '', '합계', ''],
    [],
  ];

  it('제목 행을 건너뛰고, 분류 열을 잇고, 같은 ERP 코드는 마지막 행으로 합친다', () => {
    const plan = buildErpImportPlan(table, { numericColumns: [0] });
    expect(plan.headerIndex).toBe(1);
    expect(plan.columns.map((column) => column.target)).toEqual(['code', 'name', 'category', 'category', 'salePrice', 'barcode']);
    expect(plan.columns[1]).toMatchObject({ label: '품명', sample: '아크릴 키링' });
    expect(plan.rows).toEqual([
      { row: 7, code: '000123', name: '아크릴 키링 v2', category: '문구 > 키링', salePrice: 13000, barcode: '0088012345678' },
      { row: 4, code: 'K-2', name: '키링 거치대', category: '문구', salePrice: null, barcode: null },
    ]);
    expect(plan.issues).toEqual([
      { row: 5, code: '', reason: 'missing_code' },
      { row: 6, code: 'X1', reason: 'invalid_sale_price' },
    ]);
    expect(plan).toMatchObject({ dataRowCount: 6, skippedRowCount: 1, duplicateCount: 1, duplicateCodes: ['000123'], blocking: null });
    expect(plan.warnings.join('\n')).toContain('ERP 코드(품번) 열에 숫자 형식 셀이 있습니다');
    expect(plan.warnings.join('\n')).toContain('마지막 행으로 반입합니다: 000123');
  });

  it('열을 직접 바꾸면 지정하지 않은 항목은 키를 보내지 않는다', () => {
    const plan = buildErpImportPlan(table, { headerIndex: 1, mapping: ['code', 'name', 'ignore', 'ignore', 'ignore', 'ignore'] });
    expect(plan.rows[0]).toEqual({ row: 7, code: '000123', name: '아크릴 키링 v2' });
    expect(plan.issues.map((issue) => issue.reason)).toEqual(['missing_code']);
  });

  it('머리글이 없으면 직접 고르도록 안내하고, ERP 코드·품명 열이 없으면 반입을 막는다', () => {
    const plan = buildErpImportPlan([['A-1', '키링'], ['A-2', '거치대']]);
    expect(plan.headerIndex).toBe(-1);
    expect(plan.blocking).toBe('ERP 코드(품번)·ERP 품명 열을 골라야 반입할 수 있습니다.');
    expect(plan.warnings[0]).toContain('머리글 행을 찾지 못했습니다');
    const chosen = buildErpImportPlan([['A-1', '키링'], ['A-2', '거치대']], { headerIndex: -1, mapping: ['code', 'name'] });
    expect(chosen.rows.map((row) => row.row)).toEqual([1, 2]);
    expect(chosen.columns.map((column) => column.label)).toEqual(['A열', 'B열']);
  });

  it(`한 번에 ${ERP_ITEM_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}행을 넘으면 나누어 반입하도록 막는다`, () => {
    const rows = [['품번', '품명'], ...Array.from({ length: ERP_ITEM_IMPORT_ROW_LIMIT + 1 }, (_, index) => [`C${index}`, `품목 ${index}`])];
    expect(buildErpImportPlan(rows).blocking).toContain('5,000행까지');
    expect(buildErpImportPlan([['품번', '품명']]).blocking).toBe('반입할 행이 없습니다.');
  });
});

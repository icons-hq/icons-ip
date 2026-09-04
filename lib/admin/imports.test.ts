import { describe, expect, it } from 'vitest';
import {
  IMPORT_ROW_LIMIT,
  parseDelimitedText,
  parseImportTable,
  splitCsvLine,
  unwrapTextCell,
} from './imports';

describe('CSV 읽기', () => {
  it('따옴표 안의 쉼표와 두 번 쓴 따옴표를 지킨다', () => {
    expect(splitCsvLine('A-1,"문 앞, 부재 시",3')).toEqual(['A-1', '문 앞, 부재 시', '3']);
    expect(splitCsvLine('"그는 ""빨리""",x')).toEqual(['그는 "빨리"', 'x']);
    expect(splitCsvLine('a\tb\tc')).toEqual(['a', 'b', 'c']);
  });

  it('내보내기가 쓴 문자열 셀을 되읽는다', () => {
    expect(unwrapTextCell('="06236"')).toBe('06236');
    expect(unwrapTextCell('06236')).toBe('06236');
  });

  it('BOM 과 CRLF 를 걷어낸다', () => {
    const table = parseDelimitedText('﻿주문번호,송장번호\r\nA-1,123456\r\n');
    expect(table[0]).toEqual(['주문번호', '송장번호']);
    expect(table[1]).toEqual(['A-1', '123456']);
  });
});

describe('송장 회신', () => {
  const header = ['출고지', '배송번호', '주문번호', '품목주문번호', '자체 품목코드', '상품명', '수량', '택배사', '송장번호'];

  it('발주서를 그대로 되돌려 올려도 읽는다 — 열 이름으로 찾고 빈 송장은 건너뛴다', () => {
    const result = parseImportTable([
      header,
      ['김포', 'abc12345', '7022db3f', 'item-1', 'g9-01', '피크닉 세트', '2', 'hanjin', '123456789012'],
      ['김포', 'abc12345', 'cf5a49ec', 'item-2', 'g1-01', '쿠션', '1', 'hanjin', ''],
    ], 'tracking');
    expect(result.rows).toEqual([
      { order_ref: '7022db3f', carrier: 'hanjin', tracking: '123456789012', line: 2 },
    ]);
    expect(result.skipped).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.mapping.tracking).toBe(8);
  });

  it('필요한 열이 없으면 헤더 단계에서 멈춘다', () => {
    const result = parseImportTable([['출고지', '수량'], ['김포', '1']], 'tracking');
    expect(result.rows).toEqual([]);
    expect(result.issues[0].code).toBe('header_missing');
  });

  it('빈 칸과 이상한 송장번호를 줄 번호와 함께 알린다', () => {
    const result = parseImportTable([
      ['주문번호', '택배사', '송장번호'],
      ['', 'hanjin', '123456789012'],
      ['A-2', 'hanjin', '한글송장'],
      ['A-3', 'hanjin', '123456789012'],
    ], 'tracking');
    expect(result.rows).toHaveLength(1);
    expect(result.issues.map((issue) => [issue.line, issue.code])).toEqual([[2, 'missing_cell'], [3, 'invalid_tracking']]);
  });
});

describe('재고 절대값', () => {
  it('열 이름 별칭을 받고 선택 열은 있을 때만 싣는다', () => {
    const result = parseImportTable([
      ['자체 품목코드', '출고지', '재고수량', '안전재고'],
      ['RED-S', 'gimpo', '30', '5'],
      ['g4', '', '12', ''],
    ], 'stock_set');
    expect(result.rows).toEqual([
      { ref: 'RED-S', location_id: 'gimpo', on_hand_qty: 30, safety_qty: 5, line: 2 },
      { ref: 'g4', on_hand_qty: 12, line: 3 },
    ]);
  });

  it('천 단위 쉼표는 읽고 음수·글자는 거른다', () => {
    const result = parseImportTable([
      ['품목코드', '수량'],
      ['A', '1,200'],
      ['B', '-1'],
      ['C', '열두개'],
    ], 'stock_set');
    expect(result.rows).toEqual([{ ref: 'A', on_hand_qty: 1200, line: 2 }]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['invalid_qty', 'invalid_qty']);
  });

  it('한 번에 올릴 수 있는 줄 수를 넘으면 거기서 멈춘다', () => {
    const table = [['품목코드', '수량'], ...Array.from({ length: IMPORT_ROW_LIMIT + 5 }, (_, index) => [`g${index}`, '1'])];
    const result = parseImportTable(table, 'stock_set');
    expect(result.rows).toHaveLength(IMPORT_ROW_LIMIT);
    expect(result.issues[0].code).toBe('row_limit');
  });
});

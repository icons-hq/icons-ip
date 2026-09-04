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

describe('굿즈 일괄 등록·수정 업로드', () => {
  const HEADER = ['상품코드', 'IP코드', '상품명', '분류', '판매가', '정가', '과세구분', '요약', '검색어', '판매시작', '무통장입금'];

  it('헤더에 있는 열만 싣는다 — 없는 열은 손대지 않는다는 뜻이다', () => {
    const result = parseImportTable([
      ['상품코드', '판매가'],
      ['="g1"', '39,000'],
    ], 'goods_upsert');
    /* 이름·분류·IP 를 담지 않는 것이 요점이다. 담으면 서버가 그 열까지 덮어쓴다. */
    expect(result.rows).toEqual([{ good_id: 'g1', price: 39000, line: 2 }]);
    expect(result.issues).toEqual([]);
  });

  it('내보내기가 쓴 문자열 셀과 자릿점을 되읽는다', () => {
    const result = parseImportTable([HEADER, [
      '="g1"', '="rilakkuma"', '리락쿠마 쿠션', '쿠션', '39,000', '48000', '과세', '낮잠용', '리락쿠마, 쿠션', '2026-09-10 09:00', 'Y',
    ]], 'goods_upsert');
    expect(result.rows[0]).toEqual({
      good_id: 'g1',
      ip_id: 'rilakkuma',
      name: '리락쿠마 쿠션',
      type: '쿠션',
      price: 39000,
      compare_at_price: 48000,
      tax_type: 'taxable',
      summary: '낮잠용',
      search_keywords: ['리락쿠마', '쿠션'],
      sale_starts_at: '2026-09-10T09:00:00+09:00',
      allow_bank_transfer: true,
      line: 2,
    });
  });

  it('표에 적힌 시각은 서울 시각으로 읽는다', () => {
    const result = parseImportTable([
      ['상품코드', '판매시작', '판매종료'],
      ['g1', '2026-09-10', '2026-09-30 23:59'],
    ], 'goods_upsert');
    expect(result.rows[0].sale_starts_at).toBe('2026-09-10T00:00:00+09:00');
    expect(result.rows[0].sale_ends_at).toBe('2026-09-30T23:59:00+09:00');
  });

  it('비울 수 있는 칸은 비우고, 비울 수 없는 칸은 오류다', () => {
    const result = parseImportTable([
      ['상품코드', '정가', '요약', '검색어', '상품명'],
      ['g1', '', '', '', ''],
    ], 'goods_upsert');
    expect(result.rows).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['missing_cell']);

    const cleared = parseImportTable([
      ['상품코드', '정가', '요약', '검색어'],
      ['g1', '', '', ''],
    ], 'goods_upsert');
    expect(cleared.rows).toEqual([
      { good_id: 'g1', compare_at_price: null, summary: null, search_keywords: [], line: 2 },
    ]);
  });

  it('목록에 없는 값은 줄 단위로 거른다', () => {
    const result = parseImportTable([
      ['상품코드', '분류', '과세구분', '판매유형', '무통장입금', '판매시작'],
      ['g1', '없는분류', '과세', '일반', 'Y', ''],
      ['g2', '키링', '반값', '일반', 'Y', ''],
      ['g3', '키링', '과세', '가끔', 'Y', ''],
      ['g4', '키링', '과세', '일반', '아마도', ''],
      ['g5', '키링', '과세', '일반', 'Y', '어제'],
      ['g6', '키링', '면세', '예약', 'N', '2026-09-10'],
    ], 'goods_upsert');
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'invalid_type', 'invalid_tax_type', 'invalid_sale_mode', 'invalid_flag', 'invalid_date',
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ good_id: 'g6', tax_type: 'exempt', sale_mode: 'preorder', allow_bank_transfer: false });
  });

  it('상품코드가 없는 줄은 실을 수 없다', () => {
    const result = parseImportTable([['상품코드', '판매가'], ['', '1000']], 'goods_upsert');
    expect(result.rows).toEqual([]);
    expect(result.issues[0].code).toBe('missing_cell');
  });
});

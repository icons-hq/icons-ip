import { describe, expect, it } from 'vitest';
import { decodeSpreadsheetText, parseDelimitedText, UNREADABLE_SPREADSHEET_TEXT } from './spreadsheet-text';

describe('엑셀 CSV·텍스트 글자 읽기', () => {
  it('UTF-16(BOM 유무)·UTF-8(BOM 포함)·EUC-KR 완성형을 읽는다', () => {
    const text = '상품명\t품번\r\n키링\t000123\r\n';
    const le = Buffer.from(text, 'utf16le');
    const be = Buffer.from(le).swap16();
    for (const bytes of [Buffer.concat([Buffer.from([0xff, 0xfe]), le]), Buffer.concat([Buffer.from([0xfe, 0xff]), be]), le, be])
      expect(decodeSpreadsheetText(bytes)).toBe(text);
    expect(decodeSpreadsheetText(Buffer.from('﻿상품명,판매가', 'utf8'))).toBe('상품명,판매가');
    expect(decodeSpreadsheetText(Buffer.from([0xbb, 0xf3, 0xc7, 0xb0, 0xb8, 0xed]))).toBe('상품명');
  });

  it('EUC-KR로 읽은 결과에 C1 제어문자나 U+FFFD가 하나라도 있으면 거부한다(CP949 확장 한글)', () => {
    // 똠(0x8C63) → U+008C+'c', 햏(0xC164) → U+FFFD+'d'. 100자 넘는 정상 글자 사이에 한 글자만 있어도 막는다.
    const plain = Array.from({ length: 120 }, () => [0xc5, 0xb0]).flat(); // '키' × 120
    for (const extension of [[0x8c, 0x63], [0xc1, 0x64]])
      expect(() => decodeSpreadsheetText(Uint8Array.from([...plain, ...extension]))).toThrow(UNREADABLE_SPREADSHEET_TEXT);
    expect(UNREADABLE_SPREADSHEET_TEXT).toContain("엑셀에서 'CSV UTF-8(쉼표로 분리)'로 저장하거나 XLSX로 올려 주세요.");
  });

  it('NUL이 섞이거나 UTF-8·UTF-16 결과의 대체 문자가 1%를 넘으면 거부한다', () => {
    expect(() => decodeSpreadsheetText(Uint8Array.from([0x00, 0x00, 0x41, 0x00, 0x00, 0x00, 0x42, 0x00, 0x00, 0x00]))).toThrow(UNREADABLE_SPREADSHEET_TEXT);
    expect(decodeSpreadsheetText(Buffer.from(`${'가'.repeat(200)}�`, 'utf8'))).toHaveLength(201);
  });
});

describe('구분자 표 읽기', () => {
  it('셀 전체를 감싼 따옴표만 인용으로 읽고 구분자·줄바꿈·"" 이스케이프를 셀 값으로 둔다', () => {
    expect(parseDelimitedText('﻿A,B\r\n"1,2","줄1\n줄2"\n"say ""hi""",x', ',')).toEqual({
      rows: [['A', 'B'], ['1,2', '줄1\n줄2'], ['say "hi"', 'x']],
      unclosedCells: [],
    });
    expect(parseDelimitedText('"한정판" 키링,"A"\n', ',').rows).toEqual([['"한정판" 키링', 'A']]);
  });

  it('닫는 따옴표가 없으면 원문 그대로 두고 그 레코드 번호를 알려 뒤 행을 합치지 않는다', () => {
    expect(parseDelimitedText('A\tB\n"곰\tA1\nC\tD', '\t')).toEqual({
      rows: [['A', 'B'], ['"곰', 'A1'], ['C', 'D']],
      unclosedCells: [2],
    });
  });

  it('인용 셀 탐색 상한을 넘는 셀은 닫히지 않은 것으로 본다', () => {
    const cell = 'x'.repeat(50);
    expect(parseDelimitedText(`"${cell}",y`, ',').rows).toEqual([[cell, 'y']]);
    expect(parseDelimitedText(`"${cell}",y`, ',', { quotedCellScanLimit: 10 })).toEqual({
      rows: [[`"${cell}"`, 'y']],
      unclosedCells: [1],
    });
  });
});

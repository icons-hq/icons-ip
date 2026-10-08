/*
 * 엑셀이 저장한 CSV·텍스트를 글자와 표로 읽는 공통 경계. ERP 품목 반입과 사방넷 상품 양식이 함께 쓴다.
 *
 * 글자: UTF-16(엑셀 '유니코드 텍스트', BOM 유무) → UTF-8(BOM 포함) → EUC-KR 순으로 읽는다.
 * 한국어 Windows 엑셀의 'CSV(쉼표로 분리)'는 CP949로 저장되는데, Node(ICU)의 TextDecoder('euc-kr')는
 * KS X 1001 완성형 2,350자만 읽고 CP949 확장 한글(똠·햏 등)을 C1 제어문자나 U+FFFD로 바꾼다.
 * 새 의존성 없이 깨진 글자를 저장하지 않도록, EUC-KR로 읽은 결과에 그런 글자가 하나라도 있으면
 * UTF-8 CSV나 XLSX로 다시 저장하라고 안내한다.
 */

export const UNREADABLE_SPREADSHEET_TEXT =
  "파일의 글자를 읽지 못했습니다. 엑셀에서 'CSV UTF-8(쉼표로 분리)'로 저장하거나 XLSX로 올려 주세요.";

/* EUC-KR 디코더가 해석하지 못한 바이트가 남기는 흔적: C1 제어문자(U+0080–U+009F)와 U+FFFD. */
const LEGACY_DECODE_DAMAGE = /[\u0080-\u009f�]/;

/*
 * BOM이 없어도 UTF-8·EUC-KR 텍스트에는 0x00이 나오지 않으므로, 0x00이 한쪽 바이트 위치에
 * 몰려 있으면 UTF-16으로 본다.
 */
function utf16Encoding(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  let evenZero = 0;
  let oddZero = 0;
  for (let index = 0; index < Math.min(bytes.length, 4_096); index += 1) {
    if (bytes[index] === 0) {
      if (index % 2) oddZero += 1;
      else evenZero += 1;
    }
  }
  if (oddZero > evenZero * 4) return 'utf-16le';
  if (evenZero > oddZero * 4) return 'utf-16be';
  return null;
}

/** CSV·텍스트 바이트를 글자로 읽는다. 글자가 되지 않으면 {@link UNREADABLE_SPREADSHEET_TEXT}로 거부한다. */
export function decodeSpreadsheetText(bytes: Uint8Array): string {
  const utf16 = utf16Encoding(bytes);
  let text: string;
  if (utf16) {
    text = new TextDecoder(utf16).decode(bytes);
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('euc-kr').decode(bytes);
      if (LEGACY_DECODE_DAMAGE.test(text)) throw new Error(UNREADABLE_SPREADSHEET_TEXT);
    }
  }
  text = text.replace(/^﻿/, '');
  let replaced = 0;
  for (const char of text) if (char === '�') replaced += 1;
  if (text.includes('\u0000') || replaced > text.length * 0.01) throw new Error(UNREADABLE_SPREADSHEET_TEXT);
  return text;
}

/**
 * 셀 맨 앞의 큰따옴표에서 시작해 인용 셀을 읽는다. 짝이 되는 닫는 따옴표 바로 뒤가
 * 구분자·줄바꿈·끝일 때만 인용 셀이다. 그렇지 않으면 'literal'(따옴표가 값의 일부),
 * 닫는 따옴표가 없으면 'unclosed'를 돌려준다. 두 경우 모두 호출자가 원문 그대로 읽는다.
 */
function readQuotedCell(
  source: string,
  start: number,
  delimiter: string,
  scanLimit: number,
): { value: string; end: number } | 'literal' | 'unclosed' {
  let value = '';
  const limit = Math.min(source.length, start + 1 + scanLimit);
  for (let index = start + 1; index < limit; index += 1) {
    const char = source[index];
    if (char !== '"') { value += char; continue; }
    if (source[index + 1] === '"') { value += '"'; index += 1; continue; }
    const after = source[index + 1];
    return after === undefined || after === delimiter || after === '\r' || after === '\n'
      ? { value, end: index }
      : 'literal';
  }
  return 'unclosed';
}

export interface DelimitedText {
  rows: string[][];
  /** 닫는 큰따옴표가 없어 원문 그대로 읽은 셀마다 그 레코드 번호(1부터). */
  unclosedCells: number[];
}

/**
 * 구분자 표(CSV·탭)를 읽는다. 셀 전체를 감싼 따옴표 안의 구분자·줄바꿈·"" 이스케이프를 셀 값으로 읽는다.
 * 셀을 감싸지 않은 따옴표는 값의 일부로 보존하고, 닫히지 않은 따옴표는 원문 그대로 두고 레코드 번호를
 * 셀마다 알린다 — 뒤 행이 한 셀로 합쳐지지 않게 한다. 레코드 번호는 rows 순서(1부터)와 같다.
 * quotedCellScanLimit을 주면 그보다 긴 인용 셀은 닫히지 않은 것으로 본다.
 */
export function parseDelimitedText(
  text: string,
  delimiter: string,
  options: { quotedCellScanLimit?: number } = {},
): DelimitedText {
  const source = text.replace(/^﻿/, '');
  const scanLimit = options.quotedCellScanLimit ?? source.length;
  const rows: string[][] = [];
  const unclosedCells: number[] = [];
  let row: string[] = [];
  let cell = '';
  let cellStart = true;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && cellStart) {
      const quoted = readQuotedCell(source, index, delimiter, scanLimit);
      cellStart = false;
      if (typeof quoted === 'object') {
        cell = quoted.value;
        index = quoted.end;
        continue;
      }
      if (quoted === 'unclosed') unclosedCells.push(rows.length + 1);
      cell += char;
      continue;
    }
    if (char === delimiter) { row.push(cell); cell = ''; cellStart = true; continue; }
    if (char === '\r' || char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      cellStart = true;
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      continue;
    }
    cell += char;
    cellStart = false;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { rows, unclosedCells };
}

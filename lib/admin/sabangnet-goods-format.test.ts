import { describe, expect, it } from 'vitest';
import { planGoodsWorkbookImport, type GoodsWorkbookContext } from './goods-workbook';
import {
  convertSabangnetRows,
  decodeSabangnetText,
  detectSabangnetHeaderRow,
  parseRememberedSabangnetTargets,
  parseSabangnetCsv,
  rememberSabangnetTargets,
  SABANGNET_KC_WARNING,
  suggestSabangnetBrandIps,
  suggestSabangnetTargets,
  validateSabangnetTargets,
  type SabangnetSheetRow,
} from './sabangnet-goods-format';

const HEADERS = [
  '상품명', '자체상품코드', '브랜드명', '판매가', 'TAG가', '원가', '사이트검색어', '옵션제목(1)', '옵션상세명칭(1)',
  '옵션제목(2)', '옵션상세명칭(2)', '대표이미지', '종합몰(JPG)이미지', '부가이미지2', '부가이미지3', '상품상세설명',
  '제조사', '원산지(제조국)', '인증번호', '모델명', '사방넷 메모',
];
const col = (name: string) => HEADERS.indexOf(name);
function sheetRow(row: number, values: Record<string, string>): SabangnetSheetRow {
  const cells = HEADERS.map(() => '');
  for (const [name, value] of Object.entries(values)) cells[col(name)] = value;
  return { row, cells };
}
const targets = suggestSabangnetTargets(HEADERS).targets;
const convert = (rows: SabangnetSheetRow[], extra: Partial<Parameters<typeof convertSabangnetRows>[0]> = {}) =>
  convertSabangnetRows({ headers: HEADERS, rows, targets, ipId: 'maple', ...extra });
const context: GoodsWorkbookContext = {
  existing: [],
  ips: [{ id: 'maple', archived_at: null }, { id: 'other-ip', archived_at: null }],
  origins: [],
  presets: [],
  imageNames: [],
  mediaUrl: (path) => `https://example.test/${path}`,
};

describe('사방넷 열 이름 인식', () => {
  it('안내 행을 건너뛰고 첫 10행 안에서 사방넷 열 이름이 가장 많은 행을 찾는다', () => {
    const rows: SabangnetSheetRow[] = [
      { row: 1, cells: ['사방넷 상품 일괄 다운로드'] },
      { row: 2, cells: ['상품명은 필수입니다', '', ''] },
      { row: 3, cells: [' 상품명 ', '자체상품코드', '판매가', '옵션제목 (1)', '아무 열'] },
      { row: 4, cells: ['펭귄 키링', 'PK-1', '9000', '색상', ''] },
    ];
    expect(detectSabangnetHeaderRow(rows)).toBe(2);
    expect(detectSabangnetHeaderRow([{ row: 1, cells: ['이름', '가격'] }])).toBeNull();
    const late = [...Array.from({ length: 10 }, (_, index) => ({ row: index + 1, cells: ['안내'] })), rows[2]];
    expect(detectSabangnetHeaderRow(late)).toBeNull();
  });

  it('공개 자료의 열 이름은 자동 연결하고 추정·모르는 열·겹치는 열을 구분한다', () => {
    const { targets: suggested, status } = suggestSabangnetTargets([
      '상품명', '*판매가', '소비자가', '부가이미지1', '부가이미지2', '모델명', '속성값3', '사방넷 메모', '상품명', '인증유형',
    ]);
    expect(suggested).toEqual(['name', 'price', 'compareAtPrice', 'gallery', 'gallery', 'ignore', 'ignore', 'ignore', 'ignore', 'certification']);
    expect(status).toEqual(['confirmed', 'confirmed', 'guessed', 'guessed', 'confirmed', 'known', 'known', 'unknown', 'duplicate', 'guessed']);
  });

  it('지난번 직접 고른 연결을 같은 열 이름의 기본값으로 쓴다', () => {
    const saved = rememberSabangnetTargets(['사방넷 메모', '옵션상세명칭(1)'], ['description', 'optionValues1']);
    const restored = parseRememberedSabangnetTargets(JSON.stringify({ ...saved, 깨진값: 'drop-table' }));
    expect(restored).toEqual({ 사방넷메모: 'description', '옵션상세명칭(1)': 'optionValues1' });
    expect(suggestSabangnetTargets(['사방넷 메모'], restored)).toEqual({ targets: ['description'], status: ['remembered'] });
    expect(parseRememberedSabangnetTargets('{not json')).toEqual({});
  });

  it('필수 상품명과 단일 항목 중복 연결을 막는다', () => {
    expect(validateSabangnetTargets(['ignore'], ['메모'])).toContain('상품명');
    expect(validateSabangnetTargets(['name', 'price', 'price'], ['상품명', '판매가', '할인가'])).toContain('판매가, 할인가');
    expect(validateSabangnetTargets(['name', 'gallery', 'gallery'], ['상품명', '부가1', '부가2'])).toBeNull();
    expect(validateSabangnetTargets(['name', 'drop'], ['상품명', 'x'])).toContain('알 수 없는');
    expect(validateSabangnetTargets(['name'], ['상품명', '판매가'])).toContain('다시 올려');
  });
});

describe('사방넷 CSV 읽기', () => {
  it('큰따옴표 안의 쉼표·줄바꿈과 CRLF를 지키고 탭 구분도 읽는다', () => {
    expect(parseSabangnetCsv('상품명,옵션상세명칭(1)\r\n"키링, 대형","빨강,파랑"\r\n"두 줄\n설명","say ""hi"""\n')).toEqual([
      { row: 1, cells: ['상품명', '옵션상세명칭(1)'] },
      { row: 2, cells: ['키링, 대형', '빨강,파랑'] },
      { row: 3, cells: ['두 줄\n설명', 'say "hi"'] },
    ]);
    expect(parseSabangnetCsv('상품명\t판매가\n키링\t9,000')).toEqual([
      { row: 1, cells: ['상품명', '판매가'] },
      { row: 2, cells: ['키링', '9,000'] },
    ]);
  });

  it('UTF-8(BOM 포함)과 엑셀 한국어 CSV(EUC-KR)를 모두 읽는다', () => {
    expect(decodeSabangnetText(Buffer.from('﻿상품명', 'utf8'))).toBe('상품명');
    expect(decodeSabangnetText(Buffer.from([0xbb, 0xf3, 0xc7, 0xb0, 0xb8, 0xed]))).toBe('상품명');
  });
});

describe('사방넷 행 → ICONS 일괄 등록 행 변환', () => {
  it('옵션 없는 상품은 기본 옵션 한 행이며 TAG가가 판매가보다 클 때만 소비자가가 된다', () => {
    const { rows, warnings, ignoredColumns, products } = convert([
      sheetRow(5, { 상품명: '메이플 머그', 자체상품코드: 'mp-mug-01', 판매가: '15,000원', TAG가: '18000', 원가: '7000', 모델명: 'MUG-1' }),
      sheetRow(6, { 상품명: '메이플 스티커', 자체상품코드: 'MP-ST-01', 판매가: '3000', TAG가: '3000' }),
    ]);
    expect(products).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ row: 5, errors: [], values: {
      name: '메이플 머그', code: 'MP-MUG-01', ipId: 'maple', price: '15000', compareAtPrice: '18000', publish: '',
      variantName: '기본 옵션', variantPrice: '15000', stockQty: '0', axis1: '', descriptionFormat: 'plain',
    } });
    expect(rows[1].values.compareAtPrice).toBe('');
    expect(ignoredColumns).toEqual(['원가', '모델명']);
    expect(warnings.size).toBe(0);
  });

  it('옵션 축 1개는 쉼표로 나누고 (+금액)·중복·^^ 표기를 경고와 함께 해석한다', () => {
    const { rows, warnings } = convert([
      sheetRow(7, { 상품명: '아크릴 키링', 판매가: '9000', '옵션제목(1)': '캐릭터', '옵션상세명칭(1)': '핑크빈, 슬라임(+1,000원),핑크빈, 주황버섯^^10' }),
    ]);
    expect(rows.map((row) => [row.values.axis1, row.values.value1, row.values.variantName, row.values.variantPrice])).toEqual([
      ['캐릭터', '핑크빈', '핑크빈', '9000'],
      ['캐릭터', '슬라임', '슬라임', '10000'],
      ['캐릭터', '주황버섯', '주황버섯', '9000'],
    ]);
    expect(warnings.get(7)).toEqual(expect.arrayContaining([
      expect.stringContaining('(+금액)'), expect.stringContaining("같은 값 '핑크빈'"), expect.stringContaining('^^'),
    ]));
  });

  it('옵션 축 2개는 조합으로 펼치고 축 이름이 비면 기본 이름을 붙인다', () => {
    const { rows, warnings } = convert([
      sheetRow(8, { 상품명: '티셔츠', 판매가: '20000', '옵션상세명칭(1)': '블랙,화이트', '옵션제목(2)': '사이즈', '옵션상세명칭(2)': 'M,L(+2000)' }),
    ]);
    expect(rows.map((row) => `${row.values.axis1}:${row.values.value1}/${row.values.axis2}:${row.values.value2}=${row.values.variantPrice}`)).toEqual([
      '옵션:블랙/사이즈:M=20000', '옵션:블랙/사이즈:L=22000', '옵션:화이트/사이즈:M=20000', '옵션:화이트/사이즈:L=22000',
    ]);
    expect(rows[0].values.variantName).toBe('블랙 / M');
    expect(rows.every((row) => row.row === 8)).toBe(true);
    expect(rows.slice(1).every((row) => row.errors?.length === 0)).toBe(true);
    expect(warnings.get(8)).toEqual(expect.arrayContaining([expect.stringContaining("'옵션'")]));
  });

  it('HTML 상세·이미지 주소·인증 정보·빈 칸을 ICONS 칸 규칙에 맞춘다', () => {
    const { rows, warnings } = convert([
      sheetRow(9, {
        상품명: '포스터', 판매가: '5000', 사이트검색어: '포스터, 메이플,포스터',
        상품상세설명: '<p>상세</p><img src="https://img.example.com/detail.jpg">',
        대표이미지: '', '종합몰(JPG)이미지': 'http://img.example.com/main.jpg',
        부가이미지2: '//img.example.com/sub.jpg', 부가이미지3: 'not a url', 제조사: '아이콘스', '원산지(제조국)': '대한민국', 인증번호: 'CB000-0000',
      }),
    ]);
    expect(rows[0].values).toMatchObject({
      descriptionFormat: 'html', imageUrl: 'https://img.example.com/main.jpg', galleryUrl0: 'https://img.example.com/sub.jpg', galleryUrl1: '',
      noticeMaker: '아이콘스', noticeOrigin: '대한민국', noticeMaterial: '', searchKeywords: '포스터\n메이플',
    });
    expect(warnings.get(9)).toEqual(expect.arrayContaining([SABANGNET_KC_WARNING, expect.stringContaining('부가이미지3')]));
  });

  it('추가 이미지는 ICONS 갤러리 칸 수까지만 가져온다', () => {
    const headers = ['상품명', '부가이미지2', '부가이미지3', '부가이미지4', '부가이미지5', '부가이미지6', '부가이미지7'];
    const result = convertSabangnetRows({
      headers, targets: suggestSabangnetTargets(headers).targets, ipId: 'maple',
      rows: [{ row: 2, cells: ['상품', ...[1, 2, 3, 4, 5, 6].map((n) => `https://img.example.com/${n}.png`)] }],
    });
    expect(result.rows[0].values.galleryUrl3).toBe('https://img.example.com/4.png');
    expect(result.warnings.get(2)).toEqual([expect.stringContaining('나머지 2장')]);
  });

  it('브랜드명이 IP와 같으면 행별로 그 IP를 쓰고 나머지는 일괄 선택 IP를 쓴다', () => {
    expect(suggestSabangnetBrandIps(['Other IP', '없는 브랜드'], [{ id: 'other-ip', title: 'other ip' }])).toEqual({ 'Other IP': 'other-ip' });
    const { rows } = convert(
      [sheetRow(5, { 상품명: 'A', 브랜드명: 'Other IP' }), sheetRow(6, { 상품명: 'B', 브랜드명: '없는 브랜드' })],
      { brandIps: { 'Other IP': 'other-ip' } },
    );
    expect(rows.map((row) => row.values.ipId)).toEqual(['other-ip', 'maple']);
  });

  it('행 오류: 빈 상품명·겹치는 상품코드·100개 넘는 조합·수식 셀', () => {
    const many = Array.from({ length: 11 }, (_, index) => `값${index}`).join(',');
    const errorRow = { ...sheetRow(12, { 상품명: '수식', 판매가: '1000' }), errors: { [col('판매가')]: '수식은 사용할 수 없습니다.', [col('원가')]: '무시할 열 오류' } };
    const { rows } = convert([
      sheetRow(9, { 자체상품코드: 'X-1', 판매가: '1000' }),
      sheetRow(10, { 상품명: '중복', 자체상품코드: 'x-1' }),
      sheetRow(11, { 상품명: '조합', '옵션제목(1)': '가', '옵션상세명칭(1)': many, '옵션제목(2)': '나', '옵션상세명칭(2)': many }),
      errorRow,
    ]);
    const errorsOf = (row: number) => rows.filter((item) => item.row === row).flatMap((item) => item.errors ?? []);
    expect(errorsOf(9)).toEqual(expect.arrayContaining(['상품명이 비어 있습니다.', expect.stringContaining('9, 10행')]));
    expect(errorsOf(10)).toEqual([expect.stringContaining('같은 자체상품코드')]);
    expect(errorsOf(11)).toEqual([expect.stringContaining('121개')]);
    expect(errorsOf(12)).toEqual(['판매가: 수식은 사용할 수 없습니다.']);
  });

  it('안내 행은 건너뛰고 500행을 넘게 펼치면 파일을 나누게 한다', () => {
    expect(() => convert([sheetRow(5, { 모델명: '합계' })])).toThrow('상품 정보가 없습니다');
    const values = Array.from({ length: 51 }, (_, index) => `v${index}`).join(',');
    const rows = Array.from({ length: 10 }, (_, index) => sheetRow(index + 2, { 상품명: `상품${index}`, '옵션상세명칭(1)': values }));
    expect(() => convert(rows)).toThrow('510행');
  });

  it('변환한 행은 기존 ICONS 검증을 그대로 통과해 신규 초안이 된다', () => {
    const { rows } = convert([
      sheetRow(5, { 상품명: '메이플 머그', 자체상품코드: 'MP-MUG-01', 판매가: '15000', TAG가: '18000', '옵션제목(1)': '색상', '옵션상세명칭(1)': '화이트,블랙(+500)', 상품상세설명: '<p>도자기 머그</p>', 대표이미지: 'https://img.example.com/mug.jpg' }),
      sheetRow(6, { 상품명: '스티커', 판매가: '3000' }),
    ]);
    const plan = planGoodsWorkbookImport(rows, context);
    expect(plan.map((group) => [group.kind, group.errors])).toEqual([['new', []], ['new', []]]);
    expect(plan[0]).toMatchObject({
      code: 'MP-MUG-01', rows: [5, 5], images: [{ field: 'image_path', kind: 'url', source: 'https://img.example.com/mug.jpg' }],
      target: { price: 15000, compare_at_price: 18000, publish: false, description_format: 'html' },
    });
    expect((plan[0].target?.variants as { extraPrice: number }[]).map((variant) => variant.extraPrice)).toEqual([0, 500]);
  });
});

import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import {
  GOODS_SEARCH_KEYWORD_MAX_LENGTH,
  GOODS_SEARCH_KEYWORDS_MAX_COUNT,
} from './catalog';
import {
  emptyGoodsWorkbookRow,
  GOODS_WORKBOOK_KEYS,
  GOODS_WORKBOOK_ROW_LIMIT,
  type GoodsWorkbookInputRow,
  type GoodsWorkbookKey,
  type GoodsWorkbookRow,
} from './goods-workbook';
import { normalizeRemoteImageUrl } from './remote-image-url';
import { decodeSpreadsheetText, parseDelimitedText } from './spreadsheet-text';

/*
 * 사방넷 상품 엑셀을 ICONS 일괄 등록 행으로 바꾸는 열 이름 표와 변환 규칙.
 *
 * 사방넷은 연동하지 않는 별도 판매 채널이다. 실제 사방넷 내려받기 샘플이 없어(2026-10-07 결정)
 * 공개 자료로 열 이름을 정리하고, 인식하지 못한 열은 화면에서 운영자가 직접 연결한다.
 * 출처
 * - [A] 사방넷 상품등록 API(xml_goods_info) 노드와 엑셀 한글 열 이름 대응표를 담은 공개 연동 코드
 *   https://github.com/tojiuni/sabangnet_API/blob/4cba491bfddf74b7a1c2f10753dfd5c2692015a1/utils/mappings/product_create_field_xml_mapping.py
 *   (노드 목록: 같은 저장소 utils/mappings/product_create_field_eng_mapping.py — GOODS_NM, COMPAYNY_GOODS_CD,
 *   GOODS_PRICE, GOODS_CONSUMER_PRICE, CHAR_1_NM/VAL, CHAR_2_NM/VAL, IMG_PATH~IMG_PATH24, GOODS_REMARKS, CERTNO …)
 * - [B] 사방넷 상품등록 API 안내(접근 제한으로 직접 열람하지 못함)
 *   http://r.sabangnet.co.kr/RTL_API/guide/index.html?mode=goods_info
 * - [C] 옵션상세명칭 값을 쉼표로 나눠 다루는 공개 연동 코드
 *   https://github.com/kooonine/lifelike/blob/a78a3508191bf0f0f92846593afae32da7c44c2a/adm/shop_admin/sabang/create_goods_xml.php
 * - [D] 사방넷 v3 상품 API 샘플(옵션별 추가금액·재고는 별도 optionInfo 구조)
 *   https://github.com/sabangnet-api/sabangnet-api/blob/main/dummy_data/sabangnet_data.py
 * confirmed: true는 [A]의 열 이름과 같은 이름, false는 추정이다.
 * 옵션 값 안의 "(+1,000원)"·"^^" 표기는 공개 자료에서 확인하지 못한 추정 형식이라 경고와 함께 해석한다.
 */

type NoticeTarget = Extract<
  GoodsWorkbookKey,
  'noticeMaker' | 'noticeOrigin' | 'noticeMaterial' | 'noticeSize' | 'noticeMadeOn' | 'noticeAsManager' | 'noticeAsContact'
>;
export type SabangnetTarget =
  | 'ignore'
  | 'name'
  | 'code'
  | 'price'
  | 'compareAtPrice'
  | 'nameEn'
  | 'searchKeywords'
  | 'optionTitle1'
  | 'optionValues1'
  | 'optionTitle2'
  | 'optionValues2'
  | 'image'
  | 'imageFallback'
  | 'gallery'
  | 'description'
  | NoticeTarget
  | 'brand'
  | 'certification';
export type SabangnetColumnStatus =
  | 'confirmed'
  | 'guessed'
  | 'remembered'
  | 'known'
  | 'unknown'
  | 'duplicate';
export type SabangnetSheetRow = {
  row: number;
  cells: string[];
  errors?: Record<number, string>;
  /** 파일을 읽으며 이 행에 남긴 경고(예: 닫히지 않은 큰따옴표). 미리보기의 상품 경고가 된다. */
  warnings?: string[];
};

export const SABANGNET_TARGETS: readonly {
  key: SabangnetTarget;
  label: string;
  multiple?: boolean;
}[] = [
  { key: 'ignore', label: '가져오지 않음', multiple: true },
  { key: 'name', label: '상품명' },
  { key: 'code', label: '상품코드' },
  { key: 'price', label: '기준 판매가' },
  { key: 'compareAtPrice', label: '소비자가' },
  { key: 'nameEn', label: '영문 상품명' },
  { key: 'searchKeywords', label: '검색 키워드' },
  { key: 'optionTitle1', label: '옵션 축 1 이름' },
  { key: 'optionValues1', label: '옵션 축 1 값' },
  { key: 'optionTitle2', label: '옵션 축 2 이름' },
  { key: 'optionValues2', label: '옵션 축 2 값' },
  { key: 'image', label: '대표 이미지' },
  { key: 'imageFallback', label: '대표 이미지(대표이미지 칸이 비었을 때)' },
  { key: 'gallery', label: '추가 이미지', multiple: true },
  { key: 'description', label: '상세 설명' },
  ...GOODS_NOTICE_FIELDS.map((field) => ({
    key: field.formName as NoticeTarget,
    label: `고시정보 · ${field.label}`,
  })),
  { key: 'brand', label: '브랜드명(IP 제안에만 사용)' },
  { key: 'certification', label: '인증 정보(KC 확인 안내만)', multiple: true },
];
const TARGET_KEYS = new Set(SABANGNET_TARGETS.map((target) => target.key));
const MULTIPLE = new Set(
  SABANGNET_TARGETS.filter((target) => target.multiple).map((target) => target.key),
);
export const SABANGNET_KC_WARNING =
  '인증 정보는 상품의 KC 영역에서 따로 검토해 주세요. 사방넷 인증번호는 KC 검토에 반영하지 않았습니다.';
const GALLERY_KEYS = GOODS_WORKBOOK_KEYS.filter((key) => /^galleryUrl\d+$/.test(key));
/** ICONS 양식의 갤러리 칸 수와 같다. */
export const SABANGNET_GALLERY_LIMIT = GALLERY_KEYS.length;
export const SABANGNET_HEADER_SCAN_ROWS = 10;
/** 한 번의 미리보기에서 내려받는 서로 다른 이미지 주소 수. */
export const SABANGNET_IMAGE_LIMIT = 200;
const OPTION_LIMIT = 100;

const ALIASES: readonly [header: string, target: SabangnetTarget, confirmed: boolean][] = [
  ['상품명', 'name', true],
  ['자체상품코드', 'code', true],
  ['판매가', 'price', true],
  ['TAG가', 'compareAtPrice', true],
  ['소비자가', 'compareAtPrice', false],
  ['정가', 'compareAtPrice', false],
  ['영문 상품명', 'nameEn', true],
  ['사이트검색어', 'searchKeywords', true],
  ['옵션제목(1)', 'optionTitle1', true],
  ['옵션제목1', 'optionTitle1', false],
  ['옵션상세명칭(1)', 'optionValues1', true],
  ['옵션상세명칭1', 'optionValues1', false],
  ['옵션제목(2)', 'optionTitle2', true],
  ['옵션제목2', 'optionTitle2', false],
  ['옵션상세명칭(2)', 'optionValues2', true],
  ['옵션상세명칭2', 'optionValues2', false],
  ['대표이미지', 'image', true],
  ['종합몰(JPG)이미지', 'imageFallback', true],
  ['상품상세설명', 'description', true],
  ['제조사', 'noticeMaker', true],
  ['원산지(제조국)', 'noticeOrigin', true],
  ['원산지', 'noticeOrigin', false],
  ['제조국', 'noticeOrigin', false],
  ['제조일', 'noticeMadeOn', true],
  ['제조일자', 'noticeMadeOn', false],
  ['브랜드명', 'brand', true],
  ['인증번호', 'certification', true],
  ['인증기관', 'certification', true],
  ['인증분야', 'certification', true],
  ['인증일자', 'certification', true],
  ['발급일자', 'certification', true],
  ['인증유효시작일', 'certification', true],
  ['인증유효마지막일', 'certification', true],
  ['인증서이미지', 'certification', true],
  ['인증유형', 'certification', false],
];
/** [A]에 있지만 ICONS 상품에 대응 칸이 없어 기본으로 가져오지 않는 열. 헤더 행 탐지에는 쓴다. */
const KNOWN_IGNORED = [
  '상품약어', '모델명', '모델NO', '상품구분', '마이카테고리', '표준카테고리', '매입처ID', '물류처ID',
  '생산연도', '시즌', '남녀구분', '상품상태', '판매지역', '세금구분', '배송비구분', '배송비', '반품지구분',
  '원가', '원가2', '추가상품그룹코드', '재고관리사용여부', '유효일', '식품 재료/원산지', '합포시 제외 여부',
  '관리자메모', '옵션수정여부', '출력 상품명', '추가 상품상세설명_1', '추가 상품상세설명_2',
  '추가 상품상세설명_3', '원산지 상세지역', '수입신고번호', '수입면장이미지', '속성분류코드',
];

export function normalizeSabangnetHeader(text: string) {
  return text
    .normalize('NFKC')
    .replace(/\((필수|선택)\)|\[(필수|선택)\]/g, '')
    .replace(/[\s*※]/g, '')
    .toLowerCase();
}
const ALIAS_BY_HEADER = new Map(
  ALIASES.map(([header, target, confirmed]) => [normalizeSabangnetHeader(header), { target, confirmed }]),
);
const IGNORED_HEADERS = new Set(KNOWN_IGNORED.map(normalizeSabangnetHeader));

function aliasFor(header: string): { target: SabangnetTarget; confirmed: boolean; known: boolean } | null {
  const normalized = normalizeSabangnetHeader(header);
  if (!normalized) return null;
  const alias = ALIAS_BY_HEADER.get(normalized);
  if (alias) return { ...alias, known: true };
  const gallery = /^부가이미지\(?(\d{1,2})\)?$/.exec(normalized);
  // [A]는 부가이미지2~22를 쓴다. 부가이미지1은 추정이다.
  if (gallery) return { target: 'gallery', confirmed: Number(gallery[1]) >= 2, known: true };
  if (IGNORED_HEADERS.has(normalized) || /^속성값\d{1,2}$/.test(normalized))
    return { target: 'ignore', confirmed: true, known: true };
  return null;
}

/** 첫 10행 중 사방넷 열 이름이 가장 많이 일치하는 행을 열 이름 행으로 본다. */
export function detectSabangnetHeaderRow(rows: readonly SabangnetSheetRow[]): number | null {
  let best = -1;
  let bestScore = 0;
  rows.slice(0, SABANGNET_HEADER_SCAN_ROWS).forEach((row, index) => {
    const score = new Set(
      row.cells.filter((cell) => aliasFor(cell)).map(normalizeSabangnetHeader),
    ).size;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return bestScore >= 2 ? best : null;
}

export function suggestSabangnetTargets(
  headers: readonly string[],
  remembered: Readonly<Record<string, SabangnetTarget>> = {},
): { targets: SabangnetTarget[]; status: SabangnetColumnStatus[] } {
  const targets: SabangnetTarget[] = [];
  const status: SabangnetColumnStatus[] = [];
  const used = new Set<SabangnetTarget>();
  for (const header of headers) {
    const normalized = normalizeSabangnetHeader(header);
    const saved = normalized && Object.hasOwn(remembered, normalized) && TARGET_KEYS.has(remembered[normalized])
      ? remembered[normalized]
      : null;
    const alias = aliasFor(header);
    let target: SabangnetTarget = saved ?? alias?.target ?? 'ignore';
    let state: SabangnetColumnStatus = saved
      ? 'remembered'
      : alias?.target === 'ignore'
        ? 'known'
        : alias
          ? alias.confirmed ? 'confirmed' : 'guessed'
          : 'unknown';
    if (!MULTIPLE.has(target) && used.has(target)) {
      target = 'ignore';
      state = 'duplicate';
    }
    used.add(target);
    targets.push(target);
    status.push(state);
  }
  return { targets, status };
}

export function validateSabangnetTargets(
  targets: readonly unknown[],
  headers: readonly string[],
): string | null {
  if (targets.length !== headers.length)
    return '열 구성이 바뀌었습니다. 파일을 다시 올려 주세요.';
  if (targets.some((target) => typeof target !== 'string' || !TARGET_KEYS.has(target as SabangnetTarget)))
    return '알 수 없는 ICONS 항목이 있습니다. 열 연결을 다시 골라 주세요.';
  if (!targets.includes('name')) return '상품명으로 쓸 열을 골라 주세요.';
  for (const target of SABANGNET_TARGETS) {
    if (target.multiple) continue;
    const columns = headers.filter((_, index) => targets[index] === target.key);
    if (columns.length > 1)
      return `${target.label}에 두 개 이상의 열을 연결했습니다: ${columns.join(', ')}`;
  }
  return null;
}

export function rememberSabangnetTargets(
  headers: readonly string[],
  targets: readonly SabangnetTarget[],
): Record<string, SabangnetTarget> {
  const saved: Record<string, SabangnetTarget> = {};
  headers.forEach((header, index) => {
    const normalized = normalizeSabangnetHeader(header);
    if (normalized && targets[index]) saved[normalized] = targets[index];
  });
  return saved;
}

export function parseRememberedSabangnetTargets(raw: string | null): Record<string, SabangnetTarget> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, SabangnetTarget] =>
          typeof entry[1] === 'string' && TARGET_KEYS.has(entry[1] as SabangnetTarget),
      ).slice(0, 300),
    );
  } catch {
    return {};
  }
}

const brandKey = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
/** 브랜드명이 IP 이름이나 IP ID와 같으면 그 IP를 제안한다. */
export function suggestSabangnetBrandIps(
  brands: readonly string[],
  ips: readonly { id: string; title: string }[],
): Record<string, string> {
  const suggestions: Record<string, string> = {};
  for (const brand of brands) {
    const key = brandKey(brand);
    const ip = key ? ips.find((item) => brandKey(item.title) === key || brandKey(item.id) === key) : undefined;
    if (ip) suggestions[brand] = ip.id;
  }
  return suggestions;
}

/** UTF-16·UTF-8·EUC-KR을 읽고, CP949 확장 한글처럼 글자가 되지 않으면 다시 저장하라고 안내한다(ERP 반입과 같은 경계). */
export const decodeSabangnetText = decodeSpreadsheetText;

export const SABANGNET_UNCLOSED_QUOTE_WARNING =
  '닫는 큰따옴표가 없는 셀을 따옴표를 포함해 적힌 그대로 읽었습니다. 값을 확인해 주세요.';

/**
 * CSV(쉼표 또는 탭 구분, CRLF/LF)를 ERP 반입과 같은 인용 규칙으로 읽는다. 셀 전체를 감싼 큰따옴표만
 * 인용이고, 닫히지 않은 따옴표는 원문 그대로 두고 그 행에 경고한다 — 뒤 상품이 한 셀로 합쳐지지 않는다.
 * 상세 HTML처럼 긴 인용 셀도 읽도록 셀 길이로 인용을 끊지 않는다.
 */
export function parseSabangnetCsv(text: string): SabangnetSheetRow[] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const { rows, unclosedCells } = parseDelimitedText(text, delimiter);
  const unclosed = new Set(unclosedCells);
  return rows.map((cells, index) => ({
    row: index + 1,
    cells,
    ...(unclosed.has(index + 1) ? { warnings: [SABANGNET_UNCLOSED_QUOTE_WARNING] } : {}),
  }));
}

function money(text: string) {
  const value = text.replace(/[,\s원₩]/g, '');
  if (!value) return { text: '', value: null as number | null };
  if (/^\d+(\.0+)?$/.test(value)) {
    const number = Number(value.split('.')[0]);
    if (Number.isSafeInteger(number)) return { text: String(number), value: number };
  }
  return { text: text.trim(), value: null };
}

/** 쉼표·줄바꿈으로 나누되 "(+1,000원)"처럼 괄호 안의 쉼표는 값의 일부로 둔다. */
export function splitOptionValues(raw: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of raw) {
    if (char === '(' || char === '（') depth += 1;
    if (char === ')' || char === '）') depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === ',' || char === '，' || char === '\n' || char === '\r')) {
      values.push(current);
      current = '';
    } else current += char;
  }
  values.push(current);
  return values.map((value) => value.trim()).filter(Boolean);
}

const OPTION_PRICE = /^(.*?)\s*[(（]\s*([+-])\s*([\d,]+)\s*원?\s*[)）]$/;
type ParsedAxis = { name: string; values: { name: string; extra: number }[] };

export type SabangnetConversion = {
  rows: GoodsWorkbookInputRow[];
  /** 사방넷 원본 행 번호별 경고. 미리보기에서 상품 경고로 붙인다. */
  warnings: Map<number, string[]>;
  /** 값이 있지만 가져오지 않은 열 이름. */
  ignoredColumns: string[];
  products: number;
};

export function convertSabangnetRows(input: {
  headers: readonly string[];
  rows: readonly SabangnetSheetRow[];
  targets: readonly SabangnetTarget[];
  ipId: string;
  brandIps?: Readonly<Record<string, string>>;
}): SabangnetConversion {
  const { headers, targets } = input;
  const columnsOf = (target: SabangnetTarget) =>
    targets.flatMap((value, index) => (value === target ? [index] : []));
  const single = (target: SabangnetTarget) => columnsOf(target)[0];
  const ignoredColumns = new Set<string>();
  const warnings = new Map<number, string[]>();
  const result: GoodsWorkbookInputRow[] = [];
  const identities = new Map<string, number[]>();
  const firstRows = new Map<number, GoodsWorkbookInputRow>();
  let products = 0;
  for (const source of input.rows) {
    // 안내·합계 행처럼 연결한 열이 모두 빈 행은 상품으로 보지 않는다.
    if (!targets.some((target, column) => target !== 'ignore' && ((source.cells[column] ?? '').trim() || source.errors?.[column]))) continue;
    products += 1;
    const notes = new Set<string>(source.warnings);
    const errors: string[] = [];
    const cell = (target: SabangnetTarget) => {
      const column = single(target);
      return column === undefined ? '' : (source.cells[column] ?? '').trim();
    };
    targets.forEach((target, column) => {
      const value = (source.cells[column] ?? '').trim();
      if (target === 'ignore') {
        if (value && headers[column]?.trim()) ignoredColumns.add(headers[column].trim());
        return;
      }
      const error = source.errors?.[column];
      if (error) errors.push(`${headers[column] || `${column + 1}번째 열`}: ${error}`);
    });
    const values: GoodsWorkbookRow = emptyGoodsWorkbookRow();
    values.name = cell('name');
    values.code = cell('code').toUpperCase();
    const brand = cell('brand');
    const brandIp = brand && input.brandIps && Object.hasOwn(input.brandIps, brand) ? input.brandIps[brand] : '';
    values.ipId = (typeof brandIp === 'string' && brandIp) || input.ipId;
    if (!values.name) errors.push('상품명이 비어 있습니다.');
    const price = money(cell('price'));
    values.price = price.text;
    const tag = money(cell('compareAtPrice'));
    if (tag.text && tag.value === null)
      notes.add('TAG가를 숫자로 읽지 못해 소비자가를 비웠습니다.');
    if (tag.value !== null && price.value !== null && tag.value > price.value)
      values.compareAtPrice = String(tag.value);
    values.nameEn = cell('nameEn');
    const keywords = [...new Map(
      cell('searchKeywords').split(/[\n,]/).map((keyword) => keyword.trim()).filter(Boolean)
        .map((keyword) => [keyword.toLocaleLowerCase(), keyword] as const),
    ).values()];
    const keptKeywords = keywords.filter((keyword) => keyword.length <= GOODS_SEARCH_KEYWORD_MAX_LENGTH)
      .slice(0, GOODS_SEARCH_KEYWORDS_MAX_COUNT);
    if (keptKeywords.length < keywords.length)
      notes.add(`검색 키워드는 ${GOODS_SEARCH_KEYWORDS_MAX_COUNT}개, 키워드당 ${GOODS_SEARCH_KEYWORD_MAX_LENGTH}자까지만 가져왔습니다.`);
    values.searchKeywords = keptKeywords.join('\n');
    const description = cell('description');
    values.description = description;
    values.descriptionFormat = /<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/i.test(description) ? 'html' : 'plain';
    for (const field of GOODS_NOTICE_FIELDS) {
      const key = field.formName as GoodsWorkbookKey;
      values[key] = cell(field.formName as NoticeTarget);
    }
    if (columnsOf('certification').some((column) => (source.cells[column] ?? '').trim()))
      notes.add(SABANGNET_KC_WARNING);

    // 이미지: 대표 1장 + ICONS 갤러리 칸 수만큼. 주소는 https로 바꿔 둔다.
    const imageUrl = (column: number) => {
      const raw = (source.cells[column] ?? '').trim();
      if (!raw) return '';
      const url = normalizeRemoteImageUrl(raw);
      if (!url) {
        notes.add(`${headers[column] || '이미지'}: 이미지 주소를 읽지 못해 가져오지 않았습니다.`);
        return '';
      }
      return url.toString();
    };
    let main = '';
    for (const column of [single('image'), single('imageFallback')]) {
      if (column === undefined) continue;
      main = imageUrl(column);
      if (main) break;
    }
    values.imageUrl = main;
    const gallery = [...new Set(columnsOf('gallery').map(imageUrl).filter((url) => url && url !== main))];
    gallery.slice(0, SABANGNET_GALLERY_LIMIT).forEach((url, index) => {
      values[GALLERY_KEYS[index]] = url;
    });
    if (gallery.length > SABANGNET_GALLERY_LIMIT)
      notes.add(`추가 이미지는 ${SABANGNET_GALLERY_LIMIT}장까지 가져옵니다. 나머지 ${gallery.length - SABANGNET_GALLERY_LIMIT}장은 상품 편집에서 확인해 주세요.`);

    // 옵션: 옵션제목(n)·옵션상세명칭(n) → 옵션 축 최대 2개의 조합.
    const axes: ParsedAxis[] = [];
    for (const index of [1, 2] as const) {
      let title = cell(`optionTitle${index}`);
      const raw = cell(`optionValues${index}`);
      if (!raw) {
        if (title) notes.add(`옵션 축 ${index} 이름만 있고 옵션 값이 없어 옵션 축 ${index}을 만들지 않았습니다.`);
        continue;
      }
      if (!title) {
        title = index === 1 ? '옵션' : '옵션 2';
        notes.add(`옵션 축 ${index} 이름이 비어 '${title}'(으)로 만들었습니다.`);
      }
      const parsed = new Map<string, number>();
      for (const token of splitOptionValues(raw)) {
        let name = token;
        if (name.includes('^^')) {
          name = name.split('^^')[0].trim();
          notes.add("옵션 값의 '^^' 뒤 표기는 가져오지 않았습니다. 옵션 가격·재고를 초안에서 확인해 주세요.");
        }
        let extra = 0;
        const priced = OPTION_PRICE.exec(name);
        if (priced) {
          name = priced[1].trim();
          extra = (priced[2] === '-' ? -1 : 1) * Number(priced[3].replace(/,/g, ''));
          notes.add('옵션 값의 (+금액) 표기를 옵션 추가금액으로 가져왔습니다. 옵션 판매가를 확인해 주세요.');
        }
        if (!name) continue;
        if (parsed.has(name)) {
          notes.add(`옵션 축 ${index}의 같은 값 '${name}'을 하나로 합쳤습니다.`);
          continue;
        }
        if (extra < 0) errors.push(`옵션 값 '${name}'의 금액이 기준 판매가보다 낮습니다. ICONS 옵션 판매가는 기준 판매가 이상이어야 합니다.`);
        if (name.length > 80) errors.push(`옵션 값은 80자 이하로 입력해 주세요: ${name.slice(0, 20)}…`);
        parsed.set(name, Math.max(0, extra));
      }
      if (title.length > 40) errors.push(`옵션 축 이름은 40자 이하로 입력해 주세요: ${title.slice(0, 20)}…`);
      if (parsed.size) axes.push({ name: title, values: [...parsed].map(([name, extra]) => ({ name, extra })) });
    }
    if (axes.length === 2 && axes[0].name === axes[1].name)
      errors.push('옵션 축 1과 옵션 축 2의 이름이 같습니다. 서로 다른 이름을 입력해 주세요.');
    const combinations = axes.reduce((count, axis) => count * axis.values.length, 1);
    if (axes.length && combinations > OPTION_LIMIT)
      errors.push(`옵션 조합이 ${combinations}개입니다. 상품 하나의 옵션 조합은 ${OPTION_LIMIT}개까지입니다.`);

    let combos: { name: string; extra: number }[][] = [[]];
    if (combinations <= OPTION_LIMIT)
      for (const axis of axes) combos = combos.flatMap((combo) => axis.values.map((value) => [...combo, value]));
    const expanded = combos.map((combo) => {
      const row: GoodsWorkbookRow = { ...values };
      if (combo.length) {
        row.axis1 = axes[0].name;
        row.value1 = combo[0].name;
        if (combo[1]) {
          row.axis2 = axes[1].name;
          row.value2 = combo[1].name;
        }
        row.variantName = combo.map((value) => value.name).join(' / ');
      } else row.variantName = '기본 옵션';
      const extra = combo.reduce((total, value) => total + value.extra, 0);
      row.variantPrice = price.value === null ? '' : String(price.value + extra);
      row.stockQty = '0';
      return row;
    });
    expanded.forEach((row, index) =>
      result.push({ row: source.row, values: row, errors: index === 0 ? errors : [] }),
    );
    firstRows.set(source.row, result[result.length - expanded.length]);
    const identity = values.code ? `code:${values.code}` : `name:${values.ipId}:${values.name}`;
    identities.set(identity, [...(identities.get(identity) ?? []), source.row]);
    if (notes.size) warnings.set(source.row, [...notes]);
  }
  // 사방넷 한 행은 상품 하나다. 같은 상품코드(코드가 없으면 같은 IP·상품명)가 겹치면 ICONS 양식처럼 옵션을 합치지 않는다.
  for (const [identity, rows] of identities) {
    if (rows.length < 2) continue;
    const message = identity.startsWith('code:')
      ? `같은 자체상품코드가 여러 행에 있습니다(${rows.join(', ')}행). 행마다 다른 상품코드를 입력해 주세요.`
      : `자체상품코드가 없고 상품명이 같은 행이 있습니다(${rows.join(', ')}행). 자체상품코드를 입력하거나 상품명을 구분해 주세요.`;
    for (const row of rows) firstRows.get(row)?.errors?.push(message);
  }
  if (!products) throw new Error('열 이름 행 아래에 상품 정보가 없습니다.');
  if (result.length > GOODS_WORKBOOK_ROW_LIMIT)
    throw new Error(
      `옵션 조합으로 펼친 행이 ${result.length}행입니다. 한 번에 ${GOODS_WORKBOOK_ROW_LIMIT}행까지 등록할 수 있어 파일을 나누어 올려 주세요.`,
    );
  return { rows: result, warnings, ignoredColumns: [...ignoredColumns], products };
}

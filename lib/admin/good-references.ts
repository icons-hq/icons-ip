import type { StoryGoodCandidate } from './shopping-story-picker';
import { parseGoodUrl } from './good-url';
import type { DisplayGoodVisibility } from './good-visibility';

/*
 * 전시 상품 선택기의 '여러 줄 붙여넣기'와 '엑셀로 추가(한 열)'(1014-112). 한 줄(엑셀 한 칸)에 상품 URL(주소 또는 주소 끝 값)·판매자상품코드
 * 하나를 받는다. 엑셀에서 여러 열을 복사해 붙이면 각 줄의 첫 칸만 읽는다. 조회는 DB가 한 번에 하고(admin_resolve_goods_references),
 * 고를 수 있는지는 선택기마다 자기 규칙으로 정한다.
 */
export const GOOD_REFERENCE_LIMIT = 1000;
export const GOOD_REFERENCE_MAX_LENGTH = 200;

export interface GoodReferenceInvalidLine { line: number; value: string; reason: string }
export interface GoodReferenceLines {
  /** 조회할 값(입력 순서, 같은 값은 한 번). 주소는 상품 URL 값(주소 끝)으로 바꿔 담는다. */
  refs: string[];
  invalid: GoodReferenceInvalidLine[];
  duplicates: number;
  /** 한도를 넘어 읽지 않은 줄 수. */
  overflow: number;
  /** 첫 줄을 머리글로 보고 건너뛰었는지. */
  headerSkipped: boolean;
  /** 첫 줄이 시스템 상품번호 머리글이라 그 열의 값을 조회하지 않았는지(T22i). 번호는 상품 URL·판매자상품코드가 아니다. */
  systemNumberColumn: boolean;
}

const HEADER = /^(?:판매자\s*)?상품\s*(?:코드|번호|url|주소|id)$|^(?:url|code|id|good[_ ]?id|상품코드|상품번호)$/i;
/** 엑셀 첫 줄의 머리글(상품코드·판매자상품코드·상품번호·상품 URL 등). 조회 값으로 쓰지 않는다. */
export function isGoodReferenceHeader(value: string) { return HEADER.test(value.trim()); }

/**
 * 시스템이 매기는 '상품번호' 머리글(ADR-0038). 상품 엑셀 v8의 첫 열이라 파일의 첫 열을 그대로 읽으면 번호를 상품 URL·판매자상품코드로
 * 찾다가 모두 '찾을 수 없음'이 된다. 이 열은 읽지 않고 이유를 알린다.
 */
export function isSystemProductNumberHeader(value: string) { return /^상품\s*번호$/.test(value.trim()); }
/** 상품 URL·판매자상품코드 머리글(상품번호 제외). 여러 열 파일에서 읽을 열을 고른다. */
export function isGoodReferenceKeyHeader(value: string) { return isGoodReferenceHeader(value) && !isSystemProductNumberHeader(value); }
export const SYSTEM_NUMBER_COLUMN_NOTICE = "'상품번호'는 시스템이 매기는 번호라 이 칸에서는 찾지 않습니다. '판매자상품코드' 또는 '상품 URL' 열을 올리거나 붙여넣어 주세요.";

function looksLikeUrl(value: string) { return value.includes('/') || /^https?:/i.test(value) || /iconsip\.com/i.test(value); }

/** 붙여 넣은 글(또는 엑셀 한 열의 칸들)을 조회 값으로 나눈다. */
export function parseGoodReferenceLines(text: string, currentHost?: string | null): GoodReferenceLines {
  const refs: string[] = [], seen = new Set<string>(), invalid: GoodReferenceInvalidLine[] = [];
  let duplicates = 0, overflow = 0, headerSkipped = false, firstValue = true, systemNumberColumn = false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, index) => {
    /* 엑셀 여러 열 복사는 탭으로 갈린다 — 첫 칸만 읽는다. 쉼표·세미콜론으로 이어 붙인 값은 각각 읽는다. */
    const cell = raw.split('\t').map(part => part.trim()).find(Boolean) ?? '';
    if (!cell) return;
    const values = looksLikeUrl(cell) ? [cell] : cell.split(/[,;]/).map(part => part.trim()).filter(Boolean);
    for (const value of values) {
      if (firstValue) {
        firstValue = false;
        if (isSystemProductNumberHeader(value)) { systemNumberColumn = true; headerSkipped = true; return; }
        if (isGoodReferenceHeader(value)) { headerSkipped = true; continue; }
      }
      if (systemNumberColumn) continue;
      let ref = value;
      if (looksLikeUrl(value)) {
        const parsed = parseGoodUrl(value, currentHost);
        if (!parsed.ok) { invalid.push({ line: index + 1, value, reason: parsed.error }); continue; }
        ref = parsed.id;
      } else if ([...value].length > GOOD_REFERENCE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
        invalid.push({ line: index + 1, value: value.slice(0, 40), reason: `${GOOD_REFERENCE_MAX_LENGTH}자 이하의 판매자상품코드·상품 URL이 아닙니다.` });
        continue;
      }
      if (seen.has(ref)) { duplicates += 1; continue; }
      if (refs.length >= GOOD_REFERENCE_LIMIT) { overflow += 1; continue; }
      seen.add(ref); refs.push(ref);
    }
  });
  return { refs, invalid, duplicates, overflow, headerSkipped, systemNumberColumn };
}

export interface GoodReferenceMatch {
  ref: string;
  status: 'found' | 'not_found' | 'ambiguous';
  matchedBy: 'id' | 'code' | null;
  id: string | null;
  name: string | null;
  code: string | null;
  /** 상품 또는 연결 IP가 보관됨. */
  archived: boolean;
  /** 고객 화면에 공개 중(상품·IP 공개, 보관·판매 제한 아님). */
  published: boolean;
  /** 고객 화면에 보이는지와 보이지 않는 이유(초안·IP 초안·성인(19금)·보관됨 등). 찾지 못한 값은 missing이다. */
  visibility: DisplayGoodVisibility;
  /** 보관하지 않은 상품의 관련상품 찾기 검색 행. 선택기는 검색 결과와 같은 값으로 담는다. */
  candidate: StoryGoodCandidate | null;
}

export const GOOD_REFERENCE_STATUS_REASONS = {
  not_found: '이 값의 상품을 찾지 못했습니다.',
  ambiguous: '상품 URL 값과 판매자상품코드가 서로 다른 상품을 가리킵니다. 상품 URL 전체 주소로 넣어주세요.',
  archived: '보관된 상품(또는 보관된 IP의 상품)이라 고를 수 없습니다.',
} as const;

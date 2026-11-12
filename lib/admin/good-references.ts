import type { StoryGoodCandidate } from './shopping-story-picker';
import { parseGoodUrl } from './good-url';

/*
 * 전시 상품 선택기의 '여러 줄 붙여넣기'와 '엑셀로 추가(한 열)'(1014-112). 한 줄(엑셀 한 칸)에 상품 URL·판매자상품코드·상품번호
 * 하나를 받는다. 엑셀에서 여러 열을 복사해 붙이면 각 줄의 첫 칸만 읽는다. 조회는 DB가 한 번에 하고(admin_resolve_goods_references),
 * 고를 수 있는지는 선택기마다 자기 규칙으로 정한다.
 */
export const GOOD_REFERENCE_LIMIT = 1000;
export const GOOD_REFERENCE_MAX_LENGTH = 200;

export interface GoodReferenceInvalidLine { line: number; value: string; reason: string }
export interface GoodReferenceLines {
  /** 조회할 값(입력 순서, 같은 값은 한 번). URL은 상품번호로 바꿔 담는다. */
  refs: string[];
  invalid: GoodReferenceInvalidLine[];
  duplicates: number;
  /** 한도를 넘어 읽지 않은 줄 수. */
  overflow: number;
  /** 첫 줄을 머리글로 보고 건너뛰었는지. */
  headerSkipped: boolean;
}

const HEADER = /^(?:판매자\s*)?상품\s*(?:코드|번호|url|주소|id)$|^(?:url|code|id|good[_ ]?id|상품코드|상품번호)$/i;
/** 엑셀 첫 줄의 머리글(상품코드·판매자상품코드·상품번호·URL 등). 조회 값으로 쓰지 않는다. */
export function isGoodReferenceHeader(value: string) { return HEADER.test(value.trim()); }

function looksLikeUrl(value: string) { return value.includes('/') || /^https?:/i.test(value) || /iconsip\.com/i.test(value); }

/** 붙여 넣은 글(또는 엑셀 한 열의 칸들)을 조회 값으로 나눈다. */
export function parseGoodReferenceLines(text: string, currentHost?: string | null): GoodReferenceLines {
  const refs: string[] = [], seen = new Set<string>(), invalid: GoodReferenceInvalidLine[] = [];
  let duplicates = 0, overflow = 0, headerSkipped = false, firstValue = true;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, index) => {
    /* 엑셀 여러 열 복사는 탭으로 갈린다 — 첫 칸만 읽는다. 쉼표·세미콜론으로 이어 붙인 값은 각각 읽는다. */
    const cell = raw.split('\t').map(part => part.trim()).find(Boolean) ?? '';
    if (!cell) return;
    const values = looksLikeUrl(cell) ? [cell] : cell.split(/[,;]/).map(part => part.trim()).filter(Boolean);
    for (const value of values) {
      if (firstValue) {
        firstValue = false;
        if (isGoodReferenceHeader(value)) { headerSkipped = true; continue; }
      }
      let ref = value;
      if (looksLikeUrl(value)) {
        const parsed = parseGoodUrl(value, currentHost);
        if (!parsed.ok) { invalid.push({ line: index + 1, value, reason: parsed.error }); continue; }
        ref = parsed.id;
      } else if ([...value].length > GOOD_REFERENCE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
        invalid.push({ line: index + 1, value: value.slice(0, 40), reason: `${GOOD_REFERENCE_MAX_LENGTH}자 이하의 상품코드·상품번호가 아닙니다.` });
        continue;
      }
      if (seen.has(ref)) { duplicates += 1; continue; }
      if (refs.length >= GOOD_REFERENCE_LIMIT) { overflow += 1; continue; }
      seen.add(ref); refs.push(ref);
    }
  });
  return { refs, invalid, duplicates, overflow, headerSkipped };
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
  /** 보관하지 않은 상품의 관련상품 찾기 검색 행. 선택기는 검색 결과와 같은 값으로 담는다. */
  candidate: StoryGoodCandidate | null;
}

export const GOOD_REFERENCE_STATUS_REASONS = {
  not_found: '이 값의 상품을 찾지 못했습니다.',
  ambiguous: '상품번호와 판매자상품코드가 서로 다른 상품을 가리킵니다. 상품 URL로 넣어주세요.',
  archived: '보관된 상품(또는 보관된 IP의 상품)이라 고를 수 없습니다.',
} as const;

/*
 * 전시 구성(홈 전시·카테고리 전시·쇼핑스토리·캠페인 상품 묶음)에 담았거나 담을 상품이 고객 화면에 보이는지(QA1 MD).
 * 공개 전 상품을 미리 담아 두는 것은 막지 않는다 — 대신 결과 줄·담은 목록·미리보기에 보이지 않는 이유를 늘 같은 말로 적는다.
 * 공개 판정은 관련상품 찾기·여러 줄 추가와 같다(상품·IP 공개, 보관·판매 제한 아님).
 */
export type DisplayGoodVisibility = 'public' | 'unpublished' | 'archived' | 'missing';
export const DISPLAY_GOOD_VISIBILITY_LABELS: Record<Exclude<DisplayGoodVisibility, 'public'>, string> = {
  unpublished: '비공개', archived: '보관됨', missing: '찾을 수 없음',
};
export const DISPLAY_GOOD_VISIBILITY_NOTES: Record<Exclude<DisplayGoodVisibility, 'public'>, string> = {
  unpublished: '공개 전까지 고객 화면에 보이지 않습니다.',
  archived: '보관된 상품이라 고객 화면에 보이지 않습니다.',
  missing: '찾을 수 없는 상품이라 고객 화면에 보이지 않습니다.',
};
/** 저장된 전시 구성의 상품 한 개(이름은 조회 전이면 null). */
export interface DisplayGoodInfo { name: string | null; code: string | null; visibility: DisplayGoodVisibility }

export function displayGoodVisibility(good: { archived: boolean; published: boolean } | null | undefined): DisplayGoodVisibility {
  if (!good) return 'missing';
  return good.archived ? 'archived' : good.published ? 'public' : 'unpublished';
}

/**
 * 저장된 상품번호를 조회한 결과를 전시 목록 표시로 바꾼다. 상품번호가 그대로 맞은 결과만 믿는다 —
 * 같은 값이 다른 상품의 판매자상품코드로 맞거나(지워진 상품) 둘이 엇갈리면 이름을 지어내지 않는다.
 */
export function displayGoodInfoOf(match: GoodReferenceMatch): DisplayGoodInfo | null {
  if (match.status === 'ambiguous') return null;
  if (match.status === 'not_found' || match.id !== match.ref || !match.name) return { name: null, code: null, visibility: 'missing' };
  return { name: match.name, code: match.code, visibility: displayGoodVisibility(match) };
}

function namesOf(goods: readonly { name: string }[]) {
  const shown = goods.slice(0, 3).map(good => good.name).join(', ');
  return goods.length > 3 ? `${shown} 외 ${(goods.length - 3).toLocaleString('ko-KR')}개` : shown;
}
/** 담은 상품 중 고객 화면에 보이지 않는 상품을 한 문단으로 알린다(미리보기·목록 위). 모두 보이면 null. */
export function hiddenDisplayGoodsNotice(goods: readonly { name: string; visibility: DisplayGoodVisibility }[]): string | null {
  const of = (visibility: DisplayGoodVisibility) => goods.filter(good => good.visibility === visibility);
  const unpublished = of('unpublished'), archived = of('archived'), missing = of('missing');
  const parts = [
    unpublished.length ? `비공개 상품 ${unpublished.length.toLocaleString('ko-KR')}개(${namesOf(unpublished)})는 공개 전까지 고객 화면에 보이지 않습니다.` : '',
    archived.length ? `보관된 상품 ${archived.length.toLocaleString('ko-KR')}개(${namesOf(archived)})는 고객 화면에 보이지 않습니다.` : '',
    missing.length ? `찾을 수 없는 상품 ${missing.length.toLocaleString('ko-KR')}개(${namesOf(missing)})는 고객 화면에 보이지 않습니다.` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

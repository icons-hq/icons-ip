import { COMMUNITY_ENABLED } from './community-visibility';

/* 추천 검색어 (#326 유저 스토리 19 · 11 CH-10 · LFS 패리티 2차 L8b).
 *
 * 검색 오버레이(클라이언트)와 /search 화면(서버)이 함께 쓰므로 server-only 인
 * lib/search.ts 밖에 둔다. 운영 값은 홈 전시관리의 '추천 검색어' 목록(큐레이션 `search_terms`)이고,
 * 셸이 쿠키 없는 캐시로 읽는다(lib/search-terms.server.ts). 운영 목록이 없으면 아래 코드 상수가 폴백이다 —
 * 전부 현재 카탈로그 실데이터(IP 제목·분류 표준 값)에 실제로 매칭되는 어휘만 담는다. 결과가 빈
 * 추천 칩은 죽은 링크와 같다.
 */
export const SUGGESTED_SEARCH_TERMS = [
  '리락쿠마',
  '메이플스토리',
  '담곰이',
  '카카오프렌즈',
  '키링',
  '쿠션',
  '인형',
  '아크릴',
] as const;

/** 운영 목록 한도 — DB(20261027020000 private.is_valid_home_search_terms)와 같은 값이다. */
export const SEARCH_TERM_LIMIT = 10;
export const SEARCH_TERM_MAX_LENGTH = 20;
export const SEARCH_TERM_LIST_NAME_LIMIT = 40;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/** 칩 라벨 = 검색어. 검색 정규화(lib/search.ts normalizeSearchQuery)처럼 앞뒤 공백을 걷고 안쪽 공백을 하나로 접는다. */
export function normalizeSuggestedSearchTerm(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 운영 목록 payload.terms → 검색어 배열. DB 와 같은 규칙(1~10개, 1~20자, 제어 문자 없음, 대소문자 무시 중복 없음,
 * 정규화된 값)을 하나라도 어기면 null 이다 — 셸은 폴백 상수를 쓴다.
 */
export function parseSuggestedSearchTerms(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > SEARCH_TERM_LIMIT) return null;
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry !== normalizeSuggestedSearchTerm(entry)) return null;
    const length = Array.from(entry).length;
    if (length < 1 || length > SEARCH_TERM_MAX_LENGTH || CONTROL_CHARACTER.test(entry)) return null;
    const key = entry.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    terms.push(entry);
  }
  return terms;
}

/** 오버레이가 보일 칩 — 운영 목록이 있으면 그것, 없으면 코드 상수. */
export function resolveSuggestedSearchTerms(operatorTerms: readonly string[] | null | undefined): readonly string[] {
  return operatorTerms && operatorTerms.length > 0 ? operatorTerms : SUGGESTED_SEARCH_TERMS;
}

/** 칩 링크. 운영자 입력을 그대로 검색어로 싣는다 — 인코딩은 URL 계층, LIKE 와일드카드(% _ \) 이스케이프는
 *  검색 RPC(search_public_content)가 서버에서 한다. */
export function suggestedSearchHref(term: string): string {
  return `/search?q=${encodeURIComponent(term)}`;
}

/** 통합 검색 입력 안내. 커뮤니티가 닫힌 배포에서는 검색도 포스트·태그 결과를 거르므로(lib/search.ts)
 *  '포스트'를 약속하지 않는다 — /search 화면(Search.tsx)의 같은 분기와 한 규칙이다. */
export function searchPlaceholder(communityEnabled: boolean = COMMUNITY_ENABLED): string {
  return communityEnabled ? 'IP · 굿즈 · 카드 · 포스트 통합 검색' : 'IP · 굿즈 · 카드 통합 검색';
}

import { COMMUNITY_ENABLED } from './community-visibility';

/* 추천 검색어 (#326 유저 스토리 19).
 *
 * 검색 오버레이(클라이언트)와 /search 화면(서버)이 함께 쓰므로 server-only 인
 * lib/search.ts 밖에 둔다. 값은 운영 큐레이션 상수다 — 전부 현재 카탈로그
 * 실데이터(IP 제목·분류 표준 값)에 실제로 매칭되는 어휘만 담는다. 결과가 빈
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

/** 통합 검색 입력 안내. 커뮤니티가 닫힌 배포에서는 검색도 포스트·태그 결과를 거르므로(lib/search.ts)
 *  '포스트'를 약속하지 않는다 — /search 화면(Search.tsx)의 같은 분기와 한 규칙이다. */
export function searchPlaceholder(communityEnabled: boolean = COMMUNITY_ENABLED): string {
  return communityEnabled ? 'IP · 굿즈 · 카드 · 포스트 통합 검색' : 'IP · 굿즈 · 카드 통합 검색';
}

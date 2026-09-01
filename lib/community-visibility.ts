/* 커뮤니티 임시 비공개 스위치.
 *
 * `true` 로 되돌리면 GNB·푸터·메뉴시트 진입점, `/community` 라우트, 커뮤니티 서버 액션,
 * 검색의 포스트·태그 결과가 한꺼번에 살아난다. 되돌리기가 이 한 줄이어야 해서 상수만 담는
 * 모듈로 떼어 둔다 — 의존성 0인 `lib/routes.ts` 와 서버 액션 양쪽이 순환 없이 읽고,
 * 노출을 단언하는 테스트도 이 값 하나로 기대를 분기한다.
 *
 * DB 스키마·RLS·데이터·어드민 커뮤니티 운영 화면은 이 스위치와 무관하게 그대로 둔다.
 * 화면(`components/screens/Community.tsx`)과 도메인 모듈(`lib/community*.ts`)도 손대지 않아
 * 복원은 무손실이다. */
export const COMMUNITY_ENABLED = false;

/* 커뮤니티 노출 스위치 두 개.
 *
 * `COMMUNITY_ENABLED` 는 공개 표면 스위치다. `true` 로 되돌리면 GNB·푸터 발견 열·메뉴시트
 * 진입점, 홈 큐레이션, 검색의 포스트·태그 결과, 바인더 "전시하기", IP 상세 "팬덤 채널" 이
 * 한꺼번에 살아난다. 되돌리기가 이 한 줄이어야 해서 상수만 담는 모듈로 떼어 둔다 —
 * 의존성 0인 `lib/routes.ts` 와 서버 액션 양쪽이 순환 없이 읽고, 노출을 단언하는 테스트도
 * 이 값 하나로 기대를 분기한다.
 *
 * `COMMUNITY_STAFF_PREVIEW_ENABLED` 는 그 위에 얹힌 스태프 전용 프리뷰다. 공개 스위치가
 * 꺼진 동안에도 로그인한 staff/admin 은 `/community` 를 열람할 수 있고, 진입점은 푸터의
 * 스태프 전용 블록 하나뿐이다(`lib/routes.ts` 의 FOOTER_COMMUNITY_STAFF_ITEMS). 공개 표면은
 * 위 스위치가 계속 닫아 두므로 프리뷰가 공개로 새지 않는다. 권한 판정의 진실원은 라우트·
 * 서버 액션이 매 요청 확인하는 `lib/community-visibility.server.ts` 다 — 푸터 readback 은
 * 진입점 노출용일 뿐이라 URL 을 직접 열어도 서버 게이트를 통과해야 화면이 나온다.
 *
 * 세컨더리 마켓 스태프 시연(`lib/secondary-market-demo.ts`)과 경계가 같지만 성격은 다르다:
 * 저쪽은 화면 로컬 상태로 끝나는 mock 이고, 이쪽은 실제 DB 를 읽는 진짜 커뮤니티다.
 * 사용자 작성 쓰기는 DB 의 `community_write_control` 이 별도로 닫고 있어 스태프도 열 수 없다.
 *
 * DB 스키마·RLS·데이터·어드민 커뮤니티 운영 화면은 두 스위치와 무관하게 그대로 둔다.
 * 화면(`components/screens/Community.tsx`)과 도메인 모듈(`lib/community*.ts`)도 손대지 않아
 * 복원은 무손실이다. */
export const COMMUNITY_ENABLED = false;

export const COMMUNITY_STAFF_PREVIEW_ENABLED = true;

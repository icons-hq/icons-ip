# #106 커뮤니티 트렌딩 태그 구현 계획

> 대상: `ps/feat/community-trending-tags` worktree. 각 동작은 실패 테스트를 먼저 추가하고 최소 구현으로 통과시킨다.

## 1. Supabase 집계 계약

파일:

- 생성: `supabase/tests/community_trending_tags.sql`
- 생성: `supabase/migrations/20260716133839_community_trending_tags.sql`
- 수정: `.github/workflows/pipeline.yml`

순서:

1. ACL, visible/window/future, 정규화, case/literal 문자, 정렬, clamp, top 10을 SQL smoke로 고정한다.
2. RLS를 우회하지 않는 security-invoker RPC를 구현한다.
3. 함수 기본 실행 권한을 모두 회수하고 anon/authenticated에만 부여한다.
4. pipeline의 local reset 뒤 새 smoke를 명시적으로 실행한다.

## 2. 서버 snapshot 배선

파일:

- 수정: `lib/community.server.test.ts`
- 수정: `lib/community.server.ts`

순서:

1. 실제 RPC 결과, 0행, 오류, mock source를 구분하는 실패 테스트를 추가한다.
2. Supabase 포스트와 트렌딩을 병렬 조회한다.
3. Supabase 오류는 빈 배열로 닫고 mock source에서만 `DATA.TRENDING`을 유지한다.

## 3. 커뮤니티 화면

파일:

- 생성: `components/screens/Community.test.tsx`
- 수정: `components/screens/Community.tsx`

순서:

1. 최근 7일 제목, encoded 검색 링크, mock 선행 `#`, 빈 상태 테스트를 실패시킨다.
2. desktop/mobile 공통 grid 상단에 트렌딩 칩 영역을 구현한다.
3. 검색어에서 선행 `#`만 제거하고 URL component를 encode한다.

## 4. 문서와 검증

파일:

- 수정: `README.md`, `docs/ARCHITECTURE.md`, `docs/launch-readiness-plan.md`

순서:

1. mock→real 전환과 RPC/오류/완료 상태를 as-built 문서에 반영한다.
2. 타깃 테스트와 `git diff --check`를 먼저 실행한다.
3. shared local Supabase 사용이 끝난 뒤 pinned CLI reset, 전체 SQL smoke와 DB lint를 실행한다.
4. 전체 test, lint, build, 브라우저 확인과 출시 경로는 부모 작업에서 이어간다.

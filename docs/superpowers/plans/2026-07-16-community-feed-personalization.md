# #107 커뮤니티 피드 개인화 구현 계획

> 대상: `ps/feat/community-feed-personalization` worktree. 각 동작은 실패 테스트를 먼저 추가하고 최소 구현으로 통과시킨다.

## 1. scope와 조회 계약

파일:

- 수정: `lib/community.test.ts`, `lib/community.ts`
- 수정: `lib/community.server.test.ts`, `lib/community.server.ts`
- 수정: `app/community/page.tsx`

순서:

1. `feed=fandom`만 허용하는 순수 정규화 helper를 실패 테스트로 고정한다.
2. 내 팬덤에서 팔로우 ID를 읽고 `posts.in('ip_id', followedIds)`를 order/limit 전 적용하는 실패 테스트를 추가한다.
3. 전체 피드·visible/hidden·차단·댓글·좋아요 계약을 보존한 최소 구현을 한다.

## 2. 화면과 action scope 보존

파일:

- 수정: `components/screens/Community.test.tsx`, `components/screens/Community.tsx`
- 수정: `app/community/actions.test.ts`

순서:

1. 전체/내 팬덤 탭과 guest/onboarding/0 follow/0 post/ready 상태를 테스트한다.
2. 내 팬덤에서는 팔로우 채널만 렌더링하고, 모든 mutation form의 `next`가 scope URL을 보존하도록 테스트한다.
3. 44px 이상 CTA·탭과 기존 반응 UI를 유지하는 최소 화면 변경을 한다.

## 3. 홈 커뮤니티 프리뷰 우선순위

파일:

- 수정: `lib/home-catalog.test.ts`, `lib/home-catalog.ts`
- 수정: `app/page.tsx`, `components/screens/Home.tsx`
- 수정: `lib/catalog.ts`, `lib/catalog.test.ts`

순서:

1. 팔로우 IP 프리뷰만 stable-first로 정렬하는 순수 helper를 실패시킨다.
2. 온보딩 완료 viewer의 팔로우 ID와 기존 post visibility/block option을 홈 snapshot에 전달한다.
3. 이벤트·재고 티커를 먼저 유지하고 커뮤니티 항목 안에서만 개인화한다.

## 4. DB 계약, 문서, 검증

파일:

- 생성: `supabase/tests/community_feed_personalization.sql`
- 수정: `.github/workflows/pipeline.yml`
- 수정: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/launch-readiness-plan.md`, `DESIGN.md`

순서:

1. 기존 RLS와 visible 규칙을 SQL smoke로 고정하고 pipeline에 명시한다.
2. as-built 개인화 계약과 완료 상태를 문서에 반영한다.
3. targeted Vitest·ESLint·`git diff --check`를 실행한다.
4. shared Supabase와 전체 검증·브라우저·출시 경로는 부모 작업에서 이어간다.

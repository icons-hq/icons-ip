# #108 커뮤니티 포스트 수정 구현 계획

> 대상: `ps/feat/community-post-editing` worktree. 각 동작은 실패 테스트를 먼저 추가하고 최소 구현으로 통과시킨다.

## 1. DB 수정 경계

파일:

- 생성: `supabase/migrations/20260716151616_community_post_editing.sql`
- 생성: `supabase/tests/community_post_editing.sql`
- 수정: `.github/workflows/pipeline.yml`

순서:

1. 함수 보안 속성·ACL, direct UPDATE 차단, visible owner 성공과 실패 경로를 SQL smoke로 먼저 실패시킨다.
2. direct UPDATE policy/grant를 제거하고 최소 권한 `edit_own_post` RPC를 구현한다.
3. 필드 보존·nullable tag·이전/현재 IP 반환·기존 모더레이션 회귀를 통과시킨다.

## 2. DTO와 입력 정규화

파일:

- 수정: `lib/community.test.ts`, `lib/community.ts`
- 수정: `lib/community.server.test.ts`, `lib/community.server.ts`

순서:

1. image를 무시하고 UUID·text·IP·tag만 반환하는 edit normalizer를 실패 테스트로 고정한다.
2. `updated_at`, nullable tag, `canEdit`, `isEdited` DTO 계약을 실패시킨다.
3. visible owner만 편집 가능하고 mock은 false로 닫는 최소 구현을 한다.

## 3. Server Action과 inline UI

파일:

- 수정: `app/community/actions.test.ts`, `app/community/actions.ts`
- 수정: `components/screens/Community.test.tsx`, `components/screens/Community.tsx`

순서:

1. 로그인·온보딩, catalog IP, camel/snake RPC 결과, 비노출 오류와 revalidation 계약을 테스트한다.
2. 수정 액션과 안전한 현재 `next` redirect를 구현한다.
3. 44px 토글·저장·취소, 고유 오류와 `role=alert`, image-preserve 안내, `수정됨` 표기를 테스트하고 구현한다.
4. 내 팬덤에서는 전달된 팔로우 채널만 edit select에 노출한다.

## 4. 문서와 검증

파일:

- 수정: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/launch-readiness-plan.md`

순서:

1. as-built 권한·UI·이미지 보존 계약과 #108 완료 상태를 반영한다.
2. CI 고정 Supabase CLI로 fresh reset 후 전체 SQL smoke를 실행한다.
3. targeted·전체 test, lint, build와 `git diff --check`를 실행한다.
4. 브라우저·production 검증은 부모 finish path에서 이어간다.

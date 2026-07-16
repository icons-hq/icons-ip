# #104 인앱 알림함과 IP 알림 설정 구현 계획

> 대상: `ps/feat/in-app-notifications` worktree. 각 동작은 실패 테스트를 먼저 추가하고 최소 구현으로 통과시킨다.

## 1. 알림 DB 계약과 발급 trigger

파일:

- 생성: `supabase/tests/in_app_notifications.sql`
- 생성: `supabase/migrations/20260716090001_in_app_notifications.sql`
- 수정: `.github/workflows/pipeline.yml`

순서:

1. 알림 RLS/ACL, 읽음·설정 RPC, 주문/뽑기권/catalog 발급·멱등·fan-out·seed suppression, 긴 catalog id와 draw-ticket 동시 집계, index assertion을 SQL smoke test로 먼저 실패시킨다.
2. `(user_id, dedupe_key)` 멱등 계약의 `notifications`, `ip_follows` 설정 열, owner/unread/fan-out index를 추가한다.
3. `private` trigger helper와 public 사용자 RPC를 최소 권한으로 구현한다.
4. pipeline의 local reset 뒤 새 smoke test를 명시적으로 실행한다.

## 2. 알림 도메인·보호 라우트

파일:

- 생성: `lib/notifications.ts`, `lib/notifications.test.ts`
- 생성: `lib/notifications.server.ts`, `lib/notifications.server.test.ts`
- 생성: `app/notifications/actions.ts`, `app/notifications/actions.test.ts`
- 생성: `app/notifications/page.tsx`, `app/notifications/page.test.tsx`
- 생성: `app/notifications/settings/page.tsx`, `app/notifications/settings/page.test.tsx`
- 생성: `components/screens/Notifications.tsx`, `components/screens/Notifications.test.tsx`
- 생성: `components/screens/NotificationSettings.tsx`, `components/screens/NotificationSettings.test.tsx`

순서:

1. DB row → safe DTO, 본인 필터·정렬, 보호 redirect·온보딩 gate를 실패 테스트로 고정한다.
2. `open_notification` action의 auth/RPC/검증된 redirect 계약을 실패시킨 뒤 구현한다.
3. 빈 상태와 unread/read ledger, IP 설정 진입점을 의미론적 markup으로 구현한다.
4. settings는 현재 팔로우 목록과 공용 preference action만 소비한다.

## 3. 셸과 마이페이지 진입점

파일:

- 생성: `components/shell/NotificationBell.tsx`, `components/shell/NotificationBell.test.tsx`
- 수정: `components/shell/Nav.tsx`, `components/ui/Icon.tsx`, `components/shell/Atmos.tsx`
- 수정: `components/screens/MyPage.tsx`, `components/screens/MyPage.test.tsx`
- 수정: `lib/routes.ts`, `lib/routes.test.ts`
- 수정: `app/globals.css`

순서:

1. `/notifications` mapping/active, signed-in/unknown/signed-out bell, unread badge·aria label 테스트를 실패시킨다.
2. `AuthPresenceProvider`를 재사용하는 count-only bell과 레이아웃 placeholder를 구현한다.
3. 마이페이지 알림 카드와 2×3 layout, notifications atmosphere, ledger/settings CSS를 추가한다.
4. 390px에서 top action을 44px로 유지하며 gap/padding만 압축한다.

## 4. IP·이벤트 알림 설정

파일:

- 수정: `lib/ip-follow.ts`, `lib/ip-follow.test.ts`
- 수정: `lib/ip-follow.server.ts`, `lib/ip-follow.server.test.ts`
- 수정: `app/ip/actions.ts`, `app/ip/actions.test.ts`
- 수정: `app/ip/page.tsx`, `app/ip/[id]/page.tsx`와 테스트
- 수정: `components/screens/IpHub.tsx`와 테스트
- 수정: `app/events/[eventId]/page.tsx`와 테스트
- 수정: `components/screens/EventDetail.tsx`, `components/screens/EventDetail.test.tsx`

순서:

1. preference DTO, nullable channel 보존, 원자적 auto-follow+설정 RPC와 error redirect를 실패 테스트로 고정한다.
2. follow loader가 두 설정을 읽고 settings용 팔로우 목록을 제공하게 한다.
3. IP 허브 placeholder를 가입+알림 action/두 switch로 교체한다.
4. 예정 IP 이벤트 상세에 기존 primary flow를 건드리지 않는 secondary event setting action을 추가한다.

## 5. 문서·통합·출시 경로

파일:

- 수정: `DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/launch-readiness-plan.md`

순서:

1. as-built route, 셸, DB 발급 matrix와 현재 실제 CTA 수를 문서에 반영한다. `CONTEXT.md`와 PRD의 기존 도메인 정의는 바꾸지 않는다.
2. 관련 테스트 → 전체 `npm test` → `npm run lint` → `npm run build` → `git diff --check`를 실행한다.
3. pinned Supabase CLI로 local reset, SQL smoke, DB lint를 실행한다.
4. 로컬 브라우저에서 guest/auth inbox, 설정·발급·읽음, desktop/390px UI를 확인하고 synthetic data를 삭제한다.
5. 독립 DB/보안·코드·UI 리뷰 후 의도한 파일만 commit/push하고 ready PR을 만든다.
6. GitHub CI와 preview를 확인한 뒤 squash merge한다. production pipeline과 live route/auth E2E를 검증하고 synthetic data를 삭제한다.
7. #104 close·Project Done, #105 Dependency Unblocked를 확인한 뒤 다음 이슈로 진행한다.

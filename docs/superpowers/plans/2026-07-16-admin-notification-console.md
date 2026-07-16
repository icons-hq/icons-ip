# #105 관리자 인앱 공지 발송 콘솔 구현 계획

> 대상: `ps/feat/admin-notifications-console` worktree. 각 동작은 실패 테스트를 먼저 추가하고 최소 구현으로 통과시킨다.

## 1. 발송 DB 계약

파일:

- 생성: `supabase/tests/admin_notification_console.sql`
- 생성: `supabase/migrations/20260716100001_admin_notification_console.sql`
- 수정: `.github/workflows/pipeline.yml`

순서:

1. staff ACL, 대상 추정, 0명·대규모 전체 fan-out, 감사 이력, 멱등·충돌, 설정 비적용, PII 비노출, index를 SQL smoke test로 먼저 실패시킨다.
2. estimate/send/history 세 RPC와 audit partial index를 구현한다.
3. 기존 `notifications` RLS와 client mutation 권한이 넓어지지 않았음을 확인한다.
4. pipeline의 local reset 뒤 새 smoke test를 명시적으로 실행한다.

## 2. 관리자 도메인·서버 경계

파일:

- 생성: `lib/admin/notifications.ts`, `lib/admin/notifications.test.ts`
- 생성: `lib/admin/notifications.server.ts`, `lib/admin/notifications.server.test.ts`
- 생성: `app/admin/notification-actions.ts`, `app/admin/notification-actions.test.ts`

순서:

1. form 대상·문구 정규화와 RPC row DTO 변환 테스트를 실패시킨다.
2. staff 전용 estimate/history loader를 구현한다.
3. Server Action에서 auth/staff를 재검사하고 operation UUID를 보존한 단일 send RPC를 호출한다.
4. 성공 시 실제 수신자 수를 반환하고 `/admin`·`/notifications`를 revalidate한다.

## 3. 관리자 작성·미리보기·이력 UI

파일:

- 생성: `components/admin/sections/NotificationSection.tsx`
- 생성: `components/admin/sections/NotificationSection.test.tsx`
- 수정: `components/admin/Admin.tsx`, `components/admin/Admin.test.tsx`
- 수정: `components/admin/Sidebar.tsx`, `components/admin/Sidebar.test.tsx`
- 수정: `app/admin/page.tsx`, `app/admin/page.test.tsx`
- 수정: `app/globals.css`

순서:

1. admin section route, 대상/IP 선택, 추정 수, 안내, 미리보기, 2단계 확인, 이력 테스트를 실패시킨다.
2. Server Component loader 결과와 operation ID를 `Admin`에 전달한다.
3. 입력 변경 시 확인을 해제하고 pending 중 중복 제출을 막는 composer를 구현한다.
4. 최근 20건 이력과 실제 수신자 수를 표시한다.
5. 모바일 1열, 44px action, focus-visible, 색 외 상태 표현을 CSS로 보장한다.

## 4. 문서·통합·출시 경로

파일:

- 수정: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/launch-readiness-plan.md`

순서:

1. 인앱 공지의 운영자 짝, audited RPC, 즉시 발송 범위와 완료 상태를 as-built 문서에 반영한다. `CONTEXT.md`, ADR, 디자인 원칙은 바꾸지 않는다.
2. 관련 테스트 → 전체 `npm test` → `npm run lint` → `npm run build` → `git diff --check`를 실행한다.
3. pinned Supabase CLI로 local reset, SQL smoke, DB lint를 실행한다.
4. 로컬 브라우저에서 staff 작성·확인·발송·이력과 사용자 수신함, desktop/390px UI를 확인하고 synthetic data를 삭제한다.
5. 독립 DB/보안·코드·UI 리뷰 후 의도한 파일만 commit/push하고 ready PR을 만든다.
6. GitHub CI와 preview를 확인한 뒤 squash merge한다. production pipeline과 live authenticated E2E를 검증하고 synthetic data를 삭제한다.
7. #105 close·Project Done과 다음 issue dependency를 확인한 뒤 같은 루프를 반복한다.

# #114 홈 큐레이션 관리 구현 계획

> 대상: `ps/feat/home-curation-management` worktree. 각 동작은 실패 테스트를 먼저 추가하고 최소 구현으로 통과시킨다.

## Global Constraints

- `home_curations` 단일 원장이 hero·featured IP·announcement를 관리한다.
- Supabase 공개 홈은 explicit active filter를 사용하고 `ips.featured`로 재폴백하지 않는다. mock 모드만 legacy fallback을 유지한다.
- 관리자 쓰기는 audited·idempotent staff RPC 한 경계로만 수행한다.
- #112 verified artwork claim의 격리를 약화하지 않는다.
- 공지 배너 저장은 알림을 자동 발송하지 않는다.
- KST는 UI 경계에서만 변환하고 DB에는 `timestamptz`를 저장한다.

## Task 1: DB 원장·보안·승계

파일:

- 생성: `supabase/tests/home_curations.sql`
- 생성: Supabase CLI가 만든 `supabase/migrations/*_home_curations.sql`
- 수정: `supabase/tests/admin_artwork_upload_storage.sql`
- 수정: `supabase/tests/catalog_archiving.sql`
- 수정: `supabase/seed.sql`
- 수정: `.github/workflows/pipeline.yml`

순서:

1. schema/check/RLS/ACL, public 활성 경계, staff 전체 읽기, 잘못된 입력, audited idempotent upsert와 operation 충돌을 SQL smoke로 먼저 실패시킨다.
2. `home_curations`와 active/read indexes, public/staff SELECT 정책, direct DML 차단을 구현한다.
3. `admin_upsert_home_curation`에 staff gate, operation·entity lock, exact replay, request/before/after audit를 구현하고 함수 권한을 봉인한다.
4. `curation` artwork claim과 attachment trigger를 추가해 unverified·cross-kind·attached-path 재사용을 거절한다.
5. curation upsert가 연결 IP 행을 `FOR UPDATE`로 잠근 뒤 미보관 상태를 확인하게 하고, active/future enabled featured curation이 IP 보관을 차단하도록 #113 guard를 확장한다. concurrent create/update와 archive가 같은 IP 행 lock으로 직렬화되는 smoke test를 둔다.
6. 기존 featured IP를 backfill하고 seed에도 deterministic featured curation을 추가한다.
7. 새 SQL smoke를 pipeline local reset 단계에 연결하고 관련 SQL test를 통과시킨다.

## Task 2: 관리자 도메인·서버 경계

파일:

- 생성: `lib/admin/curations.ts`, `lib/admin/curations.test.ts`
- 생성: `lib/admin/curations.server.ts`, `lib/admin/curations.server.test.ts`
- 생성: `app/admin/curation-actions.ts`, `app/admin/curation-actions.test.ts`
- 수정: `lib/admin/artwork.ts`, `lib/admin/artwork.test.ts`
- 수정: `app/admin/artwork-actions.test.ts`
- 수정: `lib/admin/artwork-upload.client.test.ts`

순서:

1. UUID·kind·title·IP 조합·internal link·순서·KST datetime·image path 정규화 테스트를 먼저 실패시킨다.
2. `2026-07-21T10:30` KST가 `2026-07-21T01:30:00.000Z`가 되며 잘못된 calendar/window를 거절하도록 form parser를 구현한다.
3. staff 전체 목록 loader와 public Storage URL mapping, 결정적 정렬·상태 계산을 구현한다.
4. Server Action에서 auth/staff를 재확인하고 단일 upsert RPC를 호출한다. 성공 시에만 `/`와 `/admin`을 revalidate하고 DB 상세 오류는 노출하지 않는다.
5. TypeScript artwork kind/path 계약을 `curation`으로 확장한다.

## Task 3: 관리자 큐레이션 화면

파일:

- 생성: `components/admin/sections/CurationSection.tsx`
- 생성: `components/admin/sections/CurationSection.test.tsx`
- 수정: `components/admin/ArtworkUploadField.tsx`, `components/admin/ArtworkUploadField.test.tsx`
- 수정: `components/admin/Admin.tsx`, `components/admin/Admin.test.tsx`
- 수정: `components/admin/Sidebar.tsx`, `components/admin/Sidebar.test.tsx`
- 수정: `components/admin/sections/IpSection.tsx`, 관련 테스트
- 수정: `app/admin/page.tsx`, `app/admin/page.test.tsx`
- 수정: 필요 시 `app/globals.css`

순서:

1. `curations` navigation/query, 목록·신규·편집, 유형별 IP/image 규칙, KST 기간, 순서, 활성 토글, 공지 발송 화면으로만 이동하는 navigation CTA 테스트를 먼저 실패시킨다. 이 CTA와 저장 action이 notification action을 호출하지 않는 것도 고정한다.
2. staff loader 결과와 draft/operation UUID를 `Admin`에 전달하고 독립 큐레이션 section을 연결한다.
3. 기존 `RecordList`와 `ArtworkUploadField kind="curation"` 패턴으로 master/detail 폼을 구현한다.
4. IP featured checkbox를 제거하고 기존 값을 hidden input으로 보존한다.
5. 모바일 1열, 44px target, focus-visible, 텍스트 상태와 overflow를 보장한다.

## Task 4: 공개 홈 큐레이션 소비

파일:

- 생성: 필요 시 `lib/home-curations.ts`, 관련 테스트
- 수정: `lib/home-catalog.ts`, `lib/home-catalog.test.ts`
- 수정: `lib/catalog.ts`, `lib/catalog.test.ts`
- 수정: `app/page.tsx`, `app/page.test.tsx`
- 수정: `components/screens/Home.tsx`
- 생성: `components/screens/Home.test.tsx`
- 수정: 필요 시 `app/globals.css`

순서:

1. Supabase active query/order/storage URL, curated IP order·dedupe·missing/empty, hero·announcement 렌더와 mock fallback 테스트를 먼저 실패시킨다.
2. mock의 `undefined` curated IDs와 Supabase의 배열(빈 배열 포함)을 구분해 legacy featured 재폴백을 막는다.
3. Home snapshot이 첫 hero, 첫 announcement, 최대 다섯 featured IP IDs를 반환하고 post preview도 같은 IP 순서를 사용하게 한다. 공개 IP query의 legacy `featured` 정렬도 제거한다.
4. hero가 있으면 배경·제목과 `자세히 보기 →` primary CTA를 교체하고 접근성 이름에 제목을 포함한다. 기존 `둘러보기` secondary CTA는 유지하며 hero가 없으면 현재 selected-IP hero를 유지한다.
5. 첫 active announcement와 ordered featured picker를 기존 Holographic Midnight 패턴 안에서 반응형·접근 가능하게 렌더한다.

## Task 5: 문서·통합·출시 경로

파일:

- 수정: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/launch-readiness-plan.md`

순서:

1. 운영 큐레이션 원장, public active RLS, audited staff RPC, 홈 소비와 #114 완료 상태를 as-built 문서에 반영한다. `CONTEXT.md`와 ADR은 바꾸지 않는다.
2. targeted test → 전체 `npm test` → `npm run lint` → `npm run build` → `git diff --check`를 실행한다.
3. pinned Supabase CLI로 local reset, 전체 SQL smoke, DB lint와 schema diff를 검증한다.
4. 로컬 브라우저에서 staff 생성·편집·비활성과 공개 홈을 desktop/390px로 검증하고 synthetic data를 정리한다.
5. 독립 DB/보안·코드·UI 리뷰 후 의도한 파일만 commit/push하고 ready PR을 만든다.
6. GitHub CI와 preview를 확인해 squash merge하고 exact main production pipeline을 검증한다.
7. production transaction rollback canary로 RPC/RLS/audit/홈 공개 조건을 검증하고 route·잔여 synthetic data를 확인한다.
8. #114 close·Project Done과 Project #8의 다음 실행 가능 issue를 확인한 뒤 같은 루프를 반복한다.

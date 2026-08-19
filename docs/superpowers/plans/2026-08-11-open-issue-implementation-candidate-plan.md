# 열린 이슈 구현 후보 계획 (#134·#137·#188·#191)

> **삭제원장 backend 정정:** 아래 GCP append service 서술은 2026-08-12 검토 시점 기록이다. 현행 방향은 운영 Supabase와 backup 계보가 분리된 **별도 Supabase compliance 프로젝트**다([`account-deletion-retention-policy.md`](../../account-deletion-retention-policy.md) · [#215](https://github.com/icons-hq/icons-ip/issues/215)).

> 상태: Approved for local TDD · 외부 인프라·Production 별도 승인 · GitHub 미게시 · 작성 2026-08-11 · 승인 2026-08-12
>
> 범위: 코드로 해결할 수 있는 #134, #137, #188, #191과 공통 개인정보 경계. #66·#115 및 사업·법무·물류·콘텐츠 사람 이슈는 별도 결정·운영 경로를 유지한다.

## 1. 목표와 불변식

구현의 critical path는 `#134 독립 경로`, `#137 1단계 → #191 → #137 2단계`다. 2026-08-12 내부 검토는 restore-resilient GCP append service + verifier 경계를 승인했다. 별도 인프라 issue와 backend drill은 #137 1단계와 병행하되 실제 drill 전에는 #191 Production 발송과 #137 2단계를 활성화하지 않는다. #188의 classifier·권리 guard는 #137 1단계 뒤 병행할 수 있지만, 신규 미성년 삭제 end-to-end와 #188 종료는 #137 2단계 뒤에만 인정한다. 각 수직 절편은 승인된 공개 seam의 실패 테스트 하나를 먼저 만들고, 그 테스트만 통과시키는 최소 구현 뒤 다음 절편으로 이동한다. 내부 helper 호출 횟수나 private table 직접 조회를 제품 동작의 증거로 삼지 않는다.

다음 불변식을 유지한다.

- 공개 브라우징과 기존 주문·티켓·취소·환불·권리행사 경로를 연령·탈퇴 보호 액션 gate와 분리한다.
- user ID, 현재 날짜, 적격 판정, 삭제 대상은 클라이언트 입력을 신뢰하지 않고 서버·DB가 현재 주체에서 파생한다.
- Auth hard delete 전에는 복원 독립 `purge_committed` ack가 있어야 하고, 외부 `purge_completed` ack 전에는 사용자에게 완료를 표시하지 않는다.
- Send Email Hook과 거래메일은 같은 withdrawal·underage fence와 durable outbound 원장을 사용한다.
- 원문 이메일·주소·주문 UUID·`paymentKey`·provider body·raw 오류는 runtime log와 Log Drain에 남기지 않는다.
- Supabase 함수는 생성 직후 `public`, `anon`, `authenticated`, `service_role` 기본 execute를 모두 revoke하고 승인된 role만 다시 grant한다. `private` schema 전체 권한을 일괄 회수해 기존 helper를 깨뜨리지 않고 신규 객체 단위로 봉인한다.
- Storage 삭제는 SQL이 아니라 Storage API를 사용하고 모든 bucket의 owner·legacy path·DB reference를 pagination해 잔여 0건을 검증한다.
- migration 파일은 구현 시 `npx supabase migration new <name>`으로 생성한다. 이 문서에서 timestamp를 발명하지 않는다.
- Next.js Route Handler·cookie·redirect 코드를 쓰기 직전에 설치된 Next.js 16 문서의 `route-handlers.md`, `cookies.md`, `redirect.md`를 다시 읽는다.

## 2. 승인할 공개 TDD seam

| 이슈 | 공개 seam | 관찰 가능한 결과 |
|---|---|---|
| #134 | `requestPasswordResetAction` | generic 응답, recovery 전용 callback, 안전한 signed state cookie |
| #134 | `GET /auth/recovery/callback` | same-browser 성공, allowlist 실패, session·cookie cleanup, no-store |
| #134 | 기존 `GET /auth/callback` | signup/OAuth와 배포 전 legacy recovery link 회귀 |
| #134 | Auth 설정 sync CLI | allowlist·template patch/read-back, 비밀값 비출력 |
| #137 | `previewMyAccountDeletion` | self-only blocker·삭제/보존 범주·해결 경로 |
| #137 | `requestMyAccountDeletion` | request/fence 원자성, 멱등 신청, opaque status cookie |
| #137 | `getMyAccountDeletionStatus` | 1a는 Auth가 살아 있는 self-only coarse status, 1b는 승인된 key 계약 뒤 post-Auth token 교환·만료 거부 |
| #191 | `dispatchTransactionalEmail` | fence→intent→외부 ack→provider→event 상태 |
| #191 | `POST /api/auth/hooks/send-email` | 서명된 Auth 메일만 공통 fence·dispatcher로 처리 |
| #191 | provider event webhook | 중복·역순 event가 한 최종 상태로 수렴 |
| 공통 | observability logger | 승인된 HMAC ref·allowlist 오류 외 원문 0건 |
| #188 | `completeOnboardingAction` | 성인 원자 완료 또는 신규 미성년 durable 거절 |
| #188 | 보호 액션 판정 | profile complete와 `eligible` 권한 분리 |
| #188 | age-out 재동의 action/RPC | KST 재판정·현재 필수 동의 뒤 원자 `eligible` 전환 |
| #137 | deletion processor | 마지막 barrier부터 멱등 재시도, residue 0, 완료 ack |

외부 경계만 주입 가능 adapter로 둔다: `ExternalPrivacyLedger.append/scanAfter`, `EmailProvider.send/find`, `AuthAdmin.signOut/deleteUser`, `StorageSweeper.inventory/remove`. 내부 모듈은 mock하지 않고 실제 public seam 또는 local test DB를 통한다.

## 3. 구현 전 hard gate

아래가 하나라도 비어 있으면 해당 절편을 구현·Production 활성화하지 않는다.

1. #134 queryless same-browser PKCE 계약과 cross-browser `browser_mismatch` 승인.
2. #102/#110 보존 필드·기산점·접근 역할·권리사건 처리 승인.
3. #188 14+·2월29일·자가신고 candidate·provider-neutral `verified_14_plus`·다섯 상태·age-out 재동의·기존 계정 backfill 승인.
4. #191 처리자 DPA·국외이전·data/event/suppression/backup TTL·삭제/자동 만료 승인.
5. #137 2단계 파괴 worker와 외부 원장 adapter를 활성화하기 전, 2026-08-12 내부 검토와 같이 현재 Supabase 프로젝트와 backup/restore failure domain이 다른 GCP append service + read-only verifier의 별도 인프라 issue, append/scan API, 키·TTL·hold·snapshot catalog·restore drill·운영 owner를 확정한다. 같은 DB mirror는 불가다.
6. 탈퇴 후 사용할 비로그인 개인정보·고객지원 연락처 확정.
7. Preview/Production Supabase 설정, Vercel env, cron, 외부 provider와 Production smoke의 별도 변경 승인.

GCP backend의 **구조와 interface만 2026-08-12 내부 검토로 승인**했다. 실제 provider project·region·보존기간·DPA·IAM·키·비용·운영자는 별도 인프라 issue와 Production 변경에서 read-back하고, 최소 Production-like drill을 통과한 뒤에만 #137/#191의 외부 barrier를 활성화한다. 별도 Supabase 프로젝트는 빠른 prototype에는 쓸 수 있지만 project 삭제 시 backup도 함께 제거되고 DB owner가 append-only trigger를 우회할 수 있어 authoritative 종료 근거로 사용하지 않는다.

비교한 두 구조와 결정은 다음과 같다.

1. **retention-class bucket direct writer(폐기)**: Vercel이 bucket 범위 `storage.objects.create`를 직접 가지면 경계가 얕고 앱 principal이 storage surface를 안다.
2. **GCP append service + verifier(채택)**: Vercel은 GCP 내부 append service만 호출하고 object를 직접 읽거나 복호화하지 않는다. append service가 create와 승인된 retention을 적용하며, 별도 read-only verifier가 모호한 결과의 generation·immutable body hash를 확인해 제한된 signed ack만 반환한다. writer와 verifier의 service account·권한·감사 로그를 분리한다.

두 구조의 공통 후보 계약은 다음과 같다.

- core store는 event ID·stream·event type·시각·schema version·subject·recipient·provider locator 없는 최소 상태·content hash만 둔다. 내부 event ID로 다시 연결될 수 있는 동안은 익명정보가 아니라 가명·최소화 데이터로 취급하고 DPA·국외이전·승인 보존기간을 적용한다.
- append service는 caller principal별 event-type ACL, server-issued namespace, schema, 선행 ack와 허용 상태전이를 검증한다. 앱 writer는 `purge_completed`, `legal_hold_released`, key destroy를 append할 수 없고 append·verify/read·restore/decrypt·expiry purge·hold set/release·key destroy·break-glass principal을 분리한다.
- sensitive store는 암호화 subject·recipient ref·provider locator·application envelope key version만 둔다. GCS CMEK는 인프라 암호화로만 사용하고, locked object의 보존 만료 전 CMEK 파괴를 개인정보 crypto-erasure 수단으로 가정하지 않는다. 재연결 가능한 core digest와 sensitive linkage는 record/subject별 DEK로 암호화하고 공유 KMS KEK에는 wrapped DEK만 둔다. 개인별 파기는 ciphertext·wrapped DEK·모든 recoverable generation을 제거하며 공유 KEK version을 개인별 crypto-erasure로 쓰지 않는다.
- object 이름·editable metadata에는 user ID·email·provider ID를 넣지 않고 증거는 immutable canonical body에 둔다. core와 sensitive object는 event ID와 상대 body hash로 pair를 고정하며, 둘의 generation·hash·retention이 확인되기 전에는 durable ack로 취급하지 않는다. 부분 성공 orphan은 자동 완료가 아니라 재시도·만료 점검 대상으로 남긴다.
- append는 stable object name과 `ifGenerationMatch=0`을 사용한다. 성공 응답의 generation·checksum을 저장하고, timeout 또는 412를 자동 성공으로 보지 않는다. 기존 object의 정확한 generation·canonical body hash가 일치한다는 별도 verifier ack가 있어야 멱등 성공이다. create-only Vercel principal에 object read 권한을 추가해 이를 우회하지 않는다.
- legal hold는 DB 행만으로 끝내지 않는다. set·release 모두 서로 독립된 2인 승인을 durable하게 확인하지 못하면 fail closed한다. 외부 원장에 immutable `legal_hold_set|legal_hold_released` event를 append하고, 앱 writer와 분리된 compliance principal들이 metageneration precondition으로 GCS temporary hold를 적용·해제한다. Object Retention object와 양립하지 않는 event-based hold는 사용하지 않는다. hold 중에는 sensitive linkage·DEK·provider locator purge와 lifecycle delete를 모두 중지하고 restore replay가 hold를 재구성한다.
- subject linkage 파기 기준은 각 `purge_committed_at`보다 앞선 상태를 복원할 수 있는 Supabase daily/PITR, manual logical export, restore-to-new-project clone, 별도 DR·분석 사본 **전부의 `max(expires_at)` + 최대 replay 지연 + 7일**이다. 미등록·expiry 미상 artifact와 catalog 변경은 fail closed하고 기존 TTL을 단축하지 않는다. linkage가 없는 더 오래된 restore는 runbook이 거부하며, legal hold는 이 기한과 record/subject DEK 파기를 함께 정지한다.
- bucket 생성 시 soft delete 0일과 Object Versioning off를 설정하고 배포마다 read-back·drift alert한다. 기존 bucket을 재사용하거나 설정이 변하면 모든 soft-deleted·noncurrent generation을 catalog·TTL·hold·파기 검증에 포함하고 잔여기간 종료 전 파기 완료로 표시하지 않는다. soft delete 0일은 고객이 복구 가능한 추가 사본을 막는 통제일 뿐 Google 내부 사본의 즉시 삭제 증거가 아니므로, 실제 DPA의 provider-side 삭제 기간을 별도 승인·고지한다.
- lock은 되돌릴 수 없으므로 retention class별 manifest, lifecycle, object-retention 권한과 비용을 unlocked test bucket에서 drill하고 법무·보안 서명 뒤 적용한다. project lien 해제는 IT 운영계정과 분리한 compliance break-glass와 2인 승인을 요구한다.
- Vercel OIDC→GCP WIF는 team issuer와 정확한 audience, `owner_id`, `project_id`, `environment='production'`, exact subject를 조건으로 고정한다. Vercel Function의 `x-vercel-oidc-token`만 교환하고 Preview·Development·다른 project token은 거부한다. bucket/service 단위 최소 권한만 부여하며 restore reader/decrypt, expiry purger, legal-hold operator, verifier, lien break-glass를 분리한다.
- Seoul `ASIA-NORTHEAST3` 선택은 object의 저장 위치 통제이지 Google·subprocessor의 모든 처리 위치가 국내라는 보장이 아니다. current Google Cloud DPA·subprocessor·지원/로그 처리 위치와 국외이전 근거를 별도 확인하고, 승인된 국외 복제 없이 dual-region을 선택하지 않는다.

## 4. Slice A — #134 recovery 전용 callback

### A1. 요청 경로 첫 RED → GREEN

- RED: `app/login/actions.test.ts`
  - recovery 요청이 정확한 `/auth/recovery/callback`을 사용한다.
  - `icons_auth_recovery_next`는 signed, HttpOnly, SameSite=Lax, HTTPS Secure, 1시간, callback path 전용이다.
  - unsafe `next`는 `/`로 정규화되고 generic 응답이 계정 존재를 노출하지 않는다.
- GREEN:
  - `lib/auth/onboarding.ts`: recovery callback 상수·URL helper.
  - `lib/auth/recovery.server.ts`: domain-separated signed recovery state.
  - `app/login/actions.ts`: signup/OAuth state와 recovery state 분리.
- 즉시 targeted test를 다시 실행한 뒤 다음 절편으로 이동한다.

### A2. 전용 callback 실패와 성공

- RED 신규 `app/auth/recovery/callback/route.test.ts`:
  - code/cookie 없음 `missing_code`.
  - PKCE verifier 없음 `browser_mismatch`.
  - 만료·중복 `link_expired_or_used`.
  - 설정 없음 `recovery_unavailable`.
  - unknown provider 상태 `unknown_recovery_error`.
  - 모든 terminal 응답은 recovery cookie 제거, `Cache-Control: private, no-store, max-age=0`, 임의 next/raw provider 값 제거.
- GREEN 신규 `app/auth/recovery/callback/route.ts`.
- 다음 RED:
  - code exchange + 서명 state + pinned auth-js의 PKCE-local recovery marker + `getUser()` 성공만 `/update-password?session_ready=1&next=<safe>`.
  - route path가 recovery purpose 진실원이고 local marker는 provider assertion이 아님.
  - marker 불일치 또는 `getUser()` 실패는 local sign-out, 새 session cookie와 recovery state 만료, fail closed.
- GREEN은 위 공개 결과에 필요한 최소 코드만 추가한다.

### A3. 기존 callback·SDK·설정 회귀

- `app/auth/callback/route.test.ts`·`app/auth/callback/route.ts`: signup/OAuth·onboarding·suspended·취소·일반 오류 유지. 실제 `mailer_otp_exp`와 안전 여유가 끝날 때까지 legacy recovery link 분기를 유지한다.
- `lib/auth/onboarding.test.ts`: 공개 reset error allowlist를 `missing_code|link_expired_or_used|browser_mismatch|session_not_found|recovery_unavailable|unknown_recovery_error`로 고정한다.
- 신규 `lib/auth/supabase-recovery-contract.test.ts`: 설치된 auth-js의 public 호출로 PKCE-local marker 계약 drift를 감시한다. private SDK 구현을 복사하지 않는다.
- `supabase/config.toml`, `.github/workflows/pipeline.yml`: 기존 callback을 유지하면서 Local·Preview·Production recovery URL을 추가한다.
- 신규 `supabase/templates/recovery.html`: `{{ .ConfirmationURL }}`을 보존한다.
- `scripts/sync-supabase-auth.mjs`·테스트: recovery template·subject·allowlist를 read→patch→read-back하며 PAT·template token을 로그에 쓰지 않는다.

### A4. 안전한 rollout

1. 호환 PR: 새 route·cookie·allowlist·template sync만 배포하고 기존 action은 아직 old callback을 사용한다.
2. Production route의 missing-code/no-store smoke 뒤 활성 PR에서 action을 전환한다.
3. same-browser 성공, cross-browser, 만료·중복, unsafe next, global sign-out과 새 비밀번호 로그인을 controlled account로 검증한다.
4. 실제 OTP 만료+안전 여유 뒤 legacy recovery branch를 제거한다.

## 5. Slice B — #137 1단계 request·fence·status

1단계도 안전 경계에 따라 나눈다. **B1/B2a**는 `private.account_deletion_requests`·`private.account_action_fences`, self-only preview/request와 Auth가 살아 있는 동안의 상태 조회까지만 구현한다. raw 256-bit status bearer를 DB RPC 결과·PostgREST 경계에 노출하지 않고, 앱과 DB가 공유할 HMAC/KMS secret·rotation·rate-limit 계약이 없는 상태에서 가짜 post-Auth 조회를 만들지 않는다. **B2b**의 opaque status cookie는 승인된 key custody와 DB에는 HMAC만 저장하는 교환 경계가 구현된 뒤 추가한다. B1/B2a만으로 #137을 닫거나 Auth hard delete를 시작하지 않는다.

### B1. schema와 최소 권한

암호화 locator·key custody·subject TTL이 승인되기 전에는 deployable migration을 만들지 않는다. 현재 B1 계약 검증본은 `supabase/prototypes/account_deletion_phase_1.sql`의 disposable-local prototype이며 `supabase db push`와 CI deployment runner에서 제외한다. 승인된 계약이 준비되면 `npx supabase migration new account_deletion_phase_1`로 새 immutable migration을 생성하고 prototype을 그대로 승격하지 말고 스키마·테스트를 다시 검토한다.

이번 1a의 신규 private 실행 원장:

- `account_deletion_requests`
- `account_action_fences`

1a request는 Auth가 살아 있는 동안 self-only로만 조회하며 stable `deletion_event_id`, reason, `requested|blocked_active_obligation` 상태와 PII 없는 blocker summary만 둔다. destructive worker·`purging|completed`, 암호화 subject/DEK, 법정 snapshot·targets·tombstone·external purge task와 post-Auth status token은 외부 ledger·key 계약이 준비되는 후속 절편까지 만들지 않는다.

목적 RPC 후보:

- `preview_my_account_deletion()`
- `request_my_account_deletion(p_confirmation text)`
- `get_my_account_deletion_status()`

SQL 첫 RED는 `supabase/tests/account_deletion_phase_1.sql`에서 self-only, request/fence 원자성, 중복 수렴, private ACL, 기본 execute revoke, user ID·reason 조작 불가와 Auth 없는 status 거부를 검증한다. `service_*`는 서버 내부 RPC로 오해할 수 있어 authenticated self-service 이름에 사용하지 않는다.

### B2a. 공개 Server Action과 Auth 상태 조회

- RED 신규 `app/settings/account-deletion/actions.test.ts`:
  - preview는 blocker code·count·allowlisted 링크만 반환한다.
  - request가 target user ID를 받지 않고 중복 호출이 같은 request로 수렴한다.
  - request와 fence가 원자적으로 생기며 Auth가 살아 있는 self 사용자만 coarse status를 조회한다.
- GREEN:
  - `app/settings/account-deletion/page.tsx`
  - `app/settings/account-deletion/actions.ts`
  - `lib/account-deletion/types.ts`
  - `lib/account-deletion/service.server.ts`

### B2b. 승인된 key 계약 뒤 post-Auth 상태 cookie

- RED 신규 `app/settings/account-deletion/actions.test.ts`:
  - preview는 blocker code·count·allowlisted 링크만 반환한다.
  - request가 target user ID를 받지 않고 중복 호출이 같은 request로 수렴한다.
  - 256-bit token 원문은 한 번만 cookie로 나가고 DB·URL·HTML·log에 없음.
  - cookie는 Secure/HttpOnly/SameSite=Strict/상태 path 전용.
  - Auth 삭제 뒤 유효 token으로 PII 없는 coarse status만 조회하고 cross-request swap·위조·변조·추측·terminal+7일/절대90일 만료·rate limit은 정보 0건. 유효 cookie 탈취 시 coarse status 노출 위험은 위협 모델에 남긴다.
- GREEN:
  - `app/account/deletion/status/page.tsx`
  - `lib/account-deletion/crypto.server.ts`
  - `lib/account-deletion/external-ledger.server.ts`

### B3. action fence matrix

공개 보호 mutation을 통해 한 절편씩 RED→GREEN한다.

- 차단: 주문·티켓 예약, cart INSERT/UPDATE, 포스트·댓글 작성/수정, like=true, follow, profile identity/avatar, marketing/IP alert opt-in, 게임, 카드팩 개봉, community/profile Storage upload.
- 유지: 조회, unlike/unfollow, marketing/IP alert opt-out, own content delete, 신고·차단, 취소·환불, 탈퇴·개인정보 요청.
- 기존 DB guard와 누락된 RPC/DML 우회, 앱 service-role 주문·예약 호출을 함께 검증한다.
- withdrawal·`underage_rejected`는 DB fence만으로 Auth token 발급을 막는다고 가정하지 않는다. login action·Auth callback·`proxy.ts`·보호 Server 경계가 제한 상태를 확인해 앱 진입과 mutation을 거부하고 Auth·앱 cookie를 만료하는 회귀 테스트를 추가한다. blocked obligation의 권리 경로는 유지한다.
- 외부 의무가 없는 신규 `underage_rejected`는 durable request/fence ack에 `hard_delete_due_at = ack+24시간`을 고정한다. deadline 전후 worker 테스트는 Auth hard delete 완료, 초과 시 PII 없는 경보·멱등 재시도와 `completed` 표시 금지를 검증한다.

이 단계는 `completed` 전이를 열지 않는다. 외부 원장 backend에 실제 `purge_committed` append/ack를 증명하지 못하면 파괴 worker를 활성화하지 않는다.

## 6. Slice C — #191 outbound ledger·Hook·로그

### C1. durable outbound 첫 절편

구현 시 `npx supabase migration new email_outbound_ledger`로 migration을 만든다.

신규 private table:

- `email_outbound_attempts`
- `email_provider_events`

attempt에는 subject fence epoch, claim lease ID·획득·만료, provider call 시작·수락시각과 terminal/cancel 사유를 둔다. fence transaction은 epoch를 올린 뒤 신규 intent·claim을 거부하고 pre-fence lease만 drain 대상으로 고정한다.

목적 RPC 후보:

- `service_create_email_outbound_intent`
- `service_claim_email_outbound`
- `service_record_email_provider_result`
- `service_reconcile_email_provider_event`
- `service_check_email_fence`
- `admin_search_email_outbound_attempts`
- `admin_request_email_resend`

첫 RED `lib/email/dispatcher.server.test.ts`는 `fence 검사·epoch 고정 → DB intent → 외부 intent ack → lease claim`이 모두 성공하기 전 provider 호출 0회를 검증한다. fence 커밋 뒤 신규 intent·claim 0건, fence 전에 claim된 in-flight lease의 accepted/failed 또는 terminal 취소 수렴과 ambiguous 0건도 공개 contract로 고정한다. provider webhook은 stable `(provider, outbound_id, provider_event_id)`별 append와 versioned reducer로 별도 검증한다. GREEN은 다음 모듈의 최소 공개 dispatcher를 만든다.

- `lib/email/dispatcher.server.ts`
- `lib/email/outbound-ledger.server.ts`
- `lib/email/provider-errors.server.ts`
- `lib/email/auth-templates.server.ts`

기존 `lib/email/transactional.server.ts`, `provider.server.ts`, `deliveries.server.ts`는 dispatcher를 소비하게 수직 이전한다. 기존 `email_deliveries`는 호환용 `legacy_unverified`로만 취급하고 과거 교부 증거로 승격하지 않는다.

다음 절편은 provider timeout/connection reset=`ambiguous`, 같은 outbound ID 중복 전송 0, 24시간 이후 자동 재발송 0, signed provider event의 중복·역순 수렴을 한 테스트씩 추가한다.

### C2. Auth Send Email Hook

- RED 신규 `app/api/auth/hooks/send-email/route.test.ts`:
  - Standard Webhooks ID/timestamp/signature, 최대 20KB, 허용 action type, secure email-change token 필드 계약.
  - withdrawal·underage fence 또는 설정/DB 장애에서 provider 0회·generic fail-closed.
  - 5초 예산과 원문 token/body 로그 0건.
- GREEN 신규 `app/api/auth/hooks/send-email/route.ts`는 공개 dispatcher만 호출한다.
- RED/GREEN 신규 `app/api/webhooks/email/route.test.ts`·`route.ts`: provider event 서명·중복·역순·unknown event를 검증한다.

### C3. observability sanitizer

- 신규 `lib/observability/ref.server.ts`·테스트: `HMAC-SHA256(key_version, purpose || 0x00 || identifier)`의 전체 base64url digest, domain separation, key rotation/TTL.
- 신규 `lib/observability/log.server.ts`·테스트: allowlisted field·오류 code만 기록한다.
- 다음 현재 leak 경로마다 첫 실패 테스트를 추가한 뒤 교체한다.
  - `lib/email/provider.server.ts`
  - `lib/email/transactional.server.ts`
  - `app/admin/order-actions.ts`
  - `app/api/payments/confirm/route.ts`
  - `app/api/webhooks/tosspayments/route.ts`
- raw recipient·subject·본문·provider body/error·order UUID·dedupe key·`paymentKey` 부재를 public route/action 결과와 captured logger에서 검증한다.

### C4. Hook rollout

1. app route·dispatcher·health probe를 먼저 배포하고 Hook은 비활성으로 둔다.
2. `scripts/sync-supabase-auth.mjs`와 `.github/workflows/pipeline.yml`에 `REQUIRE_SEND_EMAIL_HOOK`, Hook URI/secret presence, read-back을 추가한다.
3. 별도 승인 job에서만 Hook을 활성화한다. route health·signature probe 전 설정 변경은 테스트와 CI에서 거부한다.
4. controlled 가입확인·재발송·recovery·email-change에서 Hook event와 direct SMTP 발송 0건을 확인한다.
5. 공개 rate-limit/custom SMTP 상호작용을 canary로 확인하기 전에는 현재 `REQUIRE_SMTP`·custom SMTP 호환 설정을 즉시 제거하지 않는다. 제거는 별도 승인·회귀 검증 뒤 수행한다.
6. Gmail·NAVER·Daum 수신, SPF/DKIM/DMARC, provider accepted와 stable-ID webhook event/reducer, DPA/TTL/purge ack를 확인한다.

## 7. Slice D — #188 최소 연령 gate

### D1. 순수 classifier

- RED 신규 `lib/auth/age-gate.test.ts`: 생일 전/당일/후, 월말, 미래·불가능 날짜, 2월29일의 평년3월1일·윤년2월29일, UTC→KST 경계를 독립 literal로 검증한다.
- GREEN 신규 `lib/auth/age-gate.ts`: 생년월일 classifier는 `invalid|underage|adult_candidate`만 계산한다. 최종 `eligible` 권한은 현재 receipt·`verified_14_plus`를 함께 확인하는 별도 서버/DB 경계에서만 산출한다.

### D2. schema·온보딩 purpose RPC

구현 시 `npx supabase migration new minimum_age_gate`로 migration을 만든다.

- `profiles.age_gate_status`: `unverified|eligible|age_restricted|underage_rejected|review_required`.
- `profiles.age_gate_decided_at`, `profiles.age_gate_policy_version`.
- private `age_assurance_receipts`: `unverified|verified_14_plus|failed|revoked`, provider ID, domain-separated transaction ref digest, verified_at, policy version. raw payload·원 DOB·CI·전화·신분증은 저장하지 않는다.
- immutable `private.consent_receipts`: 서버가 선택한 terms/privacy version, 각 accepted 시각, source·receipt ID. 기존 `profiles.consents` boolean에서 receipt나 시각을 합성하지 않는다.
- private `age_gate_reviews`: target subject, allowlisted reason/evidence category, corrected DOB가 승인된 경우의 encrypted/minimized provenance, `pending|reconsent_allowed|age_restricted|rejected`, reviewer·decided_at·policy version과 감사 ref. 자유서술·원본 신분증은 이 원장에 저장하지 않는다.
- private classifier·protected-action assertion. `eligible`은 DB KST 14세 이상·현재 receipt·`verified_14_plus`가 모두 참일 때만 반환한다.
- `begin_age_assurance(...)` / `complete_age_assurance(...)`: server-generated state와 callback fresh verification, transaction ref 멱등·subject binding, raw provider payload 미저장. 제3자 계약·DPA·callback secret이 없으면 fail closed한다.
- `complete_onboarding(...)`: `auth.uid()`·DB KST 날짜·self row lock, `verified_14_plus`를 확인한 성인만 profile·서버 선택 현재 문서 receipt·follow를 원자 완료하고, 신규 미성년은 B단계 request/fence를 같은 transaction에서 durable 기록한다.
- `reactivate_age_restricted_account(...)`: 14세 도달·현재 필수 문서 새 receipt·`verified_14_plus` 뒤만 `eligible`.
- `admin_resolve_age_gate_review(...)`: staff/admin 재검사, target row lock, allowlisted resolution·reason만 받고 감사한다. 승인된 DOB가 14세 미만이면 `age_restricted`, 14세 이상이면 상태를 `review_required`로 유지한 채 reconsent clearance를 기록하며 직접 `eligible`로 만들지 않는다.
- `complete_review_required_reconsent(...)`: `auth.uid()`·승인된 clearance·DB KST 적격·현재 필수 문서의 새 receipt·`verified_14_plus`를 원자 확인한 뒤만 `eligible`. 미승인·타인·stale policy version을 거부한다.
- `set_marketing_consent(boolean)`: true는 eligible만, false는 제한 상태도 허용.

SQL RED `supabase/tests/minimum_age_gate.sql`은 self-only, KST DB clock, row lock, 직접 `birth_date|consents|onboarded_at|age_gate_status` update 차단, assurance subject/transaction replay·raw PII 금지, 정확한 ACL, 보호/권리 matrix를 검증한다.

### D3. 온보딩과 제한 화면

- `app/onboarding/actions.test.ts` 첫 RED: 성인 원자 성공과 versioned receipt, nickname conflict/invalid DOB write 0, 신규 미성년 personal profile write 0과 durable request ack 뒤 거절. 거절 응답은 status cookie를 먼저 발급하고 Auth·앱 cookie를 만료한다.
- GREEN: `app/onboarding/actions.ts`를 purpose RPC 하나로 전환한다.
- `components/screens/Onboarding.test.tsx`·`Onboarding.tsx`: DOB 1차 판정·추가 연령확인·결제 비검증 문구와 assurance 시작/실패/재시도 UX를 고정한다.
- 신규 `app/account/underage-rejection/page.tsx`·테스트: PII·거짓 완료 없이 비로그인 지원.
- 신규 `app/account/age-restricted/page.tsx`·action/test: 생일 뒤 현재 필수 재동의와 원자 `eligible` 전환, 마케팅 false 유지.
- 신규 `app/account/age-review-required/page.tsx`·action/test: 내부 사유·타인 정보를 노출하지 않고 pending review 또는 승인된 current-document 재동의만 제공하며 HTML/JSON은 `age_review_required`로 구분한다.
- `app/admin/member-actions.ts`·테스트, `components/admin/sections/Members.tsx`·테스트, `lib/admin/members.server.ts`·테스트: 최소정보 review·allowlisted resolution·권한·감사와 cross-user/stale decision 거부를 구현한다.

### D4. 기존 계정 dry-run·backfill·rights matrix

activation 전 repeatable-read dry-run은 상태별 exact count와 거래·UGC·legal hold·staff/admin·마케팅/IP 알림 교차 수만 낸다.

- 유효 DOB·14세 이상·승인된 현재 version consent receipt·`verified_14_plus` 있음 → `eligible`.
- 유효 DOB·14세 미만 → `age_restricted`.
- 실제 온보딩 미완료 → `unverified`.
- 유효 DOB·14세 이상이지만 receipt 또는 assurance 증거 없음, 미래·malformed source·완료 프로필 DOB 누락·상태 불변식 위반 → `review_required`. 현재 문서 재동의와 실제 assurance 뒤에만 재판정하며 legacy boolean·자가신고를 최신 증거로 승격하지 않는다.
- 기존 계정은 `underage_rejected`로 backfill하거나 자동 삭제하지 않는다.
- 제한·검토 staff/admin이 있으면 role 인수인계 전 activation을 중단한다.

`lib/auth/onboarding.test.ts`와 checkout/events/community/ip/games/packs/settings/admin 공개 action tests는 `isOnboarded()`와 보호 자격 분리, self-declared-only의 보호 액션 거부, restricted/review의 로그인·recovery·조회·취소·환불·own delete·신고·차단 허용, 새 mutation·opt-in·검표 거부를 검증한다. `review_required`는 staff clearance 전 재동의를 거부하고, clearance 뒤 현재 receipt와 verified assurance가 모두 생긴 경우만 `eligible`로 전환한다.

마지막 동작 절편과 함께 `lib/legal/documents.ts`·테스트, 이용약관·개인정보처리방침·시행일·개정이력만 실제 activation 계약에 맞춘다. 승인 전 법정 문구를 시행 중으로 바꾸지 않는다.

## 8. Slice E — #137 2단계 purge worker

### E1. schema·worker 상태기계

구현 시 `npx supabase migration new account_deletion_phase_2`로 migration을 만든다.

- `posts/comments.user_id`를 nullable·`ON DELETE SET NULL`로 바꾸고 공개 화면은 `탈퇴한 사용자`를 렌더한다. `lib/community.server.ts`의 block/filter/reaction query와 `lib/catalog.ts`의 feed·IP preview mapper, `components/screens/Community.tsx` 및 관련 타입·테스트가 NULL 작성자를 보존하며 SQL `NOT IN`/`ANY`의 NULL 삼값 논리로 행을 누락하지 않게 함께 이전한다. 본문이 남은 콘텐츠는 작성자 NULL이어도 신고·숨김할 수 있도록 `private.report_subjects.target_user_id`와 report trigger를 nullable-safe로 바꾸고, 계정 제재 대신 content moderation만 허용한다.
- 승인된 legal snapshot 뒤 일반 서비스 PII와 FK 밖 식별자를 삭제·unlink한다.
- sweep 대상에는 `audit_log.target/diff`, `reports.target_id`, `email_deliveries.dedupe_key`, 리워드·게임 idempotency, `order_cancellation_claims.requested_by`, notification source, payment raw/key, ticket QR를 포함한다.
- `private.consent_receipts`, `private.age_gate_reviews`, `private.age_assurance_receipts`의 subject·reviewer·receipt/review/transaction-ref 식별자와 정정 생년월일 provenance도 sweep한다. 일반 서비스 사본은 삭제·unlink하고, 내부 보존 매트릭스에서 근거·기한·접근 역할이 확정된 최소 동의 증빙만 별도 snapshot으로 이동한다. reviewer는 nullable 또는 승인된 keyed HMAC·감사 ref로 최소화하며 원본 신분증·원문 provider payload는 남기지 않는다.

첫 RED 신규 `lib/account-deletion/worker.server.test.ts`는 external `purge_committed` ack 전 destructive adapter 호출 0회를 검증한다. 이후 barrier 하나씩 RED→GREEN한다.

1. claim/advisory lock과 blocker row-lock 재검증.
2. 승인된 immutable legal snapshot.
3. 외부 `purge_committed` append/ack 뒤 `purging`; global sign-out·refresh session revoke를 시도하고 현재/후속 인증·상태 응답이 남은 Auth·앱 cookie를 반복 만료. worker 단독 cookie 삭제를 성공으로 기록하지 않음.
4. UGC·개인화·일반 PII cleanup.
5. 모든 Storage bucket의 owner/path/DB ref를 1,000개씩 API 삭제하고 residue 0 확인.
6. 외부 `external_purge_intent` ack.
7. fence epoch 뒤 신규 intent·claim 0, pre-fence lease drain, terminal ack·ambiguous 0과 `provider_fence_acked_at`.
8. `auth.admin.deleteUser(userId, false)`, user/session 부재 ack.
9. cutoff=`max(provider fence ack, last provider acceptance, Auth delete ack)`로 purge/expiry 등록과 `external_purge_registered` ack.
10. 외부 `purge_completed` ack 뒤만 request `completed`; status token은 승인 TTL 동안 coarse 상태만 제공.

구현 파일 후보:

- `lib/account-deletion/worker.server.ts`
- `lib/account-deletion/storage.server.ts`
- `lib/community.server.ts`·`lib/community.server.test.ts`
- `lib/catalog.ts`와 feed·IP preview 회귀 테스트
- `components/screens/Community.tsx`·`components/screens/Community.test.tsx`
- `lib/admin/moderation.server.ts`·테스트와 `components/admin/sections/Moderation.tsx`·테스트
- nullable `private.report_subjects`·report trigger·moderation RPC SQL 회귀 테스트
- `app/api/cron/account-deletion/route.ts`
- `vercel.json`
- `supabase/tests/account_deletion_phase_2.sql`
- `supabase/tests/account_deletion_storage.sh`
- `supabase/tests/account_deletion_auth.sh`
- `scripts/drill-account-deletion-restore.mjs`

### E2. fault injection·restore

- 각 barrier 직후 crash/retry.
- Storage 부분 실패, 1,000개 초과, owner 없는 legacy, 타 사용자 asset.
- external ledger timeout·duplicate·ack 유실.
- caller별 event-type·상태전이 권한 상승과 앱 writer의 compliance event 위조.
- provider accepted 직후 응답 유실.
- Auth 이미 삭제·timeout·session 잔존.
- DB·외부 원장의 legal hold 추가/해제 race, set·release 독립 2인 승인과 제2 승인자 부재 fail-closed, linkage/envelope-key purge 정지.
- 모든 restore-capable daily/PITR·logical export·clone·DR artifact의 `max(expires_at)` TTL 재계산과 미등록·expiry 미상 artifact fail-closed. snapshot durable watermark를 기록하고 복원 중 모든 writer·job·queue·hook·webhook·callback·provider egress를 격리한 뒤 stable event key로 lossless replay한다. replay checkpoint durable ack와 최종 DB/Storage/Auth/provider identifier 및 동의 receipt·연령 review subject/reviewer/provenance 잔여 0건 뒤에 writer를 단계적으로, public traffic을 마지막에 연다.

`purge_committed` 뒤에는 rollback하지 않고 같은 stable event로 forward-repair한다.

## 9. 검증 명령과 종료 증거

각 수직 절편은 targeted RED의 실제 실패 이유와 GREEN 통과를 기록한다. 전체 통합 전 다음을 실행한다.

```bash
npm test
npm run lint
npm run build
npx supabase db reset --local --no-seed
npx supabase db lint --local --fail-on error
npx supabase migration list --local
git diff --check
git status --short --branch
```

SQL smoke는 repo의 `supabase/tests/*.sql` runner 계약에 따라 전체 실행한다. CLI flag는 구현 시 설치된 `npx supabase <group> <command> --help`로 다시 확인한다.

issue별 종료 증거는 다음과 같다.

- #134: 결정 승인만으로 닫지 않는다. 호환/활성 구현 rollout, same-browser·cross-browser·만료·중복·unsafe-next·session cleanup, allowlist/template read-back과 Production controlled recovery까지 현재 이슈에 증거를 남긴 뒤 닫는다. decision-only로 바꾸려면 별도 구현 이슈를 실제 생성·연결하고 본문 범위 변경을 명시 승인한다.
- #191: Hook config read-back, 네 가지 Auth 메일과 거래메일 controlled 수신, 동일 outbound event chain, raw 로그 scan 0, DPA/TTL/purge ack, key rotation runbook.
- #188: 내부 위험결정, provider 계약·DPA·callback read-back, 다섯 상태/age-out/backfill dry-run, rights matrix, 신규 underage write 0, 법정 문서 시행일과 activation 일치, 명시적 Production 배포 승인.
- #137: preview/request/status, status token self-only·expiry, ACL·legal retention·동의 receipt·연령 review purge·nullable UGC 신고/관리자 조치·Storage/Auth/fault/restore test, synthetic deletion residue 0, 외부 `purge_completed`가 `completed`보다 선행.

각 구현 PR merge 뒤 GitHub issue 자동 종료와 Project `Done`을 재확인한다. 범위를 일부만 구현하면 `Closes`를 쓰지 않고 남은 절편과 Production gate를 issue에 남긴다. push·PR·merge·Production·Supabase remote 적용은 각각 승인 범위 안에서만 수행한다.

## 10. 연관 문서

- [제품·기술 결정 확인서](../../questionnaires/to-questionnaire-open-issue-decisions.md)
- [정책 법무 확인서](../../questionnaires/policy-legal-review.md)
- [탈퇴·이메일·로그 후보 설계](../specs/2026-08-11-account-deletion-email-log-privacy-candidate-design.md)
- [recovery 후보 설계](../specs/2026-08-11-auth-recovery-candidate-design.md)
- [만 14세 gate 후보 설계](../specs/2026-08-11-minimum-age-gate-candidate-design.md)
- [이슈 본문 동기화 초안](./2026-08-11-open-issue-body-sync-draft.md)
- [이슈 종료 증거](./2026-08-11-open-issue-closure-evidence.md)
- [회원 탈퇴·법정 보존 정책](../../account-deletion-retention-policy.md)
- [트랜잭션 이메일 운영](../../transactional-email.md)

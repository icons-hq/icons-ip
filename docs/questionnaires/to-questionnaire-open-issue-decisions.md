# ICONS 잔여 이슈 제품·기술 결정 확인서

> **삭제원장 backend 정정:** 아래 GCP append service 서술은 2026-08-12 검토 시점 기록이다. 현행 방향은 운영 Supabase와 backup 계보가 분리된 **별도 Supabase compliance 프로젝트**다([`account-deletion-retention-policy.md`](../account-deletion-retention-policy.md) · [#215](https://github.com/icons-hq/icons-ip/issues/215)).

> 상태: **Answered — Interim decision record** · 결정일 2026-08-12
>
> 결정 권한: 회사 내 전담자가 없다는 제품 소유자의 위임에 따라 Codex가 임시 제품·기술·개인정보·보안·운영 책임자 관점에서 보수적으로 확정했다. 이 기록은 회사 고유 사실이나 Production 자격증명을 만들어내지 않으며, 증거가 없는 판매·외부 처리·공개 시행은 fail closed한다.

**Purpose:** 현재 열린 이슈 중 제품 소유자 또는 Production 운영자의 결정 없이는 구현·종료할 수 없는 #66, #115, #134, #137, #188, #191과 공통 TDD seam을 확정합니다.

**From:** ICONS 개발팀 — **To:** ICONS 제품·기술 책임자 — **How your answers will be used:** 승인된 선택만 테스트·코드·ADR·GitHub 이슈 완료조건에 반영합니다. 답변 전에는 구현·Supabase 설정·Production 변경을 시작하지 않습니다.

## Context

2026-08-11 기준 열린 이슈는 13개였습니다. 정책 초안은 NAVER·스마트스토어의 문서 계층과 절차를 ICONS의 직접 판매자 역할에 맞춰 정리했습니다. 2026-08-12 이 확인서로 #66·#115는 current scope에서 제거했고, #134·#137·#188·#191의 로컬 구현 계약과 단계별 ownership을 승인했습니다. 공개 시행·외부 처리자·Production 변경은 별도 fail-closed gate입니다.

아래 답변을 반영해 다음 로컬 Candidate를 승인 설계로 승격합니다. default branch merge와 GitHub 동기화 전에는 live issue 진실원이 아니며, 구현·운영 gate가 남은 정책을 시행 중이라고 고지하지 않습니다.

- [#134 recovery callback 후보 설계](../superpowers/specs/2026-08-11-auth-recovery-candidate-design.md)
- [#188 만 14세 gate 후보 설계](../superpowers/specs/2026-08-11-minimum-age-gate-candidate-design.md)
- [#137 탈퇴·외부 이메일·로그 개인정보 후보 설계](../superpowers/specs/2026-08-11-account-deletion-email-log-privacy-candidate-design.md)
- [GitHub 이슈 본문 동기화 초안](../superpowers/plans/2026-08-11-open-issue-body-sync-draft.md)
- [열린 13개 이슈 종료 증거 계획](../superpowers/plans/2026-08-11-open-issue-closure-evidence.md)
- [#134·#137·#188·#191 TDD 구현 후보 계획](../superpowers/plans/2026-08-11-open-issue-implementation-candidate-plan.md)

## How to answer

**회신일:** `2026-08-12` · **결정 원칙:** KISS·데이터 최소화·권리 경로 유지·외부 사실 미발명·Production fail closed

각 질문에 `승인 / 수정 / 보류`와 담당자·목표일을 적어주세요. API 키·토큰·사용자 개인정보는 적지 마세요.

## 전체 목표의 범위

### “열린 이슈 전부 해결”에 V2 #66과 post-launch #115 구현도 지금 포함합니까?

현재 PRD 범위를 지키면 둘은 의도적 backlog라 이번 작업에서 닫을 수 없습니다.

> #66 — **현재 제품 범위에서 제외.** 별도 native-only 가치와 운영 주체가 생길 때 새 RFC로 다시 평가한다.
>
> #115 — **현재 제품 범위에서 제외.** 검증되지 않은 post-launch 묶음을 active backlog로 유지하지 않고, 실제 pilot 신호가 생기면 작은 tracer issue로 다시 만든다.
>
> backlog 유지 시 두 이슈를 open으로 둘지, 제품 결정으로 close할지: 승인된 정본 문서와 live issue body를 동기화한 뒤 두 이슈 모두 `wontfix`로 close한다. 기존 문서는 historical candidate로 남긴다.
>
> 결정자·결정일: 임시 제품·기술 책임자(Codex, 사용자 위임) · 2026-08-12

## #134 Auth recovery callback 계약

### recovery 전용 queryless callback 경로를 승인합니까?

권장안은 `/auth/recovery/callback`처럼 recovery 전용 경로를 두고 signup/OAuth의 `/auth/callback`과 분리하는 것입니다. URL query에 purpose·next를 싣지 않으면서 쿠키·PKCE verifier가 없는 실패도 route 자체로 recovery UX를 선택할 수 있습니다. 성공은 요청 브라우저의 PKCE verifier와 서명된 recovery state가 필요하므로 cross-browser 링크는 안전한 `browser_mismatch`로 재요청시킵니다.

> 권장안 승인 / 아래 대안 선택 / 수정: **권장안 승인.** queryless `/auth/recovery/callback`을 recovery 목적의 진실원으로 사용한다.
>
> cross-browser 성공이 필요할 때의 대안 `token_hash + type=recovery + verifyOtp` / 서명된 purpose URL: v1에서는 제공하지 않는다. cross-browser는 `browser_mismatch`로 재요청한다. 실제 필요성이 측정되면 `token_hash + type=recovery + verifyOtp`만 별도 보안 검토한다.
>
> 선택 이유·보안 trade-off: same-browser PKCE를 유지하면 링크 전달·로그·query 조작 표면이 작다. 편의보다 목적 혼동·session fixation 방지를 우선한다.
>
> 문서화할 ADR 또는 기존 문서 위치: `docs/superpowers/specs/2026-08-11-auth-recovery-candidate-design.md`를 승인 설계로 승격하고 `docs/ARCHITECTURE.md` Auth 절에 요약한다. 별도 ADR은 만들지 않는다.

### Supabase Redirect URL 변경과 Production smoke를 누가 승인·수행합니까?

> Local / Preview / Production에 등록할 정확한 callback URL: Local `http://localhost:3000/auth/recovery/callback`; Preview는 현재 배포의 `VERCEL_URL`에서 파생한 HTTPS origin의 동일 path만; Production `https://iconsip.com/auth/recovery/callback`. Preview wildcard는 실제 Supabase allowlist가 최소 범위인지 read-back한 경우에만 허용한다.
>
> Supabase 설정 담당자: 개발 agent가 version-controlled config와 검증 스크립트를 준비한다. 실제 원격 적용은 Production 변경 승인 범위에서만 수행한다.
>
> Production 변경 승인자·허용 시간: ICONS 최고관리자. 트래픽이 낮은 KST 10:00~12:00, rollback 담당이 같은 세션에 있을 때만 허용한다.
>
> 다른 브라우저·만료·중복 링크 smoke 담당자와 증거 위치: 개발 agent가 synthetic 계정으로 수행하고 비밀값·이메일 없는 결과를 PR 검증과 `docs/launch-readiness-plan.md`에 기록한다.

### #134의 TDD 공개 seam을 아래처럼 고정해도 됩니까?

제안 계약은 다음과 같습니다.

- `requestPasswordResetAction`: 유효 요청은 계정 존재 여부와 무관하게 현재의 generic 성공 문구를 반환하고 `resetPasswordForEmail(..., { redirectTo: '<approved-origin>/auth/recovery/callback' })`를 호출한다. 안전한 `next`만 서명·HttpOnly·SameSite=Lax·1시간 cookie로 recovery 경로에 저장한다. rate-limit·provider 장애는 현재 PII 없는 운영 오류만 반환한다.
- recovery callback `GET`: route 자체를 recovery purpose의 진실원으로 삼는다. 성공한 code exchange, 서명된 recovery state, pinned auth-js가 PKCE verifier에서 파생한 local recovery marker와 `getUser` 확인 뒤에만 `/update-password?session_ready=1&next=<safe>`로 보낸다. local marker는 provider-authenticated flow type이 아니다. marker가 없거나 다른데 exchange가 성공하면 sign-out하고 응답 session/recovery cookie를 만료한다. 다른 브라우저 PKCE 소실, 만료·중복, provider error, missing code는 `/login?mode=reset&reset_error=<allowlist-code>`로 보내며 임의 `next`·origin을 신뢰하지 않는다.
- 기존 `/auth/callback`: signup/OAuth 전용으로 유지하고 기존 onboarding·suspended·일반 auth-error 분기를 회귀 테스트한다. recovery 실패를 추측하지 않는다.
- 설정 검증: Local·Preview·Production Redirect URL allowlist에 recovery 경로가 있고 메일 template가 그 URL을 사용한다는 마스킹된 sync 결과와 controlled smoke를 남긴다.

> 위 계약 전체 승인 / 수정할 항목: **전체 승인.** `redirectType`은 provider assertion이 아니라 pinned SDK의 local marker라는 주석·contract test를 필수화한다.
>
> 공개 오류 code allowlist 수정: `missing_code|link_expired_or_used|browser_mismatch|session_not_found|recovery_unavailable|unknown_recovery_error`만 허용한다. provider code/message는 공개하지 않는다.
>
> cookie max-age·path 수정: 최대 3,600초, `HttpOnly`, `SameSite=Lax`, HTTPS `Secure`, `Path=/auth/recovery/callback`; terminal 응답에서 즉시 삭제한다.

## #137 탈퇴 공개 TDD seam과 #191 연동

### #137의 self-only preview·request·status 공개 계약을 승인합니까?

제안 계약은 다음과 같습니다.

- preview는 현재 인증 사용자를 서버에서 파생하고 blocker code·대상 수·승인된 해결 경로·UGC 잔존 예상·법정 보존 범주만 반환한다. 다른 회원 데이터, 원문 식별자, 자유서술 내부 오류는 반환하지 않는다.
- request는 브라우저가 user ID를 지정할 수 없는 self-only 경계이며 같은 사용자의 중복 신청을 멱등 처리한다. request와 withdrawal·`underage_rejected` 발송 fence는 하나의 트랜잭션으로 기록한다.
- 공개 status는 `blocked|processing|retryable|completed`로 고정한다. 내부 `blocked_active_obligation`은 `blocked`, `requested|purging`은 `processing`, `retryable_failure`는 `retryable`로 매핑하고, 모든 외부 purge barrier가 ack된 뒤에만 `completed`를 반환한다.
- Auth hard delete 전에는 현재 인증 사용자로 조회하고, request 성공 때만 발급한 256-bit opaque token을 `Secure`·`HttpOnly`·`SameSite=Strict`·상태 경로 전용 cookie에 둔다. DB에는 domain-separated HMAC·key version·만료만 저장하며 URL·HTML·로그에는 token을 넣지 않는다. Auth 삭제 뒤에는 이 cookie로 해당 request의 coarse status만 조회한다.
- 일반 withdrawal은 신청 직후 발송·보호 mutation을 fence하되 blocker 해결 중에는 권리 경로 session을 유지합니다. 외부 `purge_committed` ack 뒤 `purging`에 들어갈 때 global sign-out·refresh session revoke를 시도하고, 그 전이를 반환하는 응답과 이후 인증·상태 응답이 남은 Auth·앱 cookie를 반복 만료합니다. login action·Auth callback·`proxy.ts`도 새 token이 발급된 purging/completed 계정의 앱 session을 거부합니다. 비동기 worker가 브라우저 cookie를 직접 지운다고 가정하지 않습니다. `underage_rejected`는 durable request·fence ack 직후 같은 종료를 즉시 수행하되 외부 purge ack 전에는 완료로 표시하지 않습니다.

> 위 공개 계약 전체 승인 / 수정할 항목: **전체 승인.** 신청·status·worker의 공개 경계를 분리하고 내부 원장·자유서술은 노출하지 않는다.
>
> preview field·blocker code·해결 경로 allowlist 수정: `active_order|active_cancellation|active_refund|active_ticket|active_ticket_cancellation|staff_handover|required_legal_hold_review`와 대상 수만 허용한다. 주문 취소와 티켓 취소는 해결 화면이 다르므로 같은 code로 합치지 않는다. 해결 경로는 `/orders`, `/tickets`, `/settings`, `/legal/rights-protection`의 서버 allowlist만 사용한다.
>
> 공개 status code·내부 상태 매핑·다음 행동 수정: 제안 `blocked|processing|retryable|completed` 그대로 승인. 다음 행동은 allowlisted route 또는 `retry_later|contact_support|none`만 반환한다.
>
> 신청 확인 문구와 중복 신청 결과 수정: “탈퇴 처리를 시작했어요. 진행 중 거래가 있으면 먼저 해결 방법을 안내하고, 법정 보존 대상 외 정보는 순서대로 삭제해요.” 동일 request 재호출은 새 event를 만들지 않고 같은 coarse status를 반환한다.
>
> 일반 withdrawal / `underage_rejected` session·cookie 시점 수정: 제안 시점 그대로 승인. blocker 해결 권리는 유지하되 `purging` 또는 `underage_rejected` durable ack 뒤 앱 session을 거부하고 현재·후속 응답에서 cookie를 반복 만료한다.

### Auth hard delete 뒤 상태 조회 token과 TTL을 승인합니까?

권장 TTL은 terminal 상태가 된 뒤 7일과 request 생성 뒤 절대 90일 중 빠른 시각입니다. 만료 뒤에는 비로그인 개인정보·지원 경로로 안내하며 token을 재발급하거나 URL로 전달하지 않습니다. 이 cookie는 post-Auth bearer이므로 유효 token 자체가 탈취되면 coarse status는 노출될 수 있으며, 응답을 PII·내부 단계 없는 최소 상태로 제한하는 위험 수용 여부도 함께 승인합니다.

> opaque status cookie 계약 승인 / 수정: 승인. 원문 token은 한 번만 발급하고 DB·로그·URL에 저장하지 않는다.
>
> terminal 뒤 TTL / 절대 상한 수정: terminal+7일과 request+90일 중 빠른 시각. 법정 보존기간과 무관하며 연장·재발급하지 않는다.
>
> 만료 뒤 비로그인 지원 owner·연락 경로: `/legal/rights-protection`의 비로그인 최소정보 web form. 실제 공개 contact가 검증되기 전에는 이메일 주소를 만들어내지 않는다.
>
> token key rotation·rate limit·보안 검토 담당자: 90일 key version rotation, 이전 키는 해당 token 최장 TTL까지만 유지. IP당 시간당 10회·request당 일 30회, 반복 실패 시 지수 backoff. 개발 agent가 보안 회귀 테스트를 소유한다.

### #137/#191의 세 단계 ownership을 승인합니까?

권장 순서는 순환 의존성을 만들지 않는 `#137 1단계 → #191 → #137 2단계`입니다.

- #137 1단계: 공개 preview·request·status, private deletion request 원장, obligation·법정 snapshot, request/fence 원자 기록, 삭제 worker·provider fence 소비 seam.
- #191: Supabase Send Email Hook, 거래메일 공통 fence 소비, durable outbound intent·dispatcher, provider event reconciliation·locator/purge 연결, Production 설정·smoke.
- #137 2단계: #191 terminal/fence ack를 소비하는 Storage·DB·Auth cleanup, 외부 purge barrier, restore replay와 `completed` 전이.

> 위 단계·소유권 전체 승인 / 수정: **전체 승인.** 순환 dependency를 금지하고 공개 seam으로만 연결한다.
>
> #137 1단계 완료 증거·handoff owner·목표일: 개발 agent. self-only preview/request/status, private ACL, request/fence 원자성의 RED→GREEN과 로컬 DB reset이 통과하면 handoff한다. 일정 대신 이 evidence gate를 목표로 한다.
>
> #191 완료 증거·handoff owner·목표일: 개발 agent. Hook·dispatcher·durable outbound·redaction을 로컬/Preview까지 구현하되 provider 계약·Production 설정 증거 전에는 활성화하지 않는다.
>
> #137 2단계 완료 증거·owner·목표일: 개발 agent. 승인된 외부 ledger drill, Storage/DB/Auth residue 0, restore replay, `purge_completed` barrier가 모두 통과한 뒤 완료한다.

### 복원 독립 삭제 증거 ADR과 별도 인프라 issue를 승인합니까?

같은 Supabase 프로젝트의 mirror는 탈퇴 전 snapshot 복원 때 함께 사라지므로 authoritative 증거가 아닙니다. 이 질문의 답변으로 restore-resilient 증거 필요성과 GCP append service + read-only verifier 경계를 선택했고, 후속 2026-08-12 내부 검토에 기록했습니다. 실제 GCP project·billing·region·IAM과 Production ledger는 아직 생성·활성화하지 않습니다. core event도 내부 ID로 연결 가능할 수 있으므로 익명정보로 단정하지 않습니다.

> restore-resilient 증거 ADR 승인 / 수정 / 요구 폐기와 대체 통제: **필요성·interface 승인.** 같은 Supabase backup domain의 table은 대체 불가다.
>
> 별도 GCS 인프라 issue / AWS S3 Object Lock compliance issue / 동등 WORM issue와 owner·목표일: GCP 기반 별도 인프라 issue를 만든다. 개발 agent가 설계·IaC·drill을 소유하되 실제 GCP project/billing 생성은 Production 승인 뒤 수행한다.
>
> retention-class bucket / GCP append service+verifier 선택, core·sensitive retention class와 lock 전 test-bucket drill: **GCP append service + 별도 read-only verifier**를 선택한다. Vercel에서 bucket에 직접 접근하지 않는다. core·sensitive TTL은 각 `purge_committed_at`보다 앞선 상태를 복원할 수 있는 catalog artifact 전부의 `max(expires_at)`에 최대 replay 지연과 7일을 더해 계산하며 45일로 자르지 않는다. 계산값이 45일을 넘으면 Production activation을 실패시키고 해당 backup·export·clone의 복원 가능성을 먼저 영구 폐기·검증한 뒤 재계산한다. 미등록·expiry 미상 artifact와 catalog 변경은 fail closed하고 기존 TTL을 단축하지 않으며 catalog 완성 전에는 retention lock이나 Production ledger를 활성화하지 않는다.
>
> retention-bucket의 Vercel object-create-only principal / append-service 구조의 Vercel service-invoke-only principal, append service, read-only verifier, restore/decrypt, expiry purger, legal-hold operator, key destroy, lien break-glass의 분리 owner: Vercel에는 exact-production invoke-only principal만 준다. append service는 caller별 event-type·선행 ack·상태전이를 검증하고 앱 writer의 `purge_completed|legal_hold_released|key destroy`를 거부한다. append·verify·restore/decrypt·purger·legal-hold·key destroy·break-glass는 서로 다른 service account와 감사 로그로 분리한다. 회사가 단독 운영이어도 credential과 실행 경계는 합치지 않는다.
>
> external `legal_hold_set|released`, temporary hold·linkage/key purge 정지와 metageneration 조건: 승인. hold set·release 각각 서로 독립된 2인 승인, 사건 ID·근거·`review_at`을 요구하고 제2 승인자가 없으면 신규 hold·release를 fail closed한다. 명시적 release 전 자동 해제하지 않으며 object metadata 변경은 generation/metageneration precondition을 사용한다.
>
> daily/PITR·logical export·clone·DR 전체 snapshot catalog, snapshot별 durable ledger watermark와 linkage가 파기된 restore 거부: 승인. catalog에 없는 backup/clone은 금지한다. 복원 중 모든 writer·job·queue·hook·webhook·callback·provider egress를 격리하고 stable event key로 lossless replay한 뒤 잔여 0건·checkpoint ack를 확인하며 public traffic은 마지막에 연다.
>
> bucket 생성 전 soft delete 0·Object Versioning off read-back, 기존 generation 잔여와 provider-side 삭제 기간 고지: 승인. test project와 매 배포에서 read-back·drift alert하고 모든 recoverable generation을 catalog·TTL·hold·파기 검증에 포함한다. provider 내부 잔여기간은 개인정보처리방침에 실제 계약값으로 고지한다.
>
> Vercel team issuer·정확한 `aud`·`owner_id`·`project_id`·`environment='production'`·exact `sub` WIF 조건과 Preview·Development 거부: 필수. wildcard subject·환경 공용 principal은 금지한다.
>
> Seoul region이 모든 처리 위치의 국내 한정을 뜻하지 않는다는 전제의 DPA·subprocessor·국외이전 승인: 국내 한정으로 단정하지 않는다. 실제 DPA·subprocessor·지원/로그 처리 위치와 국외이전 고지를 승인하기 전에는 Production ledger를 활성화하지 않는다.

### #191 Send Email Hook의 2단계 전환과 SMTP 호환 canary를 승인합니까?

권장 순서는 `Hook route·durable dispatcher 배포 → 서명/health probe → 별도 변경 창에서 Hook 활성화·read-back → 가입확인·재발송·recovery·email-change controlled 수신`입니다. 공식 계약상 Hook 활성화 시 Auth 메일은 Hook 경로를 사용하지만, 공개된 rate-limit/custom SMTP 상호작용이 Production에서 해소됐음을 확인하기 전에는 기존 SMTP 설정을 즉시 제거하지 않습니다. 불변식은 Hook fail-closed와 direct SMTP 발송 0건입니다.

> 2단계 rollout 승인 / 수정: **승인.** route/dispatcher가 배포·검증되기 전에 Auth 설정을 바꾸지 않는다.
>
> route health·서명 probe owner와 통과 증거: 개발 agent. 위조 서명·timeout·fence 조회 실패가 모두 fail closed하는 CI/Preview 증거를 남긴다.
>
> Hook 활성화·설정 read-back 승인자와 변경 창: ICONS 최고관리자, KST 10:00~12:00. Production 변경은 별도 명시 승인 뒤에만 수행한다.
>
> 네 가지 Auth 메일 controlled canary 담당자: 개발 agent가 synthetic 계정으로 가입확인·재발송·recovery·email-change를 수행하고 provider message ID는 마스킹해 기록한다.
>
> custom SMTP 설정 제거 조건·담당자 또는 호환 설정 유지 기간: 네 흐름에서 Hook 처리 1회·direct SMTP 0건과 rate-limit 정상 동작을 연속 2회 확인한 뒤 제거한다. 확인 전에는 호환 설정을 유지하되 Hook fail-closed를 불변식으로 둔다.
>
> `REQUIRE_SEND_EMAIL_HOOK` 검증 도입과 기존 `REQUIRE_SMTP` 제거 시점: 코드/CI에는 즉시 전자를 추가한다. 후자는 위 canary와 설정 read-back 뒤 별도 변경으로 제거한다.

## #188 만 14세 gate

### v1을 만 14세 이상으로 제한하고 법정대리인 동의 예외를 제공하지 않는 안을 승인합니까?

로컬 Draft의 권장안은 `Asia/Seoul` 달력일 기준 14번째 생일부터 허용하고 생년월일 자가신고를 사용합니다. 법무 확인은 별도 [`policy-legal-review.md`](./policy-legal-review.md)에서 받습니다.

> 제품안 승인 / 수정: **승인.** KST 달력일 기준 만 14세 이상만 가입·새 보호 액션을 허용한다.
>
> 법정대리인 동의 예외 제공 여부: v1에는 제공하지 않는다. 확인 인프라 없이 보호자 동의를 흉내 내지 않는다.
>
> 생년월일 자가신고 외 추가 검증 여부·시점: 자가신고는 candidate eligibility만 판정하며 실제 연령확인 완료라고 표현하지 않는다. 공개 탐색·권리행사 외 보호 액션은 provider-neutral `verified_14_plus` assertion이 있어야 연다. assertion은 제3자 본인확인 사업자가 반환한 14세 이상 여부·transaction ref·시각만 저장하고 원 DOB·CI·신분증 원본은 받지 않는다. provider 계약·DPA·최소수집이 확정되지 않으면 보호 액션은 fail closed한다.
>
> 제품 승인자·법무 회신 목표일: 임시 제품·개인정보 책임자(Codex, 사용자 위임) · 2026-08-12. 외부 법률의견이 나중에 달라지면 더 엄격한 기준을 우선 적용한다.

### 2월 29일생의 평년 연령 경계를 승인합니까?

후보안은 윤년에는 2월 29일, 평년에는 3월 1일부터 나이가 증가하는 것으로 판정합니다. 제품 선택과 별개로 대한민국 변호사의 확정이 필요합니다.

> 후보 경계 승인 / 다른 평년 기준일로 수정 / 보류: **평년 3월 1일부터 허용**으로 승인한다. 경계 불확실성에서 하루 늦게 여는 보수적 제품 기준이다.
>
> 법무 확정자·근거 문서·회신 목표일: 외부 법무 담당자는 없다. 대한민국 민법상 기간 계산과 개인정보보호법 기준을 재검토하되, 더 이른 허용이 명백히 확인되기 전에는 3월 1일 기준을 유지한다.

### 신규 거절과 기존 미성년 계정의 권리 경계를 승인합니까?

권장안은 신규 미성년 판정 시 보호 액션·마케팅을 막고 `underage_rejected` durable 삭제 요청을 먼저 만든 뒤 #137 worker로 파기하는 것입니다. 기존 미성년 계정은 `age_restricted`, 미래·malformed·완료 상태 불일치 legacy는 `review_required`로 분리합니다. 둘 다 새 보호 액션만 막고 주문·티켓 조회, 취소·환불, 로그인·recovery, 탈퇴·개인정보 권리행사·지원은 유지하며 기존 계정을 자동 삭제하지 않습니다.

> 신규 거절·durable 파기 승인 / 수정: 승인. 최소 request/fence가 durable ack되지 않으면 성공·삭제 완료로 표시하지 않는다.
>
> 기존 계정의 권리·차단 매트릭스 승인 / 수정: 제안 그대로 승인. 새 보호 mutation만 막고 주문·티켓·취소·환불·본인 작성물 삭제·신고·차단·탈퇴·개인정보 권리 경로를 유지한다.
>
> 기존 계정 PII 없는 건수·범주 audit 승인자: 개발 agent가 dry-run 보고서를 만들고 ICONS 최고관리자가 Production 적용 전 승인한다. 채팅·PR에는 집계만 남긴다.
>
> 이용자·보호자 고지 담당자·시행일: `/account/age-restricted`와 인앱 알림으로 고지한다. 실제 activation migration과 약관 시행일을 같은 release로 묶고 선고지는 30일을 기본으로 한다.

### 다섯 연령 상태와 age-out 재동의·backfill을 승인합니까?

후보 상태는 `unverified|eligible|age_restricted|underage_rejected|review_required`입니다. `eligible`은 현재 문서 version·동의시각·source가 있는 immutable consent receipt, DB KST 14세 이상 판정, provider-neutral `verified_14_plus` assertion을 모두 확인한 상태입니다. 현재 schema의 `consents` boolean이나 생년월일 자가신고만 있는 기존 완료 계정을 최신 동의·연령확인 완료로 소급 승격하지 않고, 증명 가능한 receipt 또는 assertion이 없으면 `review_required`로 두어 현재 필수 약관 재동의와 실제 연령확인을 받습니다. `age_restricted`도 14세가 된 사실만으로 자동 해제하지 않고 재동의·`verified_14_plus`·purpose RPC의 DB KST 재판정 뒤에만 `eligible`로 전환합니다. `review_required`는 자동 age-out·자동 삭제하지 않고 최소정보 수동 검토를 거칩니다. 기존 계정 backfill 전에는 상태별 계정·거래·UGC·legal hold·staff/admin·receipt·assurance 교차 수를 PII 없이 dry-run합니다.

> 다섯 상태와 상태별 권리 matrix 승인 / 수정: **승인.** 상태를 boolean이나 `onboarded_at`에 합치지 않는다.
>
> age-out 필수 재동의·마케팅 false 유지 승인 / 수정: 승인. 현재 필수 terms/privacy receipt를 새로 만들고 marketing은 명시적 opt-in 전까지 false다.
>
> `review_required` 수동 검토 owner·해제 기준: ICONS 최고관리자 역할만 purpose RPC로 처리한다. 유효한 DOB provenance와 현재 문서 재동의가 확인되면 `reconsent_allowed`; 불명확하면 제한 유지. 원본 신분증은 받지 않는다.
>
> backfill dry-run·exact count 승인자와 staff/admin abort 기준: 집계가 예상 schema와 다르거나, 미성년/불명확 staff·admin 1건 이상, active 거래·티켓·legal hold가 있는 제한 대상 1건 이상이면 자동 migration을 중단한다.
>
> Onboarding 교체 문구: “ICONS는 만 14세 이상만 이용할 수 있어요. 입력한 생년월일로 1차 판정하고, 보호 기능을 시작하기 전 최소한의 연령확인을 진행해요. 결제 인증은 연령이나 법정대리인 동의 확인 수단이 아니에요.”로 승인한다.

### 신규 미성년 거절 직후 session 종료와 recovery fence를 승인합니까?

후보안은 durable request·발송 fence ack 직후 global sign-out을 시도하고 현재 응답의 Auth·앱 cookie를 만료합니다. DB fence는 이미 발급된 JWT의 앱·DB 보호 mutation만 거부하며 Supabase Auth token 발급 자체를 중단하지 못합니다. 따라서 login action·Auth callback·`proxy.ts`·보호 Server 경계가 fence를 재확인해 cookie를 반복 만료하고, Send Email Hook은 recovery 메일을 억제하며 최종 hard delete가 Auth 발급 가능성을 제거합니다. 외부 purge가 끝나기 전에는 삭제 완료로 표시하지 않습니다.

> 즉시 global sign-out·현재 cookie 만료 승인 / 수정: 승인. durable request/fence ack가 선행한다.
>
> remote sign-out 실패 시 공개 result·retry 상태 수정: `underage_restriction_processing`만 반환하고 보호 mutation은 계속 fail closed한다. 내부 오류·존재 여부는 노출하지 않는다.
>
> Auth recovery·재로그인 fence 유지 범위·해제 조건 수정: login action·callback·proxy·Server Action·Send Email Hook 전체에 적용한다. `eligible` 재동의 전이 또는 Auth hard delete 완료 전에는 해제하지 않는다.

### staff/admin에도 연령 예외를 두지 않는 안을 승인합니까?

후보안은 역할만으로 연령 예외를 주지 않고 기존 미성년 staff/admin의 검표 같은 운영 mutation도 차단하여 승인된 성인 담당자에게 인수인계합니다.

> staff/admin 무예외 승인 / 예외가 필요하면 역할·action·법적 근거: **무예외 승인.** 역할은 연령·동의 요건의 대체가 아니다.
>
> 기존 미성년 staff/admin audit·업무 인수인계 담당자·목표일: dry-run에서 1건이라도 나오면 activation을 중단하고 ICONS 최고관리자에게 업무를 이전한 뒤 해당 계정을 제한한다.

### #188의 TDD 공개 seam을 아래처럼 고정해도 됩니까?

제안 계약은 다음과 같습니다.

- KST classifier: 유효한 달력 생년월일과 `Asia/Seoul` 오늘을 받아 14번째 생일 당일부터 `adult_candidate`, 그 전은 `underage`; 미래·불가능 날짜는 `invalid`다. `eligible`은 별도 consent receipt와 `verified_14_plus`까지 확인한 최종 권한 상태이며 UTC 시각·서버 locale에 따라 결과가 바뀌지 않는다.
- 프로필 판정: `isOnboarded()`는 프로필 완성·기존 읽기 권리만 뜻한다. 별도 `canStartProtectedAction()`은 complete + 미정지 + 미탈퇴 + `age_gate_status='eligible'`일 때만 true다. `unverified|age_restricted|underage_rejected|review_required`를 서로 다른 공개·운영 상태로 유지한다.
- 온보딩 Server Action: 성인은 purpose RPC가 닉네임·생년월일·필수동의·추천 팔로우·`onboarded_at`을 원자 반영하고 safe `next`로 redirect한다. 미성년은 닉네임·팔로우·동의·`onboarded_at`을 쓰지 않고, `reason='underage_rejected'` durable 삭제 request ack 뒤 `{ status: 'underage_rejected', next: '/account/underage-rejection' }`를 반환한다. request 기록 실패는 보호 액션을 fail closed하고 성공으로 표시하지 않는다.
- SQL 경계: client가 user ID·현재 날짜·eligible 여부를 보내지 않는다. RPC가 `auth.uid()`와 DB의 KST 날짜로 self profile을 lock해 판정한다. protected-action guard는 새 구매·예매·작성·팔로우·좋아요·알림 마케팅·게임·카드팩만 거부한다. 별도 age-out purpose RPC는 14세 도달과 현재 필수 재동의를 원자 확인한다.
- deletion processor: stable event로 idempotent 재시도하고 Storage owner/path 0건과 Auth hard-delete ack 뒤에만 완료한다. 예상하지 못한 주문·티켓·UGC·legal hold가 있으면 삭제하지 않고 rights-review로 상향한다.
- 회귀 matrix: 기존 주문·티켓 조회, 취소·환불, 본인 작성물 삭제, 신고·차단, 로그인·recovery, 탈퇴·개인정보 권리행사·비로그인 지원은 `age_restricted|review_required`에서도 해당 권한 범위에서 열린다. 기존 계정 backfill은 `underage_rejected`나 자동 삭제를 만들지 않는다.

> 위 계약 전체 승인 / 수정할 항목: **전체 승인.** classifier·purpose RPC·guard·rights matrix를 각각 공개 seam으로 테스트한다.
>
> Server Action 공개 result code·거절 상태 경로 수정: `eligible_redirect|underage_rejected|review_required|retryable_restriction_error`; 거절 경로 `/account/underage-rejection`, 기존 제한 경로 `/account/age-restricted`.
>
> 보호 액션 / 권리 경로 matrix 수정: 제안 그대로. `follow=false`, `like=false`, marketing opt-out, 본인 작성물 삭제, report/block는 권리·안전 경로로 열어둔다.

## 로그 개인정보 보호 TDD seam

### 원문 주문 ID·`paymentKey`·provider 오류 제거를 아래 공개 경계에서 테스트해도 됩니까?

이 승인은 테스트할 public behavior를 고정할 뿐 Production 변경 승인이 아닙니다.

> `sendTransactionalEmail` — `order_ref=HMAC(..., orders.id)`, `email_ref=HMAC(..., outbound_id)`와 allowlist 오류만 반환·기록: 승인.
>
> `sendOrderConfirmationEmail` / `sendOrderShippedEmail` — 호출부 중복 로그와 원문 식별자 없음: 승인.
>
> admin 배송·재발송 Server Actions — PII 없는 결과·감사 계약: 승인. UI에는 공개 주문 reference만 표시하고 runtime log에는 HMAC ref만 남긴다.
>
> Toss webhook `POST` — 원문 `paymentKey`·주문 UUID·provider body 로그 없음: 승인.
>
> payment-confirm `POST` — 같은 redaction·correlation 계약: 승인.
>
> Toss provider adapter — raw 오류를 allowlist code로 정규화: 승인. `provider_timeout|provider_rejected|provider_unavailable|invalid_provider_response|unknown_provider_error`만 상위로 전달한다.
>
> 수정할 반환값·관측 가능성 요구: 사용자 응답은 기존 기능 결과를 유지하되 correlation ref를 노출하지 않는다. 운영 지표는 code·횟수·latency만 집계한다.

## #66 Expo WebView V2

### #66을 지금 구현한다면 앱 셸의 진실원과 출시 범위를 무엇으로 정합니까?

> 앱 셸 repo·경로 또는 새 package 위치: **미지정 — 현재 구현하지 않음.** 기존 web repo에 임시 native package를 만들지 않는다.
>
> Expo SDK·React Native 기준 버전: 미지정. 재개 시 공식 지원 최신 stable을 별도 RFC에서 검증한다.
>
> iOS / Android / 둘 다: 미지정. 동시 출시를 가정하지 않는다.
>
> bundle identifier·application ID 담당자: 없음. 값을 만들어내지 않는다.
>
> 배포·서명·스토어 계정 담당자: 없음. native 재개 조건이 충족될 때 지정한다.

### WebView가 로드할 첫파티 오리진과 bridge 권한을 확정해 주세요.

> Production 허용 origin: 재개 시에도 `https://iconsip.com` exact origin만 후보이며 현재 승인값은 아니다.
>
> Preview·local 허용 origin과 build별 분리 방법: production binary에는 포함하지 않는다. 별도 dev build의 compile-time exact allowlist만 허용한다.
>
> 불변: Supabase refresh token은 WebView·웹 게임 JS에 주입하지 않음 — 승인 / 수정 필요 시 보안 근거: **불변 승인.**
>
> 권장 credential: origin·audience-bound, single-use, 짧은 TTL의 bridge token은 first-party BFF만 소비하고 WebView에는 Supabase session을 반환하지 않으며 허용 RPC만 대행 / BFF가 불가할 때만 짧은 access JWT 직접 주입 예외 승인: BFF 방식만 기본으로 승인. access JWT 직접 주입은 새 보안 승인 없이는 금지한다.
>
> origin-bound nonce handshake, message source·schema·sequence 검증: 재개 시 필수. nonce single-use·5분 이하·strict source window·versioned schema·monotonic sequence를 요구한다.
>
> access token 만료 전 rotation·replay 방지·logout/revoke 동작: WebView에는 access session 자체를 주지 않는다. bridge capability는 1회 사용 후 폐기하고 logout/revoke 즉시 서버 denylist/fence를 적용한다.
>
> RN 원본 session의 iOS Keychain·Android Keystore/SecureStore 보관과 native debug log·backup 제외: 재개 시 필수.
>
> logout·계정 정지·탈퇴 시 native session과 WebView cookie/localStorage/sessionStorage/cache 양쪽 zeroization·검증: 재개 시 필수 E2E acceptance다.
>
> WebView screenshot·runtime log에서 credential 제거 기준: credential·nonce·사용자 ID·결제키 0건을 자동 scan한다.
>
> bridge protocol version과 허용 method 전체(`getSession` 또는 BFF 대체, `playGame`, `getRaffleResult`, `startPrizeCheckout`, `haptics`, `share`, `close`, `track`)의 request/result schema·unknown method 거부·`track` event allowlist와 PII 금지: `getSession`은 삭제하고 BFF capability request로 대체한다. 나머지는 method별 capability/resource/user binding, JSON schema, unknown reject, `track` allowlist·PII 금지를 요구한다.
>
> navigation·download·새 창·외부 링크 차단 규칙: exact first-party HTTPS origin 외 top-level navigation, download, popup, `file:`, custom scheme를 차단하고 외부 링크는 native allowlisted browser로만 연다.

### Apple App Store 4.7 검토를 누가 언제 수행합니까?

> 심사 정책 검토 담당자: 현재 없음. 그래서 구현·스토어 제출을 하지 않는다.
>
> 첫파티 미니게임 목록·연령 장치 승인 기준: 웹에서 운영 증거가 있는 게임만, 14+ gate·확률/경품 법무 gate·원격 kill switch가 모두 있어야 후보가 된다.
>
> 네이티브 API 노출·원격 콘텐츠 변경 절차: protocol version review·signed allowlist·rollback·App Review 영향 검토를 새 RFC에서 승인한다.
>
> 구현 착수 승인일 / V2 유지 재검토일: **착수하지 않음.** 재검토 trigger는 월간 활성 사용자 5,000명 이상을 3개월 유지하고 native-only 핵심 use case 2개가 검증된 때다.

## #115 post-launch epic

### 지금 착수한다면 어떤 tracer bullet부터 분리합니까?

이 epic의 온라인 팝업 운영층에는 2주 단위 IP 교체, 등급·도장깨기를 포함한 참여 루프가 들어갑니다. Expo native 앱 셸과 WebView bridge는 #66 V2의 별도 범위이며 #115에 포함하지 않습니다.

홍실 팝업 연동 판매 C방식은 현재 event·card·card_pool·game 데이터가 모두 0건이고 draft PR #167이 아직 선행 조건을 충족하지 않았습니다. #167의 schema·seed 진실원이 승인·merge되고 실제 운영 데이터가 준비되기 전에는 C방식 tracer를 착수 완료로 판단하지 않습니다.

> `popups` 운영 단위·랜딩·아카이브: 현재 착수하지 않는다.
>
> 2주 단위 IP 교체와 운영 캘린더: 실제 운영 owner가 생길 때까지 채택하지 않는다.
>
> 미션·진행도·비현금 포인트·등급·도장깨기: 실사용 신호 전에는 구현하지 않는다.
>
> 무과금 응모·commit-reveal 래플·정가 결제: 별도 경품·게임·결제 법무 검토 전 금지한다.
>
> 게임 goods variant의 `getRaffleResult` / `startPrizeCheckout` 실배선: 미승인·미구현으로 유지한다.
>
> 카드 프로필·좋아요·랭킹: 현재 v1 기능만 유지하고 확장하지 않는다.
>
> 브랜드 집계 리포트: 목적·계약·최소셀·재식별 방지 승인이 없으므로 제공하지 않는다.
>
> 알림 이메일·푸시 확장과 야간 발송 동의 gate: #191 거래·Auth 메일 안정화 전 확장하지 않는다.
>
> 검색·구매한도·예매 오픈·대기열·배지 보강: 독립적인 실제 수요 issue가 생길 때 하나씩 평가한다.
>
> Expo native 앱 셸·WebView bridge는 #66로 제외 — 승인 / 수정: 승인. #66도 현재 범위에서 제외한다.
>
> 홍실 팝업 연동 판매(C방식) — 현재 4개 운영 데이터 0건과 draft PR #167 선행 확인, schema·seed 승인자·merge 조건·데이터 입력 owner: 착수하지 않고 draft PR #167을 제품 진실원으로 사용하지 않는다.
>
> 주문→출고 지시→운송장→배송 상태 물류 API 자동화: 실제 WMS API 계약 전 금지한다. manual-first도 공개 판매 승인 전에는 실행하지 않는다.
>
> ADR-0005 할당 재고→WMS 실시간 공유재고 전환: 실제 WMS 통합 계약 전에는 할당재고 모델을 유지한다.
>
> 우선순위·의존성·첫 acceptance test: 현재 우선순위 없음. future 첫 tracer는 운영 owner가 등록한 단일 popup의 공개 랜딩→종료 아카이브이며 결제·래플은 제외한다.
>
> 첫 pilot IP·팝업·운영 owner·목표일: 미지정. 데이터를 만들어내지 않는다.
>
> 래플·경품·카드 리워드·야간 알림 법무 승인 gate: 독립 법무 결정 없이는 모두 비활성이다.
>
> 브랜드 리포트 목적·필드·집계 최소셀·재식별 방지·IP사 제공 범위·보존기간·위탁의 개인정보 승인: 현재 승인하지 않는다.

### post-launch로 유지한다면 재검토 조건을 정해 주세요.

> v1 출시를 판단할 증거: web-only v1의 보안·권리 경로·정책 시행과 공개 읽기 흐름이 안정적으로 운영되고, post-launch 기능 없이도 핵심 사용성이 검증되는 것.
>
> 착수 trigger·목표 분기: 활성 IP partner 1곳, 지정 운영 owner, 90일 pilot budget, 예상 MAU 5,000 또는 사전등록 1,000 중 하나가 실제 증거로 생길 때 새 RFC를 연다. 목표 분기는 미지정이다.
>
> 이슈 분해 책임자: 재개 시 제품 owner와 개발 agent. 현재는 분해하지 않는다.
>
> #115를 index로 계속 open 유지 / 제품 결정으로 close: **제품 결정으로 close.** 검증되지 않은 거대 epic을 무기한 open으로 유지하지 않는다.
>
> close할 경우 PRD·ARCHITECTURE·ADR-0002~0005·`docs/online-popup/`·launch plan의 canonical 상태와 superseded 표기를 누가 정리할지: 개발 agent가 정본에서 active commitment를 제거하고 `docs/online-popup/`은 historical research/candidate banner를 유지한다. ADR의 현재 v1 불변식은 보존한다.

## Anything else?

### 위 결정에 영향을 주는 추가 제약이나 담당자가 있습니까?

> 추가 제약: 사업자등록·공개 연락처·실재고·WMS·라이브 결제키·provider 계약처럼 외부에서 확인해야 하는 사실은 임시 책임자 판단으로 생성하지 않는다. 해당 증거가 없으면 판매·메일·커뮤니티 법정 시행·Production 변경은 비활성 상태를 유지한다.

# 비밀번호 재설정 전용 callback 후보 설계 (#134)

> 상태: Approved for local TDD · Production 설정 별도 승인 · GitHub 미게시 · 작성 2026-08-11 · 승인 2026-08-12

## Problem Statement

구현 전에는 비밀번호 재설정과 회원가입·OAuth가 queryless `/auth/callback`을 함께 사용했다. 다른 브라우저에서 메일 링크를 열거나 PKCE verifier·목적 cookie가 사라지면 callback이 요청 목적을 복원하지 못하고 recovery 실패를 일반 로그인 실패나 onboarding 흐름으로 잘못 분류할 수 있었다. URL query에 `purpose`나 임의 `next`를 싣는 우회는 링크 전달·로그·referrer를 통해 상태를 노출하고 open redirect 경계를 넓힌다. 2026-08-12 로컬 구현은 전용 경로로 이 문제를 닫았고, 남은 것은 Preview/Production 설정 read-back·실메일 smoke와 legacy 유예 제거다.

Production Supabase Redirect URL과 메일 template도 현재 계약에 묶여 있으므로 코드만 바꾸면 완료되지 않는다. 계정 존재 여부를 노출하지 않는 요청 응답, 목적이 분명한 callback, 안전한 후속 경로, 설정 동기화와 실제 메일 smoke가 하나의 승인 단위여야 한다.

## Solution

비밀번호 재설정만 처리하는 queryless `/auth/recovery/callback`을 둔다. 경로 자체가 recovery 목적과 exchange 전 실패 UX의 진실원이다. 성공 교환에서는 pinned `@supabase/auth-js`가 PKCE verifier에 기록한 local recovery marker를 defense-in-depth로 확인하지만, 이를 provider가 인증한 flow type이라고 간주하지 않는다. 기존 `/auth/callback`은 회원가입·OAuth만 처리한다.

재설정 요청은 계정 존재 여부와 무관하게 같은 성공 결과를 반환한다. 허용된 same-origin 후속 경로만 짧은 수명의 서명된 HttpOnly cookie에 보관하고, callback은 code exchange와 현재 사용자 확인이 모두 성공한 때에만 비밀번호 변경 화면으로 보낸다. PKCE 소실·만료·중복 사용·provider 오류·code 누락은 cookie 유무와 무관하게 제한된 공개 오류 코드로 재설정 화면에 돌려보낸다.

Local·Preview·Production의 Redirect URL allowlist와 메일 template가 전용 callback을 사용한다는 마스킹된 설정 증거와 통제된 smoke가 있어야 이 이슈를 완료한다.

## User Stories

1. 계정 보유자로서 이메일 주소의 등록 여부가 외부에 드러나지 않는 동일한 재설정 요청 결과를 받는다.
2. 계정 보유자로서 요청한 브라우저와 다른 브라우저에서 링크를 열어도 recovery 전용 오류 화면으로 안전하게 복구할 수 있다.
3. 계정 보유자로서 유효한 링크를 열면 인증 세션이 확인된 뒤에만 비밀번호 변경 화면으로 이동한다.
4. 계정 보유자로서 만료되거나 이미 사용한 링크를 열면 원인을 과도하게 노출하지 않는 재요청 안내를 받는다.
5. 계정 보유자로서 공격자가 조작한 외부 `next`나 origin으로 이동하지 않는다.
6. 신규 회원 또는 OAuth 사용자로서 기존 회원가입·onboarding·정지 계정 분기가 recovery 변경 때문에 달라지지 않는다.
7. 운영자로서 Local·Preview·Production의 허용 callback과 메일 template가 같은 계약을 가리키는지 확인할 수 있다.
8. 운영자로서 재설정 실패를 이메일·code·token 원문 없이 제한된 오류 코드와 상관관계 식별자로 조사할 수 있다.
9. 보안 검토자로서 callback 목적이 URL query나 사라질 수 있는 브라우저 상태에 의존하지 않음을 검증할 수 있다.
10. 테스트 담당자로서 실제 메일의 다른 브라우저·만료·중복 사용 동작을 통제된 계정으로 재현할 수 있다.

## Implementation Decisions

- recovery 목적은 전용 queryless 경로로 표현한다. URL query의 `purpose`, 임의의 return URL, 클라이언트가 주장하는 flow type은 신뢰하지 않는다. 유효한 성공은 요청 브라우저의 PKCE verifier와 서명된 recovery state가 모두 필요하다.
- 재설정 요청의 공개 성공 결과는 계정 존재 여부와 무관하게 동일하다. rate limit이나 provider 장애도 이메일 존재 여부를 추론할 수 없는 운영 오류만 반환한다.
- 요청 시 provider에 전달하는 redirect는 승인된 현재 환경 origin의 recovery callback으로 고정한다.
- signup·OAuth와 충돌하지 않는 recovery 전용 cookie를 사용한다. 승인된 same-origin path와 발급시각만 서명해 HttpOnly·SameSite=Lax, HTTPS의 Secure, 최대 3,600초, recovery callback path scope로 보관한다. 유효한 값이 없으면 `/`를 사용한다.
- callback 성공 조건은 유효한 code exchange, 서명된 recovery state, pinned auth-js가 PKCE verifier에서 파생한 local `redirectType === 'recovery'` marker, 서버의 현재 사용자 확인이다. 이 marker는 provider assertion이 아니다. marker가 없거나 다른데 exchange가 성공하면 fail closed로 local sign-out하고 응답에 생성된 session cookie와 recovery cookie를 만료한 뒤 제한된 오류로 종료한다. 성공 결과는 `/update-password?session_ready=1&next=<safe>`다.
- recovery는 계정 정지·온보딩 여부를 추측하지 않고 비밀번호 변경까지만 허용한다. 이후 로그인에서 기존 정지·onboarding gate를 다시 적용한다.
- 다른 브라우저의 PKCE 소실, 만료·중복 링크, provider 오류, code 누락은 `/login?mode=reset&reset_error=<allowlist-code>`로 보낸다. 공개 오류 코드는 `missing_code`, `link_expired_or_used`, `browser_mismatch`, `session_not_found`, `recovery_unavailable`, `unknown_recovery_error`처럼 복구 행동만 구분한다. provider 원문 code·message는 URL·화면·로그에 복사하지 않는다.
- callback은 cookie가 없어도 recovery 실패임을 안다. cookie 부재를 일반 auth callback으로 되돌리거나 onboarding을 추측하지 않는다.
- 성공·실패의 모든 terminal 응답은 recovery cookie를 제거하고 인증 응답 cookie와 `no-store` header를 보존한다.
- 기존 auth callback은 회원가입·OAuth 전용이다. onboarding 완료 여부, 정지 상태, 일반 auth 오류의 기존 우선순위를 보존한다.
- rollout은 새 route·allowlist·template를 먼저 배포한 뒤 재설정 action을 전용 경로로 전환한다. 전환 전에 발급된 recovery 링크를 위해 기존 callback의 legacy recovery branch는 Production `mailer_otp_exp`와 승인된 안전 여유가 지난 뒤 제거한다.
- 로그·감사에는 이메일, code, token, provider body, 임의 `next`를 남기지 않는다. 오류 allowlist와 회전 가능한 HMAC 상관관계만 허용한다.
- Production 설정 변경은 별도 승인 대상이다. 코드 merge만으로 Redirect URL·메일 template·실제 발송이 맞다고 간주하지 않는다.

## Testing Decisions

- 재설정 요청의 공개 Server Action을 통합 테스트한다. 존재하는 이메일과 존재하지 않는 이메일의 공개 결과가 같고, provider redirect가 승인된 recovery 경로이며, 안전하지 않은 `next`가 저장되지 않아야 한다.
- recovery callback의 route 동작을 통합 테스트한다. 성공, code 누락, exchange 실패, 현재 사용자 확인 실패, provider 오류, cookie 없음, 안전하지 않은 cookie를 각각 검증한다.
- recovery 경로에서 PKCE-local marker가 없거나 signup·OAuth 값인데 exchange가 성공해도 비밀번호 변경 화면으로 가지 않고 생성된 세션과 cookie가 제거되는지 검증한다. mock의 임의 필드를 provider-authenticated flow type처럼 취급하지 않는다.
- 기존 auth callback 회귀 테스트는 signup, OAuth, 미온보딩, 완료 계정, 정지 계정, 일반 오류를 포함한다.
- cookie 속성은 HttpOnly, HTTPS의 Secure, SameSite=Lax, recovery path scope, 최대 3,600초와 terminal 제거를 외부 동작으로 검증한다.
- provider 오류 정규화는 만료·중복, PKCE 소실, 사용자 재검증 실패, 설정 장애, 미분류 오류가 각각 승인된 공개 코드로만 수렴하는지 검증한다.
- 로그 포착 테스트로 이메일·code·token·provider body·임의 return URL이 출력되지 않음을 확인한다.
- Supabase 설정 검증은 Local과 Preview에서 마스킹된 allowlist와 version-controlled recovery template의 read-back을 먼저 확인한다. Production은 승인된 창에서 통제 계정으로 같은 브라우저 성공, 다른 브라우저 `browser_mismatch`, 만료, 중복 사용을 smoke하고 증거 위치를 기록한다.
- 구현은 승인된 공개 seam부터 실패 테스트를 작성하는 TDD 순서를 따른다.

## Out of Scope

- 이메일 소유권 외의 추가 신원확인 수단 도입
- Supabase Auth provider 자체의 token·PKCE 동작 변경
- 로그인·회원가입·OAuth 화면의 전면 재설계
- Production Redirect URL, 메일 template 또는 비밀값의 무승인 변경
- 계정 탈퇴, 미성년 gate, 거래메일 발송 인프라 구현

## Further Notes

- 제품·보안 승인 입력: [`to-questionnaire-open-issue-decisions.md`](../../questionnaires/to-questionnaire-open-issue-decisions.md)
- 현재 인증 구조와 출시 gate: [`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`launch-readiness-plan.md`](../../launch-readiness-plan.md)
- GitHub 추적: [#134](https://github.com/icons-hq/icons-ip/issues/134)
- 근거: [Supabase Password-based Auth](https://supabase.com/docs/guides/auth/passwords), [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates). 설치된 `@supabase/auth-js` 2.108.2의 `redirectType`은 provider 응답이 아니라 local PKCE verifier suffix에서 파생되므로 SDK contract 감시 테스트를 둔다.
- 이 문서는 2026-08-12 내부 제품·보안 결정으로 local TDD가 승인된 구현 계약이다. 로컬 구현은 완료됐지만 GitHub 이슈 본문·default branch·Supabase 설정의 진실원은 아직 아니며, Preview read-back·실메일 smoke와 별도 Production 승인 전에는 #134를 닫지 않는다.

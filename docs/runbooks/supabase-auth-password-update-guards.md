# Supabase Auth 비밀번호 변경 가드 runbook

이 runbook은 access token만 가진 사람이 앱을 거치지 않고 GoTrue `PUT /auth/v1/user { password }`로
비밀번호를 바꾸는 경로를 운영 Auth 설정으로 닫는 절차를 다룬다. 앱 경계(`/update-password`의 복구
증명 쿠키와 SNS 전용 계정 차단)는 [#604](https://github.com/icons-hq/icons-ip/pull/604)가 소유한다.
access token, refresh token, nonce, 비밀번호와 Management API PAT는 문서·issue·PR·로그·명령 인자에
기록하지 않는다.

## 확인된 범위

2026-10-26 Management API로 읽은 운영 프로젝트 값(변경 전):

| 설정 | 운영 값 |
| --- | --- |
| `security_update_password_require_current_password` | `false` |
| `security_update_password_require_reauthentication` | `false` |
| `mailer_notifications_password_changed_enabled` | `false` |
| `password_min_length` | `6` |
| `password_hibp_enabled` | `false` |
| `sessions_timebox` | `0` |

이 상태에서는 비밀번호 로그인·OAuth·recovery 세션 어느 것이든 `PUT /auth/v1/user { password }`
한 번으로 비밀번호가 바뀌고, 사용자는 아무 메일도 받지 않는다(아래 실측 C0).

## GoTrue 판정 순서

GoTrue v2.192.0 `internal/api/user.go` 기준이다. 현재 비밀번호 검사는 GoTrue
[#2364](https://github.com/supabase/auth/pull/2364)(2026-02-11)에 들어갔고, Management API
`UpdateAuthConfigBody`에 세 필드가 모두 있다.

1. **재인증**(`require_reauthentication`): 세션 생성 뒤 24시간이 지났으면 `nonce`가 필요하다. 없으면
   400 `reauthentication_needed`. nonce는 `GET /auth/v1/reauthenticate`가 메일로 보낸 6자리 코드이고,
   **검증되는 순간 소비된다** — 다음 단계에서 실패해도 다시 쓸 수 없다.
2. **현재 비밀번호**(`require_current_password`): 계정에 비밀번호가 있고(`HasPassword()`) 세션이
   recovery가 아닐 때만 `current_password`가 필요하다. 없으면 400 `current_password_required`,
   틀리면 400 `current_password_invalid`.
   - recovery 판정 `Session.IsRecovery()`는 JWT `amr`이 아니라 DB `auth.mfa_amr_claims`를 읽는다.
     `otp`·`magiclink`·`recovery` 중 하나면 recovery로 본다.
   - `verifyOtp(type=recovery)`와 magic link 검증은 모두 세션을 `otp`로 기록한다. 그래서 앱의 재설정
     흐름은 현재 비밀번호 없이 통과하고, magic link 세션도 함께 면제된다.
   - 비밀번호가 없는 계정(SNS 전용)은 이 검사를 건너뛴다.
3. **알림**(`mailer_notifications_password_changed_enabled`): 비밀번호가 바뀌면 계정 이메일로 알림을
   보낸다. 발송이 실패해도 요청은 성공한다. service role admin API(`updateUserById`)는 이 경로를 타지
   않아 알림이 없다.

## 실측

2026-10-26 로컬 격리 스택(GoTrue v2.192.0, CLI 2.109.1)에서 auth 컨테이너 env
`GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`·`…_REQUIRE_REAUTHENTICATION`만 바꿔 같은
시나리오를 반복했다. 직접 호출은 `PUT /auth/v1/user`를 fetch로, B는 앱과 같은 supabase-js 호출
(`resetPasswordForEmail` → 메일의 `token_hash` → `verifyOtp(recovery)` → `updateUser({ password })`)로 했다.
"25시간 뒤"는 `auth.sessions.created_at`을 25시간 앞당긴 것이다.

| 시나리오 (세션 AMR) | 모두 끔 | 현재 비밀번호만 | 재인증만 | **둘 다** |
| --- | --- | --- | --- | --- |
| A. 비밀번호 로그인 직후 (`password`) | 200 | 400 `current_password_required` | 200 | 400 `current_password_required` |
| A2. 비밀번호 로그인 25시간 뒤 | 200 | 400 `current_password_required` | 400 `reauthentication_needed` | 400 `reauthentication_needed` |
| B. 재설정 메일 → `updateUser` (`otp`) — 앱 경로 | 200 | **200** | **200** | **200** |
| B2. recovery 세션 25시간 뒤 (앱에서는 생기지 않음) | 200 | 200 | 400 `reauthentication_needed` | 400 `reauthentication_needed` |
| C. SNS 전용 계정, 로그인 직후 (`oauth`) | 200 | 200 | 200 | **200** |
| C2. SNS 전용 계정, 25시간 뒤 | 200 | 200 | 400 `reauthentication_needed` | 400 `reauthentication_needed` |
| D. 비밀번호 계정의 magic link 세션 (`otp`) — 앱이 쓰지 않음 | 200 | 200 | 200 | 200 |
| E. service role `admin.updateUserById` | — | — | — | 200 |

보충 실측(둘 다 켠 상태):

- A에 `current_password`를 함께 보내면 틀린 값은 400 `current_password_invalid`, 맞는 값은 200이다.
- A2는 `reauthenticate()`로 받은 nonce와 `current_password`를 **한 요청에** 보내야 200이다. nonce만 먼저
  보내면 `current_password_required`로 실패하고, 그 nonce는 이미 소비되어 다음 요청이 422
  `reauthentication_not_valid`가 된다.
- 알림 메일(`supabase/templates/password_changed_notification.html`, 제목 `ICONS 비밀번호 변경 안내`)은
  A(맞는 현재 비밀번호)·A2(nonce와 현재 비밀번호를 함께 보낸 경우)·B·C·D의 성공한 변경마다 한 통씩 왔고,
  E에는 오지 않았다.
- C는 `admin.createUser`(비밀번호 없음)로 만든 계정의 identity를 `kakao` 하나로 바꾸고, magic link로 연
  세션의 `auth.mfa_amr_claims`를 `oauth`로 고쳐 OAuth 로그인 세션과 같은 판정을 받게 했다. GoTrue는
  `PUT /user`에서 세션을 DB에서 eager load해 이 행으로 판정한다.

## 권장 설정

| 설정 | 값 | 이유 |
| --- | --- | --- |
| `security_update_password_require_current_password` | `true` | 비밀번호가 있는 계정의 비 recovery 세션 직접 호출을 막는다(A). recovery는 면제(B). |
| `security_update_password_require_reauthentication` | `true` | 24시간 지난 세션은 메일함 nonce가 필요하다(A2·C2). recovery 세션은 검증 직후 생성이라 창 안이다(B). |
| `mailer_notifications_password_changed_enabled` | `true` | 막지 못하는 경로(C)와 정상 변경 모두를 사용자에게 알린다. |
| `mailer_subjects_password_changed_notification` | `ICONS 비밀번호 변경 안내` | 기본 영문 제목 대체. |
| `mailer_templates_password_changed_notification_content` | 템플릿 파일 원문 | `{{ .Email }}`과 `{{ .SiteURL }}/login?mode=reset` 링크 하나만 쓴다. |

둘 중 하나만 켜는 조합은 고르지 않는다. 현재 비밀번호만으로는 SNS 전용 계정이 시간 제한 없이 열려
있고(C2), 재인증만으로는 로그인 직후 24시간 동안 비밀번호 계정이 열려 있다(A).

## 남는 위험

- **SNS 전용 계정의 로그인 후 24시간.** 비밀번호가 없는 계정은 현재 비밀번호 검사를 건너뛰므로, 그 세션의
  access token을 쥔 사람은 비밀번호를 새로 붙여 이후 이메일+비밀번호로 로그인할 수 있다(C). #604가 앱에서
  막은 동작을 직접 호출로 할 수 있다는 뜻이다. 알림 메일이 탐지 수단이고, 템플릿은 SNS 가입자에게 재설정
  대신 고객센터로 알리라고 안내한다(#604 이후 SNS 전용 계정은 앱에서 재설정할 수 없다). 설정으로는 닫히지
  않는다. `auth.users`의 `encrypted_password`가 빈 값에서 채워질 때 email identity가 없으면 거절하는 BEFORE
  UPDATE 트리거는 로컬 실측에서 C를 500(`P0001`)으로 막았고, 이메일 계정의 recovery와 admin API에는
  영향이 없었다. auth 스키마에 트리거를 두는 결정이라 별도로 다룬다.
- **otp 세션 토큰.** recovery·magic link 세션은 현재 비밀번호를 면제받는다. 앱은 magic link 로그인을 쓰지
  않고, recovery 세션은 메일함 소유를 증명한 결과라 이미 비밀번호를 바꿀 권한이 있다.
- **admin API.** service role 경로는 가드와 알림을 모두 우회한다. service role은 서버 신뢰 경계 안에서만
  쓴다는 기존 규칙이 경계다.
- **메일 한도.** 재설정을 마칠 때마다 알림 메일이 한 통 늘어 운영 `rate_limit_email_sent`(30통/시간)를
  가입 확인·재설정 메일과 나눠 쓴다. 알림 발송이 한도에 걸려도 비밀번호 변경은 성공한다.
- **앞으로 만들 로그인 상태 비밀번호 변경 화면.** 현재 앱에는 없다. 만든다면 `current_password`가 필수이고,
  24시간 지난 세션은 `reauthenticate()`의 nonce를 같은 요청에 실어야 한다(nonce는 실패해도 소비된다).
- **로컬과의 차이.** CLI 2.109.1 `config.toml`에는 현재 비밀번호 키가 없어 로컬은 재인증과 알림만 운영과
  같다. 로컬에서 현재 비밀번호 가드를 보려면 auth 컨테이너 env
  `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD=true`로 컨테이너를 다시 만든다.
- **운영 GoTrue 버전.** 운영 auth의 버전은 이번에 읽지 않았다. 반영 뒤 아래 확인 절차의 직접 호출 거절로
  같은 판정임을 확인한다.

## 반영 경로

대시보드나 1회성 PATCH로 바꾸지 않는다. `scripts/sync-supabase-auth.mjs`가 Management API
`PATCH /v1/projects/{ref}/config/auth` 뒤 read-back으로 관리한다. Hosted `config.toml` 전체 push가 아니므로
ADR-0006 계약은 그대로다.

| env | 동작 |
| --- | --- |
| `PASSWORD_UPDATE_GUARDS: "true"` | 두 가드를 `true`로 맞추고 read-back한다. |
| `PASSWORD_CHANGED_TEMPLATE_PATH` + `PASSWORD_CHANGED_SUBJECT` | 알림을 켜고 제목·본문을 파일과 맞춘다. 본문은 `isSafePasswordChangedTemplate`를 통과해야 한다. |

`.github/workflows/pipeline.yml`의 연결:

- production `deploy-supabase` › "Sync and verify Supabase Auth configuration": 가드 + 알림. 앱 handler와
  무관하므로 migration·앱 배포 전에 적용한다.
- isolated preview, shared preview main, persistent staging의 Auth sync 단계: 가드만. 이 프로젝트들은
  custom SMTP를 강제하지 않아 알림이 기본 메일 한도를 recovery 메일과 나눠 쓰게 된다.

선언을 지우는 것만으로는 값이 되돌아가지 않는다(스크립트는 선언된 값만 PATCH한다).

## 반영 절차

**머지가 곧 운영 반영이다.** `main` push의 `deploy-supabase`가 가장 먼저 PATCH한다. 사용자 승인 없이 머지하지
않는다.

1. 이 변경 PR의 isolated preview run에서 "Sync isolated Supabase preview Auth URLs" 단계가 `updated.` 또는
   `already up to date.`로 끝났는지 본다. hosted GoTrue가 두 가드 필드를 받아들인다는 첫 증거다.
2. 승인 뒤 머지한다. `main` run의 `deploy-supabase` › "Sync and verify Supabase Auth configuration" 로그에서
   `Supabase Auth configuration for … updated.`를 확인한다. read-back이 다섯 번 어긋나면 이 단계가 실패하고
   migration push 전에 멈춘다.
3. 값을 읽어 확인한다(토큰은 환경변수로만 넘긴다).

   ```bash
   curl -sS "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | jq '{security_update_password_require_current_password, security_update_password_require_reauthentication, mailer_notifications_password_changed_enabled, mailer_subjects_password_changed_notification}'
   ```

4. 운영에서 재설정 흐름을 한 번 통과한다: 직원 테스트 계정으로 `/login?mode=reset` → 메일 링크 →
   새 비밀번호 저장 → 로그인 화면 이동 → `ICONS 비밀번호 변경 안내` 메일 수신.
5. 같은 계정으로 비밀번호 로그인한 세션에서 `current_password` 없이 `PUT /auth/v1/user`가 400
   `current_password_required`인지 본다. 토큰은 브라우저 개발자 도구나 스크립트 변수에서만 다루고 남기지
   않는다.

되돌릴 때는 원인 PR을 revert하고, 같은 PAT로 세 값을 `false`로 PATCH한 뒤 3번으로 읽어 확인한다. revert만
머지하면 값은 켜진 채로 남는다.

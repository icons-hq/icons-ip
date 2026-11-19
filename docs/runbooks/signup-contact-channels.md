# 가입 간소화·휴대폰 번호 인증·연락 수단(SMS·카카오톡) 런북

10/14 실사용 QA 회의 요청(원장 1014-004·005·006·010·014)과 2026-11-11 사용자 결정(묶음 6, 적대적 리뷰 뒤 F3·F10 결정)을
구현한 범위, 켜는 순서, 사람이 해야 하는 일, 바뀔 개인정보처리방침·동의 문구 초안을 모은다. 키·비밀번호·인증키 값은 이
문서·이슈·PR·로그에 남기지 않는다.

## 1. 지금 상태

| 항목 | 동작 | 스위치(기본) | 사람 게이트 |
| --- | --- | --- | --- |
| 1014-004 가입 확인 코드 | 회원가입 뒤 같은 화면에서 메일의 6자리 확인 코드를 입력해 가입을 잇는다. 코드 확인 세션은 바로 닫고 같은 화면에서 입력한 비밀번호로 다시 로그인한 세션만 남긴다(§3). 새로 연 가입 화면은 [받은 코드 입력하기]로 재발송 없이 코드 단계를 다시 연다. 메일 링크도 그대로 동작한다 | 없음(배포 즉시) | 배포 파이프라인이 앱 배포 전에 운영 Auth 확인 메일 템플릿을 코드+링크로 맞춘다(§3). 배포 뒤 실제 메일 확인만 사람이 한다 |
| 1014-004 닉네임 자동 | 온보딩은 닉네임을 묻지 않는다. 닉네임이 없는 계정은 `fan_` + 8자 자동 닉네임을 받고 설정에서 바꾼다. 필수 입력은 생년월일·약관 2종 | 없음 | 없음 |
| 1014-005·006 휴대폰 번호 인증 | 온보딩 마지막 단계(생년월일·약관 저장 뒤, 필수)와 설정에서 SMS 인증번호로 휴대폰 번호(해외 포함)를 확인한다. 번호를 다른 계정에 옮겨 간 회원은 주문 같은 보호 액션 전에 다시 인증한다. 발송은 Twilio Verify(§4 '발송사 연결') | `ICONS_PHONE_VERIFICATION_ENABLED` OFF | 처리방침 개정은 코드에 반영(2026-11-17 공지·11-18 시행). 남은 것은 Twilio API 키·env 등록(§4) |
| 소셜 로그인 이메일 변경(2026-11-17) | 로그인 이메일이 Apple 이메일 가리기 릴레이 주소이거나 비어 있는 회원만 온보딩·설정에서 다른 이메일을 6자리 메일 코드로 확인해 바꾼다(릴레이는 선택, 빈 값은 필수) | 메일 발송 설정(운영에 있음) + 휴대폰 인증과 같은 법적 게이트(운영은 11-18 KST부터) | Apple 발신 도메인 등록(§12) |
| 1014-010 수단별 수신 동의 | 이메일·SMS에 카카오톡 수신 동의를 더한다 | 카카오톡 채널 스위치를 따른다 OFF | 처리방침 공지 |
| 1014-010 SMS 알림 seam | 인증 번호·SMS 동의를 DB가 확인한 회원에게 SMS를 보내는 함수 하나(`sendMemberSms`). 첫 생산자는 예약 일정 변경 안내(QNA-040, DB 설정 `sms_enabled`도 함께 필요) | `ICONS_SMS_NOTIFICATIONS_ENABLED` OFF | 발송사·080 수신거부 번호 |
| 1014-014 카카오톡 채널 | 카카오 로그인 동의 화면 채널 추가(plusfriends 동의항목) + 설정의 [카카오 계정 연결](가입 수단 무관) + 채널 친구 추가 쿠폰 1회 자동 발급 | `ICONS_KAKAO_CHANNEL_ENABLED` OFF | 채널 개설(H5)·콘솔 설정·지정 고객 쿠폰 정의·**manual linking**·처리방침 공지 |

스위치가 꺼져 있으면 로그인·온보딩·설정 화면과 카카오 로그인 요청은 기능을 넣기 전과 한 글자도 같다
(`components/screens/ContactChannelsSwitchOff.test.tsx`가 도입 전 렌더 기준 `test/fixtures/contact-channels-off/`와 비교한다).
가입 확인 코드(1014-004)는 스위치가 없어 이 비교 대상이 아니다.

**운영 법적 게이트.** 세 스위치 모두 운영(`VERCEL_ENV=production`)에서는 `lib/auth/contact-channels.ts`의 시행일(KST)이
지나야 듣는다. 휴대폰 번호 인증은 `CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE` = 방침 개정
(`lib/legal/contact-channels-privacy-revision.ts`, 2026-11-17 공지·**2026-11-18 시행**)의 시행일이다 — 실제 이용자가 없어 공지
1일 뒤 시행으로 둔다는 2026-11-17 사용자 결정("시행일 값은 내일날짜로 바로 적어놔도 됨 아직 실제 사용자없음")이다. 이용자가
생긴 뒤의 개정에는 7일 공지를 지킨다. SMS 알림·카카오톡 채널은 아직 방침에 고지가 없어
`SMS_NOTIFICATIONS_AND_KAKAO_PRIVACY_EFFECTIVE_DATE`(`null`)로 따로 닫혀 있다 — env만 켜서는 운영에서 열리지 않는다.
Preview·로컬은 env만으로 연다.

## 2. 결정: 휴대폰 인증은 Supabase Auth 전화 인증이 아니라 자체 인증번호

Supabase Auth `updateUser({ phone })` + `verifyOtp(phone_change)` + Send SMS Hook 대신, 앱 서버가 인증번호를 만들고
DB가 판정하는 자체 경로를 쓴다.

- **로그인 수단을 늘리지 않는다.** Auth에 확인된 전화번호가 생기면 Phone provider를 켰을 때 그 번호로 SMS OTP 로그인
  (`signInWithOtp({ phone })`)이 공개 Auth API에서 열린다 — 번호 재할당·유심 탈취로 계정을 가져갈 표면이다(추정 — Supabase
  Phone 로그인 문서 기준, 운영에서 시험하지 않음). 이 기능은 연락처 확인이지 로그인이 아니다.
- **번호 조회 노출이 없다.** GoTrue `UserUpdate`는 다른 계정이 쓰는 번호면 인증번호를 보내기 전에 `phone_exists`를 돌려준다
  (supabase/auth `internal/api/user.go` 확인) — 번호만 알면 가입 여부를 알아내는 조회가 된다. 자체 경로는 인증을 마친
  뒤에만 번호를 옮기고, 그 전에는 어떤 번호든 같은 응답이다.
- **남용 방지를 번호·IP 단위로 둘 수 있다.** Supabase의 SMS 한도(`rate_limit.sms_sent`)는 프로젝트 전체 시간당 건수다.
  요청서가 요구한 번호·IP별 시도 제한은 어차피 Hook 안에서 다시 만들어야 한다.
- **국내 발송사는 기본 제공자가 아니다.** Supabase 내장 SMS 제공자는 Twilio·MessageBird·Textlocal·Vonage뿐이라
  NHN Cloud·솔라피 같은 국내 발송사는 Send SMS Hook이 필요하다. Hook을 쓰든 안 쓰든 발송 코드는 우리가 쓴다.
- **운영 Auth 설정이 바뀌지 않는다.** Hosted `config.toml` 전체 push는 CI가 소유하지 않는다(AGENTS.md). 자체 경로는 env와
  migration만으로 켜고 끈다.

ADR-0024(성인 인증)와 같은 선택을 따른다: 원문 대신 서버 비밀값 HMAC, 서비스 롤 RPC, '한 번호는 한 계정에서만 유효 —
차단하지 않고 옮긴다'. 옮긴 뒤 번호를 잃은 계정은 다시 인증해야 한다(2026-11-11 사용자 결정 '옮기고 재인증 요구', §4).

## 3. 1014-004 가입 확인 코드

- 회원가입 → `signUp()`이 확인 메일을 보내면 `pendingSignupEmail`을 돌려주고, 화면은 같은 자리에서 코드 입력 단계를 연다
  (`components/screens/Login.tsx`의 `SignupCodeStep`). 입력한 코드는 `verifyOtp({ email, token, type: 'email' })`로
  확인한다 — GoTrue는 가입 확인 토큰을 먼저 보고 PKCE 가입의 `pkce_` 토큰도 같은 코드로 통과시킨다(supabase/auth
  `internal/api/verify.go` `isOtpValid` 확인).
- [코드 다시 받기]는 회원가입 폼 재제출과 같은 서명 쿠키 창(10분에 3번)을 나눠 쓰고, 이 브라우저에서 그 이메일로 가입을
  시작한 창이 있을 때만 보낸다.
- 코드 대입은 GoTrue의 IP별 검증 한도(`rate_limit.token_verifications`)와 코드 만료(`mailer_otp_exp`, 운영 3600초)가
  막는다. 이 표면은 화면을 넣기 전에도 공개 Auth API(`POST /auth/v1/verify`)에 있었다.
- 코드로 가입을 마친 뒤 같은 메일의 링크를 열면 토큰이 이미 쓰여 링크 오류 화면이 나온다. 문구가 "코드로 이미 가입을
  마쳤다면 로그인"을 안내한다.

### 코드 확인 세션은 비밀번호 로그인 세션으로 바꾼다(리뷰 F1)

`verifyOtp`가 만든 세션은 AMR이 `otp`다. 운영 Auth의 '현재 비밀번호 요구' 가드는 `otp`·`magiclink`·`recovery` 세션을
면제하므로([가드 런북](supabase-auth-password-update-guards.md)), 이 세션을 그대로 주면 토큰만으로 현재 비밀번호 없이
`PUT /auth/v1/user { password }`가 열린다. 그래서 `verifySignupCodeAction`(`app/login/actions.ts`)은:

1. 코드 확인에 성공하면 그 세션을 `signOut({ scope: 'local' })`로 서버에서 끊는다. 실패하면 auth-js가 로컬 세션을 남기므로
   이 응답의 `sb-*-auth-token` 쿠키를 직접 지운다 — otp 세션 토큰은 브라우저로 나가지 않는다.
2. 가입 폼에 입력한 비밀번호로 `signInWithPassword`를 해, AMR이 `password` 하나뿐인 세션(`lib/auth/session-amr.ts`)만
   남기고 온보딩으로 간다.
3. 비밀번호는 화면 메모리(React 상태)에만 있고 코드 확인 요청에만 실린다 — 저장소·쿠키·DOM에 남기지 않는다. 그래서
   새로고침·다른 탭·[받은 코드 입력하기]로 연 단계에는 비밀번호가 없다. 그때나 로그인이 실패하거나 AMR이 `password`가
   아니면 세션 없이 `/login?mode=signin&signup_confirmed=1`로 보내 "가입 확인을 마쳤어요. 가입한 이메일과 비밀번호로
   로그인해주세요."를 보인다(이메일 확인은 이미 끝났다).

2026-11-11 로컬 격리 스택(GoTrue, `supabase/config.toml`) 실측: 가입 토큰의 `POST /verify`(type `email`) 세션은 JWT·
`auth.mfa_amr_claims` 모두 `otp`, `POST /logout?scope=local` 뒤 그 토큰의 `PUT /user`는 403 `session_not_found`,
`grant_type=password` 재로그인 세션은 `password`였다.

### 코드 단계 복원(리뷰 F5)

확인 메일을 보낸 이메일만 이 탭의 sessionStorage(`icons:signup:pending`)에 1시간 기억한다. 새로고침·메일 앱 왕복 뒤 가입
화면에 "<이메일>로 받은 확인 코드가 있나요? [받은 코드 입력하기]"가 보이고, 누르면 메일을 다시 보내지 않고 코드 단계를 연다.
코드 확인을 보내면 기억을 지우고, 실패하면 다시 기억한다. [다른 이메일로 가입하기]도 지운다.

### 운영 확인 메일 템플릿(선언 관리)

운영 Supabase Auth의 "Confirm signup" 템플릿에 코드(`{{ .Token }}`)가 없으면 화면은 코드를 기다리는데 메일에는 링크만 있다.
그래서 **앱 배포 전에** 템플릿을 바꾼다 — 새 템플릿은 코드와 링크를 함께 담아 지금 화면(링크만 안내)에서도 그대로 동작한다.

1. 제목·본문의 정본은 `supabase/templates/confirmation.html`과 `supabase/config.toml`의 `[auth.email.template.confirmation]`
   (제목 `ICONS 가입 확인 코드`)이다.
2. 반영은 `scripts/sync-supabase-auth.mjs`가 한다(`CONFIRMATION_TEMPLATE_PATH`·`CONFIRMATION_SUBJECT`). production은
   `deploy-supabase`의 Auth sync 단계(앱 배포 job보다 먼저)에서, isolated PR preview·shared preview·staging은 각자의 Auth sync
   단계에서 Management API `mailer_subjects_confirmation`·`mailer_templates_confirmation_content`를 맞추고 읽어 확인한다.
   템플릿은 코드 하나·확인 링크 하나만 허용하는 검사(`isSafeConfirmationTemplate`)를 통과해야 반영된다.
3. 사람 확인(배포 뒤): 운영 직원 테스트 계정으로 가입 → 메일에 6자리 코드와 버튼이 함께 있는지 → 코드 입력으로 온보딩까지 가는지 본다.
4. Send Email Hook(#191, 기본 OFF)을 켜기 전에는 `lib/email/auth-hook.ts`의 signup 메일에도 6자리 코드를 넣어야 한다.
   훅 메일은 `email_data.token`이 있으면 코드를 함께 담는다(없으면 링크만).

Preview·스테이징 Auth도 같은 템플릿을 받으므로(기본 메일 발송 한도 안에서) 코드 단계를 preview에서도 시험할 수 있다.

## 4. 1014-005·006 휴대폰 번호 인증

흐름: 온보딩 1단계에서 생년월일·약관 동의를 저장 → 2단계에서 나라·번호 입력 → 서버가 E.164로 정규화
(`lib/sms/phone-number.ts`) → 6자리 인증번호 생성 → DB `service_issue_member_phone_verification`이 만 14세·필수 동의와
한도를 판정하고 요청을 기록 → 발송 seam으로 문자 → 화면에서 6자리 입력 → `service_verify_member_phone_verification`이
만 14세·필수 동의를 다시 확인하고 HMAC 비교 → 번호를 회원에게 기록 → [ICONS 시작하기]로 온보딩 완료.

- **온보딩 완료는 서버만 기록한다(2026-11-18).** 앱 서버가 service_role 전용 RPC `service_complete_member_onboarding(p_user_id, p_require_phone)`로만 쓴다. 스위치 ON이면 RPC가 같은 트랜잭션에서 인증된 번호와 1단계(동의·만 14세)를 다시 확인한다. authenticated의 `onboarded_at` update 권한은 `20261118157000` migration으로 회수돼(서버 경로 앱이 배포된 뒤 적용), Data API로 직접 써서 인증을 건너뛰는 길이 없다. 운영 DB 직접 수정이나 시드·QA 픽스처는 postgres·service_role로 쓴다.

- **동의·만 14세 확인 전에는 번호를 받지 않는다(리뷰 F2).** 생년월일·이용약관·개인정보 동의를 저장하지 않았거나 만 14세
  미만이면 요청 단계에서 `onboarding_required`로 거절해 번호를 남기지 않는다. 요청 뒤 조건이 바뀌어도 확인 단계가 다시
  보고 요청을 `refused`로 닫으며 번호 원문을 지운다.
- **나라.** 번호는 아무 나라나 +국가번호(E.164)로 받는다. 목록에 없는 나라는 '다른 나라(+국가번호로 입력)'를 고르고
  `+44 7700 900123`처럼 입력한다. 허용은 `ICONS_PHONE_VERIFICATION_COUNTRIES`가 정한다: 쉼표로 나눈 ISO 코드(`KR,JP`)나
  국가번호(`+82,+81`), `*`는 전체. 모르는 값은 건너뛰고(기능을 끄지 않는다) 남는 값이 없으면 한국만이다. **기본은 한국만** —
  해외 문자 단가·도달률과 SMS 펌핑(유료 번호로 인증 문자를 대량 유도) 위험은 발송사 계약(H4)에서 국가별 제한을 정한 뒤에야
  알 수 있어서, 계약 전에는 국내 발신번호 등록으로 다룰 수 있는 범위만 연다.
- **번호를 잃은 계정의 재인증(2026-11-11 사용자 결정 '옮기고 재인증 요구').** 다른 계정이 같은 번호를 인증하면 번호는 그
  계정으로 옮기고, 이전 계정에는 번호 없이 `released_at`(재인증 필요)만 남긴다. 스위치가 켜져 있으면 `getProfileForUser`가
  `my_member_phone_verification().reverificationRequired`를 읽어 그 계정을 온보딩 미완료로 보고, 주문 생성·결제 준비 같은
  보호 액션(온보딩 게이트를 거치는 모든 경로) 전에 온보딩의 휴대폰 인증 단계로 보낸다. 다시 인증하면 표시가 지워진다.
  스위치가 꺼져 있으면 아무것도 읽지 않는다.

| 규칙 | 값 | 판정 위치 |
| --- | --- | --- |
| 인증번호 | 6자리, 5분 | 앱(`PHONE_CODE_TTL_SECONDS`) + DB 만료 |
| 오입력 | 요청당 5번, 넘으면 요청 닫힘 | DB |
| 재발송 간격 | 같은 회원 또는 같은 번호 60초 | DB |
| 회원 한도 | 1시간 5건 · 24시간 10건 | DB |
| 번호 한도 | 1시간 5건 · 24시간 10건 | DB |
| IP 한도 | 1시간 10건 · 24시간 30건(IP를 알 때) | DB |
| 발송 실패 | 요청을 닫고 한도에는 센다 | DB |
| 동의·만 14세 | 요청·확인 두 번 확인, 미충족이면 번호를 남기지 않음 | DB `private.member_phone_onboarding_ready` |
| 한 번호 한 계정 | 다른 계정이 인증하면 번호를 옮기고 이전 계정은 재인증 필요(이력 `released`) | DB + 앱 온보딩 게이트 |
| 탈퇴 신청(계정 봉인) | 같은 트랜잭션에서 번호·진행 중 요청·인증 이력 삭제 | DB 트리거 |
| 문의로 받은 탈퇴(운영자 처리) | 정지와 같은 트랜잭션에서 번호·진행 중 요청·인증 이력 삭제 | 어드민 고객 상세 '탈퇴 요청 처리'(`admin_process_member_withdrawal`, [탈퇴 정책](../account-deletion-retention-policy.md) §5) |
| 보관 | 결과가 정해진 요청은 번호 원문 삭제, 매시 작업이 만료 요청을 닫고 이틀 지난 요청 행과 1년 지난 인증·해제 이력 삭제 | pg_cron `member-phone-verification-retention` |

저장: `private.member_phone_numbers`(회원당 1행 — 인증 번호(E.164) 또는 재인증 필요 표시), `private.member_phone_verification_challenges`
(요청, 번호 원문은 진행 중에만), `private.member_phone_verification_events`(인증·해제 이력, 번호는 다이제스트, 1년 보관).
인증번호·번호·IP는 `ICONS_PHONE_VERIFICATION_SECRET` HMAC으로만 비교·집계한다(가명 처리). 이 값을 바꾸면 진행 중 요청이
모두 무효가 되고 한도 창이 초기화된다(저장된 번호에는 영향 없음).

스위치를 켜면 새 회원의 온보딩 완료에 인증 번호가 필요하다. **이미 온보딩을 마친 회원은 다시 막지 않는다** — 설정에서
등록·변경할 수 있다(번호를 다른 계정에 옮겨 간 회원만 위의 재인증 대상이다). 기존 회원에게도 요구할지는 켜기 전에 정할 일이다.

### 발송사 연결 — Twilio Verify(2026-11-17)

인증번호 문자는 Twilio Verify로 보낸다(`lib/sms/twilio-verify.server.ts`, `ICONS_SMS_PROVIDER=twilio_verify`).

- **왜 Verify인가.** Twilio에서 한국 수신은 국제 발신 번호로만 갈 수 있다(알파벳 발신자·국내 번호 미지원, 단말에는
  `[국제발신]`·`[Web발신]`과 006/009가 붙는다 — Twilio 국가 가이드). Messages API는 번호를 사서 발신자를 관리해야 하지만
  Verify는 Twilio의 인증 전용 발신 경로·템플릿·Fraud Guard를 그대로 써서 번호 없이 보낸다. 같은 Twilio 계정의 헤이그랩잇도
  Verify 서비스(Grabit Phone Verification)로 보내고 있었다.
- **분리(2026-11-17 사용자 결정 '같은 계정에 전용 서비스').** 같은 Twilio 계정에 X SQUARE 전용 Verify 서비스를 만들었다:
  이름 `X SQUARE`(문자에 "X SQUARE"로 보인다), SID `VA6a472c8a851e0ee2c04181af19f427d8`, 코드 6자리, **Custom Verification
  Code 켬**, Fraud Guard Standard. 계정 Verify 지역 권한에서 대한민국(+82)은 허용이다. 사용량은 서비스별로 나뉘고 요금은
  계정 하나에서 나간다.
- **인증번호는 지금처럼 우리가 만든다.** 서버가 6자리를 만들고 DB가 HMAC으로 판정한다(만 14세·동의·한도·5회 잠금·번호 옮기기
  그대로). Verify에는 그 번호를 `CustomCode`로 넘겨 문자만 보낸다(한국 번호는 `Locale=ko`). Custom Code를 쓰면 Twilio에 결과를
  알려야 하므로, DB가 확인을 마친 뒤 응답 뒤(`after`)에 같은 번호의 Verification을 `approved`로 바꾼다(실패해도 인증은 그대로).
- **거래 안내·광고 문자는 보내지 않는다.** Verify는 인증번호 전용이라 `sendMemberSms`(SMS 알림 seam)는 이 발송기로 닫힌다.
  SMS 알림을 켜려면 Messages API 발송기와 발신번호·080 수신거부를 따로 준비한다.
- **env(서버 전용, Production·Preview).**
  - `ICONS_SMS_PROVIDER=twilio_verify`
  - `TWILIO_VERIFY_SERVICE_SID=VA6a472c8a851e0ee2c04181af19f427d8`
  - `TWILIO_API_KEY_SID`(SK…)·`TWILIO_API_KEY_SECRET` — **사람이 만든다.** Twilio 콘솔 Account → API keys & tokens →
    Create API key(이름 예: `x-square-verify`, 유형 Standard). 비밀값은 만들 때 한 번만 보이므로 바로 Vercel env에 넣는다.
    이 값을 채팅·이슈·문서에 남기지 않는다. 계정 Auth Token은 쓰지 않는다(헤이그랩잇과 공유되므로 키를 따로 둔다).
  - `ICONS_PHONE_VERIFICATION_SECRET`(32자 이상 무작위, 예: `openssl rand -base64 48`)
  - `ICONS_PHONE_VERIFICATION_COUNTRIES` — 비우면 한국만(기본). 해외를 열려면 Verify Geo Permissions와 함께 정한다.
  - 마지막에 `ICONS_PHONE_VERIFICATION_ENABLED=true` → 재배포.
- **로그.** 실패는 `[sms:twilio_verify] send failed status=<HTTP> code=<Twilio 오류 번호>`만 남는다(번호·코드·키 없음).
  403·60204는 Custom Code가 꺼진 서비스, 401·20003은 키 오류, 60200은 잘못된 번호, 60203은 Twilio 쪽 번호별 발송 한도다.

## 5. 1014-010 수단별 수신 동의(카카오톡)와 SMS 알림 seam

- 동의 원장(`private.customer_marketing_consents`)이 `kakao` 수단과 안내 버전 `marketing-channels-v2`를 받는다. 화면은
  카카오톡 채널 스위치가 켜졌을 때만 카카오톡 줄을 그리고 `set_my_marketing_consents_v2`로 세 수단을 저장한다. 꺼져 있으면
  예전 `set_my_marketing_consents`(v1)만 부른다.
- 스위치를 껐을 때 이미 카카오톡에 동의한 회원에게는 줄을 계속 보여 철회할 수 있게 한다(새 동의는 받지 않는다). 이때처럼
  고른 값과 저장된 값이 다를 수 있어, 카카오톡 줄을 그린 저장의 처리 결과 고지(정보통신망법 제50조 제7항)는 저장 RPC가
  돌려준 원장 상태로 만든다(리뷰 F8).
- 파생값 `profiles.consents.marketing`(인앱 마케팅 소식·고객 세그먼트가 읽는 값)은 세 수단 중 하나라도 동의면 true다.
- SMS 알림 seam `sendMemberSms`(`lib/sms/notifications.server.ts`)의 법적 경계(정보통신망법 제50조·시행령 제61조 —
  법무 확인 전 초안 기준):
  - 광고성 정보는 SMS 수신 동의가 있는 회원에게만. 받는 사람은 DB `service_member_sms_recipient`가 인증 번호·동의 원장으로 정한다.
  - 본문 앞 `(광고)` + 전송자 명칭(ICONS), 끝에 무료 수신거부 방법(`ICONS_SMS_ADVERTISING_OPT_OUT`, 예: `무료수신거부 080-…`).
    이 문구가 없으면 광고성 정보를 보내지 않는다.
  - 오후 9시~다음 날 오전 8시(KST)에는 광고성 정보를 보내지 않는다(야간 별도 동의를 받지 않는다).
  - 거래 안내(주문·배송)는 동의와 무관하지만 인증 번호로만 보낸다.
- 첫 생산자는 예약 일정 변경 안내(QNA-040)다: 거래 안내(transactional)로 보내되 SMS 수신 동의가 있는 회원에게만, DB 설정
  `order_delay_notice_delivery_control.sms_enabled`가 함께 켜졌을 때만 대상마다 한 번 보낸다. 발송 기록(본문·번호 제외)과
  재시도 없음(발송사 멱등 키 부재)의 근거는 [지연 주문 고객 안내](./order-delay-notices.md)의 'SMS(예약 일정 변경 안내)'.
  다른 생산자(예: IP 소식 알림)를 만들 때도 이메일 dispatcher처럼 발송 기록(본문 제외)·재시도·2년 수신 동의 재확인
  (시행령 제62조의3)을 함께 설계한다.

## 6. 1014-014 카카오톡 채널

- 스위치가 켜지면 카카오 로그인에 `plusfriends`(카카오톡 채널 추가 상태 및 내역) 동의항목을 더 요청한다. 동의 화면의
  "채널 추가" 항목은 카카오 콘솔 설정이 그린다. **콘솔에 이 동의항목이 없는데 요청하면 카카오가 로그인을 거절한다
  (KOE205)** — 콘솔을 먼저 맞추고 스위치를 켠다.
- **카카오 계정 연결(2026-11-11 사용자 결정, 리뷰 F10).** 설정에 '카카오톡 채널' 줄이 생긴다. 카카오 계정이 없는 회원
  (이메일·Google·Apple 가입)은 [카카오 계정 연결]을 누르면 Supabase `linkIdentity({ provider: 'kakao', scopes: 'plusfriends' })`로
  카카오 동의 화면에 가서 연결과 채널 추가를 한 번에 한다. 결과는 서명 쿠키(목적 `link`)로 콜백이 알아보고 로그인 화면이
  아니라 `/settings?kakao_link=<linked|cancelled|identity_taken|failed>`로 돌려보낸다. 설정 화면은 이 쿼리를 실제 카카오
  identity와 맞을 때만 안내한다(쿼리는 누구나 만들 수 있다). 그 카카오 계정이 이미 다른 회원에게 연결돼 있으면 GoTrue가
  `identity_already_exists`로 거절한다. 연결된 회원에게는 채널 추가 링크(`https://pf.kakao.com/<채널 ID>/friend`)와
  [친구 추가 쿠폰 받기]가 보인다.
- 친구 추가 쿠폰: 카카오 채널 관계 조회 API(`GET https://kapi.kakao.com/v2/api/talk/channels`, 어드민 키 방식 —
  `target_id_type=user_id`)로 `ADDED`를 확인한 회원에게 `ICONS_KAKAO_CHANNEL_COUPON_CODE` 쿠폰을 회원·채널당 한 번
  발급한다(`private.kakao_channel_friend_rewards`, 쿠폰 출처 `kakao_channel`). 확인하는 때: 카카오 identity가 있는 회원의
  로그인 직후·카카오 계정 연결 직후(응답 뒤 after), 온보딩 완료 직후, 채널 웹훅(added) 수신 때, 설정의 [친구 추가 쿠폰 받기]
  (`granted_via settings`). 가입 수단과 무관하다 — 기준은 카카오 identity와 관계 조회 결과뿐이다. 웹훅 본문은 확인을 시작하는
  신호일 뿐이다.
- **쿠폰은 지정 고객 발급만 쓴다(리뷰 F4).** 코드 입력 발급 쿠폰이면 친구가 아닌 회원도 코드를 입력해 받으므로, DB
  (`private.issue_coupon_code`의 `kakao_channel` 분기)가 `issuance_mode`가 `targeted`가 아닌 쿠폰을
  `coupon_kakao_channel_requires_targeted`로 거절한다(원장을 남기지 않아 쿠폰을 고치면 다음 확인 때 발급된다).
- 대상은 운영자 일괄 발급과 같다: 일반 회원·온보딩 완료·만 14세 이상·정지/탈퇴 봉인 아님. 쿠폰이 끝났거나 한도를 다 쓰면
  원장을 남기지 않아 쿠폰을 고친 뒤 다음 확인 때 발급된다. 채널을 차단했다 다시 추가해도 다시 받지 않는다.

### 콘솔·운영 준비(사람)

1. 카카오톡 채널 개설(신사업팀, H5) — '아이콘스' 이름 사용 가능 여부 확인(10/14 회의 25:04).
2. 카카오 앱(앱 ID는 ARCHITECTURE §8, 이미 비즈 앱)에 채널 연결 → 대표 채널 지정 → [카카오 로그인] > [동의항목]에서
   `plusfriends` 선택 동의 설정.
3. [앱] > [웹훅] > [카카오톡 채널 웹훅]에 `https://iconsip.com/api/webhooks/kakao/channel` 등록.
4. 어드민 쿠폰 화면에서 친구 추가 쿠폰 정의를 만든다 — **발급 방식: 지정 고객**(쿠폰 편집의 발급 대상에서 '고객지정'을
   고른다. 목록에는 '지정 고객'으로 보인다. 코드 입력 발급 아님), 코드·금액·기간·발급 한도. 지정 고객 쿠폰은 코드 입력으로
   받을 수 없고, 코드 방식으로 만들면 DB가 친구 추가 발급을 거절한다. 한 장이라도 발급한 뒤에는 발급 방식을 바꿀 수 없다.
5. **Supabase Auth manual linking 켜기(사람 게이트).** 대시보드 Authentication → Sign In / Providers → "Allow manual linking"
   또는 Management API `PATCH /v1/projects/{ref}/config/auth`의 `security_manual_linking_enabled: true`(CLI
   `enable_manual_linking`과 같은 값). 켜기 전에는 설정의 [카카오 계정 연결]이 "지금은 카카오 계정을 연결할 수 없어요"로
   끝나고 아무것도 바꾸지 않는다. 켜면 로그인한 회원이 Auth API로 다른 공급자 identity를 직접 연결·해제(identity 2개
   이상일 때)할 수도 있다 — 앱은 해제를 노출하지 않는다. 로컬 `supabase/config.toml`은 카카오 provider가 없어 `false`로 둔다.
6. env: `KAKAO_CHANNEL_PUBLIC_ID`(채널 프로필 ID, `_`로 시작), `KAKAO_ADMIN_KEY`(대표 어드민 키, 서버 전용),
   `ICONS_KAKAO_CHANNEL_COUPON_CODE`, 마지막에 `ICONS_KAKAO_CHANNEL_ENABLED=true`.

## 7. 개인정보처리방침·동의 문구 초안

**2026-11-17 반영분.** 휴대폰 번호 인증(Twilio Inc. 위탁·미국 이전)과 소셜 로그인 회원의 이메일 변경은 방침 예약 개정으로 코드에
들어갔다(`lib/legal/contact-channels-privacy-revision.ts` + `lib/legal/documents.ts`의 `applyContactChannelsPrivacyRevision` —
11-17 공지, 11-18부터 새 본문·이전 판 보존). 아래 초안 가운데 SMS 알림(080 수신거부·광고 문자)과 카카오톡 채널 부분은 아직
반영되지 않은 초안이며 법무 검토 전이다. 그 개정 PR은 `pendingRevision`(공지)과
`SMS_NOTIFICATIONS_AND_KAKAO_PRIVACY_EFFECTIVE_DATE`(시행일)를 함께 채운다.

**제1조 표(수집 항목) — 추가·변경**

| 구분 | 수집 항목 | 수집 시점 |
| --- | --- | --- |
| 온보딩(변경) | 생년월일, 이용약관·개인정보 수집이용 동의 여부, 마케팅 정보 수신 동의 여부(이메일·SMS·카카오톡 수단별, 동의·철회 일시), 팔로우한 IP. 닉네임은 회사가 자동으로 만들고 회원이 설정에서 바꿀 수 있음 | 온보딩 완료 시 |
| 휴대폰 번호 인증 | 휴대폰 번호(국가 번호 포함), 인증 일시. 인증 과정의 요청 기록(요청 시각·결과)과 인증·해제 이력(일시·구분). 요청 기록과 이력의 휴대폰 번호·접속 IP는 가명 처리한 값으로만 보관 | 생년월일·필수 동의를 마친 뒤 온보딩 또는 설정에서 휴대폰 번호를 인증할 때 |
| 카카오톡 채널(선택) | 카카오 계정 회원번호(카카오 로그인 또는 카카오 계정 연결 시), 카카오톡 채널 추가 상태(추가·차단·없음)와 채널 친구 쿠폰 발급 기록 | 카카오 로그인 또는 설정의 카카오 계정 연결 동의 화면에서 '카카오톡 채널 추가 상태 및 내역'에 동의한 경우 |

**제2조(처리 목적) — 추가**

- 휴대폰 번호 인증을 통한 회원 연락처 확인과 한 번호로 여러 계정을 이용하는 부정 이용 방지(다른 계정이 같은 번호를
  인증하면 이전 계정에 재인증을 요청)
- 주문·배송 등 거래 안내와, 수신에 동의한 회원에 한정한 SMS·카카오톡 광고성 정보 발송
- 카카오톡 채널 친구 추가 혜택(쿠폰) 지급

**제3조(보유 기간) — 마무리 문장 추가**

- 인증한 휴대폰 번호와 인증·해제 이력은 회원 탈퇴를 처리하면(탈퇴 신청 기능이 켜져 있으면 신청할 때) 지체 없이 파기합니다.
  인증번호 요청 기록은 요청일부터 2일, 인증·해제 이력은 발생일부터 1년이 지나면 파기합니다. 다른 계정이 같은 번호를
  인증하면 이전 계정의 휴대폰 번호는 그때 파기하고 재인증이 필요하다는 표시만 남깁니다.

**제5조(처리위탁) — 행 추가**(법인명은 계약 뒤 확정, 그 전에는 `확인 중`)

| 수탁자 | 위탁 업무 | 보유·이용기간 |
| --- | --- | --- |
| (SMS 발송사) | 휴대폰 번호 인증번호와 SMS 알림 발송 | 위탁계약 종료 시까지 |
| 주식회사 카카오 | 카카오톡 채널 운영과 채널 메시지 발송, 채널 관계 확인 | 위탁계약 종료 시까지 |

카카오의 지위(수탁자인지, 회원이 직접 이용하는 별도 서비스인지)와 카카오톡 광고 메시지(브랜드 메시지 등) 발송 방식은
채널 계약 때 확정해 위 행을 고친다(추정 — 공식 문서로 확인하지 못함). 해외 발송사를 쓰면 제6조(국외 이전)에도 행을 더한다.

**제7조(권리 행사) — 자가 열람·정정 항목**: '닉네임, 프로필 이미지, 마케팅 정보 수신 동의 여부' → '닉네임, 프로필 이미지,
휴대폰 번호, 마케팅 정보 수신 동의 여부(이메일·SMS·카카오톡), 카카오 계정 연결'.

**이용약관 제8조(회원에 대한 통지)**: '이메일 주소 또는 서비스 내 알림함' → '이메일 주소, 인증한 휴대폰 번호(SMS) 또는
서비스 내 알림함'. 회원에게 불리하지 않은 변경이라 7일 공지로 본다(법무 확인).

**화면 동의 문구(코드에 들어 있음, 스위치 ON에서만 보임)**

- 온보딩 안내(1단계): "생년월일과 약관 동의를 저장한 뒤 휴대폰 번호를 인증하면 바로 시작할 수 있어요." / (2단계)
  "마지막으로 휴대폰 번호를 인증해주세요. 인증을 마치면 ICONS를 시작할 수 있어요."
- 휴대폰 인증 안내: "문자로 받은 인증번호로 휴대폰 번호를 확인해요. 해외 번호도 인증할 수 있어요. 한 번호는 한
  계정에서만 인증된 상태로 남아요." — 처리방침 개정과 함께 "번호는 주문·배송 안내와(동의한 경우) 광고성 정보 발송에만
  써요" 같은 목적 문장을 더할지 법무와 정한다.
- 재인증 안내: "다른 계정에서 같은 휴대폰 번호를 인증해 이 계정의 휴대폰 인증이 해제됐어요. 다시 인증하면 이어서 이용할 수 있어요."
- 마케팅 정보 수신 동의(카카오톡) 안내(v2): "카카오톡은 ICONS 카카오톡 채널 메시지로 보내 드려요. 채널을 차단해도 받지 않아요."
  / "알림함의 마케팅 소식은 이메일·SMS·카카오톡 중 하나라도 수신에 동의하면 받아요."
- 설정 카카오 계정 연결: "카카오 계정을 연결하면서 같은 동의 화면에서 ICONS 카카오톡 채널을 추가할 수 있어요. 채널을 추가하면
  친구 추가 쿠폰을 한 번 드려요."

**사전 공지문 초안**: "[개인정보처리방침 개정 안내] 휴대폰 번호 인증과 SMS·카카오톡 알림을 시작하면서 수집 항목(휴대폰
번호와 인증 이력, 카카오 계정 회원번호와 카카오톡 채널 추가 상태), 이용 목적, 보유 기간, 처리위탁(SMS 발송사, 카카오)을
고칩니다. 시행일: YYYY-MM-DD. 변경 전·후 비교는 개인정보처리방침에서 볼 수 있어요."

## 8. 켜는 순서

1. (1014-004, 지금) 배포 파이프라인이 운영 확인 메일 템플릿을 반영(§3, deploy-supabase) → 앱 배포 → 운영 테스트 계정으로 메일·코드 확인.
2. 휴대폰 인증 발송사: Twilio Verify로 연결했다(§4). SMS 알림용 발신번호·080 무료 수신거부 번호는 아직이다.
3. 카카오톡 채널 개설(H5)·콘솔 설정·지정 고객 친구 추가 쿠폰 정의·manual linking(§6).
4. 처리방침 개정: 휴대폰 인증·이메일 변경분은 2026-11-17 공지·11-18 시행으로 반영됐다. SMS 알림·카카오톡 채널분은 §7 초안을
   확정해 공지하고 `SMS_NOTIFICATIONS_AND_KAKAO_PRIVACY_EFFECTIVE_DATE`를 시행일로 채운다(7일 공지).
5. 시행일 뒤 env: 휴대폰 인증은 §4 '발송사 연결'의 env 목록(Twilio 키·서비스 SID·`ICONS_PHONE_VERIFICATION_SECRET`)
   → `ICONS_PHONE_VERIFICATION_ENABLED=true`. env는 시행일 전에 넣어도 운영에서는 시행일(11-18 KST)부터 열린다. SMS 알림은
   `ICONS_SMS_ADVERTISING_OPT_OUT` → `ICONS_SMS_NOTIFICATIONS_ENABLED=true`. 카카오는 §6의 6번. 재배포로 반영된다.
6. 확인: 직원 테스트 계정으로 온보딩 2단계(생년월일·약관 → 휴대폰 인증), 설정 번호 변경, 같은 번호를 두 번째 계정에서 인증해
   첫 계정이 주문 전에 인증 단계로 가는지, 카카오 로그인 동의 화면의 채널 추가 → 쿠폰 1장(재로그인해도 1장), 이메일 계정의
   설정 [카카오 계정 연결] → 채널 추가 → 쿠폰 1장.

## 9. 시험(로컬)

- DB: `supabase/tests/member_phone_verification.sql`, `customer_marketing_consent_kakao.sql`, `kakao_channel_friend_coupon.sql`
  (`scripts/database-test-shards.mjs` 등록).
- 가입 코드: 메일 캡처(inbucket/mailpit)가 있는 로컬 스택에서 가입 → 메일의 6자리 → 같은 화면 입력 → 온보딩. 새로고침 뒤
  [받은 코드 입력하기] → 코드 입력 → 로그인 화면(`signup_confirmed=1`) 안내. 로컬 템플릿은 `supabase/config.toml`이 이미
  코드 포함 템플릿을 쓴다.
- 휴대폰 인증: `ICONS_PHONE_VERIFICATION_ENABLED=true`, `ICONS_PHONE_VERIFICATION_SECRET`(32자 이상),
  `ICONS_SMS_PROVIDER=console`(로컬 전용 — 인증번호가 서버 로그 `[sms:console]`에 찍힌다). Vercel에서는 console이 만들어지지 않는다.
  재인증은 두 계정에서 같은 번호를 차례로 인증한 뒤 첫 계정으로 `/checkout` 같은 보호 화면을 연다.
- 이메일 변경: `supabase/tests/member_email_change.sql`. 로컬(Vercel 밖)에서 메일 발송 설정이 없으면 코드가 서버 로그
  `[email-change:console]`에 찍힌다(`EMAIL_DISPATCH_HMAC_SECRET` 32자 이상은 필요). 릴레이 계정은 DB에서
  `update auth.users set email='<임의>@privaterelay.appleid.com'`으로 만든다.
- Twilio Verify: 단위 시험이 요청 모양(CustomCode·Locale)·오류 분류·피드백을 고정한다. 실제 문자는 Preview에 키를 넣고 본인
  번호로 확인한다.
- 카카오: 실제 채널 없이는 관계 조회가 실패해 `relation_unknown`으로 끝난다. 로컬에는 카카오 provider가 없어 [카카오 계정
  연결]은 실패 안내로 끝난다. 단위 시험이 가짜 응답으로 흐름을 고정한다.

## 10. 롤백

- env 스위치를 끄고 재배포하면 화면·서버 경로가 즉시 닫힌다. 저장된 번호·동의·쿠폰·카카오 identity 연결은 남는다
  (탈퇴 처리·보관 작업은 계속 돈다). 휴대폰 스위치를 끄면 재인증 요구도 함께 멈춘다.
- 카카오톡에 동의한 회원은 스위치가 꺼져도 설정에서 철회할 수 있다.
- 1014-004는 스위치가 없다. 되돌리려면 코드 revert — 템플릿은 코드+링크라 그대로 둬도 된다.

## 11. 남는 위험

- 서버 액션이 부르는 GoTrue 검증·로그인은 Vercel 함수 IP로 한도가 묶인다(로그인·가입과 같은 기존 구조). 혼잡하면 정상 회원의
  코드 확인이 `over_request_rate_limit`에 걸릴 수 있다. 코드 확인은 이제 확인 + 비밀번호 로그인 두 번을 쓴다.
- 가입 폼을 다른 비밀번호로 다시 제출하면(같은 미확인 계정) GoTrue는 처음 비밀번호를 유지한다(2026-11-11 로컬 격리 스택
  실측: 두 번째 비밀번호 로그인 400, 첫 비밀번호 200). 그때 코드 확인 뒤 로그인이 실패해 로그인 화면으로 가고, 처음
  비밀번호나 재설정으로 들어온다.
- 휴대폰 번호 인증은 번호 소유 확인이다. 번호를 여러 개 가진 사람의 다계정은 막지 못한다(카페24 '휴대폰 인증 간소화'와 같은 한계).
  재인증 요구는 온보딩 게이트를 거치는 앱 경로에만 걸린다 — 스위치를 끄면 풀리고, DB RPC가 직접 판정하지는 않는다.
- SMS 펌핑: 국가 허용 목록(기본 한국만)과 번호·IP·회원 한도로 줄이지만 발송사 측 국가·건수 제한도 함께 둔다.
- 카카오 채널 웹훅 재전송 정책은 확인하지 못했다. 발급은 멱등이고 다음 로그인·온보딩·설정 확인이 다시 시도한다.
- [친구 추가 쿠폰 받기]는 누를 때마다 카카오 관계 조회 API를 한 번 부른다. 회원별 호출 제한은 두지 않았다(발급은 멱등).

## 12. 소셜 로그인 이메일 — Apple 이메일 가리기(2026-11-17)

Apple 로그인에서 '이메일 가리기'를 고르면 Apple은 `<임의>@privaterelay.appleid.com` 릴레이 주소를 넘긴다. 이 주소는 **우리
발신 도메인을 Apple에 등록하기 전에는 메일을 받지 못한다**(Apple Private Email Relay가 등록되지 않은 발신자를 거절).
결정(2026-11-17 사용자): '도메인 등록 + 선택 변경'. Apple 로그인 뒤 실제 이메일을 필수로 요구하지 않는다 — iOS 앱을 내면
App Store 심사 가이드라인 4.8(로그인 서비스는 이메일을 숨길 수 있어야 한다)에 걸린다.

### 발신 도메인 등록(사람)

1. Apple Developer → Certificates, Identifiers & Profiles → Services → **Sign in with Apple for Email Communication** → Configure.
2. 우리가 메일을 **보내는** 도메인(또는 주소)을 등록한다. 사이트 주소가 아니라 발신 주소 기준이다:
   - 거래·이메일 변경 메일: Resend의 발신 주소(`RESEND_FROM`, 없으면 `EMAIL_FROM`)의 도메인
   - 가입 확인·비밀번호 재설정 메일: Supabase Auth custom SMTP 발신 주소(`smtp_admin_email`)의 도메인
3. 도메인은 SPF가 통과해야 한다(Resend 도메인 설정에 이미 있는 SPF·DKIM). Apple이 보여 주는 확인 상태가 Verified인지 본다.
4. 확인: Apple '이메일 가리기'로 가입한 테스트 계정에 주문 확인 메일이 실제 메일함에 오는지 본다.

**사이트 도메인을 바꿀 필요는 없다.** 등록 대상은 발신 도메인이고 여러 개를 등록할 수 있다. 나중에 xsquare.kr로 메일을 보내기
시작하면 그 도메인을 추가 등록한다. 릴레이 주소는 사이트 도메인이 아니라 Apple 개발자 팀에 묶여 있어 사이트 도메인을 바꿔도
기존 회원의 릴레이 주소는 그대로다.

### 이메일 변경(앱)

- 대상: 로그인 이메일(`auth.users.email`)이 비었거나 릴레이 주소인 회원만(`lib/auth/email-change.ts` `isUnusableLoginEmail`,
  DB `private.member_login_email_unusable`). 일반 이메일 계정은 이 경로로 바꿀 수 없다 — 현재 주소 확인 없이 바꾸는 길이 되지
  않게 한다(운영 Auth는 보안 이메일 변경이 켜져 있어 Supabase 기본 이메일 변경은 현재 주소(릴레이)로도 확인 메일이 가야 끝난다
  — 바로 그 주소가 메일을 못 받는 경우라 쓰지 않는다).
- 흐름: 온보딩 1단계 폼 바깥(릴레이는 [다른 이메일로 바꾸기] 선택, 빈 값은 필수)과 설정 → 새 이메일 → Resend로 6자리 코드
  (10분) → DB `service_verify_member_email_change`가 확인 → 서비스 롤 Admin API `updateUserById(email, email_confirm)` →
  트리거 `on_auth_user_email_changed`가 `profiles.email`을 맞춘다(주문자 이메일·거래 메일이 profiles.email을 먼저 읽는다).
- 한도: 같은 회원 60초 간격(주소 단위로는 세지 않는다 — 다른 회원의 요청 여부가 드러나지 않게), 회원·주소 1시간 5건·24시간
  10건, IP 1시간 10건·24시간 30건, 오입력 5번이면 닫힘. '이미 쓰는 주소'는 코드를 맞힌 뒤에만 알린다(주소만으로 가입 여부를
  알아내지 못하게). 요청 행은 이틀 뒤·탈퇴 신청 시 지운다.
- 세션 탈취 대비: 요청을 보낸 바로 그 세션이 최근 30분 안에 만들어졌어야 한다. 앱이 서명 검증한 JWT(`getClaims`)의
  `session_id`를 넘기고 DB가 `auth.sessions`(이 회원의 세션·생성 30분 이내·만료 전)로 판정한다. 계정 전체 값인
  `auth.users.last_sign_in_at`은 다른 브라우저의 로그인으로 오래된 세션이 통과하므로 쓰지 않는다(계정 탈퇴 재인증과 같은 원칙).
  아니면 "다시 로그인한 뒤".
  바꾼 뒤에는 이전 주소(있으면)로 "계정 이메일이 바뀌었어요" 알림을 응답 뒤에 보낸다(새 주소는 가려서).
- 운영 공개: 휴대폰 인증과 같은 법적 게이트(`CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE`, 11-18 KST)를 따른다 — 처리방침 개정이
  이 처리(새 이메일·IP 다이제스트)를 고지한 뒤에만 연다. 그 전에 이메일이 없는 계정에는 "지금은 등록할 수 없다"는 안내가 보인다.
- 이메일이 없는 계정은 휴대폰 인증 단계로 넘어가지 않는다(1단계에서 이메일을 먼저 확인).
- 비밀값: 새 env 없이 메일 발송 기록의 `EMAIL_DISPATCH_HMAC_SECRET`(도메인 분리 `icons:member-email-change:v1`)을 쓴다. 이 값이나
  Resend 설정이 없으면 조각을 그리지 않는다.

### 남는 위험

- **Apple로 다시 로그인할 때 이메일이 되돌아가는지 운영에서 확인하지 못했다.** GoTrue는 기존 identity로 로그인할 때 identity
  데이터와 user_metadata만 갱신하고 로그인 이메일은 바꾸지 않는 것으로 안다(추정 — supabase/auth `external.go` 기억, 로컬에는
  Apple provider가 없어 실측 불가). 배포 뒤 릴레이 계정으로 이메일을 바꾸고 Apple로 다시 로그인해 설정의 이메일이 그대로인지 본다.
- 주소별 한도(1시간 5건·24시간 10건)는 회원끼리 공유한다 — 대상 계정 하나로 남의 주소에 코드 메일을 하루 10통까지 보내 그
  주소로의 변경을 하루 막을 수 있다(메일함 보호와의 거래). 코드 확인 뒤 Admin API가 일시 실패하면 코드가 소모돼 처음부터 다시 받는다.
- 이메일을 바꾼 Apple 회원에게 비밀번호 재설정 메일을 보내면 비밀번호 로그인이 생긴다. 소셜 계정 비밀번호 설정 제한
  (`PASSWORD_UNAVAILABLE_FOR_SOCIAL_ACCOUNT_MESSAGE`)과의 관계는 따로 보지 않았다.

## 13. 가입·확인 메일 재전송·비밀번호 재설정 봇 차단(2026-11-19, 원장 CUS-002·003·OPS-084·085)

### 문제

세 요청은 공개 서버 액션이고 모두 Supabase Auth 메일을 보낸다. 운영 Auth는 `rate_limit_email_sent`(시간당 300통,
`scripts/sync-supabase-auth.mjs`의 `AUTH_EMAIL_RATE_LIMIT_PER_HOUR`)를 프로젝트 전체가 나눠 쓴다. 앱의 재전송 창(10분 3회)은
서명 쿠키라 쿠키를 버리면 매번 새 창이고, GoTrue의 IP 한도는 서버 액션이 Vercel 함수 IP로 부르므로 공격자 IP별로 걸리지
않는다. 봇이 300통을 먼저 쓰면 정상 고객의 가입 확인·재설정이 막힌다.

### 방어 두 겹(코드 `lib/auth/mail-abuse.server.ts`, 호출은 `app/login/actions.ts`의 `rejectAbusiveAuthMail`)

메일을 보내는 `signUpWithEmailAction`·`resendSignupCodeAction`·`requestPasswordResetAction`이 Supabase를 부르기 전에 차례로 거친다.

1. **Cloudflare Turnstile**(키는 사람 단계). `NEXT_PUBLIC_TURNSTILE_SITE_KEY`와 `TURNSTILE_SECRET_KEY`가 **둘 다** 있을 때만
   켜진다. 켜지면 가입(메일 입력 단계)·재설정(로그인 화면·복구 필요 화면·설정)·코드 재받기 폼에 위젯(`components/auth/TurnstileField.tsx`,
   `interaction-only` — 평소엔 보이지 않는다)이 그려지고, 서버 액션이 `cf-turnstile-response` 토큰을 Cloudflare siteverify로
   검증한다(서버 전용 비밀 키, 5초 시간 제한, 토큰 없음·검증 실패·시간 초과는 모두 거절). 둘 다 없으면 꺼져 있고 지금과 같다.
   로그인(비밀번호·소셜)에는 걸지 않는다 — 로그인은 메일을 보내지 않는다.
2. **접속 IP·이메일 시도 한도**(키 없이 지금 켜짐). DB 원장 `private.auth_mail_abuse_attempts`와 `service_role` 전용 RPC
   `service_consume_auth_mail_attempt`(`supabase/migrations/20261119106000_auth_mail_abuse_limits.sql`)가 판정한다.
   접속 IP(`x-real-ip` → `x-forwarded-for` 첫 값, 휴대폰 인증과 같은 선례)와 이메일은 **원문을 저장하지 않고** 앱 서버가 만든
   HMAC 다이제스트만 보낸다. 이틀 지난 행은 매시 정리 작업(`auth-mail-abuse-retention`, pg_cron이 있는 배포만 등록)이 지운다.

| 범위 | 시간당 | 하루 | 근거 |
|---|---|---|---|
| 접속 IP(세 요청 합산) | 15 | 40 | 세 요청이 모두 메일을 보내므로 종류별이 아니라 합쳐 센다 — 따로 세면 한 IP가 합산으로 프로젝트 한도를 독점한다. 15는 Auth 한도(300)의 5% 이하라 IP 하나가 프로젝트 한도를 독점하지 못한다. 가입 1건이 메일 1~2통이라 학교·통신사 NAT 뒤 동시 가입 7~8명/시간까지 통과한다. |
| 이메일(세 요청 합산) | 5 | 12 | 남의 주소로 확인·재설정 메일을 반복해 보내는 메일 폭탄을 막는다. 앱 쿠키 한도(3회/10분)보다 느슨해 정상 사용을 막지 않는다. |

- 막힌 시도는 기록하지 않는다(거절이 창을 늘리지 않는다). 걸리면 사용자 문구는 앱 쿠키 한도와 같은 형태이고, IP 때문인지
  이메일 때문인지는 밝히지 않는다. 남은 시간이 10분을 넘으면 그 시간(분·시간 올림)을 안내한다.
- 한도 값을 바꾸려면 migration의 `service_consume_auth_mail_attempt` 안 숫자(15·40·5·12)를 새 migration에서 앵커 치환하고 이 표를 고친다.
  Auth 시간당 한도 상수를 바꾸면 IP 시간 한도를 그 5% 이하(현재 300 기준 15)로 다시 본다.
- 이메일 별칭(`+tag`·gmail 점)은 정규화하지 않는다(소문자·공백 제거만). 별칭을 돌려 남의 메일함을 폭탄하는 경우는 IP 한도와 Turnstile이 막는다.

### 결정과 근거

- **HMAC 비밀값은 `AUTH_SIGNUP_RESEND_SECRET` 재사용**(새 env 없음). 이 값은 production·preview 빌드 가드의 필수 env라 운영에 이미 있고,
  새 env를 요구하면 등록 전까지 방어가 꺼진다. 키가 쿠키 서명과 같아도 메시지 앞에 도메인 접두(`icons-auth-mail-abuse-v1` + 종류)를
  붙여 서로 다른 용도의 값을 위조·충돌시킬 수 없다. 이 값을 돌리면 쌓인 다이제스트는 의미를 잃지만(한도 창이 비워짐) 이틀 안에 사라진다.
- **가용성 우선(fail open).** 비밀값이 없거나(로컬) 한도 DB 호출이 실패하면 한도를 건너뛰고 경고·오류 로그만 남긴다 — 방어 설정 누락이나
  일시 장애가 가입·재설정을 막아서는 안 된다. 그 사이에도 Supabase Auth 자체 한도와 앱 쿠키 창은 남는다. Turnstile은 반대로 켜져 있으면
  fail closed다(토큰 없음·검증 실패 모두 거절). 막힘이 의심되면 두 키를 지우고 재배포하면 꺼진다.
- **Supabase Auth 자체 CAPTCHA(`[auth.captcha]`)는 켜지 않는다.** 켜면 이 세 요청뿐 아니라 로그인·소셜 콜백 교환 등 모든 Auth 호출에 토큰이
  필요해져 서버 액션·콜백이 모두 바뀌어야 한다. 메일을 보내는 경로는 이 앱 서버뿐이라 앱 서버 검증으로 충분하다(로컬 `config.toml`도 꺼 둔 채).
- **CSP.** 이 저장소는 `Content-Security-Policy` 헤더를 두지 않아(`next.config.ts`·`proxy.ts` 확인) `challenges.cloudflare.com` 허용 목록을
  바꿀 곳이 없다. CSP를 도입하게 되면 `script-src`·`frame-src`·`connect-src`에 `https://challenges.cloudflare.com`을 넣어야 한다.
- **빌드 가드.** `scripts/check-vercel-build-env.mjs`는 production·preview에서 두 키 중 하나만 있으면 빌드를 멈춘다(사이트 키만이면 위젯만
  그려지고 서버가 검증하지 않고, 비밀 키만이면 꺼진 채 보호된다고 오해한다).
- **Auth 시간당 메일 한도 값**은 `AUTH_EMAIL_RATE_LIMIT_PER_HOUR` 한 상수로 모았고 검증식·시험·런북이 이 상수를 따른다. 값 자체(현재 300, 2026-11-19 사용자 결정)는
  로컬 `supabase/config.toml`의 `email_sent`는 로컬 스택용이라 바꾸지 않는다.

### 사람 단계(Turnstile 켜기 — 코드는 이미 있고 키만 넣으면 된다)

1. Cloudflare 대시보드 → Turnstile → 위젯 추가(호스트 이름: `iconsip.com`, `xsquare.kr` 및 쓰는 preview 도메인, 모드 Managed).
   사이트 키·비밀 키를 받는다. 비밀 키는 채팅·로그에 남기지 않는다(사용자 스크립트로 등록).
2. Vercel Production·Preview 환경 변수에 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`(공개 값)와 `TURNSTILE_SECRET_KEY`(서버 전용)를 **둘 다** 등록하고 재배포한다.
   사이트 키는 빌드에 박히므로 재배포가 필요하다.
3. 확인: 가입 폼에서 정상 제출이 통과하는지, 브라우저 개발자 도구로 `cf-turnstile-response` 입력을 비운 채 제출하면
   "자동 가입 방지 확인을 완료하지 못했습니다" 안내가 나오는지, 재설정·코드 재받기도 같은지. Cloudflare 테스트 키
   (사이트 `1x00000000000000000000AA` / 비밀 `1x0000000000000000000000000000000AA`)는 항상 통과, `2x…`는 항상 실패라 Preview에서 흐름만 볼 수 있다.
4. 운영 중 위젯이 안 뜨는 환경(광고 차단 등)에서는 가입이 막힌다 — 안내 문구가 새로고침을 권한다. 문의가 늘면 한도 로그부터 보고 Turnstile 키를 내린다.

### 시험

- DB: `supabase/tests/auth_mail_abuse_limits.sql`(봉인·다이제스트만 저장·IP·이메일 한도·IP 없음·막힌 시도 미기록·입력 검증·보관 기한).
- 앱: `app/login/actions.test.ts`(한도 초과 문구·쿠키 버리기·IP 헤더 없음·비밀값 없음·DB 실패 시 열림·Turnstile 켜짐/꺼짐/검증 실패/시간 초과),
  `lib/auth/mail-abuse.server.test.ts`, `components/auth/TurnstileField.test.tsx`, `scripts/check-vercel-build-env.test.mjs`, `scripts/sync-supabase-auth.test.mjs`.


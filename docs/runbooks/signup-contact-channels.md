# 가입 간소화·휴대폰 번호 인증·연락 수단(SMS·카카오톡) 런북

10/14 실사용 QA 회의 요청(원장 1014-004·005·006·010·014)과 2026-11-11 사용자 결정(묶음 6)을 구현한 범위, 켜는 순서,
사람이 해야 하는 일, 바뀔 개인정보처리방침·동의 문구 초안을 모은다. 키·비밀번호·인증키 값은 이 문서·이슈·PR·로그에
남기지 않는다.

## 1. 지금 상태

| 항목 | 동작 | 스위치(기본) | 사람 게이트 |
| --- | --- | --- | --- |
| 1014-004 가입 확인 코드 | 회원가입 뒤 같은 화면에서 메일의 6자리 확인 코드를 입력해 가입을 잇는다. 메일 링크도 그대로 동작한다 | 없음(배포 즉시) | **운영 Auth 확인 메일 템플릿에 코드 넣기**(§3) |
| 1014-004 닉네임 자동 | 온보딩은 닉네임을 묻지 않는다. 닉네임이 없는 계정은 `fan_` + 8자 자동 닉네임을 받고 설정에서 바꾼다. 필수 입력은 생년월일·약관 2종 | 없음 | 없음 |
| 1014-005·006 휴대폰 번호 인증 | 온보딩(필수)·설정에서 SMS 인증번호로 휴대폰 번호(해외 포함)를 확인한다 | `ICONS_PHONE_VERIFICATION_ENABLED` OFF | 발송사 계약(H4)·처리방침 공지 |
| 1014-010 수단별 수신 동의 | 이메일·SMS에 카카오톡 수신 동의를 더한다 | 카카오톡 채널 스위치를 따른다 OFF | 처리방침 공지 |
| 1014-010 SMS 알림 seam | 인증 번호·SMS 동의를 DB가 확인한 회원에게 SMS를 보내는 함수 하나(`sendMemberSms`). 부르는 기능은 아직 없다 | `ICONS_SMS_NOTIFICATIONS_ENABLED` OFF | 발송사·080 수신거부 번호 |
| 1014-014 카카오톡 채널 | 카카오 로그인 동의 화면 채널 추가(plusfriends 동의항목) + 채널 친구 추가 쿠폰 1회 자동 발급 | `ICONS_KAKAO_CHANNEL_ENABLED` OFF | 채널 개설(H5)·콘솔 설정·쿠폰 정의·처리방침 공지 |

스위치가 꺼져 있으면 로그인·온보딩·설정 화면과 카카오 로그인 요청은 기능을 넣기 전과 한 글자도 같다
(`components/screens/ContactChannelsSwitchOff.test.tsx`가 도입 전 렌더 기준 `test/fixtures/contact-channels-off/`와 비교한다).

**운영 법적 게이트.** 세 스위치 모두 운영(`VERCEL_ENV=production`)에서는 `lib/auth/contact-channels.ts`의
`CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE`(처리방침 개정 시행일, KST)가 채워지고 그날이 지나야 듣는다. 지금 값은
`null`이라 env만 켜서는 운영에서 열리지 않는다. Preview·로컬은 env만으로 연다.

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
차단하지 않고 옮긴다'.

## 3. 1014-004 가입 확인 코드

- 회원가입 → `signUp()`이 확인 메일을 보내면 `pendingSignupEmail`을 돌려주고, 화면은 같은 자리에서 코드 입력 단계를 연다
  (`components/screens/Login.tsx`의 `SignupCodeStep`). 입력한 코드는 `verifyOtp({ email, token, type: 'email' })`로
  확인한다 — GoTrue는 가입 확인 토큰을 먼저 보고 PKCE 가입의 `pkce_` 토큰도 같은 코드로 통과시키며, 성공하면 세션을
  돌려준다(supabase/auth `internal/api/verify.go` `isOtpValid` 확인). 그다음은 링크 콜백과 같은 정지·온보딩 경로다.
- [코드 다시 받기]는 회원가입 폼 재제출과 같은 서명 쿠키 창(10분에 3번)을 나눠 쓴다.
- 코드 대입은 GoTrue의 IP별 검증 한도(`rate_limit.token_verifications`)와 코드 만료(`mailer_otp_exp`, 운영 3600초)가
  막는다. 이 표면은 화면을 넣기 전에도 공개 Auth API(`POST /auth/v1/verify`)에 있었다.
- 코드로 가입을 마친 뒤 같은 메일의 링크를 열면 토큰이 이미 쓰여 링크 오류 화면이 나온다. 문구가 "코드로 이미 가입을
  마쳤다면 로그인"을 안내한다.

### 사람 게이트: 운영 확인 메일 템플릿

운영 Supabase Auth의 "Confirm signup" 템플릿에 코드(`{{ .Token }}`)가 없으면 화면은 코드를 기다리는데 메일에는 링크만 있다.
**앱 배포 전에** 템플릿을 바꾼다 — 새 템플릿은 코드와 링크를 함께 담아 지금 화면(링크만 안내)에서도 그대로 동작한다.

1. 제목·본문은 `supabase/templates/confirmation.html`과 `supabase/config.toml`의 `[auth.email.template.confirmation]`
   (제목 `ICONS 가입 확인 코드`)과 같게 한다.
2. 반영은 대시보드(Authentication → Email Templates → Confirm signup) 또는 Management API
   `PATCH /v1/projects/{ref}/config/auth`의 `mailer_subjects_confirmation`·`mailer_templates_confirmation_content`다.
   PAT는 환경변수로만 넘긴다. 반영 뒤 같은 API로 읽어 원문과 같은지 확인한다.
3. 운영 직원 테스트 계정으로 가입 → 메일에 6자리 코드와 버튼이 함께 있는지 → 코드 입력으로 온보딩까지 가는지 본다.
4. 선언 관리로 옮기려면 `scripts/sync-supabase-auth.mjs`에 recovery 템플릿처럼 확인 메일 템플릿 경로를 더하고
   pipeline의 production·preview Auth sync 단계에 연결한다(이 트랙 범위 밖 — 오케스트레이터 후속).
5. Send Email Hook(#191, 기본 OFF)을 켜기 전에는 `lib/email/auth-hook.ts`의 signup 메일에도 `email_data.token`(6자리)을
   넣어야 한다. 지금 그 메일은 링크만 담는다.

Preview·스테이징 Auth는 기본 템플릿(링크만)이라 코드 단계는 로컬에서 시험한다(§9).

## 4. 1014-005·006 휴대폰 번호 인증

흐름: 나라·번호 입력 → 서버가 E.164로 정규화(`lib/sms/phone-number.ts`, 한국은 휴대폰 번호 형식까지 확인) → 6자리
인증번호 생성 → DB `service_issue_member_phone_verification`이 한도를 판정하고 요청을 기록 → 발송 seam으로 문자 →
화면에서 6자리 입력 → `service_verify_member_phone_verification`이 HMAC 비교 → 번호를 회원에게 기록.

| 규칙 | 값 | 판정 위치 |
| --- | --- | --- |
| 인증번호 | 6자리, 5분 | 앱(`PHONE_CODE_TTL_SECONDS`) + DB 만료 |
| 오입력 | 요청당 5번, 넘으면 요청 닫힘 | DB |
| 재발송 간격 | 같은 회원 또는 같은 번호 60초 | DB |
| 회원 한도 | 1시간 5건 · 24시간 10건 | DB |
| 번호 한도 | 1시간 5건 · 24시간 10건 | DB |
| IP 한도 | 1시간 10건 · 24시간 30건(IP를 알 때) | DB |
| 발송 실패 | 요청을 닫고 한도에는 센다 | DB |
| 한 번호 한 계정 | 다른 계정이 인증하면 이전 계정의 인증 해제(이력 `released`) | DB |
| 탈퇴 신청(계정 봉인) | 같은 트랜잭션에서 번호·진행 중 요청 삭제 | DB 트리거 |
| 보관 | 결과가 정해진 요청은 번호 원문 삭제, 매시 작업이 만료 요청을 닫고 이틀 지난 요청 행 삭제 | pg_cron `member-phone-verification-retention` |

저장: `private.member_phone_numbers`(회원당 1개, E.164), `private.member_phone_verification_challenges`(요청, 번호 원문은
진행 중에만), `private.member_phone_verification_events`(인증·해제 이력, 번호는 다이제스트). 인증번호·번호·IP는
`ICONS_PHONE_VERIFICATION_SECRET` HMAC으로만 비교·집계한다. 이 값을 바꾸면 진행 중 요청이 모두 무효가 되고 한도 창이
초기화된다(저장된 번호에는 영향 없음).

스위치를 켜면 온보딩 완료에 인증 번호가 필요하다. **이미 온보딩을 마친 회원은 다시 막지 않는다** — 설정에서 등록·변경할
수 있다. 기존 회원에게도 요구할지는 켜기 전에 정할 일이다.

### 발송사 연결(H4 뒤)

`lib/sms/sender.server.ts`의 `SmsSender`를 구현하고 `smsSenderFromEnvironment`의 `ICONS_SMS_PROVIDER` 값 하나에 연결한다.
키는 서버 env로만 받는다. 국내 발신번호 사전등록, 해외(특히 +86) 단가·도달률, SMS 펌핑 대비 국가·건수 제한을 계약에서
정하고 `ICONS_PHONE_VERIFICATION_COUNTRIES`에 연 나라만 적는다(비우면 한국만).

## 5. 1014-010 수단별 수신 동의(카카오톡)와 SMS 알림 seam

- 동의 원장(`private.customer_marketing_consents`)이 `kakao` 수단과 안내 버전 `marketing-channels-v2`를 받는다. 화면은
  카카오톡 채널 스위치가 켜졌을 때만 카카오톡 줄을 그리고 `set_my_marketing_consents_v2`로 세 수단을 저장한다. 꺼져 있으면
  예전 `set_my_marketing_consents`(v1)만 부른다.
- 스위치를 껐을 때 이미 카카오톡에 동의한 회원에게는 줄을 계속 보여 철회할 수 있게 한다(새 동의는 받지 않는다).
- 파생값 `profiles.consents.marketing`(인앱 마케팅 소식·고객 세그먼트가 읽는 값)은 세 수단 중 하나라도 동의면 true다.
- SMS 알림 seam `sendMemberSms`(`lib/sms/notifications.server.ts`)의 법적 경계(정보통신망법 제50조·시행령 제61조 —
  법무 확인 전 초안 기준):
  - 광고성 정보는 SMS 수신 동의가 있는 회원에게만. 받는 사람은 DB `service_member_sms_recipient`가 인증 번호·동의 원장으로 정한다.
  - 본문 앞 `(광고)` + 전송자 명칭(ICONS), 끝에 무료 수신거부 방법(`ICONS_SMS_ADVERTISING_OPT_OUT`, 예: `무료수신거부 080-…`).
    이 문구가 없으면 광고성 정보를 보내지 않는다.
  - 오후 9시~다음 날 오전 8시(KST)에는 광고성 정보를 보내지 않는다(야간 별도 동의를 받지 않는다).
  - 거래 안내(주문·배송)는 동의와 무관하지만 인증 번호로만 보낸다.
- 아직 이 seam을 부르는 기능은 없다. 생산자(예: IP 소식 알림)를 만들 때 이메일 dispatcher처럼 발송 기록(본문 제외)·재시도·
  2년 수신 동의 재확인(시행령 제62조의3)을 함께 설계한다.

## 6. 1014-014 카카오톡 채널

- 스위치가 켜지면 카카오 로그인에 `plusfriends`(카카오톡 채널 추가 상태 및 내역) 동의항목을 더 요청한다. 동의 화면의
  "채널 추가" 항목은 카카오 콘솔 설정이 그린다. **콘솔에 이 동의항목이 없는데 요청하면 카카오가 로그인을 거절한다
  (KOE205)** — 콘솔을 먼저 맞추고 스위치를 켠다.
- 친구 추가 쿠폰: 카카오 채널 관계 조회 API(`GET https://kapi.kakao.com/v2/api/talk/channels`, 어드민 키 방식 —
  `target_id_type=user_id`)로 `ADDED`를 확인한 회원에게 `ICONS_KAKAO_CHANNEL_COUPON_CODE` 쿠폰을 회원·채널당 한 번
  발급한다(`private.kakao_channel_friend_rewards`, 쿠폰 출처 `kakao_channel`). 확인하는 때:
  카카오 identity가 있는 회원의 로그인 직후, 온보딩 완료 직후, 채널 웹훅(added) 수신 때 — 모두 응답을 보낸 뒤(after).
  웹훅 본문은 확인을 시작하는 신호일 뿐이다.
- 대상은 운영자 일괄 발급과 같다: 일반 회원·온보딩 완료·만 14세 이상·정지/탈퇴 봉인 아님. 쿠폰이 끝났거나 한도를 다 쓰면
  원장을 남기지 않아 쿠폰을 고친 뒤 다음 확인 때 발급된다. 채널을 차단했다 다시 추가해도 다시 받지 않는다.
- 이메일·Google·Apple로 가입한 회원은 카카오 identity가 없어 자동 확인 대상이 아니다(카카오 로그인 동의 화면을 거치지 않는다).

### 콘솔·운영 준비(사람)

1. 카카오톡 채널 개설(신사업팀, H5) — '아이콘스' 이름 사용 가능 여부 확인(10/14 회의 25:04).
2. 카카오 앱(앱 ID는 ARCHITECTURE §8, 이미 비즈 앱)에 채널 연결 → 대표 채널 지정 → [카카오 로그인] > [동의항목]에서
   `plusfriends` 선택 동의 설정.
3. [앱] > [웹훅] > [카카오톡 채널 웹훅]에 `https://iconsip.com/api/webhooks/kakao/channel` 등록.
4. 어드민 쿠폰 화면에서 친구 추가 쿠폰 정의를 만든다(코드·금액·기간·발급 한도).
5. env: `KAKAO_CHANNEL_PUBLIC_ID`(채널 프로필 ID, `_`로 시작), `KAKAO_ADMIN_KEY`(대표 어드민 키, 서버 전용),
   `ICONS_KAKAO_CHANNEL_COUPON_CODE`, 마지막에 `ICONS_KAKAO_CHANNEL_ENABLED=true`.

## 7. 개인정보처리방침·동의 문구 초안(시행 7일 전 사전 공지 대상)

공개 중인 본문(`lib/legal/documents.ts`)은 이 작업에서 고치지 않았다. 아래는 켜기 전에 낼 개정안 초안이며 법무 검토 전이다.
개정 PR은 `pendingRevision`(공지)과 `CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE`(시행일)를 함께 채운다.

**제1조 표(수집 항목) — 추가·변경**

| 구분 | 수집 항목 | 수집 시점 |
| --- | --- | --- |
| 온보딩(변경) | 생년월일, 이용약관·개인정보 수집이용 동의 여부, 마케팅 정보 수신 동의 여부(이메일·SMS·카카오톡 수단별, 동의·철회 일시), 팔로우한 IP. 닉네임은 회사가 자동으로 만들고 회원이 설정에서 바꿀 수 있음 | 온보딩 완료 시 |
| 휴대폰 번호 인증 | 휴대폰 번호(국가 번호 포함), 인증 일시. 인증 과정의 요청 기록(요청 시각·결과, 휴대폰 번호와 접속 IP를 복원할 수 없게 변환한 값) | 온보딩 또는 설정에서 휴대폰 번호를 인증할 때 |
| 카카오톡 채널(선택) | 카카오 로그인 회원의 카카오톡 채널 추가 상태(추가·차단·없음)와 채널 친구 쿠폰 발급 기록 | 카카오 로그인 동의 화면에서 '카카오톡 채널 추가 상태 및 내역'에 동의한 경우 |

**제2조(처리 목적) — 추가**

- 휴대폰 번호 인증을 통한 회원 연락처 확인과 한 번호로 여러 계정을 이용하는 부정 이용 방지
- 주문·배송 등 거래 안내와, 수신에 동의한 회원에 한정한 SMS·카카오톡 광고성 정보 발송
- 카카오톡 채널 친구 추가 혜택(쿠폰) 지급

**제3조(보유 기간) — 마무리 문장 추가**

- 인증한 휴대폰 번호는 회원 탈퇴를 처리하면(탈퇴 신청 기능이 켜져 있으면 신청할 때) 지체 없이 파기합니다. 인증번호 요청
  기록은 요청일부터 2일이 지나면 파기합니다. 다른 계정이 같은 번호를 인증하면 이전 계정의 인증 정보는 그때 파기합니다.

**제5조(처리위탁) — 행 추가**(법인명은 계약 뒤 확정, 그 전에는 `확인 중`)

| 수탁자 | 위탁 업무 | 보유·이용기간 |
| --- | --- | --- |
| (SMS 발송사) | 휴대폰 번호 인증번호와 SMS 알림 발송 | 위탁계약 종료 시까지 |
| 주식회사 카카오 | 카카오톡 채널 운영과 채널 메시지 발송, 채널 관계 확인 | 위탁계약 종료 시까지 |

카카오의 지위(수탁자인지, 회원이 직접 이용하는 별도 서비스인지)와 카카오톡 광고 메시지(브랜드 메시지 등) 발송 방식은
채널 계약 때 확정해 위 행을 고친다(추정 — 공식 문서로 확인하지 못함). 해외 발송사를 쓰면 제6조(국외 이전)에도 행을 더한다.

**제7조(권리 행사) — 자가 열람·정정 항목**: '닉네임, 프로필 이미지, 마케팅 정보 수신 동의 여부' → '닉네임, 프로필 이미지,
휴대폰 번호, 마케팅 정보 수신 동의 여부(이메일·SMS·카카오톡)'.

**이용약관 제8조(회원에 대한 통지)**: '이메일 주소 또는 서비스 내 알림함' → '이메일 주소, 인증한 휴대폰 번호(SMS) 또는
서비스 내 알림함'. 회원에게 불리하지 않은 변경이라 7일 공지로 본다(법무 확인).

**화면 동의 문구(코드에 들어 있음, 스위치 ON에서만 보임)**

- 온보딩 휴대폰 인증 안내: "문자로 받은 인증번호로 휴대폰 번호를 확인해요. 해외 번호도 인증할 수 있어요. 한 번호는 한
  계정에서만 인증된 상태로 남아요." — 처리방침 개정과 함께 "번호는 주문·배송 안내와(동의한 경우) 광고성 정보 발송에만
  써요" 같은 목적 문장을 더할지 법무와 정한다.
- 마케팅 정보 수신 동의(카카오톡) 안내(v2): "카카오톡은 ICONS 카카오톡 채널 메시지로 보내 드려요. 채널을 차단해도 받지 않아요."
  / "알림함의 마케팅 소식은 이메일·SMS·카카오톡 중 하나라도 수신에 동의하면 받아요."

**사전 공지문 초안**: "[개인정보처리방침 개정 안내] 휴대폰 번호 인증과 SMS·카카오톡 알림을 시작하면서 수집 항목(휴대폰
번호, 카카오톡 채널 추가 상태), 이용 목적, 보유 기간, 처리위탁(SMS 발송사, 카카오)을 고칩니다. 시행일: YYYY-MM-DD.
변경 전·후 비교는 개인정보처리방침에서 볼 수 있어요."

## 8. 켜는 순서

1. (1014-004, 지금) 운영 확인 메일 템플릿 반영(§3) → 앱 배포.
2. SMS 발송사 계약(H4): 발신번호 등록, 080 무료 수신거부 번호, 해외 범위. `SmsSender` 구현 PR.
3. 카카오톡 채널 개설(H5)·콘솔 설정·친구 추가 쿠폰 정의(§6).
4. 처리방침·약관 개정 PR: §7 초안을 확정해 `pendingRevision`으로 공지하고 `CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE`를 시행일로
   채운다. 머지·배포 후 7일 공지.
5. 시행일 뒤 env: 휴대폰 인증 `ICONS_PHONE_VERIFICATION_SECRET`(32자 이상 무작위)·`ICONS_SMS_PROVIDER`·
   `ICONS_PHONE_VERIFICATION_COUNTRIES` → `ICONS_PHONE_VERIFICATION_ENABLED=true`. SMS 알림은
   `ICONS_SMS_ADVERTISING_OPT_OUT` → `ICONS_SMS_NOTIFICATIONS_ENABLED=true`. 카카오는 §6의 5번. 재배포로 반영된다.
6. 확인: 직원 테스트 계정으로 온보딩 인증, 설정 번호 변경, 카카오 로그인 동의 화면의 채널 추가 → 쿠폰 1장(재로그인해도 1장).

## 9. 시험(로컬)

- DB: `supabase/tests/member_phone_verification.sql`, `customer_marketing_consent_kakao.sql`, `kakao_channel_friend_coupon.sql`
  (`scripts/database-test-shards.mjs` 등록).
- 가입 코드: 메일 캡처(inbucket/mailpit)가 있는 로컬 스택에서 가입 → 메일의 6자리 → 같은 화면 입력. 로컬 템플릿은
  `supabase/config.toml`이 이미 코드 포함 템플릿을 쓴다.
- 휴대폰 인증: `ICONS_PHONE_VERIFICATION_ENABLED=true`, `ICONS_PHONE_VERIFICATION_SECRET`(32자 이상),
  `ICONS_SMS_PROVIDER=console`(로컬 전용 — 인증번호가 서버 로그 `[sms:console]`에 찍힌다). Vercel에서는 console이 만들어지지 않는다.
- 카카오: 실제 채널 없이는 관계 조회가 실패해 `relation_unknown`으로 끝난다. 단위 시험이 가짜 응답으로 흐름을 고정한다.

## 10. 롤백

- env 스위치를 끄고 재배포하면 화면·서버 경로가 즉시 닫힌다. 저장된 번호·동의·쿠폰은 남는다(탈퇴 처리·보관 작업은 계속 돈다).
- 카카오톡에 동의한 회원은 스위치가 꺼져도 설정에서 철회할 수 있다.
- 1014-004는 스위치가 없다. 되돌리려면 코드 revert — 템플릿은 코드+링크라 그대로 둬도 된다.

## 11. 남는 위험

- 서버 액션이 부르는 GoTrue 검증은 Vercel 함수 IP로 한도가 묶인다(로그인·가입과 같은 기존 구조). 혼잡하면 정상 회원의 코드
  확인이 `over_request_rate_limit`에 걸릴 수 있다.
- 휴대폰 번호 인증은 번호 소유 확인이다. 번호를 여러 개 가진 사람의 다계정은 막지 못한다(카페24 '휴대폰 인증 간소화'와 같은 한계).
- SMS 펌핑: 국가 허용 목록과 번호·IP·회원 한도로 줄이지만 발송사 측 국가·건수 제한도 함께 둔다.
- 카카오 채널 웹훅 재전송 정책은 확인하지 못했다. 발급은 멱등이고 다음 로그인·온보딩 확인이 다시 시도한다.

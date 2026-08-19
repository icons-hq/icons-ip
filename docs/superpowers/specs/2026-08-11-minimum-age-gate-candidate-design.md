# 만 14세 이상 서비스 gate 후보 설계 (#188)

> 상태: 내부 위험결정 승인 · local TDD 허용 · Production 시행 별도 gate · GitHub 미게시 · 작성 2026-08-11 · 승인 2026-08-12

## Problem Statement

현재 가입은 생년월일을 받기 전에 Auth 사용자와 이메일이 든 프로필을 만든다. 온보딩 데이터는 인증 사용자가 직접 갱신할 수 있고, 보호 액션의 DB guard는 정지 여부만 확인하므로 만 14세 미만 사용자가 잘못된 클라이언트 흐름이나 직접 호출로 서비스를 시작할 수 있다. 반대로 연령 조건을 기존 `isOnboarded()`에 합치면 이미 존재하는 미성년 계정이 주문·티켓 조회, 취소·환불, 탈퇴·개인정보 권리행사까지 잃는다.

2026-08-12 승인된 내부 계약은 v1을 만 14세 이상으로 제한하고 법정대리인 동의 예외를 제공하지 않는다. 공식 법령을 기준으로 한 보수적 제품·위험결정이며 독립 법률의견은 아니다. 신규 거절 계정의 Auth·Storage 파기와 기존 계정의 권리 보존은 아직 코드에 없으므로 실제 시행은 fail closed한다.

## Solution

`Asia/Seoul` 달력일의 14번째 생일 당일부터 candidate eligibility를 판정하는 서버·DB 진실원을 둔다. 프로필 완성과 새 보호 액션 자격을 분리하고, 자가신고가 14세 이상이어도 provider-neutral `verified_14_plus` assertion 전에는 보호 액션을 fail closed한다. assertion은 제3자 본인확인 사업자가 반환한 over-14 boolean·transaction ref digest·시각·policy version만 저장하고 원 DOB·CI·신분증 원본은 받지 않는다.

신규 미성년은 개인정보를 더 쓰기 전에 `underage_rejected` durable 삭제 요청을 기록하고, 성공 ack 뒤에만 거절 상태를 반환한다. 파기는 #137의 공용 탈퇴 worker를 재사용한다. 기존 미성년 계정은 새 보호 액션과 마케팅만 막고 주문·티켓·취소·환불·본인 작성물 삭제·신고·차단·탈퇴·개인정보 권리행사·지원을 유지한다.

연령 상태는 `unverified|eligible|age_restricted|underage_rejected|review_required`로 분리한다. 기존 제한 계정이 14세가 됐다고 자동 활성화하지 않고, 현재 필수 약관 재동의와 DB KST 재판정을 한 트랜잭션으로 완료한 뒤에만 `eligible`로 전환한다. 미래 생년월일·malformed legacy·상태 불일치와 현재 버전을 증명할 동의 receipt가 없는 legacy 계정은 미성년으로 단정하거나 자동 삭제하지 않고 `review_required`로 fail closed한다. 기존 `consents` boolean을 최신 약관 동의 증거로 승격하거나 배포 시점의 문서 버전을 소급 기록하지 않는다.

## User Stories

1. 신규 사용자로서 KST 기준 14번째 생일 당일부터 온보딩을 완료할 수 있다.
2. 신규 사용자로서 미래 날짜나 존재하지 않는 생년월일을 입력하면 일반 서비스 상태가 만들어지지 않고 정확한 입력 오류를 받는다.
3. 만 14세 미만 신규 사용자로서 닉네임·추천 팔로우·필수동의 완료값·마케팅 동의가 저장되지 않는다.
4. 만 14세 미만 신규 사용자로서 삭제 요청이 durable하게 접수된 뒤에만 거절 안내와 비로그인 지원 경로를 받는다.
5. 만 14세 미만 신규 사용자로서 삭제 worker 실패가 성공으로 표시되지 않고 개인정보가 멱등하게 재처리된다.
6. 기존 미성년 사용자로서 새 구매·예매·작성·좋아요·팔로우·게임·카드팩 개봉을 시작할 수 없다.
7. 기존 미성년 사용자로서 과거 주문·티켓을 조회하고 취소·환불을 요청할 수 있다.
8. 기존 미성년 사용자로서 본인 작성물 삭제, 신고·차단, 탈퇴·개인정보 권리행사와 지원을 계속 사용할 수 있다.
9. 일반 성인 사용자로서 기존 구매·예매·커뮤니티·게임·카드팩 흐름이 달라지지 않는다.
10. 운영자로서 기존 미성년 계정의 PII 없는 건수·거래·UGC·legal hold 범주를 먼저 확인하고 자동 삭제 여부를 판단할 수 있다.
11. 운영자로서 예상하지 못한 거래·권리 사건이 있는 신규 거절 계정을 삭제하지 않고 rights-review로 상향할 수 있다.
12. 법무 검토자로서 연령 계산 시점, 자가신고 수준, 가입 전 최소 수집, 삭제 기한과 고지 문구를 개별 승인할 수 있다.
13. 보안 검토자로서 사용자가 user ID·현재 날짜·자격 판정 결과를 조작할 수 없음을 검증할 수 있다.
14. 개인정보 담당자로서 삭제 처리 중 Supabase Auth가 일시적으로 token을 발급하더라도 앱 진입·새 보호 액션과 Auth·거래 메일이 각각의 실행 경계에서 차단되고, 최종 hard delete가 완료됨을 검증할 수 있다.
15. 기존 제한 사용자로서 14세가 된 뒤 최신 필수 약관에 다시 동의하고 적격 상태로 전환할 수 있다.
16. 기존 제한 사용자로서 생일만 지났다는 이유로 과거 동의나 마케팅 동의가 자동 승계되지 않는다.
17. 생년월일이 미래·누락·비정상인 기존 사용자로서 미성년으로 단정되거나 자동 삭제되지 않고 최소정보 수동 검토와 권리행사 경로를 받는다.
18. 운영자로서 activation 전에 상태별 계정 수와 거래·UGC·legal hold·staff 교차 수를 PII 없이 dry-run하고 승인할 수 있다.
19. 기존 성인 사용자로서 과거의 버전 없는 동의 boolean이 최신 약관 동의로 소급 처리되지 않고, 현재 문서에 다시 동의한 receipt가 남은 뒤에만 적격 상태가 된다.
20. 제한 사용자로서 `age_restricted`와 `review_required`의 서로 다른 안내·복구 절차를 받고, 어느 상태에서도 불필요한 내부 판정 사유나 다른 회원 정보가 노출되지 않는다.
21. 자가신고상 14세 이상 사용자로서 제3자 연령확인 전에는 공개 탐색·권리행사만 가능하고 구매·예매·작성·게임·카드팩 개봉은 차단된다.
22. 개인정보 담당자로서 연령확인 원장에 원 DOB·CI·신분증이 없고 최소 transaction ref digest만 있음을 검증할 수 있다.

## Implementation Decisions

- 승인된 v1 계약은 만 14세 이상 전용이며 법정대리인 동의 예외를 제공하지 않는다. 구현·기존 계정 dry-run·법정 문서 개정 전에는 시행 중이라고 표시하지 않는다.
- `age_gate_status`는 다섯 상태다. `unverified`는 DOB candidate 판정·필수 동의·연령확인 중 하나라도 미완료, `eligible`은 DB KST 14세 이상·현재 versioned receipt·`verified_14_plus` assertion을 모두 확인한 상태, `age_restricted`는 activation 이전 기존 계정 중 유효 DOB가 14세 미만인 상태, `underage_rejected`는 activation 이후 신규 온보딩 거절과 durable 삭제 request/fence가 결합된 상태, `review_required`는 미래·malformed legacy·완료 프로필의 DOB 누락·동의/완료/상태 불일치 또는 receipt/assurance 증거 부재로 자동 판정이 안전하지 않은 상태다.
- private `age_assurance_receipts`는 `unverified|verified_14_plus|failed|revoked`, provider ID, domain-separated transaction ref digest, verified_at, policy version만 저장한다. raw provider payload·원 DOB·CI·휴대전화·신분증은 저장하지 않는다. callback은 서버 간 fresh verification과 멱등 transaction ref를 요구한다.
- 필수 동의는 서버가 선택한 `terms_version`, `privacy_version`, 각 `accepted_at`과 receipt ID를 불변 원장 또는 동등한 versioned receipt로 기록한다. 클라이언트가 문서 버전·동의시각을 주장하지 않는다. 기존 `profiles.consents.terms|privacy = true`만으로는 어떤 문서에 언제 동의했는지 증명할 수 없으므로 현재 버전 receipt를 합성하거나 `age_gate_policy_version`을 소급 채우지 않는다.
- `unverified|age_restricted|review_required`는 보호 액션을 fail closed한다. 상태별 권리 matrix는 다음과 같다.
  - `age_restricted`: 공개 browsing, 로그인·recovery, 기존 주문·배송·결제 내역, 본인 티켓·QR 조회·제시, 취소·환불, 본인 작성물 삭제, unfollow·unlike, 마케팅·홍보성 IP 알림 opt-out, 신고·차단, 탈퇴·개인정보 권리행사·고객지원을 허용한다. 새 구매·예매·작성·수정·팔로우·좋아요·마케팅 opt-in·게임·카드팩 개봉·사용자 Storage upload·프로필 identity/avatar 변경은 거부한다. 생년월일 정정과 14세 도달 해제는 직접 profile update가 아니라 승인된 review·age-out purpose 경로만 사용한다.
  - `review_required`: 공개 browsing, 로그인·recovery, 기존 주문·배송·결제 내역, 본인 티켓·QR 조회·제시, 취소·환불, 본인 작성물 삭제, unfollow·unlike, 마케팅·홍보성 IP 알림 opt-out, 신고·차단, 탈퇴·개인정보 권리행사·고객지원을 허용한다. 새 구매·예매·작성·수정·팔로우·좋아요·마케팅 opt-in·게임·카드팩 개봉·사용자 Storage upload·프로필 identity/avatar 변경은 거부한다. 이 상태를 미성년으로 단정하거나 자동 삭제·자동 age-out하지 않는다. 먼저 최소정보 수동 검토로 DOB·상태·동의 증거 문제를 해소한 뒤 현재 필수 문서 재동의 purpose 경로로만 `eligible` 전환을 시도한다.
- 연령 계산은 `Asia/Seoul`의 유효한 달력 생년월일과 DB의 오늘을 사용한다. classifier는 14번째 생일부터 `adult_candidate`, 그 전은 `underage`, 미래·불가능 날짜는 `invalid`를 반환한다. `adult_candidate`만으로 `eligible`이 되지 않으며 현재 consent receipt와 `verified_14_plus`도 필요하다. 2월 29일생은 민법상 초일산입과 법제처 해석에 따라 평년 3월 1일, 윤년 2월 29일부터 나이가 증가한다. UTC 시각이나 process locale에 좌우되지 않는다.
- `isOnboarded()`는 프로필 완성과 기존 읽기·권리 경로의 의미를 유지한다. 별도 `canStartProtectedAction()`이 완성, 미정지, 미탈퇴, 미거절, DB 연령 적격, 현재 receipt와 `verified_14_plus`를 모두 판정한다.
- 온보딩은 purpose RPC 하나로 처리한다. RPC가 `auth.uid()`를 파생하고 self profile을 잠근 뒤 DB의 KST 날짜로 판정한다. 클라이언트는 user ID, 현재 날짜, 적격 여부를 보내지 않는다.
- 성인은 닉네임, 생년월일, 서버가 선택한 현재 필수 문서의 versioned consent receipt, 추천 팔로우, 온보딩 완료시각을 하나의 트랜잭션에서 반영한다.
- 미성년은 닉네임, 추천 팔로우, 필수동의 완료값, 마케팅 동의, 온보딩 완료시각을 쓰지 않는다. `reason='underage_rejected'`, 암호화 subject, stable deletion event를 가진 요청을 durable하게 기록한다.
- 삭제 요청 ack 뒤 공개 결과는 `{ status: 'underage_rejected', next: '/account/underage-rejection' }`다. 기록 실패는 fail closed하며 삭제 성공이나 정상 가입으로 표시하지 않는다.
- durable request·fence ack 직후 global sign-out을 시도하고 현재 응답의 Auth·앱 cookie를 만료시킨 뒤 거절 결과를 반환한다. remote sign-out 실패는 PII 없는 retry 상태로 남기고 DB fence는 이미 발급됐거나 이후 발급된 JWT의 보호 mutation을 거부한다. DB fence 자체는 Supabase Auth의 token 발급·비밀번호 로그인·OAuth callback·recovery 요청을 중단할 수 없다. 따라서 앱 login action·Auth callback·`proxy.ts`를 포함한 app auth gate는 서버에서 fence를 다시 확인해 제한 계정의 앱 진입을 거부하고 응답 cookie를 만료하며, #191 Send Email Hook은 recovery 메일의 provider 호출을 막고, #137 worker의 Auth hard delete가 최종적으로 새 Auth session 발급을 끝낸다. 각 경계의 실패와 재시도를 분리해 기록하며 외부 purge 전에는 파기 완료로 표시하지 않는다.
- 제한 사용자의 마케팅 동의는 항상 false다. 직접 프로필 update 권한으로 생년월일·동의·완료시각을 우회하지 못하게 하고 purpose 경계만 허용한다.
- 새 구매, 예매, 커뮤니티 작성·수정, 팔로우·좋아요 생성, 마케팅 opt-in, 게임, 카드팩 개봉, 사용자 Storage upload와 profile identity/avatar 변경에는 DB 보호 guard를 적용한다. `age_restricted|review_required`는 위 권리 matrix를 유지한다. 신규 `underage_rejected`는 login action·Auth callback·app auth gate와 cookie cleanup으로 재진입을 거부하고 Send Email Hook으로 Auth recovery 메일을 중단하며, DB guard로 남은 JWT의 보호 mutation을 막는다. 예상 밖 obligation은 비로그인 권리행사·수동 최소정보 심사로 처리한다.
- HTML 경로와 JSON 오류는 상태를 합치지 않는다. `unverified`는 기존 `/onboarding?next=<safe>`와 HTTP 403 `{ error: { code: 'onboarding_required' } }`, `age_restricted`는 `/account/age-restricted?next=<safe>`와 HTTP 403 `{ error: { code: 'age_restricted' } }`, `review_required`는 `/account/age-review-required?next=<safe>`와 HTTP 403 `{ error: { code: 'age_review_required' } }`를 사용한다. 신규 거절의 본인 온보딩 결과만 `underage_rejected`와 `/account/underage-rejection`을 반환하고, 이후 login/callback의 공개 결과는 연령·계정 존재를 추론하지 못하는 HTTP 403 generic `{ error: { code: 'account_access_unavailable' } }`로 정규화한다.
- `age_restricted`는 생일 경과만으로 자동 `eligible`이 되지 않는다. 제한 화면에서 현재 필수 문서에 재동의하고 제3자 연령확인을 완료한 뒤, purpose RPC가 `auth.uid()`를 파생해 profile row를 잠그고 DB KST 날짜·receipt·`verified_14_plus`를 원자 확인해 상태를 전환한다. 마케팅 동의는 승계하지 않는다.
- `review_required`는 시간 경과로 자동 전환하지 않는다. 최소정보 수동 검토로 생년월일·상태 불일치·동의 증거 부재를 해결한 뒤에만 위 age-out 재동의 경로에 진입한다.
- staff/admin을 포함해 역할만으로 연령 예외를 주지 않는다. staff의 검표는 구매자의 티켓 사용 권리가 아니라 상태·감사를 변경하는 운영 mutation이므로 기존 미성년 staff에게 허용하지 않고 역할·업무를 승인된 성인에게 인수인계한다. 예외가 필요하면 별도 제품·법무 결정으로 이 계약을 개정한다.
- 신규 거절 파기는 `#137 1단계 → #191 → #137 2단계` 계약을 재사용한다. #188은 classifier·온보딩 RPC·권리 guard와 #137 1단계 request/fence 호출까지만 소유한다. #191은 Send Email Hook·outbound terminal ack를, #137 2단계는 Storage의 모든 owner/path/DB-reference 잔여·Auth hard-delete·외부 purge ack와 완료 전이를 소유한다.
- 신규 거절 계정에서 주문·티켓·UGC·legal hold가 발견되면 자동 삭제를 멈추고 권리 보존 검토로 상향한다.
- 기존 계정은 PII 없는 count·범주 audit와 고지 계획 없이 자동 삭제하지 않는다. 새 보호 mutation만 차단하고 회복·거래·권리 경로는 보존한다.
- activation 전 read-only dry-run은 상태별 계정 수, 온보딩 완료 여부, versioned consent receipt·age assurance 유무, 진행 거래·UGC·legal hold·staff/admin·마케팅/IP 알림의 교차 수만 PII 없이 산출한다. backfill은 `유효 DOB·14세 이상·현재 receipt·verified_14_plus 모두 있음 → eligible`, `유효 DOB·14세 미만 → age_restricted`, `실제 온보딩 미완료 → unverified`, `14세 이상이지만 receipt 또는 assurance 증거 부재 → review_required`, `미래·malformed·상태 불변식 위반 → review_required`로 고정한다. 기존 boolean·자가신고에서 receipt·assurance를 합성하지 않고 기존 계정을 `underage_rejected`로 backfill하거나 자동 삭제하지 않는다.
- 제한·검토 대상 staff/admin이 한 명이라도 있으면 role·업무 인수인계 전 activation을 중단한다. backfill dry-run은 local/Preview에서만 실행하고, Production mutation은 결과 검토·복구 rehearsal·명시적 배포 승인 뒤에만 수행한다.
- 온보딩 안내는 “ICONS는 만 14세 이상만 이용할 수 있어요. 입력한 생년월일로 1차 판정하고, 보호 기능을 시작하기 전 최소한의 연령확인을 진행해요. 결제 인증은 연령이나 법정대리인 동의 확인 수단이 아니에요.”로 고정한다.
- 공개 거절 화면은 PII와 내부 삭제 단계를 노출하지 않고, 완료되지 않은 파기를 완료라고 말하지 않으며, 비로그인 개인정보·지원 경로를 제공한다.

## Testing Decisions

- KST classifier를 순수 경계로 테스트한다. 14번째 생일 전날·당일·다음날, 2월 29일생의 평년 3월 1일·윤년 2월 29일, 월말, 미래·불가능 날짜, UTC 날짜 전환을 포함한다.
- 프로필 완성과 보호 액션 자격을 독립 테스트한다. 미온보딩, 성인 완료, 미성년 완료형 legacy, 정지, 탈퇴 요청 상태를 구분한다.
- 온보딩 Server Action은 성인 성공, 입력 오류, 미성년 durable ack 성공, request 실패를 통합 테스트한다. 미성년 경로에서 닉네임·팔로우·동의·완료시각 write가 없어야 한다.
- 신규 미성년은 durable ack 전 세션 종료·성공 결과가 없고, ack 뒤 global sign-out 시도와 local cookie 만료가 일어나며, remote sign-out 실패나 임시 Auth token 재발급 중에도 login/callback/app gate가 앱 진입을 거부하고 DB guard가 보호 mutation을 거부하는지 검증한다. DB fence가 Auth token 발급 자체를 막는다고 테스트하거나 표시하지 않는다.
- SQL 테스트는 self-only, row lock, KST 판정, 직접 update 거부, 목적 RPC 원자성, 함수 ACL과 신규 보호 action guard를 검증한다.
- 보호 액션 matrix는 신규 `underage_rejected`, 기존 `age_restricted`, `review_required`를 분리한다. `underage_rejected`는 Auth 발급 자체가 아니라 login/callback/app gate·cookie cleanup·Send Email Hook·DB guard·최종 hard delete의 조합으로 앱 재진입과 보호 mutation을 막고 비로그인 권리 경로만 제공한다. `age_restricted`와 `review_required`는 각각 Implementation Decisions의 허용 권리와 거부 action 전체를 통합 테스트하며, 후자는 수동 검토 전 age-out RPC를 호출할 수 없다. staff 검표 mutation은 세 상태 모두 허용하지 않는다.
- 삭제 processor는 durable request, 중복 호출, 각 외부 단계 실패, 전역 발송 fence, Storage owner/path/DB-reference sweep, Auth hard-delete ack, 예상 밖 obligation 상향을 fault injection으로 검증한다. #188 테스트는 #137/#191의 승인된 공개 seam만 사용하고 각 이슈의 private 구현을 중복하지 않는다.
- 기존 미성년 회귀 테스트는 전체 페이지를 onboarding으로 redirect하지 않고 권리 경로가 계속 열리는지 확인한다.
- 다섯 상태의 공개 결과와 권리 matrix를 통합 테스트한다. HTML은 onboarding·age-restricted·age-review-required·underage-rejection 경로를, JSON은 `onboarding_required|age_restricted|age_review_required|account_access_unavailable`을 서로 바꾸지 않고 반환해야 한다. `age_restricted`는 생일 전 차단, 생일 뒤 현재 필수 약관 재동의 전 차단, 재동의 purpose RPC 뒤 원자적 `eligible` 전환을 검증하고 마케팅 false가 승계되지 않는지 확인한다.
- 미래·malformed·불일치 legacy와 versioned receipt 없는 legacy boolean 계정은 `review_required`이며 자동 삭제·자동 age-out되지 않아야 한다. 현재 버전 receipt를 소급 합성하지 않고 실제 재동의가 불변 receipt를 만든 뒤에만 재판정하는지 검증한다. 상태별 backfill fixture의 exact count와 `age_restricted|review_required` 각각의 로그인·recovery·기존 거래·권리행사 허용, 보호 액션·마케팅·upload·profile mutation 차단을 검증한다.
- 온보딩 화면 테스트는 승인된 1차 DOB 판정·추가 연령확인·결제 비검증 문구를 확인하고 기존 “결제사 확인으로 본인확인” 문구가 없음을 검증한다.
- 공개 약관·개인정보처리방침 테스트는 시행 전/후 문구, 연령 기준, 거절 처리, 비로그인 문의 경로가 실제 기능과 일치하는지 확인한다.
- 구현은 승인된 classifier, Server Action result, SQL RPC, 삭제 processor, 권리 matrix, 법정 문구 seam부터 실패 테스트를 작성하는 TDD 순서를 따른다.

## Out of Scope

- 만 14세 미만 법정대리인 동의 수집·검증·철회 시스템
- ICONS가 주민등록번호·신분증·CI·원 DOB·provider raw payload를 직접 수집·저장하는 본인확인 시스템. 계약·DPA·server callback이 검증된 제3자 provider의 최소 `verified_14_plus` assertion은 본 설계 범위다.
- 승인 전 Production 기존 계정 audit·backfill·자동 삭제
- #137 전체 탈퇴·보존 시스템의 중복 구현
- 거래·신고·legal hold 보존기간에 대한 개발자의 법률 확정
- 보호자 대상 마케팅 또는 별도 미성년 서비스 모드

## Further Notes

- 제품·TDD 승인 입력: [`to-questionnaire-open-issue-decisions.md`](../../questionnaires/to-questionnaire-open-issue-decisions.md)
- 내부 위험결정과 아직 확인해야 할 외부 사실: [`policy-legal-review.md`](../../questionnaires/policy-legal-review.md)
- 삭제·권리 경계: [`account-deletion-retention-policy.md`](../../account-deletion-retention-policy.md)
- 제품·아키텍처 상태: [`PRD.md`](../../PRD.md), [`ARCHITECTURE.md`](../../ARCHITECTURE.md)
- GitHub 추적: [#188](https://github.com/icons-hq/icons-ip/issues/188), 선행 구현 [#137](https://github.com/icons-hq/icons-ip/issues/137)
- 2월 29일 경계 후보 근거: [법제처 기간계산규정에 관한 연구](https://moleg.go.kr/mpbleg/mpblegInfo.mo?mid=a10402020000&mpb_leg_pst_seq=128993). 실제 서비스 적용은 대한민국 변호사가 확정한다.
- 이 문서는 2026-08-12 내부 위험결정으로 local TDD가 승인된 구현 계약이다. GitHub 이슈 본문 동기화와 Production 배포는 별도 외부 변경이며, provider 계약·DPA·callback 검증, 기존 계정 dry-run, 법정 문서 시행일과 명시적 배포 승인이 갖춰지기 전에는 실제 연령 gate를 활성화하지 않는다.

# ICONS 회원 탈퇴·법정 보존 정책

> 상태: 내부 보수 정책 결정 확정 · 구현·공개 미시행 · 결정일 2026-08-13
>
> 적용 범위: 회원 계정, 커뮤니티 작성물, 굿즈·티켓 거래, Storage 객체, Auth 사용자와 복원 가능한 백업
>
> 시행 경계: 이 문서는 법률의견이 아니다. #137 Phase 1의 self-only request·legal snapshot·write fence는 기본 OFF로 구현됐지만, 삭제 worker, #191 이메일 fence, 별도 Supabase compliance 프로젝트와 복원 replay가 검증되기 전에는 활성화하거나 탈퇴 완료를 제공·고지하지 않는다.

## 1. 확정 결정

1. 회원은 로그인 상태에서 자신의 계정만 전자적으로 탈퇴 신청한다.
2. 진행 중인 주문·배송·취소·환불과 종료 전 유효 티켓이 있으면 삭제를 보류하고 해당 거래의 해결 경로를 안내한다.
3. 프로필·Auth·세션·개인화·카드 리워드 데이터는 법적 보존 대상으로 일괄 취급하지 않고 삭제한다. 법령상 필요한 거래·사건의 최소 snapshot만 일반 서비스와 분리해 보존한다.
4. 커뮤니티 텍스트는 대화 맥락과 다른 회원의 권리를 위해 작성자 연결을 제거하고 `탈퇴한 사용자`로 표시한다. 회원이 올린 이미지는 모두 삭제한다.
5. 복원 방지 원장은 운영 Supabase와 백업 계보가 다른 **별도 Supabase compliance 프로젝트**에 둔다. GCP 원장을 사용하지 않는다.
6. 탈퇴 후 거래기록·개인정보 권리행사는 로그인 없는 전용 창구와 최소 본인확인 절차로 제공한다.

## 2. 신청과 처리 순서

신청 시 결과, 진행 중 의무, 되돌릴 수 없는 시점을 먼저 보여준다. 서버는 현재 세션과 `auth.uid()`를 다시 확인하며 브라우저가 삭제 대상 사용자 ID를 지정하지 못한다. 신청 RPC는 현재 JWT의 `session_id`가 같은 사용자의 최근 10분 내 생성된 `auth.sessions` 행인지 확인한다. 다른 브라우저의 새 로그인으로 바뀌는 전역 `last_sign_in_at`은 현재 세션의 재인증 증거로 쓰지 않는다. 오래된 세션에는 전용 `reauth=1` 로그인 경로를 안내하며, 정지 계정도 이 self-service 재인증·탈퇴 경로만은 사용할 수 있다.

처리 순서는 다음으로 고정한다.

1. `request/fence`: self-only 요청과 멱등키를 기록하고 새 구매·예매·작성·카드팩 개봉·게임·마케팅과 새·갱신 커뮤니티 Storage 업로드를 차단한다. 신청과 보호 write는 같은 사용자별 transaction lock으로 순서를 정한다.
2. `legal snapshot`: 아래 매트릭스에 해당하는 최소 record와 `retain_until`을 분리 저장한다.
3. `email fence`: #191의 durable outbox와 Resend/Supabase Send Email Hook이 탈퇴 대상의 새 발송을 막고 in-flight 결과를 종결한다. dark schema에는 `notification_intent_id`와 fail-closed fence 판정만 추가하며, 탈퇴 notice producer·실수신 증거 전에는 Phase 2 worker를 열지 않는다.
4. `hard delete`: 커뮤니티 연결 해제와 이미지 삭제, Storage 잔여 0건, 일반 DB 개인정보 삭제, 전역 sign-out과 Auth hard delete를 순서대로 수행한다.
5. `secondary tombstone`: compliance 프로젝트에 같은 event를 멱등 append하고 durable ack를 기록한다. 실패한 요청은 완료로 표시하지 않고 PII 없는 primary request에서 재시도한다.
6. `restore replay`: 운영 DB 복원 시 compliance sequence 이후 event를 replay해 복원된 subject를 다시 제거한 뒤에만 writer와 public traffic을 연다.

`hard delete`와 secondary tombstone 이후에는 reverse migration을 제공하지 않고 forward repair만 허용한다. 실제 Production hard delete 직전에는 대상과 비가역성을 다시 표시해 사용자 확인을 받는다.

Phase 1에서 blocked request는 종결 상태가 아니다. 기존 주문·결제·환급 worker가 허용된 정합화 작업을 끝낸 뒤 동일 신청 replay 또는 상태 조회가 진행 의무와 allowlist snapshot을 다시 평가한다. blocker가 모두 해소되어도 `awaiting_notification`까지만 전진하며 hard delete를 시작하지 않는다.

Phase 1 schema는 기본 OFF이며, 거래 lookup 연락처 HMAC/key version, legacy 승인·환급·공급의 검증된 시각, immutable 티켓 계약 snapshot, 승인된 커뮤니티·권리사건 보존 seam이 모두 준비됐다는 private readiness 값 없이는 DB constraint가 activation을 거부한다. 불완전한 legacy 행은 존재하지 않는 승인·환급·공급 사실을 추정해 snapshot하지 않는다.

## 3. 진행 중 의무 gate

| 데이터 | 삭제 보류 상태 | 해소 경로 |
|---|---|---|
| `orders` | `pending`, `paid`, `shipping` | 주문 상세의 결제·만료·취소·배송·반품 처리 |
| 주문 취소·환불 | `requested`, `processing`, `needs_review`, provider claim 존재 | 해당 주문의 환급 정합화 |
| 결제·시도 | legacy payment `pending`, attempt `prepared`, `confirming`, `unknown`, `needs_review` 또는 payment 원장 없는 `approved` | staff 결제 정합화 |
| `ticket_orders`, `tickets` | 미정리 `pending`, 종료 전 `paid`·`valid` 티켓 | 예매 상세의 만료·취소·사용 또는 이벤트 종료 |
| 티켓 취소 | `requested`, `processing`, `needs_review` | 해당 예매의 환급 정합화 |
| staff/admin | 활성 운영 권한 또는 미인계 회사 자산 | 권한 회수와 책임자 인수인계 |

만료됐지만 아직 정리되지 않은 거래와 provider 결과가 모호한 결제는 fail closed한다. 커뮤니티 신고나 계정 제재만으로 탈퇴를 막지 않으며, 적법한 보전 요구가 있으면 계정은 삭제하고 승인된 사건의 최소 증거만 별도 legal hold로 보존한다.

## 4. 커뮤니티·Storage 처리

| 대상 | 처리 |
|---|---|
| 포스트·댓글 텍스트 | 작성자 FK를 제거하고 공개 작성자를 `탈퇴한 사용자`로 표시. 다른 회원의 댓글과 신고 대상 식별자는 유지 |
| 본인만 작성한 draft 또는 비공개 콘텐츠 | 법적 사건에 필요하지 않으면 삭제 |
| 업로드 이미지 | 본문 유지와 무관하게 삭제하고 image ref를 제거 |
| 좋아요·팔로우·차단·개인화 | 삭제 |
| 신고 | 진행 사건 또는 승인된 보존표에 필요한 case ref·category·조치시각만 비식별화해 유지하고 자유서술 개인정보는 최소화·파기 |

삭제 worker는 `user-uploads/<user-id>/*`뿐 아니라 모든 bucket의 `owner_id`, DB 참조 path와 owner가 없는 legacy 사용자 path를 인벤토리한다. Storage API로 객체를 삭제하고 Auth hard delete 전에 owner·path 기준 잔여가 0건임을 확인한다. `storage.objects` 행만 SQL로 지우는 방식은 사용하지 않는다.

## 5. 분리 보존 매트릭스

2026-10-14 구현 범위: 신규 반품·교환 연락처 계획·변경 이력·최종 재출고 목적지에는 별도 필드 암호화, 목적 종료 판정, 유한 보존 예외, 기한 도달 시 읽기 차단과 실제 파기 경로를 추가했다. 이 운영 목적의 이름·전화·주소·내부 합의는 같은 파기 범위이며 장기 거래 snapshot에 복사하지 않는다. 전화는 신규 회수·교환 연락처의 운영 목적에 한정해 같은 기한까지 암호화 보관하며 법정 장기 거래 snapshot에는 포함하지 않는다. 배송메모는 새 계획에 추가하지 않는다. 새 세 저장소의 local 검증과 기존 원주문/대리접수 사본, 전체 탈퇴 worker·백업 replay 완료는 구분한다([연락처 inventory와 절차](runbooks/claim-contact-corrections.md)). 운영 활성화와 이 문서 전체의 공개 시행은 아직 실행하지 않았다.

| 분류 | 최소 보존 필드 | 기산점·기간 | 접근 역할 | 제외·파기 |
|---|---|---|---|---|
| 계약·청약철회 | order ref, 상태·합계·배송비, 상품명/type/IP snapshot, 수량·단가, 계약·청약철회·결정 시각과 정규화 유형 | 각 기록 생성일부터 5년 | 분쟁 담당자; 목적별 service RPC | checkout key, 자유서술 reason·note, 오류 상세 제외 |
| 대금결제·재화 공급 | provider, provider-neutral payment/order ref, 금액·통화·상태·승인/환급/공급 시각, carrier와 opaque tracking ref | 각 결제·환급·공급 기록 생성일부터 5년 | 재무·CS 분리 역할; 목적별 service RPC | payment key, raw provider payload, idempotency secret, 전체 주소 제외 |
| 상품 이행·디지털 제공 | 주문/품목 ref, 제공 방식·선결제 비용, 구매 당시 파일 ID·형식·크기·해시와 제공 시각 | 기존 계약·공급 기록의 5년 보존 기준을 재사용 | 분쟁 담당자; 목적별 service RPC | 파일명·비공개 Storage 경로·로그인 세션·자유서술·고객 원식별자는 복제하지 않음 |
| 티켓 계약·공급 | event/order ref, 회차·ticket type·단가·수량 snapshot, 상태, 계약·검표·취소·환급 시각과 금액 | 각 기록 생성일부터 5년 | 티켓 분쟁 담당자; 목적별 service RPC | QR token, reservation key, staff 원식별자, 자유서술 제외 |
| 탈퇴 후 거래 lookup | 거래 시점 정규화 이메일·전화의 purpose-separated keyed HMAC, key version, 거래 ref | 연결된 거래 record와 같은 기간 | 전용 권리행사 verifier | 원문 연락처·프로필·DOB를 보존하지 않음 |
| 소비자 불만·분쟁 | case ID, 정규화 category, 거래 ref, 접수·조치·결과 시각과 최소 증거 hash | 각 처리기록 생성일부터 3년 | 배정 CS와 승인된 법무 reviewer | 모든 신고·운영 메모 일괄 복제 금지 |
| 표시·광고 | 실제 노출한 고시·가격·조건의 version/hash와 노출 시각 | 각 노출 기록 6개월 | 상품·법무 reviewer | 회원과 연결하지 않음 |
| 주문 배송지(수령인 이름·연락처·우편번호·주소·배송 요청사항) | 이미 한 주문의 배송지 사본 전체. 주문 정보의 일부로 거래 기록과 함께 보관 | 연결된 계약·공급 기록과 같은 기간(생성일부터 5년) 뒤 파기 | fulfillment·분쟁 담당자 | 2026-11-19 사용자 결정: 공개 개인정보처리방침 제3조('이미 한 주문의 배송지는 … 거래 기록 보존 기간 동안 따로 보관')·제5조의 배송지 정의와 같은 기준이다. 배송 완료 30일 파기 배치는 두지 않는다. 전화 원문을 법정 장기 snapshot(위 '계약·청약철회' 등)에 따로 복제하지는 않는다 |
| 회수·교환 연락처 계획 | 신규 회수·교환 연락처 계획의 이름·전화·주소(필드별 암호화) | 배송 완료·반품·분쟁 종료 중 늦은 시각부터 30일 이내 | fulfillment 최소 역할 | 구현됨(runbooks/claim-contact-corrections.md). 전화·주소 원문은 법정 장기 거래 snapshot에 복제하지 않음; 명시적 legal hold 외 연장 금지 |
| 커뮤니티 일반 신고 | case ID, category, content ref/hash, 당사자 keyed ref, 접수·조치·통지·이의 시각과 결과 | 최종 조치·이의 종료부터 90일 내부 상한 | 배정 staff의 redacted view | 자유서술·원본 첨부는 30일 안에 최소화 |
| 법정 권리 사건 | case ID, 권리 유형, content ref/hash, 서류 검증 결과, 중단·통지·재개·종료 시각 | 사건별 법적 근거·승인된 `retain_until`; 종료 후 불필요 PII 즉시 파기 | 사건별 reviewer; 반출 별도 승인 | 일반 신고라는 이유로 자동 장기보존 금지 |

법정 snapshot은 `private` schema의 service-only 원장에 저장하고 `public`, `anon`, `authenticated`, 일반 `service_role` 직접 권한을 모두 회수한다. `legal_basis`, `retain_until`, 접근 목적, 사건별 hold와 파기 결과가 없는 record는 생성할 수 없다. 매일 만료 batch가 legal hold 없는 record를 파기하고 PII 없는 category·건수·시각만 감사한다.

주소록(`public.address_book_entries`)은 법정 보존 대상이 아니다. 탈퇴 신청으로 계정 fence가 생기는 트랜잭션에서 그 회원의 주소록을 지운다. 이미 한 주문의 배송지는 주문 정보로서 위 '주문 배송지'·거래 기록 기준(5년)을 따른다 — 2026-11-19 사용자 결정으로 배송 완료 30일 파기를 두지 않고 공개 처리방침 문장에 맞춘다. 주문이 있는 회원은 `orders.user_id` 제약 때문에 Auth 삭제의 cascade로 지워지지 않는다. 그래서 Phase 1이 OFF인 동안 문의로 받은 탈퇴는 아래 운영자 절차로 처리한다.

### 문의로 받은 탈퇴의 운영자 처리 (Phase 1 OFF 동안)

탈퇴 신청 기능이 꺼져 있는 동안 고객 화면(`/settings/delete-account`·설정 하단 회원 탈퇴)은 화면 신청 대신 1:1 문의(유형 '계정')로 탈퇴를 요청하라고 안내하고, 처리 뒤 지워지는 것·남는 것·같은 이메일 재가입 불가를 알린 뒤 문의 작성으로 잇는다. 정지 회원과 온보딩을 마치지 않은 회원도 이 경로를 쓸 수 있도록 '계정' 유형 문의만은 글로 접수·이어 쓰기·열람이 열려 있다. 다른 유형과 다른 보호 액션은 그대로 막히고 하루 20건 상한도 같으며, 이미지 첨부와 주문·굿즈 연결은 받지 않는다. 정지 회원에게는 DB `create_inquiry`·`append_inquiry_message`가 이 규칙(계정 유형만·첨부 0개·연결 없음, 어기면 `account_suspended`·`account_suspended_inquiry_limited`)을 강제하고, 온보딩 미완료 회원은 DB가 원래 온보딩을 보지 않아 앱(작성 화면·서버 액션)이 같은 규칙을 지킨다. 로그인은 탈퇴 화면·계정 문의 작성·문의 스레드(`/my/inquiries/<uuid>`, 답변 알림 메일 링크)로는 정지·온보딩 게이트 없이 돌려보내고, 스레드 화면이 계정 문의가 아니면 정지 화면·온보딩으로 보낸다. 정지 화면(`/account-suspended`)은 계정 문의 작성과 내 문의 목록(정지 회원에게는 계정 문의만 보인다)으로 잇는다. 회원 관리 권한(`platform.manage` — 통합 매니저·계정 주매니저, 매니저 역할 설정 전에는 staff/admin)을 가진 운영자가 어드민 고객 상세(`/admin/customers/<회원 id>`) 개요의 **탈퇴 요청 처리**로 처리한다. SQL 편집기 절차(정지 + `private.erase_member_address_book` 실행 + 수기 기록)는 더 쓰지 않는다.

1. 문의 내용으로 본인의 탈퇴 요청인지 확인한다. 고객 상세에서 탈퇴 요청 처리를 펼쳐 문의 번호(#번호)와 처리 메모(정지 사유로 남는 내부 기록 — 연락처·주소 같은 개인정보는 적지 않는다)를 입력한다. 확인창이 그 문의의 유형·제목·작성일을 보여주므로(`admin_member_withdrawal_inquiry`, '계정' 유형이 아니면 경고) 탈퇴를 요청한 문의가 맞는지 대조한 뒤 처리한다. 대조하는 동안 입력은 읽기 전용이고, 대조한 번호를 함께 보내 서버 액션이 입력한 번호와 다르면 처리하지 않는다.
2. DB `admin_process_member_withdrawal`이 한 트랜잭션에서 처리한다.
   - 문의 번호가 그 회원이 쓴 1:1 문의인지 확인한다.
   - §3 진행 중 의무(`private.account_deletion_blockers` — 탈퇴 신청과 같은 판정)와 운영 권한(프로필 staff/admin·매니저 소속)이 남아 있으면 아무것도 바꾸지 않고 남은 항목·건수를 돌려준다. 해당 거래를 끝내거나 권한을 회수한 뒤 다시 처리한다.
   - 계정을 정지한다(`admin_suspend_user`, 정지 감사 포함). 주소록, 인증한 휴대폰 번호와 인증 요청·이력, 마케팅 정보 수신 동의(동의 중인 모든 수단 철회 — 원장 출처 `member_withdrawal`, 파생값 `consents.marketing=false`), 성별(고객 통계 동의), 활동 기록과 그 동의, 진행 중인 이메일 변경 요청, 대기 중인 재입고 알림 신청을 지우고, 프로필의 닉네임은 '탈퇴한 회원 <구분 번호>'로 바꾸며 생년월일과 프로필 사진 경로는 비우고 성인 인증 기록(`private.adult_verifications`·`adult_verification_sessions` — 공개 처리방침 제3조가 탈퇴 시 파기를 약속하고 법정 snapshot이 보존하지 않는다)과 프로필 사진 후보 기록을 지운다(2026-11-19 사용자 결정, 아래 처리 기록의 사진 파일 삭제 참고). 처리 뒤에는 그 회원의 프로필 닉네임·생년월일·사진·동의 쓰기를 DB가 거절한다(`member_withdrawn`, 마케팅 철회만 허용)(탈퇴 봉인 트리거의 삭제 범위와 같고, 재입고 알림은 정지와 무관하게 알림·메일을 보내므로 더한다). 모든 로그인 세션(`auth.sessions`, refresh token)을 지운다.
   - 보존 근거가 없는 나머지 개인정보도 지운다(2026-11-25, migration `20261126104000`): 위시리스트, 장바구니(쿠폰 선택·주문서 초안 포함), 알림함, IP 팔로우(팬 수 캐시는 `unfollow_ip`와 같은 규칙으로 줄인다), 재입고 알림(이미 알린 기록 포함), 좋아요·내가 한 차단·리뷰 도움돼요, 등급 변경 기록, 쓰지 않은 쿠폰(주문 할인에 쓴 쿠폰은 사용 원장과 함께 거래 기록으로 남는다), 출석 코인 원장·잔액·출석 기록(원장의 추가 전용 가드는 이 처리의 트랜잭션 로컬 표시로만 통과), 마케팅 발송 대상 기록의 회원 연결. Auth 쪽은 모든 로그인 연결(`auth.identities` — 소셜 회원번호·이름·사진 주소·이메일), user metadata, 전화·변경 대기 이메일·비밀번호 해시, 로그인 진행 기록(`auth.flow_state`·`auth.one_time_tokens`)을 지운다. 로그인 연결을 지우기 전에 이메일과 소셜 로그인 계정(공급자:회원번호)을 DB 안 비밀키 HMAC으로 바꾼 값을 `private.withdrawn_signin_blocks`에 처리 시각부터 1년 남기고, `auth.users` 새 사용자 생성 트리거(`private.reject_withdrawn_member_signup`)가 같은 값의 가입을 거절한다(같은 이메일·소셜 계정 재가입 차단 — 판정 오류 시에는 가입을 막지 않는다). 감사·결과 `erased`에 `wishlistItems`·`cartItems`·`notifications`·`follows`·`coupons`·`loginIdentities` 개수가 더해진다.
   - 처리 기록 `private.member_withdrawal_processings`와 감사 로그 `admin.member.withdrawal_processed`(문의 번호·처리자·시각·지운 개수와 익명화한 프로필 칸 이름 `profileFields` — 메모·개인정보 원문·값 없음)를 남긴다. 다시 처리해도 처음 기록을 돌려주고(멱등) 그 사이 생긴 세션만 다시 끊는다.
3. 이어서 앱 서버가 프로필 사진 파일을 지운다(`user-uploads` 버킷의 객체는 SQL로 지울 수 없어, 처리 기록의 `avatar_erase_pending`이 켜진 회원의 `<id>/profile/` 접두 아래 객체 전체 — 현재 사진뿐 아니라 교체 때 정리에 실패한 이전 파일·저장하지 않은 후보 포함 — 를 Storage API로 삭제하고, `admin_confirm_member_withdrawal_avatar_erased`가 `storage.objects`에 그 접두 객체가 0개인지 직접 확인해 감사 `admin.member.withdrawal_avatar_erased`를 남긴다). 사진 파일이 없던 회원은 이 단계가 없다. 실패하면 고객 상세의 '다시 적용'으로 재시도한다. 같은 방식으로 앱 서버가 Supabase Auth 관리 API로 재로그인을 막는다(`ban_duration` 876000h — 로그인·토큰 갱신 거절). 관리 API에는 사용자 id로 세션을 끊는 호출이 없어(`signOut`은 그 사용자의 JWT가 필요하다) 세션 삭제는 2의 RPC가 한다. `admin_confirm_member_withdrawal_signin_block`이 `auth.users.banned_until`을 직접 읽어 장기 차단을 확인한 뒤 감사 로그 `admin.member.withdrawal_signin_blocked`를 남긴다. 차단이 실패하면 정지·삭제는 이미 끝난 상태로 고객 상세에 '재로그인 차단 다시 적용'이 보인다.
4. 처리한 계정은 정지를 해제할 수 없다(`member_withdrawn`). 이미 발급된 access token은 만료(기본 1시간)까지 PostgREST에서 유효하다. 그동안 정지를 확인하는 쓰기 — 구매·예매·작성·카드팩 개봉·게임, 마케팅 정보 수신 새 동의(직접 `consents.marketing` 쓰기 포함, 철회는 언제나 허용), 재입고 알림 신청, '계정' 유형이 아닌 문의 — 는 거절되지만, 위시처럼 정지를 확인하지 않는 본인 행 쓰기는 만료 전까지 될 수 있다.
5. 처리한 뒤 바로 문의에 처리 결과를 답변하고 문의를 닫는다. 답변 메일은 프로필 이메일로 가는데, 이메일 원문은 처리 3일 뒤 지워지므로 그 뒤 답변은 메일로 가지 않는다.
6. DB 정리 잡 `member-withdrawal-retention`(pg_cron, 매시 41분, `private.run_member_withdrawal_retention`)이 처리 3일이 지난 회원의 Auth·프로필 이메일을 비우고(`private.erase_withdrawn_member_email`, 처리 기록 `email_erased_at`, 감사 `admin.member.withdrawal_email_erased`), 기한이 지난 재가입 차단 값을 지우며, 처리 1년이 지난 회원의 마케팅 수신 동의·철회 원장과 성별·활동 기록 동의 행을 지운다(`retention_purged_at`, 감사 `admin.member.withdrawal_retention_purged`). 메일 발송 기록(`email_deliveries`)은 2026-08-13부터 수신 주소 원문을 남기지 않는다.

카카오로만 가입한 회원이 카카오계정을 탈퇴해(카카오 사유 `ACCOUNT_DELETE`·`FORCED_ACCOUNT_DELETE`) 로그인 수단이 영구히 없어진 경우는
1:1 문의를 쓸 수 없으므로, 카카오 계정 상태 변경 웹훅의 해제 알림을 근거로 같은 처리를 한다(2026-11-19 결정,
[runbooks/kakao-account-unlink.md](runbooks/kakao-account-unlink.md) §5.1). 어드민 고객 상세의 **카카오 알림으로 탈퇴 처리**
(`admin_process_kakao_unlink_withdrawal`, 같은 `platform.manage`)가 위 2~4와 같은 확인·삭제·차단을 하고, 카카오 identity(회원번호·
카카오 프로필)를 함께 지운다. 처리 기록의 근거는 `basis = kakao_unlink`와 해제 원장 행이다. 카카오 연결만 끊은 회원은 다시 로그인할 수
있으므로 이 경로를 쓰지 않고, 확인 연락 뒤 회원이 쓴 1:1 문의로 위 절차를 따른다.

2026-11-19 이전에 이미 처리한 회원은 migration `20261119109500`이 같은 익명화·파기로 백필하고, 재처리 요청(`already_processed`)도 아직 익명화되지 않은 프로필이면 같은 규칙을 한 번 적용한다(감사 `admin.member.withdrawal_profile_anonymized`).

2026-11-25 이전에 처리한 회원은 migration `20261126104000`이 같은 재가입 차단 값(처리 시각 기준 1년)·로그인 연결·개인화 데이터 삭제를 백필하고(감사 `admin.member.withdrawal_personal_data_erased`), 처리 3일이 지난 회원의 이메일은 같은 migration 끝의 정리 잡 한 번이 지운다.

이 처리는 hard delete가 아니다. 보존 근거가 없는 개인정보는 위 2·6에서 지우고, 법정 보존 기록과 그 기록을 잇는 정지된 계정 껍데기만 남긴다. 공개 약관 제7조·개인정보처리방침 제3조(2026-11-25 최초 판)가 이 범위를 그대로 적는다. §1·§2의 완전한 탈퇴(법정 snapshot 분리 → 메일 fence → hard delete → compliance tombstone)의 선행 조건이 아직 없어 남는 것은 다음과 같다.

| 남는 항목 | 이유·기간 |
|---|---|
| 주문·결제·환불·티켓·클레임·적립금·쿠폰 사용 기록과 주문 배송지 사본 | 전자상거래법 계약·청약철회·대금결제·재화 공급 기록(5년). 분리 보존 원장이 활성화되기 전에는 운영 DB에 그대로 둔다 |
| 1:1 문의·상품 문의(답변 포함)·상담 메모 | 전자상거래법 소비자 불만·분쟁처리 기록(3년) |
| 리뷰·커뮤니티 작성물과 그 이미지 | 게시물은 지우지 않고 작성자를 익명화한 닉네임('탈퇴한 회원 <구분 번호>')으로 표시한다. 약관 제7조가 탈퇴 전 직접 삭제를 안내한다. 작성자 연결 해제·이미지 삭제는 hard delete 단계(§4) |
| 프로필 행·Auth 사용자(정지·재로그인 차단, 이메일·로그인 연결·metadata 없음) | 위 기록의 `user_id` 외래키(`orders.user_id` 등)가 가리키는 번호. 이메일 원문은 처리 3일 뒤 지운다(처리 결과 답변 메일) |
| 재가입 차단 값(이메일·소셜 계정 HMAC, 회원 연결 없음) | 같은 이메일·소셜 계정의 즉시 재가입 부정 이용 방지 — 처리 시각부터 1년 뒤 정리 잡이 지운다 |
| 마케팅 수신 동의·철회 원장, 성별·활동 기록 동의 행(철회 상태) | 동의 철회 사실 확인(정보통신망법 제50조) — 처리 1년 뒤 정리 잡이 지운다 |
| 처리 기록·감사 로그 | 처리 근거(개인정보 원문 없음). 처리 기록은 프로필이 hard delete될 때 함께 지워진다 |
| ADR-0052로 지운 카드·카드팩·게임 기록(`user_cards`·`card_grants`·`draw_tickets`·`game_plays`) | 2026-11-24 이후 새로 쌓이지 않는 보존 유물이라 이 처리에서 건드리지 않는다. 정리는 별도 migration과 사용자 승인 범위(AGENTS.md) |
| GoTrue 접속 기록(`auth.audit_log_entries`, 이메일 포함) | 서비스 접속 기록(통신비밀보호법 3개월). 아직 자동 삭제 잡이 없다 — 별도 과제 |

배포 전 확인(운영 Supabase, 사람): 처리 RPC와 정리 잡은 함수 소유자 `postgres`로 `auth.sessions`·`auth.refresh_tokens`·`auth.identities`·`auth.flow_state`·`auth.one_time_tokens` 행을 지우고 `auth.users`를 고치며, migration은 `auth.users`에 트리거를 만든다. 로컬 이미지는 이 권한이 있지만 운영 프로젝트에서 SQL 편집기로 다음이 모두 `true`인지 먼저 확인한다. `false`면 처리 RPC가 실패해 아무것도 바뀌지 않는다(트리거 권한이 없으면 migration이 실패한다).

```sql
select has_table_privilege('postgres','auth.sessions','delete'), has_table_privilege('postgres','auth.refresh_tokens','delete'),
  has_table_privilege('postgres','auth.identities','delete'), has_table_privilege('postgres','auth.users','update,trigger'),
  has_table_privilege('postgres','auth.flow_state','delete'), has_table_privilege('postgres','auth.one_time_tokens','delete');
```

남은 일(hard delete로 가기 위한 선행 조건):

- 별도 Supabase compliance 프로젝트(§6)의 생성·append/scan credential 분리·backup·restore drill과 Production 연결(#215).
- Phase 1 readiness 값 4종(§2 끝): 거래 lookup 연락처 HMAC/key version, legacy 승인·환급·공급의 검증된 시각, immutable 티켓 계약 snapshot, 승인된 커뮤니티·권리사건 보존 seam.
- #191 이메일 fence(durable outbox·Send Email Hook)와 탈퇴 notice producer·실수신 증거.
- 삭제 worker(커뮤니티 연결 해제·Storage 전 bucket 인벤토리와 잔여 0건 확인·일반 DB 개인정보 삭제·전역 sign-out·Auth hard delete)와 restore replay.
- 탈퇴 후 권리행사 창구(§7). 약관 제7조·방침 제3조는 2026-11-25 최초 판에서 이 임시 처리의 실제 범위(즉시 파기·이메일 3일·재가입 차단 1년·게시물 익명 표시·법정 보존 기간)로 맞췄다. 카카오계정 탈퇴 알림으로 하는 처리도 약관 제7조에 적었다.
- 법정 보존 기간(5년·3년)이 끝난 거래·문의 기록의 파기 잡. 지금은 운영 DB에 남고 자동 파기가 없다(가장 이른 기한 2029년).
- 이 절차로 처리한 회원의 hard delete 백필 순서. 대상 목록은 `private.member_withdrawal_processings`다(문의·카카오 알림 근거 모두).

## 6. Secondary Supabase compliance ledger

외부 interface는 다음 두 동작으로 제한한다.

- `append(event) -> {eventKey, canonicalDigest, sequence, generation, ackedAt}`
- `scanAfter(sequence, pageToken)`

compliance 프로젝트에는 직접 식별자·이메일·DOB·거래 payload를 넣지 않는다. 환경별 keyed-HMAC subject tombstone과 append-only event key, canonical digest, 단조 sequence, generation, ack 시각만 둔다.

현재 [local contract](./deletion-ledger-local-contract.md)는 versioned HMAC/canonical encoding, deterministic fake, signed pagination과 disabled adapter까지만 구현했다. Production runtime은 기본 disabled이고 remote I/O는 없으며, 별도 프로젝트·credential·backup·restore drill과 Production 연결은 #215가 완료될 때까지 열지 않는다.

- 같은 event key와 같은 digest는 기존 ack를 반환한다.
- 같은 key에 다른 digest가 오면 conflict로 중단하고 자동 덮어쓰지 않는다.
- Production 앱에는 append-only credential만, 복원 운영자에는 scan-only credential만 제공한다.
- Preview·CI에는 어느 credential도 제공하지 않고 local fake adapter를 사용한다.
- compliance 프로젝트의 backup·권한·key rotation은 운영 프로젝트와 분리하고 모든 scan을 감사한다.

복원 drill은 복원 전 provider egress·cron·queue·writer를 차단하고, 마지막 durable sequence 이후 tombstone을 replay해 DB/Auth/Storage의 대상 잔여 0건과 checkpoint ack를 확인한다. 그 뒤 worker, webhook, public traffic 순으로 다시 연다.

## 7. 탈퇴 후 권리행사와 문서 반영

로그인 없는 `/legal/privacy-request` 경로와 실제 응답 가능한 고객지원 채널을 공개한다. 신청자는 주문·예매 ref와 거래 당시 연락수단의 purpose-HMAC 검증으로 최소 본인확인을 거치며, 보존 record 전체나 내부 식별자를 직접 조회하지 않는다. 확인 결과에 따라 거래기록 열람·정정·삭제·처리정지 결과와 거절 근거를 전달한다.

시행 전 개인정보처리방침과 이용약관에 다음을 새 시행일·개정 이력과 함께 반영한다.

- 즉시 삭제, 커뮤니티 작성자 연결 해제, 법정 분리보존의 차이
- 분류별 목적·필드·기간·접근 역할과 만료 파기
- Resend·Supabase 등 처리자와 국외이전·삭제/자동 만료 범위
- 탈퇴 후 권리행사 경로와 본인확인 절차
- backup 복원 시 secondary ledger replay와 삭제 재실행

## 8. 근거

- [개인정보 보호법 제21조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?ancYnChk=&chrClsCd=010202&lsJoLnkSeq=1020398651) — 불필요 개인정보의 파기와 법정 보존분 분리
- [전자상거래법 제5조](https://www.law.go.kr/lsLinkProc.do?chrClsCd=010202&joNo=000500000&lsId=009318&lsNm=%EC%A0%84%EC%9E%90%EC%83%81%EA%B1%B0%EB%9E%98%20%EB%93%B1%EC%97%90%EC%84%9C%EC%9D%98%20%EC%86%8C%EB%B9%84%EC%9E%90%EB%B3%B4%ED%98%B8%EC%97%90%20%EA%B4%80%ED%95%9C%20%EB%B2%95%EB%A5%A0&mode=2) — 전자 가입 시 전자 탈퇴 수단
- [전자상거래법 제6조와 시행령 제6조](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=63460) — 거래기록의 목적 제한·분리보존과 5년·3년·6개월 기간
- [Supabase Auth user management](https://supabase.com/docs/guides/auth/managing-user-data) — Auth hard delete와 Storage 객체 선삭제 제약
- [Supabase Storage 객체 삭제](https://supabase.com/docs/guides/storage/management/delete-objects) — Storage API 삭제와 batch 제한

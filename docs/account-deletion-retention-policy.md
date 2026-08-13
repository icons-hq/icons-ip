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

신청 시 결과, 진행 중 의무, 되돌릴 수 없는 시점을 먼저 보여준다. 서버는 현재 세션과 `auth.uid()`를 다시 확인하며 브라우저가 삭제 대상 사용자 ID를 지정하지 못한다. 신청 RPC는 최근 10분 안에 성공한 sign-in 증거가 있어야 하고, 오래된 세션에는 전용 `reauth=1` 로그인 경로를 안내한다. 정지 계정도 이 self-service 재인증·탈퇴 경로만은 사용할 수 있다.

처리 순서는 다음으로 고정한다.

1. `request/fence`: self-only 요청과 멱등키를 기록하고 새 구매·예매·작성·카드팩 개봉·게임·마케팅과 새·갱신 커뮤니티 Storage 업로드를 차단한다. 신청과 보호 write는 같은 사용자별 transaction lock으로 순서를 정한다.
2. `legal snapshot`: 아래 매트릭스에 해당하는 최소 record와 `retain_until`을 분리 저장한다.
3. `email fence`: #191의 durable outbox와 Resend/Supabase Send Email Hook이 탈퇴 대상의 새 발송을 막고 in-flight 결과를 종결한다.
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

| 분류 | 최소 보존 필드 | 기산점·기간 | 접근 역할 | 제외·파기 |
|---|---|---|---|---|
| 계약·청약철회 | order ref, 상태·합계·배송비, 상품명/type/IP snapshot, 수량·단가, 계약·청약철회·결정 시각과 정규화 유형 | 각 기록 생성일부터 5년 | 분쟁 담당자; 목적별 service RPC | checkout key, 자유서술 reason·note, 오류 상세 제외 |
| 대금결제·재화 공급 | provider, provider-neutral payment/order ref, 금액·통화·상태·승인/환급/공급 시각, carrier와 opaque tracking ref | 각 결제·환급·공급 기록 생성일부터 5년 | 재무·CS 분리 역할; 목적별 service RPC | payment key, raw provider payload, idempotency secret, 전체 주소 제외 |
| 티켓 계약·공급 | event/order ref, 회차·ticket type·단가·수량 snapshot, 상태, 계약·검표·취소·환급 시각과 금액 | 각 기록 생성일부터 5년 | 티켓 분쟁 담당자; 목적별 service RPC | QR token, reservation key, staff 원식별자, 자유서술 제외 |
| 탈퇴 후 거래 lookup | 거래 시점 정규화 이메일·전화의 purpose-separated keyed HMAC, key version, 거래 ref | 연결된 거래 record와 같은 기간 | 전용 권리행사 verifier | 원문 연락처·프로필·DOB를 보존하지 않음 |
| 소비자 불만·분쟁 | case ID, 정규화 category, 거래 ref, 접수·조치·결과 시각과 최소 증거 hash | 각 처리기록 생성일부터 3년 | 배정 CS와 승인된 법무 reviewer | 모든 신고·운영 메모 일괄 복제 금지 |
| 표시·광고 | 실제 노출한 고시·가격·조건의 version/hash와 노출 시각 | 각 노출 기록 6개월 | 상품·법무 reviewer | 회원과 연결하지 않음 |
| 배송 운영 개인정보 | 발송·반품에 필요한 수령인명·우편번호·실사용 주소를 필드별 암호화 | 배송 완료·반품·분쟁 종료 중 늦은 시각부터 30일 이내 | fulfillment 최소 역할 | 전화·배송메모 제외; 명시적 legal hold 외 연장 금지 |
| 커뮤니티 일반 신고 | case ID, category, content ref/hash, 당사자 keyed ref, 접수·조치·통지·이의 시각과 결과 | 최종 조치·이의 종료부터 90일 내부 상한 | 배정 staff의 redacted view | 자유서술·원본 첨부는 30일 안에 최소화 |
| 법정 권리 사건 | case ID, 권리 유형, content ref/hash, 서류 검증 결과, 중단·통지·재개·종료 시각 | 사건별 법적 근거·승인된 `retain_until`; 종료 후 불필요 PII 즉시 파기 | 사건별 reviewer; 반출 별도 승인 | 일반 신고라는 이유로 자동 장기보존 금지 |

법정 snapshot은 `private` schema의 service-only 원장에 저장하고 `public`, `anon`, `authenticated`, 일반 `service_role` 직접 권한을 모두 회수한다. `legal_basis`, `retain_until`, 접근 목적, 사건별 hold와 파기 결과가 없는 record는 생성할 수 없다. 매일 만료 batch가 legal hold 없는 record를 파기하고 PII 없는 category·건수·시각만 감사한다.

## 6. Secondary Supabase compliance ledger

외부 interface는 다음 두 동작으로 제한한다.

- `append(event) -> {eventKey, canonicalDigest, sequence, generation, ackedAt}`
- `scanAfter(sequence, pageToken)`

compliance 프로젝트에는 직접 식별자·이메일·DOB·거래 payload를 넣지 않는다. 환경별 keyed-HMAC subject tombstone과 append-only event key, canonical digest, 단조 sequence, generation, ack 시각만 둔다.

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

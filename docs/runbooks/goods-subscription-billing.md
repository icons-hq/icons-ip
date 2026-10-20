# 정기배송·자동결제 운영

2026-10-14. 정기배송은 상품의 반복 구매이며 회차별로 기존 상품 주문을 생성한다. 재입고 알림과 별개다. 첫 회차의 명시적 쿠폰·적립금만 적용하고 이후 회차는 쿠폰·적립금 0으로 계산한다. [거래 설계](../research/smartstore-admin/subscription-transaction-proposal.md)와 [공통 주문 계약](../research/smartstore-admin/goods-transaction-module-proposal.md)을 함께 참조한다.

## 구현과 공개 범위

- 상품 설정은 `catalog.manage`가 `/admin/catalog/goods`의 정기배송 패널에서 수정한다. 주기는 1·2·4주 또는 1·2·3개월이다.
- 고객은 `/my/subscriptions`에서 등록카드, 신청, 회차, 일시정지·해지, 미래 일정·배송지·카드 변경과 재동의를 처리한다. 목록과 회차는 50건씩 과거 내역을 탐색한다. 현재 미확정 회차 판단은 과거 페이지와 분리한다.
- `/admin/sales/subscriptions` 목록·상세·암호화 엑셀은 `sales.read`, 기존에 발송한 회차의 결제 결과 재조회는 `sales.manage`다. 관리자가 고객 대신 새 결제를 청구하거나 자동결제 동의를 생성하지 않는다.
- 금액은 온라인 결제 T와 수령 시 별도 착불 배송비 D를 구분한다. 운영 화면의 결제완료 누계는 취소된 주문을 제외한 온라인 금액이며 PG 정산 완료액이 아니다.
- migration 기본값은 모두 OFF다. 코드·빌드·Fake 시험 완료가 실제 PG 계약, 키 발급, Preview/운영 배포, 공개 승인 또는 실결제 성공을 뜻하지 않는다.

## 서버 설정과 키

`private.goods_subscription_runtime`은 공개 신청(`public_enabled`), 신규 청구(`charge_enabled`), 자동 신규 회차 처리(`worker_enabled`), 로컬 합성 원장(`fake_local_enabled`)을 분리한다. 공통 주문 런타임도 별도다. 공개 스위치를 꺼도 기존 신청 조회·해지·카드 정리·이미 발송한 결제의 조회/환급을 유지한다.

실제 Toss는 서버 전용 `TOSS_BILLING_CREDENTIAL_PROFILES`와 `BILLING_PRIMARY_PROFILE_ID`를 사용한다. 프로필은 UUID·MID·test/live 환경·현재 키 버전·공개 client key·버전별 secret을 갖고, 주문서형 gck/gsk와 분리한 ck/sk를 요구한다. 프로필 UUID/MID/환경은 DB와 일치해야 하며 변경하지 않는다. 키 교체는 같은 프로필 안에서 버전을 바꾼다. secret bytes를 로그, RPC DTO, 감사 기록, 파일에 넣지 않는다.

암호화 키는 서버 전용 `BILLING_ENCRYPTION_KEYS`와 `BILLING_ENCRYPTION_ACTIVE_VERSION`으로 제공한다. AES-256-GCM 암호문은 용도·등록/카드 ID·회원·프로필·MID·환경·키 버전에 결속된다. 복호화 키 회전 때 기존 버전을 유지한 채 새 버전으로 재암호화해야 한다. 백업·복구·회전 실측 없이 운영 키를 폐기하지 않는다.

이미 보낸 청구는 같은 프로필의 현재 secret으로 조회한다. 이 조회에는 billing-key 복호화 키가 필요하지 않다. 최초 POST와 미확정 환급 POST는 처음 선택한 write key version과 멱등키를 유지한다. 기존 버전이 없거나 외부 멱등 기간이 지났으면 새 key로 쓰기를 반복하지 않고 조회·운영 확인을 진행한다. MID를 바꾸려면 새 프로필과 카드 재등록·고객 동의가 필요하다.

## 카드 등록과 비밀 보관

카드 입력은 Toss의 redirect 등록창에서만 받는다. 애플리케이션은 카드번호·비밀번호·생년월일 입력 폼을 제공하지 않는다. 서버 등록은 현재 로그인 session, 회원, HttpOnly nonce cookie, canonical origin과 10분 만료에 결속된다. callback은 즉시 query 없는 고객 결과 URL로 이동하며 no-store/no-referrer를 사용한다.

provider callback의 authKey/customerKey가 포함된 query를 애플리케이션/edge/호스팅 로그가 저장하지 않는지 별도로 확인해야 한다. route 코드만으로 호스팅 access log의 마스킹을 완료했다고 보지 않는다.

발급 응답을 잃으면 같은 등록 operation·write key version으로만 복구한다. 암호화한 발급 auth 재료는 복구 기한 24시간 이후 cron이 제거하며, 미확정 등록의 안전한 메타데이터와 `needs_review` 상태는 남긴다. 빌링키 발급 결과를 끝내 받지 못한 orphan key를 조회하거나 자동 삭제할 수 있다고 가정하지 않는다. 이 경우 Toss 계약 담당 경로로 확인해야 하며 다른 키로 성공을 가장하지 않는다.

## 회차 실행·중지·복구

`/api/cron/subscriptions`는 `CRON_SECRET` Bearer 인증과 90초 실행 예산을 사용한다. 매 실행에서 민감 임시자료 TTL을 정리하고 회차를 최대 한 건 처리한다. 결제 회차가 없으면 카드 폐기를 한 건 처리하고, 둘 다 idle이면 탈퇴 계정의 잔여 거래 데이터 정리를 최대 한 건 시도한다. 각 RPC는 독립 트랜잭션이며 provider 요청 동안 DB 잠금을 유지하지 않는다.

신규 청구는 DB due 후보와 10분 lease/fence, 현재 계정·상품·가격·할인·배송·재고·약관을 확인한 뒤 시작한다. 월 주기는 원래 날짜 또는 말일 의도를 보존한다. 예정 시각이 24시간 넘게 지났으면 일시정지하고 고객이 미래 일정을 다시 정하도록 한다. 밀린 여러 회차를 한꺼번에 청구하지 않는다.

첫 결제가 DB에서 승인 확정되어야 신청을 active로 표시한다. 승인 시 기존 주문 확인 메일의 멱등 훅을 실행한다. 메일 장애는 결제 승인을 되돌리지 않는다. 발송을 실제로 검증하는 테스트는 별도 승인 범위이며 로컬 자동 검증은 메일 훅을 mock한다.

- 발송 전 해지·일시정지 승리: 해당 worker의 기존 fence는 무효가 되며 미결제 주문은 기존 취소 절차로 자원을 해제한다.
- 발송 commit 뒤 해지: 미래 회차를 중지하고 현재 회차 결과는 계속 조회한다. 현재 주문의 취소·환불은 별도 주문 요청이다.
- timeout·응답 유실·5xx·404: 새 청구를 만들지 않는다. 같은 회차·주문·attempt로 조회한다. 404 한 번은 미청구의 증거가 아니다.
- 확정 거절: 미결제 자원을 해제하고 신청을 일시정지한다. 카드/일정 재확인 전 같은 실패 회차를 자동 재청구하지 않는다.
- 금액 T 또는 D·수납 안내·배송지·주기·상품 조건 변경: 새 불변 약관 snapshot과 현재 견적에 다시 동의해야 청구한다.
- 승인/환불은 기존 금융 finalizer가 확정하며 webhook payload 자체는 성공 증거로 쓰지 않는다. 금융 binding은 계정의 주소·카드 암호문 정리 이후에도 해당 payment attempt와 함께 보존한다.

## 계정 삭제 시 동의 증거

구독 주소·직접 입력·카드 암호문을 정리하기 전에 동의 계약을 기존 계정 삭제 보존 snapshot에 남긴다. 보존 allowlist는 terms ID·정책 버전·hash·주기, 굿즈/옵션/수량, 최초·향후 금액과 배송 결제 방식·정책 ID, 회차→terms 연결, 동의·재동의 operation의 시각·revision·연결 ID다. 미동의 draft는 계약 보존에 포함하지 않는다.

수납 안내의 자유문구와 연락처는 복사하지 않는다. 안내 원문의 hash와 해당 terms 작성 전에 존재하면서 같은 공개 조건을 담은 불변 수납계약 version ID 목록을 남긴다. 동일 조건의 여러 version이 있을 수 있으므로 이 목록을 최초 발급 version 한 개를 알아낸 증거로 해석하지 않는다. 원 결제의 실제 수납계약 version은 기존 주문 배송 원장에 별도로 남는다.

`20261014034238_goods_subscription_contract_retention.sql`까지 설치한 뒤 계정 정리 cron을 시작해야 한다. `11902` 초기 helper만 적용한 상태로 정리를 실행하면 계약 증거가 부족하다. 검증 결과는 [QA 행렬](../research/smartstore-admin/subscription-qa-matrix.md)에 기록한다.

## 운영 조회·내려받기

운영자는 상태와 신청번호·구매자명·상품으로 검색한다. 암호화 엑셀은 현재 페이지가 아닌 같은 조건의 전체 신청을 최대 10,000건 담는다. 비밀번호는 POST 본문에서만 받고 저장하지 않는다. 원본 workbook 버퍼는 암호화 이후 지운다. 내려받기 직전 현재 권한, DB snapshot fingerprint와 암호화 파일 SHA-256의 감사 기록이 성공해야 파일을 반환한다. DB의 임시 export snapshot은 24시간 후 정리한다.

카드 원문·authKey·billingKey·customerKey·ciphertext·nonce와 배송 주소/연락처는 이 운영 목록·엑셀에 포함하지 않는다. 필요한 주문·배송 업무는 기존 주문 상세 권한과 계약을 따른다.

## 로컬 합성 검증

`BILLING_FAKE_LOCAL_ENABLED=true`, `BILLING_FAKE_PROFILE_ID`와 DB fake 프로필을 함께 사용한다. Fake는 development/test, 비-Vercel, HTTP localhost/127.0.0.1 앱과 DB 조합에서만 선택한다. 합성 키 재료와 DB 원장은 실제 Toss 요청을 만들지 않는다. Fake의 승인·환불·폐기 원장은 DB에 남으므로 애플리케이션/검증 프로세스가 재시작해도 조회할 수 있다.

격리 검증은 `supabase/tests/goods_subscriptions_isolated.sh`를 사용한다. 명시한 로컬 Supabase 컨테이너의 기존 DB를 custom dump로 별도 DB에 복제하고 검증 후 복제 DB를 삭제한다. 원본 DB나 기존 개발 DB를 reset하지 않는다. 먼저 공통 거래·구독 migration 이력과 필수 schema가 설치됐는지 확인하며 migration을 다시 적용하지 않는다. 컨테이너의 이름·프로젝트·실행 상태와 전체 ID를 확인하고, 모든 작업을 그 ID에 고정한다. 종료 시 원본 migration 이력 전체 행의 SHA-256이 시작값과 같은지 검사한다.

자동 검증 범위는 암호화·키 버전·provider 응답 결속·90초 경로·최초 혜택/향후 무혜택·카트 독립·재고 예약·회차 멱등·해지·카드 폐기·금융 binding 보존·105건 신청/66회차 탐색·엑셀 감사·TTL·실제 두 세션 경쟁 및 프로세스가 끊긴 뒤 durable Fake 조회/확정이다. 실제 Toss 계약/키 발급·요청·메일 발송·클라우드 스케줄러 실행은 이 로컬 검증에 포함하지 않는다.

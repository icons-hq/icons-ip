# NICEPAY Production rollout runbook

판매 제한 상품(성인/19금)이 담긴 굿즈 주문의 카드 결제를 나이스페이(NICE정보통신
NICEPAY)로 운영하는 절차다. 순서는 **자격 증명 등록 → dark deploy → 심사용 canary →
카드사 심사 → 보증보험 → 공개**다. MID, MerchantKey, SignData, TID,
AuthToken, 승인번호, 카드번호, 원문 응답, 자격 증명 fingerprint는 문서·issue·PR·로그·명령
인자에 기록하지 않는다. 이 저장소는 공개 저장소다.

## 현재 상태 (2026-11-06)

- 코드는 dark다. Vercel Production에 `NICEPAY_MID`·`NICEPAY_MERCHANT_KEY`가 없으므로
  `paymentProviderConfigured('nicepay')`가 false이고, 판매 제한 주문은 결제를 시작할 수 없다.
- 계약: 슈퍼로그(㈜이노빅스비전) 대행으로 19금 전용 계약(수수료 3%, 정산 D+5, 취소 연동
  가능). 계약서·구비서류 협조전은 하이웍스에 임시저장된 상태다.
- 계약서 제5조는 판매 품목을 계약 때 고지한 재화로 한정한다. 그래서 카드사 심사는 **실제
  운영 경로 그대로** 받는다 — 심사자에게만 다른 결제창이나 가짜 결제창을 보여 주는 경로는
  만들지 않았다. 공개 gate를 닫은 채 단일 canary(심사용 회원 계정)만 결제할 수 있게 하는
  기존 방식을 쓴다.
- 코페이는 drain 전용으로 은퇴했다(아래 "코페이 은퇴").

## 확인된 범위

- 기술 계약은 [NICEPAY 개발자 문서](https://developers.nicepay.co.kr)의 **웹표준 인증결제**
  (2026-08-03 개편본)만 근거로 한다 — 결제창 호출하기, 승인 API, 망취소 API, 승인 취소 API,
  거래조회, 결과코드(결제창 인증·API 공통·승인 공통·신용카드·승인 취소), 결제통보.
- API 세대는 2026-11-06 사용자 결정으로 **웹표준(MID + MerchantKey)**이다. Start API v1
  (`api.nicepay.co.kr/v1`, clientKey/secretKey)은 쓰지 않는다. 슈퍼로그가 발급하는 MID가
  웹표준으로 열리는지는 MID 발급 때 확인한다 — 다르면 이 어댑터를 쓸 수 없다.
- 공개 샌드박스 MerchantKey는 문서에 없다. 테스트 MID가 필요하면 나이스페이 기술지원
  (it@nicevan.co.kr)이나 슈퍼로그에 요청한다. 저장소의 테스트는 형식만 맞춘 가짜 값과
  fetch mock만 쓴다.
- 결제수단은 신용카드(`PayMethod=CARD`)뿐이다. 계좌이체·가상계좌·휴대폰은 열지 않는다.
- 티켓은 범위 밖이다. 나이스페이 티켓 gate는 코드에 없다.

## 의존 순서

1. [#595](https://github.com/icons-hq/icons-ip/pull/595) — KCP 휴대폰 본인확인 V2 성인 인증
   (2026-11-06 main 머지).
2. [#596](https://github.com/icons-hq/icons-ip/pull/596) — 성인 인증을 마친 회원에게 19금
   굿즈를 공개·판매(노출·장바구니·주문 생성 개방, 2026-11-06 main 머지). 심사용 계정이 19금
   상품을 보고 주문하려면 이 변경과 성인 인증 공개 스위치(또는 성인 인증 canary)가 필요하다
   ([KCP 성인 인증 runbook](./kcp-adult-verification.md)).
3. 이 runbook의 나이스페이 연동.

셋이 모두 production에 있어야 심사용 canary가 실제 결제를 할 수 있다. 장바구니 단계 파생
(`deriveGoodsCartProvider`·`deriveUserCartProvider`), 주문 단계 파생(`deriveGoodsOrderProvider`)은
모두 `RESTRICTED_GOODS_CARD_PROVIDER`(`lib/payments/goods-sale-restriction.server.ts`, 값
`'nicepay'`)를 쓰고, DB 강제(`prepare_goods_payment_attempt`)도 같은 값이다.

## 환경 변수

| 이름 | 범위 | 값 |
| --- | --- | --- |
| `NICEPAY_MID` | Production 전용, sensitive | 나이스페이 가맹점 ID(영숫자 10자) |
| `NICEPAY_MERCHANT_KEY` | Production 전용, sensitive | 가맹점관리자 "가맹점정보 > KEY관리"의 MerchantKey |
| `NICEPAY_ORDER_CHECKOUT_ENABLED` | Production | `true`·`false`·미설정(기본 닫힘) |
| `NICEPAY_ORDER_CANARY_USER_ID` | Production | 심사용 회원 계정의 UUID 하나. 미설정이 기본 |
| `SITE_URL` | Production | 정확히 `https://iconsip.com` |
| `PAYMENT_RECONCILIATION_SECRET` | Production | 내부 재정합 라우트 bearer(16~128자 URL-safe) |

- 자격 증명은 `VERCEL_ENV=production`에서만 읽는다(fail closed). Preview 빌드는 두 값의 존재
  자체를 거절한다(`scripts/check-vercel-build-env.mjs`).
- 두 자격 증명은 required가 아니다. 다만 하나라도 놓이면 둘 다 형식이 맞아야 하고, 자격 증명
  없이 gate나 canary를 켜면 빌드가 멈춘다.
- CLI로 등록할 때는 값을 명령 인자나 shell history에 넣지 않고 hidden stdin으로 입력한다.
- 이 PR은 Vercel env를 바꾸지 않는다. 모든 등록·변경은 사람이 한다.

## 결제 프로토콜

1. **준비**: `prepareGoodsPaymentAction`이 주문의 판매 제한 여부로 provider를 파생한다
   (`deriveGoodsOrderProvider` → `nicepay`). gate(`NICEPAY_ORDER_CHECKOUT_ENABLED` 또는
   canary)가 열려 있어야 하고, DB `prepare_goods_payment_attempt`가 같은 파생을 강제한다
   (판매 제한 주문 ↔ `nicepay`, 일반 주문 ↔ `toss`, `korpay`는 거절).
2. **결제창**: 어댑터가 `SignData = hex(sha256(EdiDate + MID + Amt + MerchantKey))`를
   계산한다. `EdiDate`는 attempt 만료 10분 전(KST)이라 같은 attempt를 다시 준비해도 값이
   같다. 브라우저는 `pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js`를 싣고
   `accept-charset="euc-kr"` 결제 폼을 `goPay()`에 넘긴다. 상품명은 `ICONS 굿즈 주문`,
   주문번호(`Moid`)는 attempt의 provider 주문번호, 가맹점 여분 필드(`ReqReserved`)는 단회용
   callback nonce다. MerchantKey는 브라우저로 나가지 않는다.
3. **인증 응답**: PC는 `nicepaySubmit()`이 폼을, 모바일은 나이스페이가 인증 결과를
   `POST /api/payments/goods/confirm/nicepay`로 보낸다(세션 무관). 라우트는 판정 필드만
   남기고(한글 필드는 버린다), 어댑터가 서버의 attempt와 대조한다 — `MID`·`Moid`·`Amt`·
   `ReqReserved`(nonce)·인증 서명 `hex(sha256(AuthToken + MID + Amt + MerchantKey))`.
   `NextAppURL`·`NetCancelURL`은 문서가 밝힌 `dc1-api`·`dc2-api.nicepay.co.kr`의 고정 경로만
   받는다. 하나라도 어긋나면 승인 API를 부르지 않는다.
4. **TID 기록**: 승인 API를 부르기 전에 `service_record_nicepay_payment_reference`로 TID를
   DB에 남긴다. 기록이 실패하면 승인 API를 부르지 않는다. 그래서 "TID 기록이 없다 = 승인을
   부른 적이 없다"가 성립한다.
5. **승인**: `NextAppURL`로 승인 요청(`SignData = hex(sha256(AuthToken + MID + Amt + EdiDate +
   MerchantKey))`, 시한 25초). `3001`이고 응답 서명 `hex(sha256(TID + MID + Amt + MerchantKey))`·
   TID·주문번호·금액·`CARD`·승인일시가 모두 맞을 때만 `approved`다. 원장 `payments.payment_key`는
   TID다.
6. **망취소**: 승인 응답을 받지 못했거나(전송 실패·시한 초과·200 아님·JSON 아님) 카드사
   타임아웃·지연·통신 오류 계열 코드면 `NetCancelURL`로 망취소한다. 망취소가 확인되면(`2001`
   + 서명 일치, 또는 되돌릴 거래 없음·이미 취소) `declined`, 아니면 TID를 증거로 남긴
   `unknown`이다.

결과 분류:

| 상황 | outcome | reasonCode |
| --- | --- | --- |
| 인증 응답이 attempt와 다름·서명 불일치 | `needs_review` | `provider_identity_mismatch` |
| 승인 주소가 나이스페이 도메인 밖·필수 필드 형식 위반 | `needs_review` | `provider_invalid_callback` |
| 구매자가 결제창 취소(`I002`·`9993`) | `canceled` | `provider_user_canceled` |
| 그 밖의 인증 실패 | `declined` | `provider_authentication_failed` |
| TID 기록 실패 | `unknown` | `provider_reference_unrecorded` |
| 승인 `3001` + 대조 통과 | `approved` | `provider_approved` |
| 승인 `3001`인데 대조 실패 | `needs_review` | `provider_identity_mismatch` |
| 중복 승인 계열(`1621`·`1622`·`1651`·`1681`·`1682`) | `needs_review` | `provider_duplicate_requires_review` |
| 키·상점 설정 오류 계열(`A101`·`A109`·`A114`·`1641` 등) | `needs_review` | `provider_configuration_error` |
| 카드사 거절 등 확정 실패 | `declined` | `provider_declined` |
| 승인 무응답·모호 코드 → 망취소 확인 | `declined` | `provider_net_canceled` |
| 승인·망취소 모두 모호 | `unknown` | `provider_unavailable` |

## 재정합과 환불

- **재정합**(`reconcile`): 남은 TID로 거래조회(`trans_status.jsp`)를 한다. 웹표준 거래조회는
  TID의 승인·취소 여부만 돌려주고 주문번호·금액은 돌려주지 않는다. 그래서:
  - TID 기록 없음 → `declined`(`provider_payment_absent`) — 승인을 부른 적이 없다.
  - `Status=1`(취소) → `declined`(`provider_payment_canceled`).
  - `Status=9`·거래 없음 → 승인 가능 시한(attempt 만료 + 45분) 뒤에만 `declined`, 그 전에는
    `unknown`.
  - `Status=0`(승인) → **자동 승인하지 않는다** → `needs_review`(`provider_approval_unverified`).
    콜백이 실어 온 TID가 다른 주문의 것일 수 있어서다.
  - TID가 여럿이면 `needs_review`(`provider_reference_ambiguous`).
- **환불**(`refund`): 취소 오케스트레이터가 원장 `payment_key`(TID)를 넘긴다. 전액 취소만
  보낸다(`PartialCancelCode=0`). 부분 취소 요청(반품배송비 차감, [ADR-0031](../adr/0031-return-fee-deduction-partial-refund.md))은
  부분 취소 계약 전이고 거래조회가 잔액을 주지 않아 호출 없이 `provider_partial_cancel_unavailable`로 돌려준다 —
  나이스페이 결제의 단순 변심 반품은 차감하지 않고 전액 환불한다. 부분 취소를 켜려면 계약 확인 뒤 잔액 검증
  방법(거래 내역 조회 등)을 정해 어댑터를 따로 고친다. 취소 전 조회 → 취소 → 취소 후 조회를 함께 보고, 취소
  응답(`2001`·`2211` + 서명 일치, 또는 `2013`·`2015`·`2219` 이미 취소)과 사후 조회 `Status=1`이
  맞을 때만 승인한다. 취소 거절 코드는 `needs_review`(`provider_cancel_rejected`)다. 한글
  취소 사유는 EUC-KR 인코딩을 피하려고 `ICONS order cancellation`으로 바꿔 보낸다.
- 나이스페이 결제는 토스처럼 운영자 전액 취소·클레임 승인 시 자동 전액 취소 대상이다
  (`lib/payments/provider-capabilities.ts`와 DB 같은 판정).

### `needs_review` 건 처리

1. 가맹점관리자(npg.nicepay.co.kr)에서 주문번호(`Moid`, 주문 화면의 결제 시도 provider
   주문번호)로 거래를 찾는다.
2. 승인 상태인데 우리 주문이 결제되지 않은 건이면 가맹점관리자에서 그 거래를 전액 취소한다.
   구매자에게는 다시 주문하도록 안내한다.
3. 내부 재정합 라우트로 그 attempt 한 건을 다시 정합한다:
   `POST /api/internal/payments/goods/reconcile`(`Authorization: Bearer
   $PAYMENT_RECONCILIATION_SECRET`, 본문 `{"operation":"payment","attemptId":…,"caseRef":…}`).
   거래조회가 `취소`면 `declined`로 닫힌다.

### 결제통보(웹훅)

쓰지 않는다. 문서의 결제통보에는 위변조 검증 수단(서명)이 없고, 확정의 진실원은 서버
승인 응답이다. 가맹점관리자에 결제통보 URL을 설정하지 않는다.

## 시퀀스

1. **(human) 서류 제출 → MID/KEY 발급.** 슈퍼로그를 통해 받는다. MID가 웹표준
   (MerchantKey 방식)인지 확인한다.
2. **(human) 자격 증명 등록.** Vercel Production에 `NICEPAY_MID`·`NICEPAY_MERCHANT_KEY`를
   sensitive로 등록한다. gate와 canary는 등록하지 않는다. `PAYMENT_RECONCILIATION_SECRET`이
   없으면 함께 등록한다.
3. **(agent/CI) dark deploy.** 승인된 exact main SHA를 GitHub Actions Production 경로로
   배포하고 build readback이 `NICEPAY configured=true, order checkout enabled=false, order
   canary configured=false`인지 확인한다. build log에 MID·키가 없는지 본다.
4. **(human) 심사용 계정 지정.** 심사용 회원 계정을 하나 정하고, 그 계정으로 성인 인증
   (#595)을 마친다. 성인 인증 공개 스위치가 닫혀 있으면 같은 UUID를
   `ADULT_VERIFICATION_CANARY_USER_ID`에도 둔다(KCP 성인 인증 runbook). UUID를
   `NICEPAY_ORDER_CANARY_USER_ID`에 등록하고 3번과 같은 경로로 다시 배포한 뒤
   readback(`order checkout enabled=false, order canary configured=true`)을 확인한다.
5. **(human/agent) canary 실증.** 그 계정으로 실제 19금 상품을 주문해 결제 1건을 승인시키고,
   이어서 취소(클레임 승인 또는 운영자 전액 취소)해 환불 경로를 한 번 태운다. 확인할 것:
   - PC·모바일 결제창이 열리고 인증 응답이 confirm 라우트에 도착한다(PC 결제 폼에 인증
     결과 필드가 같은 이름으로 중복돼도 값이 같으면 통과한다).
   - 승인 응답 서명 대조가 통과한다(승인 `Amt`가 12자리 패딩 원문으로 서명된다는 해석 확인).
   - 거래조회가 `ResultCode=0000`과 `Status`를 돌려준다.
   - 취소 응답 서명과 사후 조회 `Status=1`이 맞아 환불이 `completed`로 닫힌다.
   - 가맹점관리자 거래 내역의 주문번호·금액·상품명이 우리 원장과 같다.
   하나라도 어긋나면 6번으로 가지 않는다. 그 결제로 생긴 주문·attempt는 정리 대상으로 적는다.
6. **(human) 카드사 심사(약 2주).** 심사자는 심사용 계정으로 로그인해 실제 운영 경로로 결제한다.
   공개 gate는 닫힌 채다. 심사 요청 사항에 대응한다.
7. **(human) 보증보험 가입.**
8. **법정 고지 — #631로 이행 완료(2026-11-06).** 이용약관 제11조(지급방법)와
   개인정보처리방침 제5조(처리 위탁) 수탁자 표(`lib/legal/documents.ts`)가 19금 굿즈가 담긴
   주문의 카드 결제를 나이스정보통신 주식회사로 고지한다. 오픈 전 최초 판(시행일 2026-11-06)이라
   별도 개정과 사전 공지는 없다. 공개 직전에 이 고지가 그대로인지만 확인한다. 오픈 뒤 문구를
   바꾸면 약관 제3조와 방침 제13조대로 사전 공지하고, 개정 시행일이 공개일보다 늦으면 gate를
   열지 않는다.
9. **(human) 공개.** `NICEPAY_ORDER_CHECKOUT_ENABLED=true`로 바꾸고 canary를 제거한 뒤 3번과
   같은 경로로 배포하고 readback(`order checkout enabled=true, order canary
   configured=false`)을 확인한다.

## Rollback과 callback drain

1. `NICEPAY_ORDER_CHECKOUT_ENABLED`를 `false`로 바꾸고 canary를 제거한다. **키는 지우지
   않는다** — 진행 중 인증 응답(confirm 라우트는 gate가 아니라 자격 증명 기준)과 환불·재정합이
   계속 돌아야 한다.
2. 승인된 main SHA로 GitHub Actions Production 경로에서 새로 배포하고 readback으로 gate·canary가
   닫혔는지 확인한다.
3. `prepared | confirming | unknown | needs_review` 나이스페이 attempt가 모두 terminal이나
   운영 소유 `needs_review`가 된 뒤에만 키 교체·삭제를 별도 승인 범위로 검토한다.

## 코페이 은퇴

- 판매 제한 주문의 provider는 앱·DB 모두 `nicepay`로 고정됐다. DB prepare는 `korpay`를
  `goods_payment_unavailable`로 거절한다.
- 런타임은 `KORPAY_ORDER_CHECKOUT_ENABLED`·`KORPAY_TICKET_CHECKOUT_ENABLED`·`KORPAY_*_CANARY_USER_ID`를
  더는 읽지 않는다. 남아 있으면 빌드가 경고만 남긴다 — 사람이 Production에서 지운다.
- `KORPAY_MID`·`KORPAY_KEY`, 코페이 어댑터, `/api/payments/goods/confirm`(코페이 콜백 drain),
  코페이 수동 복구 seam은 그대로다. 진행 중 코페이 결제와 과거 원장 처리용이다.
- 코페이 계약 해지·자격 증명 삭제는 drain이 끝난 뒤 사람이 결정한다.

## 남은 위험

- 거래조회가 주문번호·금액을 돌려주지 않아, 승인·망취소가 모두 모호하게 끝난 드문 건은
  사람이 가맹점관리자에서 처리한다(`provider_approval_unverified`).
- 망취소 허용시간·`EdiDate` 유효기간은 문서에 없다. 승인 시한(25초) 뒤 곧바로 망취소하고,
  결제창 `EdiDate`는 준비 시각 기준이다.
- 나이스페이 정산 대사는 아직 없다(토스 정산 대사 `pg_settlement_match`와 별개). 정산 D+5
  대조는 당분간 가맹점관리자 정산 내역으로 한다.
- 실키 검증 전에는 5번의 해석(응답 서명의 `Amt` 원문, PC 폼 필드 중복, `CharSet=utf-8` 응답)이
  문서 해석에 머문다.

## 남길 증거

- 배포 exact SHA, PR, Actions run, Vercel deployment와 canonical alias
- 환경 변수 **이름·존재 여부·sensitive 여부·gate boolean**만 담은 readback
- canary 실증 시각과 결과(위 5번 항목별), 그 결제로 생긴 주문·attempt 정리 기록
- 카드사 심사 접수·결과 시각, 보증보험 가입 시각
- 공개 직전 약관 제11조·처리방침 제5조의 나이스정보통신 고지 확인 시각

원문 MID·MerchantKey·TID·AuthToken·승인번호·카드번호·provider 응답은 어디에도 복사하지 않는다.

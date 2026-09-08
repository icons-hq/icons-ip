# Korpay Production rollout runbook

이 runbook은 Korpay 신규 결제를 **자격 증명 등록 → dark deploy → 단일 actor canary →
목적별 공개 활성화** 순서로 운영한다. MID, MKEY, paymentKey, TID, 승인번호, 원문 응답,
자격 증명 fingerprint는 문서·issue·PR·로그·명령 인자에 기록하지 않는다.

## 현재 상태 — 판매 제한 상품 전용 대기 (2026-09-01~)

> **이 runbook의 gate는 닫힌 대기 상태다.** 기본 PG 지위는 토스페이먼츠 주문서형
> 결제(구 결제위젯 v2)로 이관됐다(에픽
> [#384](https://github.com/icons-hq/icons-ip/issues/384), 정본 스펙
> [#398](https://github.com/icons-hq/icons-ip/issues/398)). 신규 굿즈·티켓 결제의
> 기본 provider는 `toss`이고, 토스가 취급하지 않는 **판매 제한 상품**(성인(19금),
> 추후 랜덤박스)이 담긴 주문만 코페이로 파생된다.
>
> 아래 절차는 삭제하지 않는다 — 19+ 오픈 트랙(NICE 성인인증 #209·#210 · 노출 게이트 ·
> 코페이 수동 취소 운영 콘솔)이 갖춰진 뒤 코페이 gate를 판매 제한 상품 전용으로
> 재개방할 때 그대로 재사용한다(에픽 #384 시퀀스 ⑥).
>
> 토스 심사·라이브 전환 절차는 [Toss Production rollout runbook](./toss-production-rollout.md)에 있다.

전환 뒤에도 유지되는 사실:

- 코페이 자격 증명(`KORPAY_MID`·`KORPAY_KEY`)과 어댑터는 제거하지 않는다. 진행 중이던
  코페이 결제의 callback drain은 rollout gate가 아니라 자격 증명 기준으로 열려 있어,
  gate를 닫아도 known order+nonce는 계속 claim·confirm·finalize된다.
- 판매 제한 상품은 성인인증이 붙기 전까지 스토어에서 비노출이고 주문 생성이 서버에서
  차단되므로, 코페이 gate가 닫힌 지금 코페이로 파생되는 신규 주문은 만들어지지 않는다.
- 코페이에는 취소·상태 조회 API가 없다는 제약이 그대로다. 아래 "모호 결제와 취소",
  수동 복구 seam, #208 운영 경계는 재개방 시점에도 같은 조건으로 적용된다.

### 2026-09-01 굿즈 gate 폐쇄 readback (#385)

- 2026-09-01 기본 PG 재전환 결정으로 굿즈 공개 gate를 닫기로 확정했다. 근거는 첫 실판매가
  약 2개월 뒤로 확정돼 수동 취소밖에 안 되는 결제를 공개로 열어 둘 효익이 없다는 것이다.
  이는 아래 `2026-08-18` 예외 전환(승인 경계 밖 운영 예외)의 복원이며, 그 예외 기록과
  잔여 위험은 이력으로 보존한다.
- 폐쇄 실행은 human 티켓
  [#385](https://github.com/icons-hq/icons-ip/issues/385)가 수행한다: Vercel Production
  `KORPAY_ORDER_CHECKOUT_ENABLED`를 `false`로 변경(또는 제거 — 기본값이 closed)한 뒤
  아래 "Rollback과 callback drain" 순서대로 새 Production deployment를 만들고 boolean
  readback까지 확인한다. 티켓 gate와 두 canary는 이미 닫힌 상태를 유지한다.
- **실행 일시·배포 SHA·Actions run·readback 결과는 #385가 수행한 뒤 여기에 채운다.**
  기록 형식은 아래 `2026-08-18` readback과 같게 하고, 원문 provider 식별자는 남기지 않는다.

## 확인된 범위

- 2026-08-14 사용자 확인으로 Korpay 계약은 완료됐고 현재 운영 자격 증명을 사용할 수
  있다. 이 확인을 계약 미완료, 키 폐기, rotation 또는 재발급 대기로 해석하지 않는다.
- 위 확인은 공급사 서면 증거가 아니며 19+ 유한 실물 쿠지의 결제·NICE·법률·IP 승인
  범위를 포함하지 않는다.
- 기술 계약은 **코페이 인증결제 가이드 v1.2.2**와
  [`@korpay/sdk` 1.1.8 공식 sample](https://github.com/korpay/korpay-sample)을 따른다.
- 공개 가이드에는 자동 결제 상태 조회, reconcile, 취소 API가 문서화되어 있지 않다.
  문서화되지 않은 endpoint를 추측해 호출하지 않는다.

## 법정 고지 일정과 운영 담당

- 현행 이용약관과 개인정보처리방침의 시행일은 `2026-08-07`로 유지한다.
  `2026-08-14`에 Korpay 결제대행사·수탁자 변경을 사전 공지하고, 개정 본문은
  `2026-08-21`부터 시행한다.
- 사전 공지 단계에서는 현행 본문을 미리 바꾸지 않는다. `2026-08-21`에 별도
  배포로 약관의 신규 굿즈·티켓 Korpay 카드 결제 내용, 방침의 `주식회사 코페이`
  수탁자 행, 두 문서의 시행일을 활성화하고 사전 공지 패널을 제거한다. 날짜가 되어도
  코드가 자동으로 개정 본문으로 전환된다고 가정하지 않는다.
- `2026-08-14` 확인 시점에 필수 동의와 온보딩을 완료해 구매 가능한 일반 고객은
  0명이다. 완료하지 않은 프로필은 기존 고객으로 간주하지 않고, 결제 canary 후보는
  내부 관리자 계정 하나뿐이므로 기존 고객 재동의·데이터 backfill migration은 하지 않는다. 고객이
  생긴 뒤에는 이 판단을 재사용하지 않고 변경 영향과 개별 통지·재동의 필요를 다시
  판단한다.
- `2026-08-21` 시행 전에는 Korpay 굿즈·티켓 canary와 목적별 public gate를 모두
  닫는 것이 승인된 기본 rollout 경계였다. `2026-08-18` 사용자의 명시적 운영 지시로
  굿즈 public gate만 예외적으로 열었으며, 아래 운영 readback과 잔여 위험을 이 문서에
  그대로 보존한다. 티켓 gate와 두 canary는 닫힌 상태를 유지한다.
- 현재 결제 취소·환급 운영 소유자는 canary 관리자 계정을 소유한 **회사 대표자** 한 명이다.
  개인 이메일 주소를 runbook에 기록하지 않는다. 수동 취소 반영 UI·Server Action·DB RPC는
  모두 활성 `admin` 역할만 허용한다. 승인된 기본 경계에서는 공개 판매 전에 지정된 회사
  직원에게 접수 채널, 처리 SLA, 상태·금액 대조 방법, 완료 증거 보관 위치, 에스컬레이션
  경로를 문서로 인계해야 했다. 2026-08-18 예외 전환 시점에는 인계가 끝나지 않았으므로
  현재 대표자가 대응 가능 상태를 유지하고, 지정 담당자에게 필요한 `admin` 권한을
  명시적으로 부여·검증한 뒤 기존 담당자의 권한을 회수한다. 모든 `staff`가 이 권한을 가진
  것으로 간주하지 않고 #208의 담당자를 갱신한다.

### 2026-08-18 굿즈 공개 활성화 readback

- Production `KORPAY_ORDER_CHECKOUT_ENABLED=true`,
  `KORPAY_TICKET_CHECKOUT_ENABLED=false`이며 두 canary user ID는 미설정이다. 따라서
  로그인과 필수 온보딩을 마친 모든 사용자가 굿즈 checkout을 시작할 수 있다.
- 배포 source는 `main@a0b12227179caee47bf773151d845fd623fd3d5a`, 검증된
  Production source run은 [31770654341](https://github.com/icons-hq/icons-ip/actions/runs/31770654341),
  config-only 재배포는 [32085023278](https://github.com/icons-hq/icons-ip/actions/runs/32085023278)이다.
  수동 실행은 전체 validate와 Vercel Production 배포에 성공했고 Supabase job은 의도대로
  건너뛰었다.
- 새 Vercel deployment `https://icons-i15y9nvea-sangwopark19icons-1055s-projects.vercel.app`는
  `Ready` 뒤 `https://iconsip.com`에 alias됐고 build readback은
  Korpay configured, 굿즈 checkout ON, 티켓 checkout OFF, canary 0을 확인했다. 로그인된
  Production `/checkout`에서도 주문 생성 버튼의 활성 상태를 확인했지만 실제 주문·과금은
  실행하지 않았다.
- 이 공개 활성화는 `2026-08-21` 개정 약관·개인정보처리방침의 활성 본문 배포, callback
  서명 또는 provider 상태조회 부재, #208의 공급사 취소 채널·담당자 인계·모호 승인 운영을
  해소하지 않는다. 이는 사용자 승인에 따른 운영 예외이며 이후 rollout의 안전한 선례로
  재사용하지 않는다.
- `2026-08-18`부터 `2026-08-20`까지 현행 법정 본문과 Korpay 공개 결제가 일치하지 않는
  상태는 위에서 승인한 운영 예외 자체이므로 그것만으로 rollback을 반복 실행하지 않는다.
  `2026-08-21 00:00 KST`까지 개정 본문이 Production에 활성화되지 않으면 아래 rollback
  순서로 굿즈 gate를 즉시 `false`로 되돌린다. 그전이라도 이 전환 범위를 벗어난 새로운
  법정 고지 불일치, 모호 승인, 취소 불능 또는 운영자 부재가 확인되면 즉시 rollback하고
  새 Production deployment의 boolean readback까지 확인한다.

## 결제 프로토콜

1. 서버가 DB attempt의 불변 amount·KRW·opaque order number·opaque product code를 읽는다.
2. 서버가 14자리 `ediDate`와 `SHA256(merchantId + ediDate + amount + MKEY)` hash를
   생성한다. MKEY는 이 경계 밖으로 내보내지 않는다.
3. 서버가 만든 일회성 payload를 `@korpay/sdk` 1.1.8에 전달한다. `merchantId`는 provider가
   요구하는 SDK 필드로 이 payload에만 포함되고 `NEXT_PUBLIC_` 환경변수나 정적 번들 설정이
   아니다. Production `returnUrl`은 `SITE_URL=https://iconsip.com`에서 만들며 굿즈·티켓
   callback 모두 canonical Production origin을 사용한다.
4. Korpay는 인증 결과를 `application/x-www-form-urlencoded` POST로 callback한다. 앱은 body
   크기·형식·필수 필드를 제한하고 opaque order+nonce를 DB에서 먼저 원자 claim한다.
   공개 가이드에는 callback signature나 status 조회 API가 없고 nonce는 SDK payload를 받은
   구매자에게 보이므로, 이 값만으로 provider 발신 진위를 증명한다고 간주하지 않는다.
5. 인증 성공일 때만 서버가 paymentKey로 Korpay confirm을 정확히 한 번 호출한다. callback과
   confirm의 MID·주문번호·금액·통화·결제수단을 attempt와 엄격히 대조한다. callback body나
   브라우저 성공 신호만으로 주문·티켓을 확정하지 않는다.
6. 정규화한 `approved | declined | canceled | unknown | needs_review`만 DB finalizer에 넘긴다.
   사용자 브라우저는 provider 식별자가 없는 명시적 303 success·checking·failure 경로로
   이동한다.

## 환경별 변수

| 변수 | Production | Preview / CI |
|---|---|---|
| `SITE_URL` | `https://iconsip.com`; 일반 server config, 필수 | 환경별 일반 server origin을 둘 수 있음; Korpay를 단독 활성화하지 않음 |
| `KORPAY_MID` | sensitive, 필수 | 없어야 함 |
| `KORPAY_KEY` | sensitive, 필수; MKEY 서버 전용 | 없어야 함 |
| `KORPAY_ORDER_CHECKOUT_ENABLED` | 기본 `false`; 공개 굿즈 판매 승인 뒤에만 `true` | unset 또는 `false` |
| `KORPAY_TICKET_CHECKOUT_ENABLED` | 기본 `false`; 공개 티켓 판매 승인 뒤에만 `true` | unset 또는 `false` |
| `KORPAY_ORDER_CANARY_USER_ID` | 선택적 단일 인증 사용자 UUID; 기본 미설정 | 없어야 함 |
| `KORPAY_TICKET_CANARY_USER_ID` | 선택적 단일 인증 사용자 UUID; 기본 미설정 | 없어야 함 |

`SITE_URL`은 secret이 아닌 일반 server config다. Production에서는 정확히
`https://iconsip.com`으로 등록해 Korpay callback origin을 고정한다. Preview/CI에 `SITE_URL`
자체가 있어도 괜찮지만 Korpay 실자격 증명과 canary user ID는 없어야 하고 public gate는
닫혀 있어야 한다.

자격 증명과 canary user ID는 Vercel Production에 직접 sensitive 값으로 등록한다. GitHub
Secret, 저장소 파일, Preview, CI로 복제하지 않는다. 현재 optional canary user ID가 등록됐다고
가정하지 않는다. CLI를 쓸 때는 값을 명령 인자나 shell history에 넣지 말고 interactive hidden
stdin으로 입력한다.

Vercel 환경변수의 추가·수정·삭제는 이미 생성된 deployment의 runtime을 바꾸지 않는다.
`SITE_URL`, credential, public gate, canary user ID를 바꿀 때마다 그 변경 뒤에 **GitHub Actions의 Production
배포 경로로 새 deployment**를 만들어야 한다. 새 deployment가 Ready인 것만으로 끝내지 않고,
배포한 exact Git SHA와 canonical production alias가 그 deployment를 가리키는지 확인한 뒤 안전한
boolean runtime readback까지 일치해야 변경이 적용된 것으로 본다.

설정만 바뀐 Production 재배포는 `workflow_dispatch`의 `production_redeploy=true`와
`production_source_run_id`를 함께 사용한다. source run은 **현재 main의 exact SHA**에서 실행된
성공한 `push` CI/CD Pipeline이어야 하고, 그 run의 `deploy-supabase`와 `deploy-vercel`이 모두
성공해야 한다. workflow가 이 조건을 GitHub Actions API로 검증하지 못하면 앱만 재배포하지
않고 중단한다. 이 경계는 DB migration 적용에 실패한 SHA 위에 새 앱만 배포하는 것을 막는다.

Provider credential readiness와 목적별 rollout gate는 독립이다. public gate가 `false`여도 해당
목적의 canary UUID가 정확히 일치하면 그 인증 사용자만 새 provider session을 만들 수 있다.
gate와 canary allowlist를 모두 내려도 이미 DB에 durable하게 준비된 known order+nonce callback은
계속 claim·confirm·finalize한다. 알 수 없는 order·nonce는 provider 호출 전에 거부한다.

## Dark deploy

1. Production의 일반 server config `SITE_URL`을 정확히 `https://iconsip.com`으로 등록하거나
   exact-value metadata로 readback한다.
2. Production에 `KORPAY_MID`·`KORPAY_KEY`를 sensitive 값으로 등록한다. 출력에는 값이나
   fingerprint가 아니라 변수명, 대상 환경, 존재 여부만 남긴다.
3. 두 public gate를 `false`로 등록한다. canary actor는 아직 등록하지 않는다.
4. Preview/CI에 `SITE_URL` 같은 일반 server config가 있더라도 Korpay credential과 canary actor가
   없고 gate가 열리지 않는지 확인한다.
5. PR 검증 뒤 승인된 exact main SHA를 GitHub Actions Production 경로로 새로 배포한다. build
   log에 secret, hash 입력, paymentKey 또는 provider 원문이 없는지 확인한다.
6. 새 deployment가 Ready이고 canonical production alias가 같은 deployment와 exact SHA를
   가리키는지 확인한다.
7. 새 deployment에서 `SITE_URL=https://iconsip.com`, provider readiness는 true, 목적별 public
   readiness와 canary configured는 모두 false인지 안전한 metadata로 readback한다. 식별자 없는
   malformed callback POST가 readiness `503`이 아니라 parser `400`에서 끝나는지도 확인한다.
   이 probe는 provider·DB를 호출하지 않으며, SITE_URL·gate 값은 build log와 Vercel metadata로
   별도 확인한다. 아직 결제 session을 만들지 않는다.

## Controlled canary

실결제 canary도 현재 약관·개인정보처리방침이 표시하는 결제수단·수탁자와 일치해야
한다. Korpay 결제수단·수탁자 개정의 시행일, 사전 공지, 기존 회원 동의 처리가
승인·반영·배포되기 전에는 canary user ID를 등록하거나 실과금을 시작하지 않는다.

현재 공개 계약만으로는 구매자가 자기 order+nonce에 임의 paymentKey를 먼저 보내 callback
claim을 선점하는 것을 암호학적으로 차단할 수 없다. 승인된 기본 경계에서는 canary를 신뢰하는
단일 actor로만 수행하고, provider가 서명 검증 또는 자동 상태 조회 계약을 제공하거나 definitive
invalid-key claim 재개방과 ambiguous hold 해제 SLA가 별도 승인되기 전에는 목적별 public gate를
`true`로 열지 않는다. 2026-08-18 사용자 지시로 굿즈 gate가 이 경계보다 먼저 열렸으므로,
보호 계약이 추가될 때까지 현재 admin 취소 담당자의 즉시 대응 가능 여부와 rollback 준비 상태를
계속 확인하고 모호 승인·취소 불능 징후가 있으면 새 결제를 즉시 닫는다. 티켓 gate는 `false`로
유지한다.

굿즈는 provider confirm 뒤 DB finalizer 전에 프로세스가 종료될 때 stale `confirming`을 자동
재확인할 공식 provider API가 없다. 현재 admin-only 수동 seam은 공급사 원장에서 **전액 취소가
완료된 사실**을 운영자가 먼저 확인한 경우에만 `provider_cancel_confirmed`를 반영한다. DB는
단일 claim 아래 주문·취소 요청·attempt의 사용자, 금액, KRW, snapshot과 payment provenance를
재검증한다. 이미 `approved`인 attempt는 exact linked payment만 환불 종결한다. `confirming`,
`unknown`, `needs_review`는 payment/refund를 합성하지 않은 채 attempt·주문·재고를 한 번만
취소 종결한다. 이 seam은 모호한 승인을 재구성하거나 문서화되지 않은 Korpay API를 호출하지
않는다.

따라서 [#208](https://github.com/icons-hq/icons-ip/issues/208)의 전체 범위가 끝나지 않았더라도
이 단일 관리자 canary의 취소 반영 경계는 준비되어 있다. 다만 실과금 전에 실제 가맹점 관리
화면 또는 공급사가 지정한 접수 채널, 전액 취소 완료 상태와 보관할 증거, 현재 운영 소유자의
즉시 대응 가능 여부를 직접 확인해야 한다. 이를 확인하지 못하면 굿즈 canary를 시작하지 않는다.
공개 판매와 다른 직원에게의 인계, 직접 환급·모호 승인 처리 확장은 계속 #208 잔여 범위다.

실제 과금 직전에 아래 값을 사용자에게 다시 보여 주고 명시 확인을 받는다. 과거의 구현 승인이나
자격 증명 등록 승인을 과금 승인으로 재사용하지 않는다.

- 목적: 굿즈 주문 또는 티켓 예매 중 정확히 하나
- 대상: 실제 판매·예매 entity와 내부 opaque reference
- 사용자: canary를 수행할 인증 계정 하나
- 금액: 실제 청구액과 Korpay 최소 결제금액 조건을 충족하는 정확한 KRW 값
- 결제수단: 사용할 카드와 명세 표기 확인
- 취소 계획: #208 담당자, 공급사 수동 접수 채널, 접수 시점, 완료 확인 근거

확인을 받은 뒤 해당 목적의 `KORPAY_*_CANARY_USER_ID`만 Production에 등록하고 public gate는
`false`로 유지한다. 이어 승인된 exact main SHA와 그 SHA의 성공한 Production source run ID를
GitHub Actions Production 재배포 입력으로 전달하고,
canonical alias와 runtime boolean readback에서 해당 목적의 canary만 true인지 확인한다. 환경변수
등록만 하고 기존 deployment에서 canary를 시작하지 않는다. 이 확인 뒤 canary를 한 번만 수행한다.
다음 항목을 원문 식별자 없이 확인한다.

- prepare 1회, known callback claim 1회, provider confirm 1회
- callback 응답이 provider 값을 포함하지 않는 303인지
- `approved` payment와 주문/예매 상태가 하나의 finalizer transaction으로 일치하는지
- 티켓이면 승인 전 QR이 없고 승인 뒤에만 발급됐는지
- 중복 callback이 추가 결제·재고·티켓을 만들지 않는지
- 사용자 주문/티켓 화면과 운영 원장의 금액·상태가 일치하는지

## 모호 결제와 취소

- 인증 취소·명시적 실패는 `canceled | declined`로 종결한다.
- confirm timeout, 네트워크 오류, malformed 응답, 주문·금액·MID 불일치는 자동 재시도하거나
  승인으로 추측하지 않고 `unknown | needs_review`로 보존한다. 재고·정원·fulfillment를 자동
  해제하지 않는다.
- Korpay status/reconcile/cancel endpoint를 임의로 만들지 않는다. 운영자는 공급사 관리 화면과
  [#208](https://github.com/icons-hq/icons-ip/issues/208)의 수동 CS·재무 절차로 확인한다.
- 아직 승인 claim을 얻지 않은 `prepared` 굿즈 attempt는 결제·환불 원장이 없는 no-capture
  상태다. fresh 또는 만료 시각이 없는 attempt는 주문·재고를 그대로 유지하고, 관리자 화면의
  `Korpay 만료·취소 처리`로 exact attempt TTL을 다시 확인한다. TTL이 지난 `prepared`만
  service-role RPC가 attempt·취소 요청·주문·재고를 한 transaction에서 종결하며, 이 경로에는
  공급사 취소 접수나 전액취소 attestation을 만들지 않는다. callback이 먼저 `confirming` 이상을
  선점했으면 이 예외를 적용하지 않고 아래 수동 원장 확인 절차로 넘긴다.
- 취소는 공급사 수동 접수 증거와 최종 상태를 확인한 뒤에만 내부 refund/finalizer를 완료한다.
  카드 승인 취소가 확인되지 않았는데 재고·정원만 복원하지 않는다.
- 관리자 화면의 opaque Korpay 주문번호와 KRW 금액을 공급사 원장과 대조하고, 전액 취소 완료
  attestation과 브라우저 재확인을 모두 통과한 경우에만 수동 반영한다. private audit에는 자동
  audit ID·기록 시각, DB에서 검증한 admin actor UUID, 내부 order·request·attempt 식별자,
  operation, opaque case, prior state, outcome을 남기고 public audit에도 같은 내부 linkage와 actor를
  기록한다. paymentKey, TID, PAN, 승인번호, provider raw는 입력·화면·audit에 복사하지 않는다.

## Rollback과 callback drain

문제가 생기면 다음 순서를 고정한다.

1. 해당 목적의 public gate를 `false`로 바꾸고 canary user ID를 제거한다. 이 시점에는 기존
   deployment 동작이 아직 바뀌지 않았다고 간주한다.
2. config-only rollback이면 현재 승인된 main SHA와 그 SHA의 성공한 Production source run ID,
   코드 결함이면 검토된 revert가 반영된 exact main SHA의 성공 run ID를 GitHub Actions Production
   경로에 전달해 새로 배포한다.
3. 새 deployment가 Ready인지, canonical production alias가 그 deployment와 exact SHA를
   가리키는지 확인한다.
4. 새 deployment의 안전한 boolean readback에서 해당 public gate와 canary configured가 모두
   false인지 확인한다. 이때부터 새 reserve·prepare·provider session이 차단된 것으로 본다.

자격 증명은 즉시 삭제하지 않는다. 이미 준비된 known callback이 만료·종결될 때까지 provider
readiness를 유지해 claim·confirm·finalize를 drain한다.

drain 동안 다음 집계만 확인한다.

- `prepared | confirming | unknown | needs_review` attempt 수
- known callback claim과 finalizer 성공/중복 수
- 승인 결제·주문·예매·환불 상태별 count
- #208 수동 확인 대상 count와 담당자

모든 in-flight attempt가 terminal 또는 명시적 `needs_review` 운영 소유 상태가 된 뒤에만
credential 교체·삭제를 별도 승인 범위로 검토한다. credential을 교체·삭제한 경우에도 같은
Actions 새 Production deployment → exact SHA/canonical alias → boolean readback 순서를 반복한다.

## 남길 증거

- 배포 exact SHA, PR, Actions, Vercel deployment URL과 canonical production alias 대상
- canonical `SITE_URL`의 공개 exact 값과 환경별 변수 **이름·존재 여부·sensitive 여부·public gate boolean**만 담은 readback
- canary 직전 사용자 확인 시각과 승인된 목적·대상·사용자·금액·취소 계획
- 원문 provider 식별자 없는 DB 상태 transition과 멱등 count
- 공급사 수동 취소 접수·완료 여부와 #208 운영 근거

계약·credential 사실은 [#87](https://github.com/icons-hq/icons-ip/issues/87), 구현·canary는
[#207](https://github.com/icons-hq/icons-ip/issues/207), 수동 취소·모호 결제는 #208에 기록한다.
실제 MID, MKEY, paymentKey, TID, 승인번호, provider raw는 어느 이슈에도 복사하지 않는다.

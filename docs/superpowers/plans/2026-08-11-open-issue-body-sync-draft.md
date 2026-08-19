# 열린 GitHub 이슈 본문 동기화 초안

> **삭제원장 backend 정정:** 아래 GCP append service 서술은 2026-08-12 검토 시점 기록이다. 현행 방향은 운영 Supabase와 backup 계보가 분리된 **별도 Supabase compliance 프로젝트**다([`account-deletion-retention-policy.md`](../../account-deletion-retention-policy.md) · [#215](https://github.com/icons-hq/icons-ip/issues/215)).

> 상태: 내부 결정 반영본 · GitHub 미적용 · 작성 2026-08-11 · 결정 2026-08-12
>
> 범위: 현재 코드·정책 문서와 크게 어긋난 #66, #87, #102, #110, #115, #137, #168, #188, #191의 교체용 본문. 제품·기술·내부 위험결정은 완료했지만, 외부 쓰기 승인 전에는 게시하거나 label·Project 상태를 바꾸지 않는다. #134의 공개 계약도 승인됐으며 구현 결과를 반영해 본문을 생성한다.
>
> 2026-08-11 live 재검증에서 #134의 현재 결정 본문과 #177·#179·#190의 human 입력 본문은 현행 코드·운영 순서와 맞아 교체 대상에서 제외했다. #134는 결정 후 완료 기준만 확장하고, #177·#179·#190은 실제 답·운영 증거를 기존 본문에 기록한다.
>
> 각 이슈를 실제로 닫기 전에 요구할 증거는 [`open-issue-closure-evidence.md`](./2026-08-11-open-issue-closure-evidence.md)에 고정한다.
>
> #134·#137·#188·#191의 승인 후 수직 TDD 순서는 [`open-issue-implementation-candidate-plan.md`](./2026-08-11-open-issue-implementation-candidate-plan.md)에 고정한다.
>
> **Close 금지:** 2026-08-11 live #137·#168·#188·#191 본문은 아래 기준보다 약하다. 승인된 문서가 default branch에 merge되고 각 교체 본문을 GitHub에 적용·read-back하기 전에는 기존 체크박스만으로 해당 이슈를 닫지 않는다.

## 열린 13개 처리 map

| 이슈 | 현재 성격 | 다음 닫힘 조건 | 문서 merge 뒤 권장 label |
|---|---|---|---|
| #66 | current scope에서 제거 | ADR-0008·canonical docs merge 뒤 `not planned` close | `wontfix`; `ready-for-human` 제거 |
| #87 | 사업자·PG·법무·Production 운영 | 사업자 6종, 연락처, Toss live 계약·4-key·실결제 canary | `ready-for-human` 유지 |
| #102 | 탈퇴·보존 내부 위험정책 | 결정문·정책 merge와 #137 handoff | 결정 완료; merge 뒤 close 가능 |
| #110 | 커뮤니티 내부 위험·운영 정책 | 정책 merge, 미시행 gate와 후속 구현 분해 | 결정 완료; merge·후속 이슈 분해 뒤 close 가능 |
| #115 | current scope에서 제거 | ADR-0008·canonical docs merge 뒤 `not planned` close | `wontfix` |
| #134 | Auth rollout | recovery 전용 callback·legacy fail-closed·설정 sync의 local TDD 구현 완료. Preview/Production 설정 read-back·controlled 실메일 smoke·TTL 유예 뒤 legacy 제거 | local 구현 완료 · 원격 rollout 증거 대기 |
| #137 | 탈퇴 구현 | 완료된 #102·#110 내부 승인과 #188 제품·위험 계약으로 1단계를 시작하고, #87 실제 연락처·#191 처리자/외부 인프라 계약을 충족해 2단계와 종료를 연다 | `ready-for-human` 권장 |
| #168 | 첫 실판매 운영 epic | #87·#177·#190·#179·#191과 controlled 주문 canary. 완료해도 public sale은 전체 Launch Blocker 별도 승인 | `ready-for-human` 권장 |
| #177 | 물류 human 입력 | WMS·한진·출고·반품·도서산간·위탁사 H1~H7 | `ready-for-human` 유지 |
| #179 | 재고 human 입력 | WMS 격리 수량·운영 계약과 g13~g15 `stock_qty` 입력 | `ready-for-human` 유지 |
| #188 | 승인된 14+ 계약 구현 | #137/#191 연동 TDD 구현·기존 계정 audit·법정 문서 시행 | local 구현은 `ready-for-agent` |
| #190 | 상품 운영 데이터 | 고시정보 7항목·설명·갤러리·상세 이미지 Production 입력 | `ready-for-human` 유지 |
| #191 | 이메일 처리자·Production 구현 | DPA·TTL·Hook·outbound ledger·event·redaction·DNS·수신 canary | `ready-for-human` 유지 |

label 변경은 이 문서 merge와 명시적 GitHub 쓰기 승인 뒤에만 수행한다.

## 비순환 실행 순서

본문의 상호 참조를 전부 선행 완료 blocker로 해석하지 않는다. 다음 tracer 순서로 작업한다.

1. #102·#110 공동 정책, #188 제품·위험 계약과 restore-resilient 요구/interface·2026-08-12 내부 검토는 내부 승인됐다. 다음 외부 사실 gate는 #87의 실제 공개 연락처·서면교부 판단, #191 처리자 계약, 2026-08-12 내부 검토 GCP 인프라 issue·drill이다. #102와 #110은 같은 보존표를 공동 사용하는 묶음이며 서로를 순차적으로 기다리지 않는다.
2. #137 1단계에서 self-only request, private 원장, withdrawal/underage fence와 외부 ledger adapter seam을 구현하되 탈퇴 `completed` 전이는 열지 않는다. 실제 외부 backend 구현·Production-like drill은 별도 인프라 issue에서 병행한다.
3. #191이 그 fence를 소비하는 unified outbound dispatcher, Send Email Hook, provider event·외부 purge 계약과 로그 redaction을 구현한다. #137 전체 완료를 기다리지 않지만 승인된 외부 durable ack backend가 실제 연결되기 전에는 Production 발송을 활성화하거나 #191을 닫지 않는다.
4. 외부 backend drill 뒤 #137 2단계가 provider fence drain·Auth hard delete·외부 cutoff·restore replay를 연결하고 완료 전이를 연다.
5. #188은 승인된 classifier·보호 action matrix를 병행할 수 있지만, 신규 거절 end-to-end 완료는 #137 worker와 #191 발송 fence가 연결된 뒤에만 인정한다.
6. 정책·구현·운영 증거가 모두 닫힌 이슈만 close한다. `ready-for-agent`는 해당 단계의 사람 결정과 기술 선행 seam이 준비됐다는 뜻이지 모든 연관 이슈가 이미 닫혔다는 뜻이 아니다.

## #66 Expo WebView 앱 셸·보안 bridge — `not planned` 종료안

```markdown
## 결정

2026-08-12 현재 ICONS는 web-only v1로 운영하며 Expo 네이티브 앱·WebView 미니앱 셸을 current product scope와 active backlog에서 제거한다. 앱 repo·스토어·보안·운영 owner와 native-only 가치가 없어 구현 가능한 약속이 아니기 때문이다.

기존 본문의 RN Supabase session 주입안은 refresh token·범용 bearer 노출 위험 때문에 거부한다. 현행 웹 게임의 서버 결과 권위·웹 renderer 경계는 유지한다.

재검토는 ADR-0008의 조건(MAU 5,000 이상 3개월, native-only use case 2개, 지정 owner·예산)을 모두 충족할 때 새 RFC·새 이슈로 시작한다. 그때도 refresh token·범용 session의 WebView 주입은 금지하고 capability/resource-bound single-use BFF 경계를 새 위협모델에서 승인한다.

## 종료

- reason: `not planned`
- label: `wontfix`
- 근거: `docs/adr/0008-remove-unvalidated-popup-native-roadmap.md`
```

### 폐기된 구현형 본문 — 게시 금지

```markdown
## Background

ADR-0002의 “하나의 웹 게임 번들, 두 호스트”를 Expo 앱에서 구현하는 V2 이슈다. 웹 게임 PoC #63은 완료됐지만 native 앱 셸의 저장소·SDK·플랫폼·배포 책임자가 정해지지 않았다.

기존 본문의 “`postMessage`로 RN Supabase 세션 주입”은 refresh token 또는 범용 bearer session을 WebView JavaScript에 노출할 수 있어 현행 보안 계약으로 사용하지 않는다. 앱은 첫파티 origin만 로드하고, 최소 권한 bridge와 native secure storage를 사용해야 한다.

## 제품 결정 필요

1. #66을 지금 구현할지 V2 backlog로 유지할지 확정한다.
2. 구현 시 Expo 앱 셸의 repo·package 위치, Expo SDK·React Native 버전, iOS/Android 범위, bundle ID/application ID와 서명·스토어 담당자를 지정한다.
3. 환경별 허용 first-party origin과 Preview/local 분리 방법을 확정한다.
4. Apple App Store 4.7, 연령 장치, 원격 미니게임 변경 절차와 첫 심사 담당자를 지정한다.

## 보안 불변식

- Supabase refresh token은 WebView·웹 게임 JavaScript에 주입하지 않는다.
- 권장안은 native에서 검증한 인증 subject·원본 session identifier, origin·audience와 정확한 capability allowlist에 묶인 single-use·짧은 TTL bridge token을 first-party BFF가 소비해 허용된 RPC만 대행하고 WebView에 Supabase session을 반환하지 않는 것이다.
- BFF가 불가능하고 직접 Supabase 호출이 불가피한 경우에만 짧은 access JWT를 예외 승인한다. refresh token은 예외가 아니다.
- BFF는 WebView가 보낸 `userId`를 권한 근거로 받지 않고, 범용 service-role proxy를 노출하지 않는다. 검증된 bridge token의 subject와 capability에서만 대상·허용 동작을 파생한다.
- RN 원본 session은 iOS Keychain·Android Keystore/SecureStore에 보관하고 OS backup·debug log·screenshot에서 제외한다.
- origin-bound nonce handshake, message source·schema·sequence·protocol version 검증, replay 방지와 token rotation을 적용한다.
- logout·정지·탈퇴 시 native session과 WebView cookie/localStorage/sessionStorage/cache를 모두 zeroize한다.
- 허용 method는 versioned allowlist로 고정한다: `getSession`의 BFF 대체, `playGame`, `getRaffleResult`, `startPrizeCheckout`, `haptics`, `share`, `close`, `track`.
- `track` event 이름도 allowlist하고 PII·credential·자유서술 payload를 금지한다.
- 허용하지 않은 origin, navigation, download, 새 창, 외부 링크와 unknown method는 fail closed한다.
- 현재 `lib/games/host.ts`의 `accessToken` 반환 interface는 브라우저 PoC의 기존 표면이며 Expo bridge 계약으로 재사용하지 않는다. #66 구현에서 승인된 BFF/예외 계약으로 교체한다.

## 완료 기준

- [ ] 위 제품·플랫폼·스토어 결정이 기록됐다.
- [ ] 앱 셸은 승인된 first-party origin만 로드하고 protocol handshake 전 method를 실행하지 않는다.
- [ ] WebView에 refresh token·범용 Supabase session이 전달되지 않는다.
- [ ] BFF 또는 승인된 access-JWT 예외의 TTL·audience·origin·rotation·replay 계약을 테스트했다.
- [ ] bridge token의 native subject·session·capability binding과 cross-user/session token swap 거부, client `userId` 무시, generic service-role proxy 부재를 테스트했다.
- [ ] native secure storage와 logout·정지·탈퇴 양쪽 zeroization을 iOS/Android에서 검증했다.
- [ ] 전체 method request/result schema, unknown method·악성 origin·navigation 거부와 PII 없는 `track`을 테스트했다.
- [ ] Apple App Store 4.7 검토와 첫파티 미니게임·연령 장치·원격 변경 운영 절차를 승인했다.
- [ ] ADR-0002와 게임 miniapp spec이 실제 bridge 계약과 일치한다.

## 상태와 의존성

- #63 웹 게임 PoC는 완료됐다.
- 현재 blocker는 기술 선행 이슈가 아니라 V2 범위 유지 여부와 native 제품·보안·스토어 결정이다.
- V2 유지 시 close로 가장하지 않고 backlog로 열어 두며 재검토 trigger·분기를 기록한다.

## 근거 문서

- `docs/questionnaires/to-questionnaire-open-issue-decisions.md` #66
- `docs/adr/0002-cross-platform-popup-game-miniapps.md`
- `docs/online-popup/05-game-miniapp-spec.md`
- `docs/PRD.md`
```

## #87 실제 판매를 위한 사업자·토스 라이브 설정

```markdown
## Background

ICONS의 굿즈·티켓 결제 인프라는 토스페이먼츠 테스트 키로 구현·검증되어 있다. 실제 판매를 시작하려면 직접 통신판매자로서 사업자 정보, 토스 라이브 상점 계약, 라이브 키와 웹훅 설정을 확정해야 한다.

디지털 카드는 별도 가격·충전·현금화가 없는 무상 카드팩 및 참여형 게임 리워드다. 유료 가챠 모델을 전제로 심사하거나 카드팩·확률 표현 자체를 제거해서는 안 된다. 표시의무가 확인되면 실제 `pool_odds`를 카드풀·발급 조건과 함께 공개한다.

## 현재 상태

- 2026-08-11 Production 빌드 로그 실측 기준 토스 결제는 테스트 모드다.
- Preview와 Production 결제 키 환경은 #199에서 분리됐다.
- `BUSINESS_INFO`는 호스팅 제공자를 제외한 상호·대표자·사업자등록번호·통신판매업신고번호·주소·연락처가 비어 있다.
- A/S 연락처가 없어 #190의 굿즈 고시정보와 후속 재고 공개가 막혀 있다.
- 결제 확정의 진실원은 `/api/webhooks/tosspayments`다.
- 토스 결제 웹훅에는 검증용 서명이 없다. 지급대행 웹훅의 서명 헤더를 이 경로에 적용하지 않는다.
- 웹훅 payload는 신뢰하지 않고 `paymentKey`로 토스 결제 조회 API를 fresh GET해 금액·목적·상태를 검증한 뒤에만 멱등 RPC로 주문·티켓을 확정한다.
- Live Toss 전환 전 runtime log와 모든 Log Drain에서 주문 UUID, `paymentKey`, provider raw/body를 제거해야 한다.

## 결정 필요

1. 다음 사업자 정보 6종의 실제 공개값을 확정한다.
   - 상호
   - 대표자
   - 사업자등록번호
   - 통신판매업신고번호
   - 사업장 주소
   - 대표 연락처
2. 굿즈 A/S 연락처를 대표 연락처와 같이 쓸지 별도 고객센터로 둘지 결정한다.
3. 계정 없이 사용할 거래기록 열람·개인정보 권리행사 연락처를 확정한다.
4. “인앱 주문 상세 제공이 전자상거래법상 계약내용 서면 교부로 충분한가”에 대한 법률 판단을 기록한다. 이 답은 이메일의 법정 역할·보존 증빙 범위를 정하지만, 첫 실판매에 주문 확인·배송 시작 이메일을 도입한다는 제품 결정 D8을 취소하지 않는다.
5. 토스 상점 계약에서 BM을 “실물 굿즈·티켓 직접 판매, 디지털 카드·카드팩은 별도 대금·충전·현금화가 없는 무상 리워드”로 정확히 심사받는다.
6. 라이브 키 전환 승인자, 작업 시간과 controlled 실결제 검증 담당자를 지정한다.

키·시크릿·실제 결제 식별자는 이슈에 기록하지 않는다.

## 완료 기준

- [ ] 사업자등록·통신판매업 신고와 토스 라이브 상점 계약이 확인됐다.
- [ ] 사업자 정보 6종과 A/S·권리행사 연락처가 법정 문서·푸터·상품 고시정보에 연결됐다.
- [ ] 토스 개발자센터에 `/api/webhooks/tosspayments`와 `PAYMENT_STATUS_CHANGED` 이벤트가 등록됐다.
- [ ] 웹훅은 서명이 아니라 `TOSS_SECRET_KEY`를 사용한 fresh GET 조회 결과로 결제를 검증한다.
- [ ] Production 한 배포에서 다음 네 항목을 함께 전환했다.
  - `NEXT_PUBLIC_TOSS_CLIENT_KEY`·`TOSS_SECRET_KEY`를 같은 `live_gck_…`/`live_gsk_…` 쌍으로 교체
  - Production의 `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY` 삭제
  - `ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION` 삭제
  - 라이브 키 쌍 기준 `TOSS_PAYMENT_KEY_PAIR_SHA256` 재계산·교체
- [ ] Production 배포 로그가 `Toss widget live mode`를 확인했다.
- [ ] runtime log와 모든 Log Drain의 TTL·접근자를 확인하고 원문 주문 ID·`paymentKey`·provider body redaction 테스트를 통과했다.
- [ ] 승인된 controlled 실결제에서 success callback이 아닌 검증된 웹훅으로 주문 또는 티켓이 정확히 1회 확정됐다.
- [ ] 상품·약관·PG 설명은 유료 가챠·충전·현금화가 없다는 사실과 무상 카드팩 구조를 정확히 설명하고, 필요한 확률 고지를 금지하지 않는다.

## 의존성

- #199 Preview/Production 결제 키 분리는 완료됐다.
- #191은 제품 결정 D8에 따라 첫 실판매의 선행조건이다. 위 서면 교부 법률 판단은 이메일의 법정 역할과 증빙 보존 범위를 정한다.
- 이 이슈는 #170 사업자 정보 표기, #190 굿즈 고시정보, #179 재고 공개와 #137 탈퇴 후 권리행사 연락처의 선행 조건이다.
- 카드 리워드·게임 공개는 별도의 게임물 해당성·간접 유상성·확률 표시의무 법률 승인에 따른다.

## 근거 문서

- `docs/ARCHITECTURE.md` §9 결제 통합
- `docs/first-sale-readiness.md` §5.2, §8.1, §8.3
- `docs/launch-readiness-plan.md`
- `CONTEXT.md`
- `docs/adr/0003-free-reward-pivot.md`
- `docs/adr/0004-draw-ticket-card-packs.md`
```

## #102 회원 탈퇴·보존 정책 확정

```markdown
## Background

회원 탈퇴는 단순한 Auth 사용자 삭제가 아니다. 주문·결제·티켓·취소 요청의 FK, Supabase Storage, 커뮤니티 작성물, 법정 거래기록, 이메일 처리자 사본과 runtime log를 함께 처리해야 한다.

이 이슈는 구현이 아니라 탈퇴·보존·권리행사의 법률·운영 정책을 확정한다. 실제 삭제 상태 머신과 UI는 #137에서 구현한다.

NAVER·스마트스토어의 문구나 중개자 책임을 복제하지 않고, 상위 약관→개인정보처리방침→계정·게시물 운영정책→거래·배송 정책→권리보호 절차의 문서 계층과 처리 절차를 ICONS의 직접 판매자 역할에 맞춰 참고한다.

## 현재 상태

- `docs/account-deletion-retention-policy.md`와 공식 근거·내부 위험결정 확인서는 2026-08-12 승인됐다. 삭제 worker·외부 원장·권리 경로가 없어 미시행이다.
- 현재 `/settings`에는 탈퇴 UI·RPC·보존 원장·만료 파기 작업이 없다.
- `auth.admin.deleteUser()`만 호출하면 주문·티켓·취소 요청 FK와 Storage 객체 때문에 실패하거나 개인정보가 외부 처리자·로그에 남을 수 있다.
- 거래·신고·권리침해 사건의 보수적 내부 보존 상한과 접근 원칙은 승인됐다. 이는 법정 기간 단정이 아니며 실제 private 원장·접근 역할·expiry job은 미구현이다.
- 현재 `email_deliveries`는 시도별 불변 증거나 실제 교부 증거가 아니며, Resend·Auth SMTP·Vercel 로그의 실제 삭제·만료 계약도 승인되지 않았다.
- 현재 공개 약관·개인정보처리방침은 승인된 내부 삭제·잔여기간 계약을 시행 중인 정책으로 표시하지 않는다.

## 승인 결과와 남은 시행 입력

1. **승인:** ICONS의 직접 통신판매자 역할과 상위 약관→개인정보처리방침→계정·게시물 운영정책→거래·배송 정책→권리보호 절차의 문서 계층을 적용한다.
2. **승인:** 계약·청약철회, 결제·환급·공급, 티켓, 분쟁, 표시·광고 기록의 최소 필드·기산점·기간·`retain_until`을 내부 보존표로 확정했다.
3. **승인:** `payment_key`, 배송지와 이메일 원문 전체를 법정 기록으로 복제하지 않고 승인된 최소 증거만 분리보존한다.
4. **승인:** 법정 보존분은 별도 `private` 원장에 두고 목적별 조회·복호화·반출·자동 파기와 독립 2인 legal hold 승인·해제를 적용한다.
5. **승인:** 탈퇴자의 포스트·댓글을 관계별로 삭제·tombstone·작성자 연결 해제하고 직접 식별정보 사후 삭제 경로를 제공한다.
6. **승인:** 진행 중 주문·환불·티켓만 구체적 해소 경로와 함께 fail closed로 탈퇴를 보류한다.
7. **승인:** 모든 bucket의 사용자 Storage 객체를 삭제하고 staff/admin 회사 자산은 인수인계한다.
8. **시행 전 외부 입력:** Resend·Auth SMTP·Vercel·Log Drain의 실제 DPA, 국외이전, 데이터별 TTL, 회원별 삭제/자동 만료와 외부 locator는 #191에서 확인한다.
9. **승인·시행 입력:** 거래시점 연락처 keyed-HMAC, magic link/전화 OTP와 수동 최소정보 심사 기준을 승인했다. 실제 공개 채널·연락처는 #87 입력이 필요하다.
10. **승인:** 일반 신고·명예·사생활·저작권·불법촬영물등 사건의 보존 근거·필드·기간·역할을 #110과 공동 확정했다.
11. **승인:** 구체적 사건·법적 근거 없이 부정 이용 의심만으로 임의 장기보존하지 않는다.
12. **시행 전 작업:** 공개 정책·약관의 사전 고지, 시행일과 동의 재취득은 #137/#188 rollout에서 실제 문서와 함께 반영한다.

## 내부 정책 결정 완료 근거와 시행 blocker

- [x] `docs/questionnaires/policy-legal-review.md`와 공식 근거 research에 내부 위험결정·근거·수정 문구가 기록됐다. 독립 법률의견이라고 표시하지 않는다.
- [x] 거래·신고 사건별 필드, 내부 근거, 기산점, 기간, `retain_until`, 접근 역할과 파기 방법을 보수적 내부 상한으로 확정했다.
- [x] 커뮤니티 작성물·Storage·진행 중 거래·legal hold·탈퇴 후 열람의 내부 계약을 승인했다.
- [ ] #191 처리자·로그의 실제 계약값과 #87 공개 연락처를 확인한다. 이는 #102 내부 정책 결정 완료와 분리된 시행 blocker다.
- [x] 승인 결과를 `docs/account-deletion-retention-policy.md`와 #137 handoff에 반영했다. 개인정보처리방침·이용약관·runbook의 실제 시행일 반영은 구현 rollout 범위다.
- [x] 현재 구현되지 않았거나 외부 사실이 확인되지 않은 내용을 시행 중이라고 표시하지 않는다.
- [x] #137 본문을 승인된 정책과 최신 완료 기준으로 동기화했다.
- [x] #102는 정책 승인 이슈로 완료하고, #137의 구현 착수·완료와 혼동하지 않는다.

## 공동·선행 승인

- #110: 커뮤니티·권리침해 사건 처리와 증거 보존을 같은 법무 묶음에서 공동 확정하며 순차 blocker로 취급하지 않는다.
- #191: 외부 이메일 처리자와 Send Email Hook·outbound 원장 **계약 승인**. 구현 완료는 #102의 선행 조건이 아니다.
- #188: 만 14세 미만 가입 거절·기존 계정 처리 **제품·법률 계약**. 구현 완료는 #102의 선행 조건이 아니다.
- #87: 탈퇴 후 거래기록 열람·권리행사에 사용할 실제 공개 연락처

## 후속 구현

- #137은 승인된 정책을 구현하는 후속 이슈다. #102의 dependency가 아니며, #102 승인 결과와 동기화된 본문을 입력으로 사용한다.

## 근거 문서

- `docs/account-deletion-retention-policy.md`
- `docs/questionnaires/policy-legal-review.md`
- `docs/community-moderation-policy.md`
- `docs/questionnaires/community-policy-operations-approval.md`
- `docs/transactional-email.md`
- `docs/ARCHITECTURE.md` §8
- `docs/launch-readiness-plan.md`
```

## #110 커뮤니티 운영·권리보호 정책

```markdown
## Background

ICONS 커뮤니티에는 일반 신고뿐 아니라 명예·사생활, 저작권, 불법촬영물등과 아동·청소년 성착취물에 대한 별도 절차가 필요하다.

정책 계층, 게시물 유지 원칙, 단계 제재, 신고·이의·복원 구조는 NAVER·스마트스토어의 공식 운영 체계를 참고하되, ICONS의 실제 기능·직접 판매자 역할과 대한민국 법령에 맞게 적용한다.

## 현재 상태

- `docs/community-moderation-policy.md`의 내부 위험·solo-operator 운영 결정은 2026-08-12 승인됐다. 실제 자연인 수령인·backup·도구가 없어 미시행이고 신규 community write는 fail closed한다.
- 현재 어드민은 일반 신고의 `open/reviewing/resolved/dismissed`, 포스트·댓글 비공개, 수동 계정 정지·해제와 감사 로그를 지원한다.
- 다음 기능은 아직 없다.
  - 신고 사유 필수 입력과 사건별 법정 상태
  - 비회원·권리자 공개 신고 창구
  - 보완·반려·당사자 통지·이의·복원 예정일 이력
  - 포스트·댓글 복원
  - 종료시각이 있는 계정 정지와 자동 해제
  - 사건 유형별 보존·파기
  - 금지 콘텐츠 원본용 격리 저장소와 기한부 접근 capability
- 법정 기한은 공식 법령 기준으로 계약에 반영했다. ICONS의 정확한 법적 유형은 회사 사실이 없어 단정하지 않고 저장형 OSP·부가통신사업자의 높은 의무를 운영 가정으로 적용한다.

## 승인 결과와 남은 시행 입력

1. **운영 가정 승인:** 실제 법인·기능 사실이 확인되기 전에는 저장형 OSP·부가통신사업자의 높은 의무를 보수적으로 적용하고 신규 write를 열지 않는다. 불법촬영물등 조치의무사업자·사전조치의무사업자 해당 여부는 공개 전 실제 사실과 법률 검토로 확정한다.
2. **운영 가정 승인:** 저작권법 제103조 중단·재개 절차를 보수적 계약으로 적용한다. 정확한 OSP 유형은 실제 사실 확인 전 단정하지 않는다.
3. **시행 전 human 입력:** 제103조 수령인 공개 의무가 적용될 때 다음 실제 값을 지정한다.
   - 수령인 성명·소속부서
   - 업무 전화·팩스·이메일
   - 우편 수령 주소
   - 부재·야간·휴일 대체 담당자
4. **시행 전 human 입력:** 실제 운영 책임자·대체 reviewer·이중 알림 수령인을 지정하고 일일 모니터링, 야간·휴일 상향과 달력일 기한 커버리지를 rehearsal한다.
5. **승인:** `/legal/community`, `/legal/rights-protection`, 인앱 신고와 비회원·권리자 접수 채널 계약을 확정했다. route와 연락처는 아직 구현되지 않았다.
6. **승인:** 일반 신고 1영업일 분류·3영업일 1차 결정, 이의 3영업일 내 재검토 시작 등 운영 목표를 적용한다.
7. **승인:** 안내·주의→콘텐츠 제한→일시 정지→계속 정지·계약 해지 단계, 긴급 예외와 자동 해제·복원 승인 역할을 확정했다.
8. **승인:** 조치·보완·기각·복원 통지 채널과 일반 제재 이의기간을 확정했다.
9. **승인:** 일반 증거와 금지 콘텐츠 원본을 분리하고 `restricted_evidence_reviewer`를 사건별·기한부로 부여하며 독립 2인 승인·조회 감사·다운로드 금지를 적용한다.
10. **승인:** 사건 유형별 보존 근거·필드·기산점·기간·접근·반출·파기 정책을 #102와 공동 확정했다.

## 내부 정책 결정 완료 근거와 공개 시행 blocker

미체크 항목은 공개 write 활성화 또는 후속 구현 blocker다. 후속 구현 이슈 분해만 #110 close 전에 완료하고, 실제 자연인·법적 유형·route rehearsal은 #110 내부 결정 close와 분리한다.

- [x] `docs/questionnaires/policy-legal-review.md`의 커뮤니티 내부 위험결정이 승인됐다.
- [x] `docs/questionnaires/community-policy-operations-approval.md`에 solo-operator interim 역할·목표시간·휴일 통제와 미확정 human input을 기록했다.
- [ ] 실제 자연인 수령인·대체 reviewer·이중 알림 연락처와 휴일 커버리지를 지정·검증한다.
- [x] 승인 결과를 반영해 `docs/community-moderation-policy.md`의 내부 법정 절차·목표시간·역할·보존표를 확정했다.
- [ ] 적용되는 경우 저작권 제103조 수령인 실제 값·공개 위치·변경·휴일 대체 절차가 승인됐다.
- [ ] 불법촬영물등 법 적용 범위와 기술적·관리적 의무, 일반 운영자가 원본을 복제·다운로드하지 않는 격리 원칙이 법무 승인됐다.
- [x] 사건 유형별 증거 보존·접근·파기 내부 정책을 #102에 반영했다. 개인정보처리방침 공개 개정은 시행 rollout에서 수행한다.
- [ ] 신고 사유 필수, 비회원·권리자 접수, 법정 사건 상태, 양쪽 통지, 이의, 복원, 자동 정지 해제, 격리 증거와 감사 요구를 후속 구현 이슈의 acceptance criteria로 분해했다.
- [ ] 공개 route·푸터 연결·운영 리허설이 끝나기 전에는 공개 정책 surface를 미시행으로 유지한다.

## 공동·선행 승인

- #102: 탈퇴 시 신고·권리침해 사건의 최소 보존·legal hold를 같은 법무 묶음에서 공동 확정하며 순차 blocker로 취급하지 않는다.
- #87: 공개 권리행사·권리침해 연락처
- #191: 결과 통지에 이메일을 선택할 때 필요한 Production 메일 계약 승인

## 후속 구현

- `/legal/community`, `/legal/rights-protection`, 신고·법정 사건·통지·이의·복원·자동 해제·격리 저장·운영 리허설은 별도 구현 이슈로 추적한다.
- #137은 탈퇴자의 작성물·신고 연결 해제와 승인된 사건 보존표를 소비하는 관련 구현 이슈이며 #110 정책 승인의 선행 조건이 아니다.

## 근거 문서

- `docs/community-moderation-policy.md`
- `docs/questionnaires/community-policy-operations-approval.md`
- `docs/questionnaires/policy-legal-review.md`
- `docs/account-deletion-retention-policy.md` §5.3
- `docs/PRD.md` §5.6
- `docs/launch-readiness-plan.md`
```

## #115 온라인 팝업 운영 레이어 — `not planned` 종료안

```markdown
## 결정

2026-08-12 `popups` 운영 단위·미션·등급·래플·브랜드 리포트·알림·검색·대기열·WMS 자동화를 한 epic으로 묶은 #115를 current product scope와 active backlog에서 제거한다. 기본 웹 굿즈 판매·팝업 티케팅·서버 결정 카드 게임은 그대로 유지한다.

실제 partner·운영 owner·pilot 예산·측정 가능한 수요가 없으므로 거대 예약 이슈를 유지하지 않는다. ADR-0008의 재진입 조건(active IP partner 1곳, 90일 pilot owner·예산, 예상 MAU 5,000 또는 사전등록 1,000)을 충족하면 하나의 `popups` landing/archive tracer만 다루는 새 RFC·새 이슈로 시작한다.

## 종료

- reason: `not planned`
- label: `wontfix`
- 근거: `docs/adr/0008-remove-unvalidated-popup-native-roadmap.md`
```

### 폐기된 post-launch 구현형 본문 — 게시 금지

```markdown
## Background

v1 출시 기준선 밖의 온라인 팝업 운영 레이어와 미승격 보강 항목을 추적하는 post-launch epic이다. 현재 제품 범위를 유지하면 “미구현 버그”가 아니라 의도적 backlog이며, 착수 시 하나의 거대 구현으로 처리하지 않고 tracer issue로 분해한다.

## 현재 범위

### 온라인 팝업 레이어

- `popups` 운영 단위, 카운트다운 랜딩과 아카이브
- 2주 단위 IP 교체와 운영 캘린더
- 미션·진행도·비현금 포인트·등급·도장깨기
- 무과금 응모, commit-reveal 래플, 당첨자 정가 결제
- 게임 goods variant의 `getRaffleResult`·`startPrizeCheckout` 실배선
- 카드 프로필·좋아요·랭킹
- 목적·필드·최소 집계셀·재식별 방지가 승인된 브랜드 집계 리포트

### 출시 후 보강

- 알림 이메일·푸시 확장과 야간 발송 동의 gate
- 최근·인기 검색어
- 구매 한도·예매 오픈·고동시성 대기열
- 굿즈 한정·예약 배지
- 홍실 팝업 연동 판매 C방식
- 주문→출고 지시→운송장→배송 상태 물류 API 자동화
- ADR-0005 할당 재고에서 WMS 실시간 공유재고로의 전환

Expo native 앱 셸과 WebView bridge는 #66의 V2 범위이며 이 epic에 포함하지 않는다. 홍실 C방식은 현재 이벤트·카드·카드풀·게임 데이터가 모두 0건이고 draft PR #167도 merge 금지 상태이므로, 그 진실원과 운영 데이터가 승인되기 전에는 착수 완료로 보지 않는다.

## 결정 필요

1. post-launch 유지 또는 지금 착수 중 하나를 선택한다.
2. 유지 시 v1 출시 증거, 재검토 trigger·목표 분기, 분해 책임자와 epic을 index로 계속 열어 둘지 확정한다.
3. 지금 착수 시 첫 pilot IP·팝업, 운영 owner, 목표일과 첫 tracer·acceptance test를 지정한다.
4. 래플·경품·카드 리워드, 야간 알림, 브랜드 리포트의 법무·개인정보 gate를 지정한다.
5. 홍실 C방식, WMS 제품·물류 API, 공유재고 전환의 사업·운영 책임자를 지정한다.

## 착수 완료 기준

- [ ] epic을 위 영역별 독립 issue로 분해하고 dependency·owner·acceptance test를 기록했다.
- [ ] 첫 tracer가 사용자에게 보이는 end-to-end 결과와 운영 rollback을 가진다.
- [ ] 래플·경품·카드 리워드의 게임물·간접 유상성·확률 표시와 소비자 계약을 법무 승인했다.
- [ ] 브랜드 리포트의 목적·항목·최소 집계셀·재식별 방지·IP사 제공·보존·위탁을 개인정보 승인했다.
- [ ] 야간 이메일·푸시는 명시 동의와 철회·실패 상향 계약을 통과했다.
- [ ] 물류 API·공유재고는 수기 fallback, idempotency, oversell·장애 책임과 reconciliation을 승인했다.
- [ ] PRD·ARCHITECTURE·ADR-0002~0005·`docs/online-popup/`의 current/target 상태가 구현 결과와 일치한다.

## backlog 유지 계약

- v1 출시 전에는 구현 완료로 표시하지 않는다.
- 재검토 trigger와 책임자를 남기고 epic은 post-launch index로 open 유지한다.
- 제품 결정으로 close하려면 단순 보류가 아니라 범위 폐기 여부를 확정하고 canonical PRD·ARCHITECTURE·ADR·online-popup 문서에 superseded 상태를 반영한다.

## 근거 문서

- `docs/questionnaires/to-questionnaire-open-issue-decisions.md` #115
- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/adr/0002-cross-platform-popup-game-miniapps.md`
- `docs/adr/0003-free-reward-pivot.md`
- `docs/adr/0004-draw-ticket-card-packs.md`
- `docs/adr/0005-icons-allocated-inventory.md`
- `docs/online-popup/`
```

## #137 회원 탈퇴·분리보존·외부 파기 구현

```markdown
## Background

#102에서 회원 탈퇴 정책과 구현을 분리했다. 이 이슈는 승인된 정책을 실제 self-service 탈퇴 상태 머신, 법정 분리보존, Storage/Auth 삭제, 외부 처리자 정리와 복원 후 재파기 절차로 구현한다.

현재 `auth.users → profiles`는 cascade지만 주문·결제·티켓·취소 요청 FK가 profile 삭제를 막는다. 사용자 Storage 객체, FK 밖 문자열 식별자, 이메일 처리자 사본과 runtime log도 별도로 정리해야 한다.

## 현재 상태

- 탈퇴 UI·RPC·상태 원장·법정 분리보존·만료 purge·DB restore 재파기 절차가 없다.
- 현재 schema로 Auth 사용자만 삭제하면 실패하거나 거래·UGC·Storage·외부 처리자에 개인정보가 남을 수 있다.
- `posts.user_id`·`comments.user_id`가 `NOT NULL ... ON DELETE CASCADE`라 승인된 tombstone·작성자 연결 해제 정책을 수행할 수 없다.
- 이메일 provider message ID·검증된 event·복원 독립 outbound 원장이 없고, 일부 결제·메일 로그에는 원문 식별자가 남는다.
- #102·#110의 내부 정책과 #188의 제품·위험 계약은 2026-08-12 승인됐다. #87 실제 공개 연락처, #191 처리자·외부 인프라 사실과 구현·공개 시행 승인은 남아 있다.

## 완료 기준

### 사용자 절차와 상태 머신

- [ ] 설정에서 즉시 삭제, 유지되는 작성물, 법정 분리보존과 현재 blocker를 preview한다.
- [ ] 브라우저가 target user ID를 보내지 않는 self-only 신청과 되돌릴 수 없음 확인 문구를 사용한다.
- [ ] 신청 즉시 마케팅과 새 구매·예매·작성·카드팩 개봉·게임을 차단한다.
- [ ] `requested → blocked_active_obligation` 또는 `requested → purging → completed`, 모든 단계의 `retryable_failure` 전이를 멱등 구현한다.
- [ ] 진행 중 주문·취소·환불·티켓·provider claim을 행 잠금으로 재검증하고 정확한 해결 링크를 반환한다.
- [ ] 외부 `purge_committed` durable ack 전에는 파괴 단계로 진입하지 않는다.
- [ ] request 때 256-bit opaque status token을 한 번만 발급하고 원문 대신 domain-separated HMAC·key version·만료만 private 원장에 저장한다. Auth hard delete 뒤에는 `Secure`·`HttpOnly`·`SameSite=Strict`·상태 경로 전용 cookie로 해당 request의 coarse status만 조회하며, terminal+7일과 request+90일 중 빠른 시각에 만료한다.
- [ ] valid status cookie는 post-Auth bearer라 탈취 시 coarse status가 노출될 수 있음을 위협 모델에 남기고 PII·내부 단계는 반환하지 않는다. 위조·추측·교환·변조·만료 token은 정보 0건이다.
- [ ] `blocked_active_obligation`에는 권리 경로 session을 유지하되 `purge_committed` ack 뒤 `purging` 진입 시 global sign-out·refresh session revoke를 시도하고, 현재와 이후 인증·상태 응답이 남은 Auth·앱 cookie를 반복 만료한다. worker만으로 browser cookie를 지웠다고 보지 않는다.

### 보존·UGC·Storage

- [ ] 승인된 최소 거래 snapshot만 `private` 원장에 분리하고 ACL·`retain_until`·legal hold·자동 만료 파기를 구현한다. legal hold set·release는 각각 서로 독립된 2인 승인과 제2 승인자 부재 fail-closed를 요구한다.
- [ ] `private.consent_receipts`·`private.age_gate_reviews`·`private.age_assurance_receipts`의 일반 서비스 행과 subject·reviewer·receipt/review/transaction-ref 식별자·정정 생년월일 provenance를 삭제·unlink하고 잔여 0건을 검증한다. 내부 보존 매트릭스에 근거·기한·접근 역할이 있는 최소 동의 증빙만 별도 snapshot으로 이동하며 reviewer는 nullable 또는 승인된 keyed HMAC으로 최소화한다.
- [ ] `private` 테이블과 SECURITY DEFINER 함수는 `public`, `anon`, `authenticated`, `service_role`의 직접·execute 권한을 모두 revoke한 뒤 self-only 또는 필요한 서버 역할에만 명시적으로 grant한다.
- [ ] 삭제 request의 암호화 subject·key version은 각 `purge_committed_at`보다 앞선 상태를 복원할 수 있는 daily/PITR·logical export·clone·DR artifact 전부의 `max(expires_at)`+최대 replay 지연+7일까지 유지한다. 미등록·expiry 미상 artifact와 catalog 변경은 fail closed하고 linkage가 없는 더 오래된 restore는 거부한다. 재연결 가능한 core digest와 sensitive linkage는 record/subject별 DEK로 암호화하고 공유 KMS KEK에는 wrapped DEK만 둔다. 개인별 파기는 ciphertext·wrapped DEK·모든 recoverable generation을 제거하며 공유 KEK version을 개인별 파기 수단으로 쓰지 않는다.
- [ ] 일반 신고·법정 권리사건의 승인된 보존표를 적용한다.
- [ ] 본인 포스트의 관계별 삭제/tombstone, 타인 포스트 댓글의 작성자 연결 해제와 `탈퇴한 사용자` 렌더링을 구현하고 feed·IP preview·block/filter·reaction query와 타입/UI에서 NULL 작성자를 누락하지 않는 회귀 테스트를 통과한다.
- [ ] 계정 연결이 해제돼도 본문이 남은 포스트·댓글은 계속 신고·숨김 처리할 수 있다. `private.report_subjects.target_user_id`·report trigger·admin moderation query/type/UI가 nullable 작성자를 허용하되 계정 제재 대상은 만들지 않고 콘텐츠 조치·감사만 수행한다.
- [ ] 유지 댓글의 직접 식별정보를 탈퇴 전에 삭제할 일괄·개별 경로와 탈퇴 후 공개 요청 경로를 제공한다.
- [ ] 모든 bucket의 `owner_id`, `user-uploads/<user-id>/*`, owner 없는 legacy 경로와 DB 참조를 Storage API로 삭제하고 잔여 0건을 확인한다.
- [ ] staff/admin 회사 자산은 승인된 책임자에게 인수인계하고 개인·staging 객체만 삭제한다.

### 외부 원장·메일·Auth

- [x] restore-resilient 삭제 증거 요구와 GCP append service + read-only verifier 경계를 2026-08-12 내부 검토로 승인했다.
- [ ] 실제 GCP project·region·billing·IaC·WIF/IAM·snapshot catalog·restore drill을 다루는 인프라 issue를 생성·연결한다. 현재 Supabase 프로젝트와 failure domain이 분리된 backend는 append·scan API·stable event ID·ACL·key rotation·retention class·external legal hold·전체 snapshot catalog·독립 restore drill을 갖추며 같은 DB mirror는 대체물이 아니다. soft delete·Object Versioning off를 매 배포 read-back하고 drift alert하며 모든 recoverable generation을 catalog·TTL·hold·파기 검증에 포함한다.
- [ ] 복원 독립 원장에 `purge_committed|purge_completed`, `external_purge_*`, `email_outbound_intent|accepted|failed`, stable `(provider,outbound_id,provider_event_id)`별 webhook event를 durable 기록하고 versioned reducer로 역순·중복을 수렴한다. append service는 caller별 event-type·선행 ack·상태전이를 검증하고 앱 writer의 `purge_completed|legal_hold_released|key destroy`를 거부한다.
- [ ] snapshot마다 외부 원장의 단조 sequence 또는 독립 durable watermark를 기록한다. 복원 중 verifier/replay principal 외 모든 writer·job·queue·hook·webhook·callback·provider egress를 격리하고 stable event key로 lossless replay해 삭제·provider locator·미완료 purge·external legal hold를 재구성한다. wall-clock cutoff나 GCS generation을 전역 cursor로 쓰지 않고 잔여 0건·checkpoint durable ack 뒤 writer를 단계적으로, public traffic을 마지막에 연다.
- [ ] Production Auth 메일을 withdrawal·`underage_rejected` fence가 있는 Send Email Hook으로 통제한다.
- [ ] provider 호출 전 durable outbound intent를 기록하고 idempotency key·PII 없는 tag·provider message ID·검증된 event로 reconcile한다.
- [ ] 24시간 window를 지난 모호 outbound는 자동 재발송하지 않고 수동 판정한다.
- [ ] fence epoch 뒤 신규 intent·claim은 0건이고 fence 전 lease의 in-flight attempt가 terminal event 또는 승인된 취소로 수렴하기 전에는 Auth 삭제·탈퇴 완료로 진행하지 않는다.
- [ ] DB fence는 Auth token 발급 자체를 막지 못하므로 login action·callback·`proxy.ts`·보호 Server 경계가 제한 세션을 거부하고 cookie를 만료한다. Storage 정리 뒤 `auth.admin.deleteUser(userId, false)`로 hard delete해 새 Auth 발급을 끝낸다.
- [ ] 민감 작업은 기존 stateless JWT뿐 아니라 실제 `auth.sessions` 존재 여부도 검증한다.
- [ ] request와 withdrawal/underage 발송 fence를 같은 트랜잭션으로 기록하고, fence 이전 모든 outbound가 durable terminal ack로 수렴하며 ambiguous가 0건이기 전에는 Auth를 삭제하지 않는다.
- [ ] `provider_fence_acked_at`, 마지막 provider 수락시각, Auth hard-delete ack 중 가장 늦은 시각을 처리자별 외부 삭제 cutoff로 사용한다.
- [ ] `external_purge_registered`와 `purge_completed`가 복원 독립 원장에 durable ack된 뒤에만 탈퇴 request를 `completed`로 전이한다.

### 개인정보·운영 검증

- [ ] runtime log와 모든 Log Drain에서 이메일·주소·QR·주문 UUID·`paymentKey`·provider raw/body를 제거한다.
- [ ] `order_ref|ticket_ref|email_ref`는 versioned domain-separated HMAC만 사용하고 키 수명·Log Drain TTL을 문서화한다.
- [ ] `audit_log.target/diff`, `reports.target_id`, `email_deliveries.dedupe_key`, 리워드·게임 idempotency key, `order_cancellation_claims.requested_by`를 포함한 FK 밖 직·간접 식별자를 삭제 또는 승인된 HMAC으로 치환하고 잔여 0건을 검증한다.
- [ ] 외부 처리자별 삭제 ack 또는 승인된 자동 만료 due와 이용자에게 고지할 잔여기간을 추적한다.
- [ ] 개인정보처리방침·이용약관·탈퇴 안내의 새 시행일과 개정 이력을 반영한다.
- [ ] 단위·통합·SQL smoke, local Supabase reset/lint, Storage/Auth E2E, DB restore와 provider fault-injection을 통과한다.
- [ ] 승인된 Production migration 뒤 controlled account deletion smoke와 ACL·보존 canary를 확인한다.

## 의존성

- #102: 거래·UGC·법정 보존·본인확인 내부 정책 승인 완료
- #110: 신고·권리침해 사건 보존과 운영 절차 내부 승인 완료
- #188: `underage_rejected` 제품·위험 계약 승인 완료. #188 구현 완료는 #137의 선행 조건이 아니다.
- #191: #137 1단계 fence를 소비해 외부 이메일·Send Email Hook·outbound event를 구현한다. #137 2단계 완료 전이는 #191 결과를 기다린다.
- #87: 탈퇴 후 거래기록 열람·개인정보 권리행사 연락처
- #102·#110 내부 승인과 #188 제품·위험 계약은 충족됐다. #87 실제 연락처와 #191 처리자·외부 인프라 계약을 확인하면서 1단계 request·private 원장·fence·외부 ledger adapter seam을 구현할 수 있다. restore-resilient 증거 ADR과 별도 인프라 issue가 실제 backend·운영자를 확정하기 전에는 2단계 파괴 worker를 활성화하거나 #137을 닫지 않는다. #191이 Hook·outbound·provider event를 연결한 다음 2단계가 Auth 삭제·외부 cutoff·완료 전이를 연다.

## 근거 문서

- `docs/account-deletion-retention-policy.md`
- `docs/questionnaires/policy-legal-review.md`
- `docs/community-moderation-policy.md`
- `docs/transactional-email.md`
- `docs/ARCHITECTURE.md` §8
- `docs/launch-readiness-plan.md`
```

## #168 홍실 퀘스트 첫 실판매 준비

```markdown
## Background

홍실 퀘스트 굿즈 3종의 controlled commerce smoke와 공개 판매 준비를 추적하는 운영 epic이다. 코드 하위 이슈 #169~#176, #178, #180~#185는 2026-08-10 모두 완료됐다. 남은 일은 사업자·PG, 운영 데이터, 물류·할당 재고와 이메일 안전 gate다. 이 epic 완료만으로 public sale activation을 허가하지 않으며, 공개 판매에는 `docs/launch-readiness-plan.md`의 Rewards Legal·Account를 포함한 전체 Launch Blocker 승인·구현·운영 검증이 별도로 필요하다.

계획 진실원은 `docs/first-sale-readiness.md`, 재고 모델은 ADR-0005다. v1 기능 출시와 실제 돈을 받고 물건을 보내는 판매 개시를 구분한다.

## 완료된 범위

- 약관·개인정보·배송정책 route와 사업자 정보 surface
- 굿즈 고시정보·상세 콘텐츠 schema와 admin 입력·미리보기
- 굿즈 상세, 배송비, 우편번호, 배송 후 청약철회
- 수기 운송장 등록·조회
- 트랜잭션 이메일 코드·주문 template — Production 발송은 비활성
- 카탈로그 admin 보강과 수동 뽑기권 발급

## 남은 critical path

2026-08-11 Production `/shop/g13`·`g14`·`g15` 응답을 재검증했다. 세 상품 모두 `stock='soldout'`, `stockQty=0`, `description=null`, `gallery=[]`, `detailImageUrl=null`이며 고시정보 7항목이 모두 `null`이다.

1. #87: 사업자 정보·통신판매업 신고·토스 live 상점과 4-key 전환, 실제 공개 연락처와 서면교부 법률 판단
2. #190: 홍실 3종 고시정보 7항목·설명·갤러리·상세 이미지 입력
3. #177: WMS·한진·출고·반품·도서산간·위탁사 H1~H7 확정
4. #179: WMS에서 ICONS 할당 수량 격리 후 Production `stock_qty`를 실제 값으로 입력·대조하되 public `stock='soldout'` 유지. `stock='ok'`는 #168의 server-side 제한 canary 또는 별도 public-sale 승인에서만 전환
5. #191: 제품 결정 D8에 따른 첫 실판매 선행조건. DPA·Send Email Hook·durable outbound·event·redaction gate를 완료하고, #87의 법률 판단에 따라 서면 교부 증빙 범위를 확정

#190은 #87의 A/S 연락처 뒤, #179는 #190과 #177 뒤에 완료한다. #177과 #87·#191의 사람 조사는 병렬로 진행할 수 있다.

## 범위 불변식

- 홍실 굿즈 3종 실재고 소프트런칭
- 온라인 팝업 연동 판매는 제외하고 #115에서 추적
- 홍실 카드가 없으므로 자동 카드 리워드 loop는 OFF, 수동 뽑기권만 사용
- 옵션·예약판매·부분환불·리뷰/Q&A·재입고 알림·쿠폰은 제외
- ADR-0005의 WMS 격리 할당 재고만 판매하며 다른 채널이 그 물량을 사용하지 않는다.

## epic 완료 기준

- [ ] #87, #177, #190, #179가 실제 운영 증거와 함께 완료됐다.
- [ ] #191의 안전 gate와 controlled 수신 검증을 완료했고, #87의 서면교부 판단에 따른 증빙 범위를 적용했다.
- [ ] 홍실 3종의 고시정보·상세 콘텐츠는 공개 화면에, 실제 할당 `stock_qty`는 admin·DB·WMS에서 정확히 대조되며 public은 승인 전 `stock='soldout'`을 유지한다.
- [ ] 사업자·A/S·권리행사 연락처와 배송·반품 안내가 실제 운영값과 일치한다.
- [ ] Toss live 결제는 검증된 webhook으로 정확히 1회 확정되고 원문 `paymentKey`·주문 ID가 runtime log에 남지 않는다.
- [ ] 비승인 사용자의 UI와 `place_order` RPC를 모두 막는 server-side canary allowlist를 구현·검증한 뒤, 승인된 controlled 주문 1건이 그 경계 안에서 결제→출고 지시→운송장→배송→필요 시 취소·환불 경로를 통과한다.
- [ ] WMS 할당 재고와 ICONS `stock_qty`를 대조하고 oversell·불일치 시 판매 중단·복구 절차를 리허설한다.
- [ ] first-sale readiness 표와 GitHub 하위 issue 상태를 최신 증거로 갱신한다.
- [ ] smoke 직후 public `stock='soldout'`과 비승인 주문 차단을 read-back했다. 이 epic 완료를 public sale 승인으로 오인하지 않았고 공개 전 전체 Launch Blocker를 별도로 확인했다.

## 근거 문서

- `docs/first-sale-readiness.md`
- `docs/adr/0005-icons-allocated-inventory.md`
- `docs/launch-readiness-plan.md`
```

## #188 만 14세 gate

```markdown
## Background

현재 가입·온보딩 코드는 만 14세 미만을 자동 차단하지 않는다. 이메일·OAuth 가입은 생년월일을 받기 전에 Auth 사용자와 이메일이 포함된 최소 프로필을 만들고, 생년월일은 온보딩에서만 수집한다.

이 이슈는 v1 가입 가능 연령의 제품 결정을 받고, 온보딩·DB 신뢰 경계·기존 계정·법정 문서를 실제 동작과 일치시키는 작업이다.

## 현재 상태

- `readBirthDate()`는 유효한 과거 날짜인지만 확인하고 나이를 계산하지 않는다.
- `isOnboarded()`도 만 14세 여부를 보호 액션 권한과 분리하지 않는다.
- 만 14세 미만 사용자가 온보딩을 완료하고 이메일·닉네임·생년월일을 저장할 수 있다.
- 온보딩은 닉네임 RPC·직접 profile update·팔로우 변경·`onboarded_at` update의 비원자 단계이고, 현재 화면은 결제사 확인을 본인확인 수단처럼 안내한다.
- 현재 공개 법정 문서는 자동 gate가 없다는 실제 상태를 기준으로 한다.
- 2026-08-12 승인된 **내부 제품·위험 계약**은 다음과 같다.
  - `Asia/Seoul` 달력일 기준 14번째 생일부터 가입 허용
  - 생년월일 자가신고는 1차 candidate 판정만 수행
  - 보호 액션 전 provider-neutral `verified_14_plus`; 원 DOB·CI·신분증 미저장
  - v1에서 법정대리인 동의 예외 경로를 제공하지 않음
- 위 계약은 공식 법령을 기준으로 한 보수적 내부 결정이며 독립 법률의견이 아니다. 코드·기존 계정 dry-run·법정 문서 개정 전에는 시행 중이라고 표시하지 않는다.

## 승인된 결정

1. v1을 만 14세 이상으로 제한하고 법정대리인 동의 예외를 제공하지 않는 제품안을 승인하거나 수정한다.
2. KST 14번째 생일 경계, 자가신고 1차 판정과 보호 액션 전 `verified_14_plus` 계약을 확정한다.
3. 생년월일을 받기 전 Auth 사용자·최소 프로필을 생성하는 현재 가입 순서를 유지해도 되는지 법무 확인을 받는다.
4. 신규 만 14세 미만 판정 시 보호 액션·마케팅을 막고 durable 삭제 요청 후 계정·개인정보를 파기하는 안을 승인한다.
5. 기존 만 14세 미만 계정은 새 보호 액션만 막고 기존 주문·티켓 조회, 취소·환불, 탈퇴·개인정보 권리행사·고객지원을 유지하는 안을 승인한다.
6. 기존 계정의 PII 없는 건수·범주 audit 담당자, 이용자·보호자 고지와 시행일을 확정한다.
7. `unverified|eligible|age_restricted|underage_rejected|review_required` 다섯 상태, 상태별 로그인·recovery·권리·마케팅 matrix와 HTML/JSON 오류 mapping을 승인한다.
8. 기존 `age_restricted`의 생일 자동 해제 대신 현재 필수 약관·개인정보 처리 재동의와 DB KST 재판정 뒤 `eligible` 전환을 승인한다.
9. 미래·malformed·완료 상태 불일치 legacy는 `review_required`로 두고 자동 삭제·자동 age-out하지 않는 최소정보 수동 검토를 승인한다.
10. activation backfill dry-run·PII 없는 상태별 exact count와 staff/admin abort gate를 승인한다.
11. 결제 인증은 연령·법정대리인 동의 확인 수단이 아니라는 Onboarding 교체 문구를 승인한다.
12. 현재 필수 문서 version·동의시각·source를 가진 immutable consent receipt를 승인하고, 기존 boolean 동의를 최신 receipt로 소급 승격하지 않는 backfill을 승인한다.

## 완료 기준

- [x] 제품·내부 법률위험 결정과 공식 근거가 확인서·research에 기록됐다.
- [ ] KST classifier가 미래·불가능 날짜를 거부하고 14번째 생일부터 candidate adult를 반환하며, `verified_14_plus` 없이는 `eligible`과 보호 액션을 반환하지 않는다.
- [ ] `isOnboarded()`와 `canStartProtectedAction()`을 분리한다.
- [ ] `unverified|eligible|age_restricted|underage_rejected|review_required` 다섯 상태의 RPC 결과와 권리 matrix를 구현·통합 테스트한다.
- [ ] 클라이언트가 user ID·현재 날짜·eligible 여부를 보내지 않고 DB가 `auth.uid()`와 KST 현재 날짜로 판정한다.
- [ ] 성인 온보딩은 server-verified assurance 뒤에만 닉네임·생년월일·현재 문서 immutable receipt·추천 팔로우·`onboarded_at`을 원자 반영한다. provider raw DOB·CI·전화·신분증은 저장하지 않는다.
- [ ] 미성년 판정은 닉네임·동의·팔로우·`onboarded_at`을 쓰지 않고 `reason='underage_rejected'` durable 삭제 request ack 뒤에만 거절 결과를 반환한다.
- [ ] durable request 기록 실패는 fail closed하고 성공 또는 온보딩 완료로 표시하지 않는다.
- [ ] #137 processor가 Storage owner/path 0건과 Auth hard-delete ack까지 멱등 재시도한다.
- [ ] 예상하지 못한 주문·티켓·UGC·legal hold가 있으면 자동 삭제하지 않고 rights-review로 상향한다.
- [ ] 신규 구매·예매·작성·팔로우·좋아요·마케팅·카드팩 개봉·게임은 차단한다.
- [ ] 기존 `age_restricted|review_required` 계정은 각각 주문·배송·결제·본인 티켓·QR 조회와 제시, 취소·환불, 본인 작성물 삭제, unfollow·unlike, 마케팅 opt-out, 신고·차단, 로그인·recovery, 탈퇴·개인정보 권리행사·비로그인 지원을 유지하며 상태별 안내·오류를 구분한다.
- [ ] `age_restricted`는 생일 전 보호 액션 차단, 생일 뒤 재동의·DB KST 재판정·새 `verified_14_plus` 전까지 차단, 세 조건 뒤 원자적 `eligible` 전환을 검증하고 마케팅 동의를 자동 승계하지 않는다.
- [ ] 미래·malformed·완료 상태 불일치 또는 versioned receipt 없는 legacy boolean 계정은 `review_required`이며 최신 동의로 소급 승격·자동 삭제·자동 age-out하지 않는다. 최소정보 staff review RPC가 reason code·근거 범주·결정자·시각을 감사하고, 승인된 생년월일 정정·재동의 가능 판정 뒤 전용 page/action에서 실제 현재 문서 receipt를 만든 때만 재판정한다.
- [ ] `/account/age-review-required`와 `age_review_required` 오류, staff review action/RPC, review 미승인 사용자의 재동의 우회 거부를 통합 테스트한다.
- [ ] 신규 `underage_rejected`는 DB fence가 Auth 발급 자체를 막는다고 가정하지 않고 login/callback/app gate·cookie cleanup·Send Email Hook·보호 mutation guard·최종 hard delete의 조합으로 재진입을 막는다. 예상 밖 obligation은 비로그인 권리행사·수동 최소정보 심사로 처리한다.
- [ ] staff 검표는 구매자 권리가 아닌 운영 mutation으로 분리하며 미성년 staff 역할 예외를 두지 않는다.
- [ ] 2월 29일생은 평년 3월 1일·윤년 2월 29일부터 나이가 증가한다는 경계를 법무 승인값과 일치시킨다.
- [ ] 기존 만 14세 미만 계정의 PII 없는 audit과 승인된 처리·통지를 완료한다.
- [ ] activation 전 backfill dry-run fixture와 상태별 exact count를 검증하고 제한·검토 대상 staff/admin이 있으면 role 인수인계 전 중단한다. 기존 계정을 `underage_rejected`로 backfill하거나 자동 삭제하지 않는다.
- [ ] 이용약관·개인정보처리방침·온보딩·거절 안내와 공개 권리행사 경로가 실제 동작 및 새 시행일과 일치한다.
- [ ] 온보딩에 DOB 1차 판정·보호 액션 전 연령확인·결제 비검증 문구를 노출하고 기존 결제사 확인 본인확인 문구를 제거한다.
- [ ] 경계 날짜, Server Action, SQL RPC, protected-action matrix, 삭제 실패 재시도와 기존 거래 회귀 테스트를 통과한다.

## 의존성

- #102: 연령·삭제·법정 보존 내부 위험정책 결정 완료; default branch merge 필요
- #137: `underage_rejected` durable 삭제 상태 머신과 worker
- #191: underage fence가 적용된 Send Email Hook과 거래메일 발송 차단
- #87: 계정 삭제 전후 사용할 공개 개인정보 권리행사·고객지원 연락처
- local 구현은 `ready-for-agent`로 전환할 수 있다. Production activation은 dry-run·권리 경로·법정 문서 시행 뒤 별도로 승인한다.

## 근거 문서

- `docs/questionnaires/to-questionnaire-open-issue-decisions.md` #188
- `docs/questionnaires/policy-legal-review.md` “만 14세 미만 처리”
- `docs/account-deletion-retention-policy.md` §2.4
- `docs/ARCHITECTURE.md` §8
- `docs/PRD.md`
- `docs/launch-readiness-plan.md`
```

## #191 트랜잭션 이메일 Production 활성화

```markdown
## Background

#180에서 트랜잭션 이메일 코드와 주문 확인·배송 시작 템플릿을 구현했지만 Production 발신 설정은 없다. 이메일 활성화는 API 키와 DNS만 추가하는 작업이 아니라 외부 개인정보 처리자, Auth 메일, 탈퇴·미성년자 fence, 중복 발송과 runtime log를 함께 통제하는 Production gate다.

## 현재 상태

- 2026-08-10 실측 기준 Vercel Production에 `EMAIL_PROVIDER_API_KEY`와 `EMAIL_FROM`이 없다.
- 주문 확인·배송 시작 메일은 발송되지 않고 `provider_not_configured` 이력만 남는다.
- 기본 transactional endpoint는 Resend지만 실제 Supabase Auth SMTP 처리자·계약·보존기간은 별도 인벤토리가 필요하다.
- Auth custom SMTP와 앱 거래메일이 서로 다른 경로라 탈퇴·`underage_rejected` 이후 발송을 하나의 정책 경계에서 막지 못한다.
- 현재 Production pipeline은 Auth 설정을 앱 Hook route보다 먼저 동기화할 수 있어 그대로 Hook을 활성화하면 발송 장애가 날 수 있다.
- 현재 `email_deliveries`는 재시도 시 mutable 값을 덮어쓰고 HTTP 2xx를 `sent`로 기록할 뿐 provider message ID와 검증된 delivery event가 없다.
- provider가 수락한 직후 앱이 중단되면 현재 DB claim만으로 실제 발송 여부를 판정할 수 없다.
- 따라서 env·DNS 설정과 테스트 메일 1통만으로 이 이슈를 완료할 수 없다.

## 결정 필요

1. Resend와 실제 Auth SMTP 처리자의 DPA, 국외이전, email data·event·suppression·backup별 실제 TTL을 승인한다.
2. 회원별 삭제 지원 또는 자동 만료 확인 방법, message content storage·tracking 설정과 이용자 고지 문구를 확정한다.
3. 주문 확인·배송 메일에 포함할 수령인명·전화·우편번호·주소·배송메모·운송장 중 목적상 필요한 최소 필드를 승인한다.
4. 암호화 recipient의 기본 24시간 보존, attempt/event locator의 처리자 만료+7일 상한과 외부 삭제 cutoff를 승인한다.
5. #87에서 인앱 주문 상세가 계약내용 서면 교부로 충분한지 판단해 이메일의 법정 역할과 보존 증빙 범위를 정한다. 첫 실판매의 이메일 도입 자체는 제품 결정 D8에 따라 이 답과 무관하게 선행한다.
6. Production 설정·재배포·controlled smoke 승인자와 허용 시간을 지정한다.
7. `Hook route 배포·서명/health probe → 별도 Hook 활성화·read-back` 2단계 전환과 controlled canary 뒤 custom SMTP 호환 설정을 제거할지 확정한다.

키·토큰·실제 수신자 개인정보는 이슈에 기록하지 않는다.

## 완료 기준

### 개인정보 처리·발송 경계

- [ ] Resend와 Auth SMTP 처리자의 DPA·국외이전·데이터별 TTL·회원별 삭제/자동 만료·content storage·tracking이 법무·운영 승인됐다.
- [ ] Supabase Auth 메일의 실행 경계를 Send Email Hook으로 전환하고 Hook 활성 상태에서 custom SMTP direct-path 발송이 0건임을 검증했다. 기존 SMTP 설정의 제거 여부는 controlled canary 뒤 별도로 결정한다.
- [ ] Hook은 secret을 검증하고 5초 timeout·최소 권한·실패 시 fail-closed를 적용한다.
- [ ] 가입확인·재발송·recovery·이메일 변경과 거래메일 모두 withdrawal·`underage_rejected` fence를 먼저 확인한다.
- [ ] 제한 대상에는 provider를 호출하지 않고 계정 존재 여부를 드러내지 않는 동일한 공개 응답을 반환한다.
- [ ] provider·DB의 raw body와 `Error.message`를 `provider_rejected|provider_rate_limited|provider_unavailable|db_unavailable|unknown_internal_error` 같은 승인된 allowlist 코드로 정규화하고 원문을 응답·DB `last_error`·runtime log에 복사하지 않는다.

### 중복·복구·삭제 계약

- [ ] provider 호출 전에 DB와 복원 독립 원장에 stable `outbound_id`의 durable intent를 기록한다.
- [ ] fence transaction은 epoch를 올려 신규 intent·claim을 거부하고, fence 전 lease를 가진 in-flight attempt는 accepted·failed 또는 승인된 terminal 취소까지 drain하며 ambiguous를 0건으로 만든다. webhook event drain은 stable cursor와 reducer checkpoint로 별도 추적한다.
- [ ] 같은 ID를 idempotency key와 PII 없는 tag로 전달하고 provider message ID·검증된 webhook event로 reconcile한다.
- [ ] `email_outbound_intent|accepted|failed`와 stable ID별 `email_outbound_provider_event`를 외부 원장에 durable append·ack한 뒤 DB attempt/event mirror를 갱신한다.
- [ ] 모호 응답은 24시간 idempotency window 안에서 같은 payload·key로만 재시도하고, 이후에는 자동 재발송하지 않는다.
- [ ] provider locator를 탈퇴자의 외부 purge task에 연결하고 삭제 ack 또는 승인된 자동 만료를 추적한다.
- [ ] fence 이전 in-flight outbound가 terminal event 또는 승인된 취소로 수렴하고 ambiguous가 0건이 되기 전에는 탈퇴·Auth 삭제를 완료하지 않는다.
- [ ] recipient·attempt·locator의 `retain_until`과 만료 파기 batch를 구현한다.

### 로그·Production 활성화

- [ ] recipient·subject·본문·provider raw/body·주문 UUID·dedupe key·`paymentKey`가 runtime log와 모든 Log Drain에 남지 않는다.
- [ ] `order_ref|email_ref`는 versioned domain-separated HMAC 계약만 사용한다.
- [ ] Production pipeline에 `REQUIRE_SEND_EMAIL_HOOK`·Hook URI/secret·callback read-back 검증을 추가한다. controlled canary 전에는 현재 `REQUIRE_SMTP` 호환 검사를 즉시 제거하지 않으며, 제거 조건과 변경 이력을 별도 승인한다.
- [ ] Hook route·durable dispatcher를 먼저 배포해 서명·health probe를 통과한 뒤 별도 승인 job에서 Hook을 활성화하고 read-back한다. Auth 설정이 route 배포보다 먼저 적용되지 않는다.
- [ ] Auth 설정 sync script·테스트, GitHub Actions Production/Preview 분기와 ARCHITECTURE·운영 문서를 새 Hook 진실원에 맞춘다. Preview는 승인되지 않은 실제 발송을 계속 막고, Production canary는 가입확인·재발송·recovery·이메일 변경에서 direct SMTP 우회 0건을 검증한다.
- [ ] `EMAIL_PROVIDER_API_KEY`·`EMAIL_FROM`과 승인된 선택 env를 Vercel Production에 sensitive 값으로 등록했다.
- [ ] 발신 도메인의 SPF·DKIM·DMARC를 확인했다.
- [ ] 위 안전 gate를 통과한 뒤에만 재배포했다.
- [ ] Gmail·네이버·다음의 controlled 수신 smoke에서 provider message ID와 검증된 delivery event가 확인됐다.
- [ ] 어드민 이력이 같은 `outbound_id`와 provider event로 reconcile되며, 앱의 `sent` 또는 HTTP 2xx만으로 교부를 단정하지 않는다.
- [ ] 기존 `provider_not_configured` 행은 현재 주문 상태를 재검증하고 정확한 경우에만 안전하게 재발송한다.

## 의존성

- #180: 트랜잭션 이메일 코드·템플릿 구현 완료
- #102: 외부 처리자·보존·삭제·이용자 고지 정책 승인
- #137: 전체 완료가 아니라 1단계의 withdrawal/underage fence와 외부 ledger adapter seam만 먼저 필요하다. restore-resilient 구조는 2026-08-12 내부 검토로 결정됐고 실제 GCP 인프라 issue·drill은 남아 있다. #191 완료 뒤 #137 2단계가 외부 purge를 닫는다.
- #188: `underage_rejected` 계약 승인만 필요하며 age gate 구현 완료를 기다리지 않는다.
- #87: 이메일의 법정 서면 교부 역할·증빙 범위를 정하는 법률 판단과 공개 사업자·고객센터 연락처
- Production 발송은 위 gate와 명시적 Production 변경 승인 전까지 비활성으로 유지한다.

## 근거 문서

- `docs/transactional-email.md`
- `docs/account-deletion-retention-policy.md` §5.5~§8
- `docs/questionnaires/policy-legal-review.md`
- `docs/first-sale-readiness.md` §8.1
- `docs/ARCHITECTURE.md`
- `docs/launch-readiness-plan.md`
```

## 적용 순서

1. 제품·법무·운영 확인서의 답변을 먼저 반영한다.
2. 승인된 정책·질문 답변·후보 spec을 review 가능한 branch와 PR로 default branch에 merge한 뒤에만 이슈 본문의 근거 문서로 사용한다. untracked·미커밋 로컬 파일을 GitHub 진실원처럼 링크하지 않는다.
3. 각 본문의 날짜·현재 상태를 게시 직전에 GitHub·코드·Production에서 다시 검증한다.
4. 승인받은 이슈만 `gh issue edit`로 본문을 교체한다. 키·토큰·실사용자 PII는 입력하지 않는다.
5. body 교체 뒤 dependency label과 Project 상태를 실제 unblock 여부에 맞춰 갱신한다. 미승인 정책 이슈를 `ready-for-agent`로 바꾸지 않는다.
6. 구현 PR이 merge된 경우 자동 close·Project Done을 확인하고 누락만 보정한다.

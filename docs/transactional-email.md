# 트랜잭션 이메일 운영 (#180)

> 상태: Active · 작성 2026-08-07 · 근거: [`first-sale-readiness.md`](./first-sale-readiness.md) §3.4(`N1`·`L4`) · 결정 D8
> 코드 진실원: `lib/email/*`, `supabase/migrations/20260807130001_transactional_email_deliveries.sql`,
> `supabase/migrations/20260807140001_email_delivery_admin_ops.sql`,
> `supabase/migrations/20260807150001_email_resend_order_state_gate.sql`

앱이 직접 보내는 메일이다. Supabase Auth의 가입 확인·비밀번호 재설정 메일과는 **다른 경로**다
(Auth 메일은 Supabase custom SMTP, 이 메일은 앱 서버의 HTTP 호출).

---

## 1. 구성

| 조각 | 위치 | 역할 |
|---|---|---|
| provider 경계 | `lib/email/provider.server.ts` | HTTP 한 번. SDK 의존성 없음. env 없으면 no-op |
| 본문 템플릿 | `lib/email/templates.ts` | 순수 함수. 네트워크·DB·env를 모른다 |
| 발송 훅 | `lib/email/transactional.server.ts` | 주문 로드 → 사실 확인 → 클레임 → 발송 → 결과 기록. **throw하지 않는다** |
| 발송 이력 | `email_deliveries` 테이블 + `claim_email_delivery` / `complete_email_delivery` | 멱등·재발송의 진실원 |
| dedupe 키 | `lib/email/dedupe.ts` | `<template>:<orderId>` 형식의 진실원. 재발송이 행 하나에서 대상을 되찾는 근거 |
| 운영 조회 | `lib/email/deliveries.server.ts` + `admin_search_email_deliveries` | `failed`·`pending` 목록 읽기(staff 전용) |

발송 지점은 두 곳이다.

- **주문 확인** — 토스 웹훅(`app/api/webhooks/tosspayments/route.ts`)이 `confirm_order_payment` 성공 직후 호출한다.
- **배송 시작** — 어드민 배송 전이(`app/admin/order-actions.ts`)가 `shipping` 전이 성공 직후 호출한다.
  택배사·운송장번호·조회 링크를 **그대로 넘긴다**. 인자를 생략하면 발송 훅이 `orders`의
  `shipping_carrier`·`tracking_number`에서 읽는다(재발송 경로가 이 폴백을 쓴다).
  양쪽 다 비어 있을 때만 배송 시작 사실만 알린다.

### 왜 메일 실패가 주문을 막지 않는가

결제 확정의 진실원은 토스 웹훅이다(`AGENTS.md` 불변). 발송 훅이 예외를 던지면 웹훅이 500으로
떨어지고 토스가 확정을 재전송한다 — 메일 문제로 주문 상태를 흔드는 셈이다. 그래서 훅은 모든
실패를 삼키고 결과 객체로만 보고한다. 실패는 `email_deliveries.status='failed'`로 남는다.

### 왜 미발송 로그를 훅이 직접 남기는가

훅이 결과 객체만 돌려주면 그 결과를 버리는 호출자 하나가 미발송을 통째로 지운다. 그래서
로그는 호출부가 아니라 훅(`safely`)이 남긴다 — `sent`와 `already_delivered`를 뺀 모든 결과가
주문 id와 사유를 달고 `console.error`로 나간다. 호출부는 결과를 다시 로그하지 않는다.
같은 사건이 두 줄로 남으면 알림 임계값이 흔들린다.

### 왜 발송 시점의 주문 상태를 다시 보는가

재발송이 열리면서 발송 시점이 웹훅 확정 직후로 한정되지 않는다. 확인 메일이 실패해 `failed`로
남은 주문이 다음날 청약철회로 `canceled`가 될 수 있고, 그때 "결제가 확인됐고 배송 준비를
시작합니다"를 보내면 취소된 주문에 대한 거짓 고지다. 그래서 훅이 발송 직전에 `orders.status`를
읽고 본문이 지금도 사실인 상태에서만 보낸다.

| 템플릿 | 보내는 주문 상태 | 어긋나면 |
|---|---|---|
| `order_confirmation` | `paid` · `shipping` · `done` | `skipped` + `order_status_mismatch:<status>` 로그 |
| `order_shipped` | `shipping` · `done` | 〃 |

집합은 두 곳에 있다 — `lib/email/transactional.server.ts`의 `ACCURATE_ORDER_STATUSES`와
`admin_request_email_resend`. 웹훅 경로는 DB 게이트를 지나지 않으므로 실제 안전장치는 훅이고,
DB 게이트는 운영자에게 발송 전에 이유를 알려주는 역할이다. **바꿀 때 양쪽을 함께 바꾼다.**

### 왜 클레임과 결과 기록이 나뉘어 있는가

발송은 HTTP다. DB 트랜잭션으로 감쌀 수 없다. `claim_email_delivery`가 행을 잠가 발송 권한을
한 호출자에게만 주고(`true`), 발송이 끝나면 `complete_email_delivery`가 결과를 닫는다.
토스가 최대 7회 재전송해도 확인 메일은 1통이다. 응답이 유실돼 `pending`으로 남은 클레임은
10분(`target_retry_after`) 뒤에 다시 잡을 수 있어, 한 번의 사고로 메일이 영구히 막히지 않는다.

### 배송비 표기

메일은 `orders`의 배송비 컬럼을 읽지 않고 `총 결제금액 - 굿즈 합계`로 파생한다.
배송비 도입([#174](https://github.com/sangwopark19/icons-ip/issues/174))이 먼저 들어와도, 나중에 들어와도 표기가 맞는다.
배송비가 0이면 "무료"로 적는다.

---

## 2. 환경변수 (서버 전용)

`NEXT_PUBLIC_` 접두사를 **쓰지 않는다**. 붙이면 클라이언트 번들에 API 키가 박힌다.

| 이름 | 필수 | 설명 |
|---|---|---|
| `EMAIL_PROVIDER_API_KEY` | ✅ | provider API 키. Resend 기준 `re_…` |
| `EMAIL_FROM` | ✅ | 발신자. 예: `ICONS <no-reply@iconsip.com>` — 로컬 파트 앞의 도메인이 인증된 도메인이어야 한다 |
| `EMAIL_REPLY_TO` | — | 회신 주소. 발신 전용을 유지하려면 비워둔다 |
| `EMAIL_PROVIDER_ENDPOINT` | — | 기본 `https://api.resend.com/emails`. 같은 모양의 API면 이 값만 바꿔 갈아끼운다 |
| `SITE_URL` | — | 메일 본문 링크의 오리진. 기본 `https://iconsip.com` |

**`EMAIL_PROVIDER_API_KEY` 또는 `EMAIL_FROM`이 없으면 메일을 보내지 않는다.** 대신
`email_deliveries`에 `status='failed'`, `last_error='provider_not_configured'`로 **기록은 남긴다.**
발송을 앞에서 끊고 아무것도 남기지 않으면 확인 메일 0통·이력 0행·로그 0줄이 되어, 나중에 키를
채운 운영자가 발송 이력을 열어도 "다시 보낼 메일이 없습니다"만 본다 — 구매자는 계약내용
서면(L4)을 영영 못 받는다. 기록해 두면 키를 채운 뒤 `다시 보내기` 하나로 복구된다.

빌드와 테스트는 깨지지 않는다. `prebuild` 필수 변수 검증에도 넣지 않는다 — 메일 미설정은
배포를 막을 사유가 아니다.

`SUPABASE_SERVICE_ROLE_KEY`가 없으면 주문도 못 읽고 이력도 못 남긴다. 이 경우에만 로그 한 줄
(`service_role_not_configured`)이 유일한 흔적이다.

Vercel에서는 Production·Preview 모두 sensitive로 등록한다. Preview에 실제 발신 도메인을
쓰면 테스트 메일이 실사용자에게 갈 수 있으므로, Preview는 키를 비워 두는 것이 기본이다.
Preview의 `email_deliveries`에는 `provider_not_configured` 행이 쌓인다 — 보내지 않은 사실의
정확한 기록이므로 정상이다.

---

## 3. 발신 도메인 인증 (SPF · DKIM · DMARC) — 코드로 할 수 없는 부분

DNS와 provider 콘솔 작업이다. `iconsip.com` DNS는 **Cloudflare**에서 관리한다
([`ARCHITECTURE.md` §도메인/DNS](./ARCHITECTURE.md)).

### 3.1 현재 상태

Supabase Auth custom SMTP가 이미 Resend를 쓰고 있고 발신자는 `no-reply@iconsip.com`,
Resend 도메인은 `iconsip.com`이다. 즉 **`iconsip.com`의 SPF·DKIM은 이미 발급·등록되어 있을 가능성이 높다.**
새 키를 만들기 전에 Resend 콘솔의 Domains에서 `iconsip.com`이 `Verified`인지 먼저 확인한다.
Verified라면 3.2는 건너뛰고 3.3(DMARC)만 확인하면 된다.

### 3.2 새로 인증해야 할 때

1. Resend 콘솔 → **Domains → Add Domain** → `iconsip.com`. Region은 Auth SMTP와 같은 값을 고른다.
2. 콘솔이 제시하는 레코드를 Cloudflare DNS에 그대로 추가한다. **Proxy status는 반드시 `DNS only`**
   (주황 구름 끄기) — 메일 레코드를 프록시하면 검증이 실패한다.

| 종류 | Name | 값 | 비고 |
|---|---|---|---|
| TXT (SPF) | `send.iconsip.com` 또는 루트 | `v=spf1 include:amazonses.com ~all` | 콘솔이 준 값을 그대로. **루트에 SPF TXT는 하나만 존재해야 한다** — 이미 있으면 새로 만들지 말고 기존 레코드에 `include:`를 합친다 |
| TXT (DKIM) | `resend._domainkey` | 콘솔이 준 공개키 | 값이 길어 잘리기 쉽다. 붙여넣은 뒤 전체 길이를 다시 확인한다 |
| MX | `send.iconsip.com` | `feedback-smtp.<region>.amazonses.com` (priority 10) | 반송 처리용. 루트 MX(수신 메일)와 혼동하지 않는다 |

3. 전파 후 콘솔에서 **Verify**. 보통 수 분, 최대 48시간.

### 3.3 DMARC

SPF·DKIM만으로는 수신 측 정책이 없다. 리포트부터 받는 정책으로 시작한다.

| 종류 | Name | 값 |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@iconsip.com; fo=1` |

`p=none`으로 2~4주 리포트를 본 뒤 `p=quarantine` → `p=reject`로 올린다.
바로 `reject`로 올리면 Auth 메일까지 함께 반송될 수 있다.

### 3.4 검증 체크리스트

- [ ] Resend Domains에서 `iconsip.com`이 `Verified`
- [ ] `dig TXT resend._domainkey.iconsip.com +short`에 DKIM 공개키가 보인다
- [ ] 루트 SPF TXT가 **1개**다 (`dig TXT iconsip.com +short | grep spf1`)
- [ ] Cloudflare에서 메일 관련 레코드가 전부 `DNS only`
- [ ] Gmail·네이버·다음 계정으로 실제 주문 확인 메일을 받아 "표준 암호화" 경고나 스팸함 분류가 없다
- [ ] 받은 메일 원본에서 `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`

---

## 4. 운영

### 조회와 재발송

어드민 사이드바 **메일 발송 이력** 섹션(`components/admin/sections/EmailDeliverySection.tsx`,
`app/admin/page.tsx`가 로드해 `components/admin/Admin.tsx`가 렌더)에서 한다. 각 건의
`다시 보내기`가 재발송 경로다. **SQL 콘솔이 필요 없다.**

목록은 `failed`와 `pending`을 **둘 다** 읽는다(`loadEmailDeliveries`). `failed`만 읽으면,
클레임 직후 함수 타임아웃이나 `complete_email_delivery` 실패로 죽은 발송이 `pending`으로
영구히 남아 — 메일은 안 갔는데 목록에는 안 보이는 상태가 된다.

`email_deliveries` 테이블은 RLS 활성 + 모든 롤 revoke다. **service role 세션에서도 직접
`select`할 수 없다** — 시도하면 `permission denied for table email_deliveries`가 난다.
조회·재발송은 staff 게이트가 붙은 RPC 두 개로만 한다
(`supabase/migrations/20260807140001_email_delivery_admin_ops.sql`).

| RPC | 실행 롤 | 역할 |
|---|---|---|
| `admin_search_email_deliveries(p_status, p_limit, p_offset)` | `authenticated` (내부에서 `is_staff()`) | 상태별 발송 이력 조회. 앱은 `lib/email/deliveries.server.ts`로 부른다 |
| `admin_request_email_resend(p_dedupe_key)` | `authenticated` (내부에서 `is_staff()`) | 재발송 게이트. 통과하면 `audit_log`에 `admin.email_delivery.resend_requested`를 남기고 템플릿 이름을 돌려준다 |

재발송이 멱등을 깨지 않는 이유는 두 겹이다. `admin_request_email_resend`가 이미 `sent`인
건을 거절하고, 통과하더라도 실제 발송은 `claim_email_delivery`를 다시 잡는 기존 훅이 한다.
버튼을 연타해도 이미 도착한 메일이 두 번 가지 않는다.

`다시 보내기`가 거절되는 이유는 다음과 같다. 거절되면 `audit_log`에도 남지 않는다 —
일어나지 않은 발송을 기록하지 않는다.

| 메시지 | 뜻 | 운영자가 할 일 |
|---|---|---|
| `email_already_sent` | 이미 도착했다 | 없음 |
| `email_no_longer_accurate` | 주문 상태가 본문과 어긋난다(예: 청약철회로 `canceled`) | 없음. 이 건은 다시 보내면 안 된다 |
| `order_missing` | 대상 주문이 사라졌다 | 없음 |
| `email_delivery_not_found` · `email_delivery_target_unresolved` | 대상을 특정할 수 없다 | 개발자 확인 |

`email_no_longer_accurate`로 막힌 행은 `failed`로 계속 남는다. 지우지 않는다 — "이 메일은
끝내 가지 않았다"는 사실 자체가 기록이다.

배송 시작 메일을 다시 보낼 때 운송장 값은 폼에서 오지 않는다. 발송 훅이 `orders`의
`shipping_carrier`·`tracking_number`를 읽어 채운다.

### 이력에 남지 않는 미발송

발송 훅이 클레임 전에 멈추면 `email_deliveries`에 행이 생기지 않는다. 이 경우 로그가 유일한
흔적이므로, 화면만 보고 "보낼 게 없다"고 판단하면 안 된다. 로그에서
`[email] order confirmation not sent (order:<id>)` 를 찾는다.

| 사유 | 이력 행 | 복구 |
|---|---|---|
| `service_role_not_configured` | 없음 | env 채운 뒤 로그의 주문 id로 확인. 재발송 대상이 없으므로 개발자 경로가 필요하다 |
| `recipient_missing` | 없음 | `profiles.email`을 채운 뒤 위와 같다 |
| `order_missing` | 없음 | 없음(대상이 없다) |
| `order_status_mismatch:<status>` | 없음 | 없음. 보내면 안 되는 메일이다 |
| `provider_not_configured` | **있음**(`failed`) | 키를 채우고 발송 이력에서 `다시 보내기` |

### 본문 확인

템플릿은 순수 함수라 렌더 결과를 테스트로 고정한다(`lib/email/templates.test.ts`).
클라이언트 호환은 table 레이아웃 + 인라인 스타일 + 밝은 배경으로 확보한다 —
Gmail은 `<style>`을 떼어내고 Outlook은 flex·grid를 무시한다. 앱의 어두운 서피스를
그대로 옮기면 강제 라이트 모드 클라이언트에서 뭉개진다.

### 남은 것

- 사업자 정보·고객센터 연락처의 메일 푸터 반영 — [#170](https://github.com/sangwopark19/icons-ip/issues/170)(#87 종속)
- 발송 실패의 능동 알림. 현재 미발송은 `console.error`로만 나가고, 운영자가 로그 알림을
  걸어두지 않으면 발송 이력 화면을 열어야 안다
- 이력 행이 없는 미발송(`recipient_missing` 등)의 화면 복구 경로. 지금은 로그를 보고
  개발자가 처리한다
- `admin_request_email_resend`의 SQL 스모크. `supabase/tests/`에 대응 파일이 아직 없다

# 트랜잭션 이메일 운영 (#180)

> 상태: Active · 작성 2026-08-07 · 근거: [`first-sale-readiness.md`](./first-sale-readiness.md) §3.4(`N1`·`L4`) · 결정 D8
> 코드 진실원: `lib/email/*`, `supabase/migrations/20260807130001_transactional_email_deliveries.sql`

앱이 직접 보내는 메일이다. Supabase Auth의 가입 확인·비밀번호 재설정 메일과는 **다른 경로**다
(Auth 메일은 Supabase custom SMTP, 이 메일은 앱 서버의 HTTP 호출).

---

## 1. 구성

| 조각 | 위치 | 역할 |
|---|---|---|
| provider 경계 | `lib/email/provider.server.ts` | HTTP 한 번. SDK 의존성 없음. env 없으면 no-op |
| 본문 템플릿 | `lib/email/templates.ts` | 순수 함수. 네트워크·DB·env를 모른다 |
| 발송 훅 | `lib/email/transactional.server.ts` | 주문 로드 → 클레임 → 발송 → 결과 기록. **throw하지 않는다** |
| 발송 이력 | `email_deliveries` 테이블 + `claim_email_delivery` / `complete_email_delivery` | 멱등·재발송의 진실원 |

발송 지점은 두 곳이다.

- **주문 확인** — 토스 웹훅(`app/api/webhooks/tosspayments/route.ts`)이 `confirm_order_payment` 성공 직후 호출한다.
- **배송 시작** — 어드민 배송 전이(`app/admin/order-actions.ts`)가 `shipping` 전이 성공 직후 호출한다.
  택배사·송장번호·조회 링크는 **인자로 받는다**. 운송장 컬럼은 [#178](https://github.com/sangwopark19/icons-ip/issues/178)의 범위이며,
  값이 생기면 `sendOrderShippedEmail`에 그대로 넘기면 된다. 값이 없으면 배송 시작만 알린다.

### 왜 메일 실패가 주문을 막지 않는가

결제 확정의 진실원은 토스 웹훅이다(`AGENTS.md` 불변). 발송 훅이 예외를 던지면 웹훅이 500으로
떨어지고 토스가 확정을 재전송한다 — 메일 문제로 주문 상태를 흔드는 셈이다. 그래서 훅은 모든
실패를 삼키고 결과 객체로만 보고한다. 실패는 `email_deliveries.status='failed'`로 남는다.

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

**`EMAIL_PROVIDER_API_KEY` 또는 `EMAIL_FROM`이 없으면 발송을 건너뛰고 로그만 남긴다.**
로컬·CI에서 빌드와 테스트가 깨지지 않는다. `prebuild` 필수 변수 검증에도 넣지 않는다 —
메일 미설정은 배포를 막을 사유가 아니다.

Vercel에서는 Production·Preview 모두 sensitive로 등록한다. Preview에 실제 발신 도메인을
쓰면 테스트 메일이 실사용자에게 갈 수 있으므로, Preview는 키를 비워 no-op으로 두는 것이 기본이다.

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

### 재발송

`email_deliveries`에 `status='failed'`로 남은 건이 대상이다. 같은 발송 훅을 다시 호출하면
클레임이 다시 잡히고 재발송된다. `status='sent'`인 건은 클레임이 거절되어 중복 발송되지 않는다.

```sql
-- 실패 목록
select dedupe_key, template, recipient, attempt_count, last_error, claimed_at
from email_deliveries
where status = 'failed'
order by claimed_at desc;
```

테이블 직접 접근 권한은 열려 있지 않다(RLS 활성 + 모든 롤 revoke). 운영 조회는 Supabase 콘솔의
service role 세션에서 한다.

### 본문 확인

템플릿은 순수 함수라 렌더 결과를 테스트로 고정한다(`lib/email/templates.test.ts`).
클라이언트 호환은 table 레이아웃 + 인라인 스타일 + 밝은 배경으로 확보한다 —
Gmail은 `<style>`을 떼어내고 Outlook은 flex·grid를 무시한다. 앱의 어두운 서피스를
그대로 옮기면 강제 라이트 모드 클라이언트에서 뭉개진다.

### 남은 것

- 운송장 값 배선 — [#178](https://github.com/sangwopark19/icons-ip/issues/178)
- 사업자 정보·고객센터 연락처의 메일 푸터 반영 — [#170](https://github.com/sangwopark19/icons-ip/issues/170)(#87 종속)

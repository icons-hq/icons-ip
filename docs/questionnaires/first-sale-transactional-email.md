# iconsip.com 트랜잭션 이메일 인프라 확인서

**목적:** 주문 확인 메일을 Production에서 실제 발송하고 [#191](https://github.com/icons-hq/icons-ip/issues/191)의 완료 증거를 확보합니다.

> **상태: 2026-08-11 작성 · 미회신.** [#191](https://github.com/icons-hq/icons-ip/issues/191)의 완료 근거가 된다. 작성 이후 legacy Supabase custom SMTP의 SPF·DKIM·DMARC pass는 확인됐고, 아래 처리위탁·보존기간·tracking 항목이 남았다.

**보내는 사람:** ICONS 운영팀  
**답변 담당:** iconsip.com 도메인·이메일 인프라 담당자  
**답변 사용처:** DNS·Vercel 설정, 재배포, 실제 수신 검증에 사용합니다.

## 배경

앱 발송 경로는 구현됐지만 Production의 `RESEND_API_KEY`와 `RESEND_FROM`이 비어 있습니다. Supabase Auth 메일과 별도 경로이며, 처리자 승인·전역 발송 fence·provider 호출 전 원장·로그 redaction 전에는 Production 활성화가 차단됩니다.

## 답변 방법

**회신 희망일:** `[기입]` · **예상 소요:** 20~30분  
**API 키·토큰·전체 비밀값은 이 문서나 GitHub 이슈에 적지 마세요.** 상태와 마스킹된 증거만 남기고, 비밀값은 승인된 보안 채널로 전달합니다.

## Provider

### 사용할 이메일 provider는 무엇입니까?

> Provider:

### 해당 provider 계정의 운영 책임자는 누구입니까?

> 담당자:

### 기존 Supabase Auth용 Resend 계정과 `iconsip.com` 도메인을 재사용할 수 있습니까?

> 가능 여부 / 제한사항:

### API 키를 전달할 승인된 보안 채널이 있습니까?

> 채널 종류 / 접근 담당자:  
> 키 값은 적지 않음:

## 개인정보 처리·보존 전제

### Provider와 개인정보 처리위탁·국외이전 계약(DPA)을 체결하거나 적용받고 있습니까?

> 계약 상태 / 확인 담당자 / 공개 문서 링크:

### 수신주소·메일 metadata·HTML·text 본문·event log의 실제 보존기간은 각각 얼마입니까?

Resend를 쓰면 공개 문서의 일반 email data 30일과 실제 account 설정·계약이 일치하는지 확인해주세요.

> 항목별 기간 / 기산점 / 확인 근거:

### 회원별 삭제 요청, suppression 제거, backup 만료를 처리할 운영 경로가 있습니까?

> Dashboard / API / Support / 자동 만료:
>
> 삭제 또는 만료 확인 증거:
>
> 처리 담당자:

### Message content storage를 비활성화할 수 있습니까?

> 가능 / 불가능 / 별도 유료 옵션:
>
> 적용 여부와 근거:

### Open·click tracking은 비활성 상태입니까?

> 상태 / 설정 위치 / 예외 사유:

### Provider message ID와 delivery event를 회원 탈퇴·교부 증빙에 사용할 수 있습니까?

> 지원 여부 / 필요한 webhook·권한:
>
> 회원별 locator를 원문 이메일 없이 보관하는 방법:

### Provider 호출 전에 durable outbound intent를 기록하고 같은 ID를 멱등키·tag로 사용할 수 있습니까?

Resend 기준 idempotency window는 24시간입니다. provider 수락 직후 앱이 중단돼도 사본을 찾을 수 있도록 DB와 복원 독립 원장에 intent를 먼저 기록하고, provider message ID·검증된 event로 reconcile해야 합니다.

> Idempotency-Key 지원·최대 window:
>
> PII 없는 `outbound_id` tag 지원·event 전달 형태:
>
> provider webhook 검증 방법·담당 secret 위치(값은 적지 않음):
>
> 24시간이 지난 모호 intent의 조회·지원·수동 판정 절차:

### 발송 원장과 crash recovery 구현을 fault-injection으로 검증했습니까?

설정 지원 여부만으로 완료하지 않습니다. 아래는 마스킹된 test run·로그 ref·DB/external event 상태로 증명해 주세요.

> DB attempt와 복원 독립 `email_outbound_intent` durable ack 전에는 provider mock이 호출되지 않음:
>
> provider 수락 직후 앱 중단 시 `email_outbound_accepted` 또는 검증된 webhook이 같은 `outbound_id`의 message ID·external purge locator를 복구함:
>
> 24시간 window 안의 timeout 재시도는 같은 payload·Idempotency-Key를 써 중복 발송하지 않음:
>
> 24시간이 지난 모호 intent는 자동 재발송하지 않고 수동 판정 queue로 감:
>
> DB backup 복원 뒤 외부 intent/accepted/reconciled event replay가 누락 attempt·purge task를 재구성함:
>
> withdrawal·`underage_rejected` fence 뒤 Auth/거래 메일 provider 호출 0건이며 Auth 삭제 실패 재시도 중에도 유지됨:

### 가입확인·비밀번호 재설정용 Supabase Auth SMTP의 실제 처리자는 누구입니까?

현재 provider·과거 사본을 인벤토리하고, Production 활성화 전에는 custom SMTP를 Supabase Send Email Hook으로 교체합니다. 탈퇴 처리 중에는 거래메일뿐 아니라 signup resend·recovery·이메일 변경 발송도 withdrawal·`underage_rejected` fence에서 정지해야 합니다.

> Provider / 계정 / 도메인:
>
> transactional provider와 동일 / 별도:
>
> Send Email Hook 적용 담당자·hook secret 검증·실패 시 fail-closed 확인:
>
> fence 이후 provider 호출 0건과 fence 이전 intent drain을 확인할 증거:
>
> Auth 삭제 실패 재시도 중 fence 유지 확인 방법:

## 도메인과 DNS

### Provider 콘솔에서 `iconsip.com`이 `Verified` 상태입니까?

> 상태 / 확인일 / 마스킹된 화면 증거:

### SPF 레코드가 정상이며 루트 SPF가 하나뿐입니까?

> 상태 / 확인 방법:

### DKIM 레코드가 정상입니까?

> 상태 / 확인 방법:

### 메일 관련 Cloudflare 레코드가 모두 `DNS only`입니까?

> 상태 / 확인 방법:

### Provider가 요구한 반송용 MX 레코드가 정상입니까?

> 상태 / 확인 방법:

### DMARC 레코드의 현재 상태는 무엇입니까?

> 정책 / 확인 방법:

## Vercel Production 환경변수

> **#191 dispatcher 기준이다.** `EMAIL_PROVIDER_API_KEY`·`EMAIL_FROM`은 legacy
> `sendTransactionalEmail` 어댑터(`lib/email/provider.server.ts`)가 읽는 구 변수이고, 이것만
> 채우면 #191이 요구하는 durable outbound intent와 탈퇴 fence를 우회한 채 메일이 나간다.
> 아래는 `lib/email/resend-provider.server.ts`와 Send Email Hook 경로가 읽는 변수다
> (`docs/transactional-email.md` §참조).

### `RESEND_API_KEY`가 Sensitive 값으로 등록됐습니까?

> 등록 여부 / 환경 / 마스킹된 증거:

### `RESEND_FROM`에 사용할 발신자 문자열은 무엇입니까?

> 예: `ICONS <no-reply@iconsip.com>` — 로컬 파트 뒤의 도메인이 인증된 도메인이어야 합니다:

### 회신 주소를 사용할 예정입니까?

> `RESEND_REPLY_TO` 값 또는 `미사용`:

### `RESEND_WEBHOOK_SECRET`을 발급하고 Resend webhook endpoint를 등록했습니까?

> 발급 여부 / endpoint URL / 구독 event:

### Supabase Auth 메일을 Send Email Hook으로 전환할 준비가 됐습니까?

> `SUPABASE_SEND_EMAIL_HOOK_SECRET`·`EMAIL_DISPATCH_HMAC_SECRET` 발급 여부 / 전달 채널:

### 전용 API endpoint를 써야 합니까?

> `RESEND_API_ENDPOINT` 값 또는 `기본값 사용`:

### 기본 provider endpoint를 사용합니까?

> 기본 사용 / override URL:

### 메일 링크의 사이트 주소는 `https://iconsip.com`입니까?

> 확인 / 다른 주소:

### Preview 환경은 실제 발송 키 없이 유지합니까?

> 확인 / 예외 사유:

### Vercel runtime log 보존기간과 Log Drain 목록을 확인했습니까?

> Vercel plan / runtime log TTL:
>
> Log Drain·외부 관측 도구 / 각각의 TTL·접근 담당자:
>
> provider raw body·주문 UUID·dedupe key·`paymentKey` redaction 테스트 근거:
>
> `order_ref=HMAC(..., orders.id)`, `email_ref=HMAC(..., outbound_id)` 계약과 이전 key version 파기일:

### 환경변수 등록 후 Production 재배포를 완료했습니까?

> 배포 시각 / 배포 URL 또는 ID:

## 실제 발송 검증

### 테스트 주문 확인 메일의 식별 정보는 무엇입니까?

개인정보는 마스킹해주세요.

> 주문 참조 / 발송 시각 / 수신 주소 일부 마스킹:

### Gmail에서 정상 수신됐습니까?

> 수신함·스팸 여부 / 경고 여부 / 증거:

### 네이버 메일에서 정상 수신됐습니까?

> 수신함·스팸 여부 / 경고 여부 / 증거:

### 다음 메일에서 정상 수신됐습니까?

> 수신함·스팸 여부 / 경고 여부 / 증거:

### 받은 메일 원본에서 SPF·DKIM·DMARC가 모두 PASS입니까?

> SPF:  
> DKIM:  
> DMARC:

### 어드민 "메일 발송 이력"에 해당 건이 `sent`로 기록됐습니까?

> 확인 시각 / 마스킹된 화면 증거:

## 추가 확인

### 운영 전에 추가로 해결해야 할 이메일 인프라 문제가 있습니까?

>

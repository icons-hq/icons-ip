# ICONS

ICONS는 서브컬처 팬덤을 위한 슈퍼앱 프로토타입이다. 공식 라이선스 **굿즈** 커머스, 수집형 디지털 **카드**(무료 리워드), 팝업 티케팅, 커뮤니티, IP 허브를 하나의 "Holographic Midnight" 경험으로 묶는다.

## 현재 상태

- Next.js 16, React 19, Tailwind v4 기반 App Router 프로젝트다.
- Claude Design 핸드오프를 옮긴 시각적 프로토타입에서 출발했다.
- 화면은 `app/**/page.tsx`가 `components/screens/*` 컴포넌트를 렌더링하는 구조다.
- 공개 카탈로그(IP, 굿즈, 카드, 이벤트)는 Supabase 환경변수가 있으면 DB를 읽고, 로컬 개발에서 환경변수가 없으면 `lib/data.ts` mock으로 fallback한다. Vercel Preview는 새 static mock catalog 확인을 위해 기본적으로 mock을 사용한다.
- Supabase Auth/SSR은 이메일/비밀번호 가입·로그인, 확인 메일 콜백·재전송, 비밀번호 재설정 요청·콜백·새 비밀번호 저장·전역 로그아웃, 온보딩 완료 게이트와 IP 팔로우 보호 액션에 연결되어 있다. 환경변수가 없으면 인증 폼은 비활성화되고 세션 갱신은 no-op으로 동작한다.
- 커뮤니티 공개 피드는 Supabase `posts`/`public_profiles`와 최근 7일 visible 포스트의 트렌딩 태그를 읽는다. 포스트·댓글 Server Action과 RPC는 연결돼 있지만 생성·수정과 community 이미지 upload는 DB·Storage gate에서 기본 OFF다. 운영·법률 준비를 증명한 별도 migration 전까지 공개 읽기·좋아요·신고·차단·본인 삭제·운영자 숨김만 유지한다.
- 디지털 카드 리워드는 DB 전역 gate에서 기본 OFF다. 법무·운영 승인을 반영한 별도 migration 전까지 카드팩·게임 공개 표면과 신규 발급·개봉·운영 활성화를 차단하고, 기존 보유 카드 바인더만 읽기 전용으로 유지한다.
- 검색은 Supabase 환경변수가 있으면 Postgres `search_public_content` RPC로 IP, 굿즈, 카드, visible 포스트, 태그를 그룹 검색하고, 로컬 fallback에서는 mock 데이터를 사용한다.
- `/admin`은 staff/admin 게이트, 카탈로그 CRUD·보관/복원·아트워크 업로드, 카드풀 운영 기간·등급별 발급 확률·카드 풀 바인딩, 뽑기권 발급 정책, 카드 보상형 참여형 게임 등록·운영과 PII-free 플레이 집계, 감사 로그, 커뮤니티 신고 상태 변경과 포스트 숨김 처리 경로에 연결되어 있다. 기존 게임 `goods` variant는 운영 콘솔에서 읽기 전용이고, mock 연출은 실제 경품·구매권을 만들지 않으며 신규 실물 판매에 쓰지 않는다.
- Google, Kakao, Apple 버튼은 Supabase 관리형 OAuth Server Action에 연결되어 있고 production Supabase provider도 모두 활성화되어 있다. Google은 production 공개 상태이며 Apple App ID·Services ID·callback·서명 키 구성이 완료됐다. Kakao는 `(주) 아이콘스` 비즈 앱, 로그인용 client secret, `account_email` 필수 동의·계정 정보 수집까지 설정했고 Supabase의 이메일 없는 사용자 허용은 꺼져 있다. 코드가 production에 배포된 뒤 controlled login smoke가 남아 있다.
- 굿즈와 티켓 checkout은 provider-neutral attempt/claim/finalizer와 `PaymentGateway` 경계, Korpay SDK prepare→form-urlencoded callback→confirm 경로에 연결됐다. 목적별 rollout gate의 기본값은 OFF지만, 2026-08-18 Production 굿즈 gate를 공개 ON으로 전환해 로그인·온보딩 완료 사용자가 결제를 시작할 수 있다. 티켓 gate와 두 canary는 OFF이며 기존 Toss 거래는 알려진 결제의 조회·취소·웹훅 정리 경로로만 남는다.
- 범용 온라인 팝업 운영 레이어와 Expo webview 호스트는 현 로드맵에 없다. 19+ 꽝 없는 유한 실물 쿠지는 기존 카드·게임과 분리된 `prize_sale`로 설계하며 [#212](https://github.com/icons-hq/icons-ip/issues/212)·[#213](https://github.com/icons-hq/icons-ip/issues/213)이 별도 추적한다.

## 빠른 시작

```bash
npm install
cp .env.local.example .env.local # 선택: Supabase를 연결할 때만 값 입력
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 연다.

Supabase 환경변수를 입력하지 않아도 로컬 개발 앱은 mock 데이터로 실행된다.

`supabase/seed.sql`은 로컬 reset용 개발 데이터다. Production 공개 카탈로그 baseline은 immutable migration으로 관리하며, production 배포는 seed를 실행하지 않는다.

## 환경변수

`.env.local.example`을 `.env.local`로 복사한 뒤 필요한 값만 채운다.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ICONS_CATALOG_SOURCE=
AUTH_SIGNUP_RESEND_SECRET=
SITE_URL=https://iconsip.com
CRON_SECRET=
# #191 dark path: Production only; Preview/CI leave empty and Hook stays disabled.
SUPABASE_SEND_EMAIL_HOOK_SECRET=
EMAIL_DISPATCH_HMAC_SECRET=
RESEND_API_KEY=
RESEND_FROM=
RESEND_REPLY_TO=
RESEND_WEBHOOK_SECRET=
# Optional Resend-compatible endpoint override; normally leave empty.
RESEND_API_ENDPOINT=
PAYMENT_RECONCILIATION_SECRET=
# Korpay live credentials: Production only; never put these in Preview/CI or NEXT_PUBLIC_*.
KORPAY_MID=
KORPAY_KEY=
KORPAY_ORDER_CHECKOUT_ENABLED=false
KORPAY_TICKET_CHECKOUT_ENABLED=false
# Optional Production-only UUID for one authenticated canary actor; leave unset by default.
KORPAY_ORDER_CANARY_USER_ID=
KORPAY_TICKET_CANARY_USER_ID=
```

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase 프로젝트 URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable public key. 새 프로젝트는 이 값을 우선 사용한다.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: legacy Supabase anon public key. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`가 없을 때 fallback으로만 사용한다.
- `ICONS_CATALOG_SOURCE`: 서버 전용 catalog/search source override. 값은 `mock` 또는 `supabase`만 허용한다. 비워두면 Vercel Preview는 `mock`, Supabase 환경변수가 있는 production/local은 `supabase`, Supabase 환경변수가 없으면 `mock`을 쓴다.
- `AUTH_SIGNUP_RESEND_SECRET`: 회원가입 확인 메일 재전송 상태, 인증 `next`, 비밀번호 재설정 요청 제한 쿠키를 domain-separated HMAC으로 서명하는 서버 전용 secret. 긴 랜덤 값을 사용하고 `NEXT_PUBLIC_` prefix를 붙이지 않는다.
- `SITE_URL`: secret이 아닌 서버 전용 canonical public origin이다. Production은 정확히 `https://iconsip.com`을 사용하며 Korpay 굿즈·티켓 `returnUrl` callback도 이 origin 아래에서 생성한다. Preview/CI는 필요하면 각 환경의 일반 서버 origin을 둘 수 있지만 Korpay 실자격 증명과 canary actor는 두지 않고 목적별 gate를 닫는다. `SITE_URL`만으로 live checkout이 열리지는 않는다.
- `CRON_SECRET`: production Vercel Cron이 만료된 관리자 아트워크 staging 객체를 정리할 때 쓰는 서버 전용 bearer secret. 16~128자의 URL-safe 랜덤 값을 사용하고 preview에는 필요하지 않다.
- `SUPABASE_SEND_EMAIL_HOOK_SECRET`·`RESEND_WEBHOOK_SECRET`: #191 Hook/webhook의 raw body 서명 검증용 서버 secret이다.
- `EMAIL_DISPATCH_HMAC_SECRET`: recipient·source·provider reference를 목적 분리 keyed HMAC으로 투영하는 32자 이상 서버 secret이다.
- `RESEND_API_KEY`·`RESEND_FROM`·`RESEND_REPLY_TO`: durable EmailDispatcher의 Resend HTTP 발송 설정이다. Preview·CI에는 실값을 두지 않는다.
- `RESEND_API_ENDPOINT`: 호환성 검증에만 쓰는 선택적 endpoint override다. 일반 운영에서는 비워 둔다.
- `PAYMENT_RECONCILIATION_SECRET`: 검토된 단일 결제·환급 건을 명시적으로 재조회하는 내부 route 전용 bearer secret. `CRON_SECRET`과 공유하지 않는다. #206 dark deploy에서는 미설정이 정상이며 route가 401로 닫힌다. 활성화 시 별도 승인 절차로 Production에만 16~128자의 URL-safe 랜덤 값을 두고 Preview/CI에는 넣지 않는다. 요청은 이메일 등 PII가 아닌 opaque URL-safe `caseRef`만 받으며 actor는 서버가 `payment_reconciliation_service_v1`으로 고정한다.
- `KORPAY_MID`·`KORPAY_KEY`: 코페이 운영 자격 증명이다. Vercel Production에만 sensitive 값으로 두고 Preview/CI에는 만들지 않는다. 두 변수 모두 서버 환경변수이며 `NEXT_PUBLIC_` 접두사를 쓰지 않는다. MKEY인 `KORPAY_KEY`는 브라우저로 보내지 않는다. `KORPAY_MID`는 정적 클라이언트 설정이 아니라 서버가 hash를 포함해 만든 일회성 SDK payload의 provider 필드로만 전달한다.
- `KORPAY_ORDER_CHECKOUT_ENABLED`·`KORPAY_TICKET_CHECKOUT_ENABLED`: 신규 굿즈·티켓 provider session을 목적별로 여는 정확한 `true`/`false` gate다. 기본값은 `false`다. gate를 내려도 이미 durable하게 준비된 known order+nonce callback은 계속 drain한다.
- `KORPAY_ORDER_CANARY_USER_ID`·`KORPAY_TICKET_CANARY_USER_ID`: public gate가 `false`인 동안 목적별로 인증된 단일 UUID actor만 허용하는 선택적 Production canary allowlist다. 기본값은 미설정이고 Preview/CI에는 두지 않는다. 현재 provision됐다고 가정하지 않는다.

#191 코드는 dark deploy 상태다. DB gate는 기본 OFF이고 Supabase Send Email Hook도 사람이 운영 증거를 확인하기 전에는 활성화하지 않는다. 기존 Supabase custom SMTP와 주문 메일 경로는 실제 Auth 흐름 canary와 direct SMTP 0 증거가 끝날 때까지 유지한다. 상세 순서는 [`docs/transactional-email.md`](./docs/transactional-email.md)에 있다.

### Production 결제 활성화 경계

Korpay 계약 완료와 현재 운영 자격 증명의 사용 가능 상태는 2026-08-14 사용자 확인으로 정정됐다. 이는 공급사 서면 증거나 19+ 유한 실물 쿠지 승인 범위를 뜻하지 않는다. 연동 계약은 코페이 인증결제 가이드 v1.2.2와 `@korpay/sdk` 1.1.8에 맞춘 서버 prepare → 브라우저 SDK → `application/x-www-form-urlencoded` callback → 서버 confirm → 명시적 303 redirect다. Production의 Korpay callback은 `SITE_URL=https://iconsip.com`에서 만든 canonical origin만 사용한다.

Provider credential readiness와 목적별(`order`·`ticket`) rollout gate를 분리한다. 판매 gate를 내리면 해당 목적의 새 reserve·prepare·provider session 생성만 차단하고, 이미 DB에 durable한 attempt의 known opaque order+nonce callback은 계속 claim·확정한다. 알 수 없는 order·nonce는 provider 호출 전에 거부한다. 코페이가 공개한 가이드에는 자동 status/reconcile/cancel API가 없으므로 모호 결과를 추측하거나 자동 재시도하지 않고 `needs_review`로 격리하며, 취소는 #208의 수동 운영 절차로 처리한다. Toss 결제위젯과 `/api/payments/confirm`을 이용한 신규 결제는 열지 않고, Production의 `TOSS_SECRET_KEY`는 알려진 기존 거래가 종결될 때까지만 유지한다.

2026-08-18 사용자 지시로 Production 굿즈 public gate를 ON으로 전환했고 티켓 gate와 canary는 OFF로 유지했다. 이는 2026-08-21 개정 법정 문서 활성화, callback 서명·자동 상태조회 부재, #208 수동 취소 운영을 해소하지 않는다. 실제 배포 증거, drain, rollback과 잔여 위험은 [`docs/runbooks/korpay-production-rollout.md`](./docs/runbooks/korpay-production-rollout.md)를 따른다.

URL과 public key 둘 중 하나라도 없으면 인증 미들웨어는 세션 갱신을 건너뛰고, 공개 카탈로그는 로컬 개발용 mock 데이터로 fallback한다. `AUTH_SIGNUP_RESEND_SECRET`이 없으면 회원가입 재전송 제한과 서명된 `next` 보존을 신뢰할 수 없으며, 비밀번호 재설정 요청은 fail closed한다. Vercel preview와 production 배포는 Supabase 공개 환경변수 또는 이 secret이 없으면 workflow preflight에서 실패한다.

## Supabase Auth URL 설정

Auth URL·email link TTL·recovery template 설정은 손으로 관리하지 않는다. `scripts/sync-supabase-auth.mjs`, workflow, `supabase/templates/recovery.html`이 진실원이다. workflow는 URL과 TTL을 production·preview 프로젝트에 각각 적용·검증하고, recovery template는 Production handler 배포가 성공한 뒤 Production에만 활성화·readback한다. 공유 Preview의 전역 template는 PR workflow가 바꾸지 않는다. 관리 대상 값을 대시보드에서 직접 바꾸면 해당 동기화 단계가 있는 다음 배포에서 되돌아간다.

**Production** (`deploy-supabase`, `main` push):

- Site URL: `https://iconsip.com`
- Redirect URLs: `https://iconsip.com`, `https://www.iconsip.com`, `https://icons-ip.vercel.app`, `http://localhost:3000`, `http://127.0.0.1:3000` 각 origin의 `/auth/callback`과 `/auth/recovery/callback`
- 제거 대상: `https://icons-ip-*.vercel.app/auth/callback`. preview가 전용 프로젝트를 보게 된 뒤로는 운영 allow-list에 있을 이유가 없고, 애초에 실제 preview 호스트와 맞지도 않았다(아래).

**Preview** (`deploy-supabase-preview`, PR):

- Site URL: `https://icons-ip.vercel.app`
- Redirect URLs: `https://icons-ip.vercel.app`, `https://icons-hongshil-vn.vercel.app`, `https://icons-*-sangwopark19icons-1055s-projects.vercel.app`, `https://icons-git-*-sangwopark19icons-1055s-projects.vercel.app` 각 origin과 local 두 origin의 `/auth/callback`·`/auth/recovery/callback`
- preview 배포 호스트는 프로젝트 이름(`icons-ip`)이 아니라 **배포 접두 `icons-`**를 쓴다 — `icons-nb9vdpqs8-sangwopark19icons-1055s-projects.vercel.app` 형태다. 그래서 `icons-ip-*` 패턴은 어떤 preview URL과도 매칭되지 않았다. 팀 접미까지 붙여 좁힌다: `icons-*.vercel.app`은 남의 프로젝트까지 허용한다.
- preview에는 custom SMTP가 없어 SMTP 강제와 confirmation/rate-limit 강제를 켜지 않는다. email link/OTP TTL 3,600초와 callback allow-list만 동기화한다. recovery template는 여러 PR이 공유하는 preview Auth 프로젝트의 전역 설정이므로 PR workflow에서 바꾸지 않으며, 이메일 확인이 필요한 가입 플로우는 preview에서 끝까지 갈 수 없다.

가입 확인·OAuth는 query 없는 `/auth/callback`을 사용한다. 비밀번호 재설정 메일은 Supabase의 `TokenHash`를 전용 `/auth/recovery/callback` query로 전달하고 서버에서 `verifyOtp(type=recovery)`한다. callback query에는 `next`나 계정 식별자를 넣지 않는다. 가입·OAuth의 안전한 `next`·목적·발급 시각은 `icons_auth_next`에 10분, recovery의 값은 경로가 분리된 `icons_auth_recovery_next`에 최대 3,600초 동안 서명된 httpOnly 쿠키로 보존한다. 신규 recovery 요청은 shared callback cookie를 만들지 않는다.

공용 `/auth/callback`은 가입 확인과 OAuth code exchange만 성공시킨다. exchange 결과가 recovery이면 signed marker 유무와 관계없이 생성된 local session과 응답 cookie를 폐기하고 reset 오류로 닫는다.

Server Action이 만드는 callback origin은 production·www·기본 Vercel·local 고정 origin과 플랫폼이 제공한 현재 `VERCEL_URL`만 허용한다. 인식하지 못한 `Origin`·`X-Forwarded-Host`·`Host`는 신뢰하지 않고 `https://iconsip.com`으로 닫는다.

비밀번호 재설정 요청은 계정 존재 여부와 무관하게 같은 응답을 반환한다. 같은 브라우저의 정규화 이메일별 요청은 raw email 대신 HMAC digest를 담은 `icons_auth_password_reset` 쿠키로 총 3회/10분 제한하고, 활성 이메일 bucket은 12개로 제한해 브라우저 cookie 크기를 넘지 않게 한다. Supabase provider rate limit은 실제 상한으로 둔다. 전용 callback의 서명 state가 요청 브라우저에만 있으므로 최신 메일 링크는 재설정을 요청한 브라우저에서 열어야 한다.

전용 Recovery callback은 `token_hash`와 `type=recovery`만 허용한다. token-hash `verifyOtp(type=recovery)`, 유효한 전용 서명 state, `getUser()` 재검증을 모두 통과한 뒤에만 온보딩 여부와 무관하게 `/update-password`로 보낸다. `code`만 있는 PKCE 링크는 session exchange 없이 제한된 reset 오류로 닫는다. 검증 과정의 성공 조건이 어긋나면 그 과정에서 만들어진 local session만 폐기한다. signed recovery state는 최신 유효 링크를 다시 쓸 수 있도록 성공하거나 자체 3,600초 TTL이 끝날 때까지 보존한다. 브라우저가 redirect 응답의 session cookie를 첫 SSR 요청보다 늦게 반영하면 callback이 붙인 1회성 `session_ready` 표식으로 전체 탐색을 한 번 다시 수행하며, 세션 확인 전에는 비밀번호 폼을 노출하지 않는다. 새 비밀번호 저장 뒤 global sign-out을 완료하면 `/login?password_reset=success`로 이동한다. 일반 가입 callback은 기존 온보딩 게이트를 유지하고, 회원가입 확인 메일 재전송은 서명된 httpOnly 쿠키로 3회/10분 window를 추적한 뒤 Supabase `auth.resend({ type: 'signup' })`를 사용한다. workflow는 Site URL, 두 callback의 Redirect URLs, email link/OTP TTL 3,600초와 기존 mailer 설정을 먼저 동기화한다. Production Vercel 배포가 성공한 뒤에만 recovery template 원문을 PATCH하고 read-back한다.

### 소셜 OAuth 공급자 운영

세 공급자가 공유하는 외부 callback은 `https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback`이다. 앱이 Supabase에서 돌아온 뒤 사용하는 callback은 위 Redirect URLs의 `/auth/callback`이며, 소셜 로그인 `next`도 `icons_auth_next`에 `purpose: oauth`로 10분 동안 서명해 보존한다.

- Google: Google Cloud project `icons-503202`, Auth Platform 앱 `ICONS`, Web client `ICONS Web`을 사용한다. JavaScript origin은 `https://iconsip.com`, `https://www.iconsip.com`이고 redirect URI는 Supabase callback 한 개다. 게시 상태는 production이며 scope는 `openid`, email, profile만 사용한다.
- Kakao: Kakao Developers 비즈 앱 `ICONS`(앱 ID `1520482`)의 `ICONS Web` REST API 키를 사용한다. Kakao Login과 로그인용 client secret은 ON이고 redirect URI는 Supabase callback이다. `account_email`은 `필수 동의 [수집]`이며 목적은 회원 가입·로그인과 계정 식별이다. Supabase의 `Allow users without an email`은 OFF로 유지한다.
- Apple: primary App ID `com.iconsip.app`, Services ID `com.iconsip.web`을 사용한다. Services ID의 domain은 `sbutbsghcxmxmxgrshwq.supabase.co`, return URL은 Supabase callback이다. Supabase Client IDs에서는 웹용 Services ID를 첫 항목으로 둔다.

OAuth client secret, Apple Team ID·Key ID와 `.p8` 원문은 저장소, 문서, 채팅, 명령 인자에 남기지 않는다. Apple `.p8`은 재다운로드할 수 없으므로 접근 제한된 비밀 저장소에 백업하고, 노출 또는 분실 시 새 키를 발급한 뒤 기존 키를 폐기한다.

현재 Apple OAuth client secret의 만료일은 **2027-01-18**이다. 늦어도 2027-01-04까지 동일한 Services ID로 새 ES256 client secret을 생성해 Supabase Dashboard → Authentication → Sign In / Providers → Apple의 Secret Key를 교체하고, provider가 Enabled인지 확인한 뒤 controlled web login을 검증한다. 새 secret은 최대 6개월만 유효하며 교체가 끝나기 전 기존 키를 폐기하지 않는다.

Production에서 이메일/PW 가입을 운영하려면 Supabase Auth custom SMTP를 활성화하고 Authentication → Rate Limits에서 이메일 전송 한도를 운영 트래픽에 맞춰 조정한다. Supabase 기본 메일 provider는 production 용도가 아니며, 기본 전송량 제한이 강하다. `main` 배포 workflow는 custom SMTP가 비활성화되어 있거나 `smtp_host`, `smtp_port`, `smtp_user`, `smtp_admin_email`이 비어 있으면 production 배포를 실패시킨다. SMTP 비밀번호는 workflow에서 읽거나 출력하지 않고 repo에 커밋하지 않는다.

현재 production 메일 발송은 Supabase Auth → custom SMTP → Resend 경로를 사용한다. `iconsip.com`은 Resend에서 verified domain으로 관리하고, SMTP sender는 `no-reply@iconsip.com`을 기준으로 한다. 도메인 DNS는 Cloudflare에서 관리하며, Vercel 앱 레코드와 Resend DKIM/SPF/DMARC/MX 레코드를 함께 둔다. Resend 계정에 다른 프로젝트 도메인이 함께 있어도 앱별 domain-scoped API key를 분리해서 사용한다.

## Production 도메인과 DNS

- Primary: `https://iconsip.com`
- WWW alias: `https://www.iconsip.com`
- Vercel fallback: `https://icons-ip.vercel.app`

`iconsip.com` DNS는 Cloudflare에서 관리한다. Cloudflare에는 Vercel 연결용 apex/`www` 레코드와 Resend 발송 인증용 DKIM/SPF/DMARC/MX 레코드가 필요하다. Vercel custom domain과 Supabase Auth Site URL은 `iconsip.com`을 기준으로 맞춘다.

## 주요 스크립트

```bash
npm run dev    # 개발 서버
npm run test   # Vitest 단위 테스트
npm run test:goods-payment-local-integration # full local Supabase Auth/API + Fake 결제 통합
npm run lint   # ESLint
npm run typecheck # Next route type 생성 + test 전용 TypeScript 검사
npm run build  # production build
npm run start  # build 결과 실행
npm run hong-sil:download # 홍실퀘스트 신규·누락 이미지 다운로드
```

굿즈 결제 local integration은 `npx supabase start`로 Auth·Data API까지 전체 로컬 스택이 실행 중일 때만 실행한다. DB만 띄우는 CI smoke는 동일한 public seam의 Vitest와 SQL·경합 테스트를 각각 실행하고, 이 full-stack 명령은 로컬 E2E 증거로 분리한다.

### 홍실퀘스트 이미지 다운로더

저작권자에게 허가받은 운영 자료를 갱신할 때 다음 명령을 실행한다. 로컬에 설치된 Google Chrome으로 회차 목록과 이미지 API를 확인하고, 기본적으로 `outputs/hong-sil-quest-webtoon-source/`에 회차별 폴더를 만든다.

```bash
npm run hong-sil:download
```

재실행하면 검증을 통과한 기존 회차와 이미지는 건너뛰고 새 회차, 누락 파일, 손상 파일만 다시 받는다. 이미지 서버가 응답하지 않으면 페이지가 제공한 대체 CDN URL을 순서대로 시도한다. 완료 후 다음 파일로 결과를 확인할 수 있다.

- `source-manifest.json`: 회차, 원문 URL, 페이지별 이미지 출처
- `download-report.json`: 신규·기존·실패 이미지 수와 실패 원인
- `asset-index.json`: 이미지 크기, 포맷, 파일 크기, SHA-256 검증값

다른 목록 URL이나 저장 위치, 동시 요청 수를 지정하려면 `--` 뒤에 옵션을 전달한다.

```bash
npm run hong-sil:download -- \
  --url https://sbxh9.com/webtoon/17586 \
  --output outputs/hong-sil-quest-webtoon-source \
  --concurrency 10
```

`--concurrency`는 1~50을 허용한다. 일부 파일이 끝까지 실패하면 성공한 파일과 보고서는 그대로 보존하고 종료 코드 `1`을 반환하므로, `download-report.json`을 확인한 뒤 같은 명령을 다시 실행하면 된다.

## CI/CD

GitHub Actions는 `CI/CD Pipeline` workflow 하나로 PR 검증(lint/typecheck/test/build/Supabase local lint), Vercel preview 배포, production 배포를 처리한다.

- `pull_request`: `validate` 통과 후 같은 repo 브랜치 PR이면 `deploy-supabase-preview`를 실행하고, 그 다음 `deploy-vercel-preview`를 실행한다. fork PR은 secret 경계 때문에 preview 배포 없이 검증만 실행한다.
- `merge_group`: `validate` job만 실행한다.
- `push` to `main`: `validate` 통과 후 `deploy-supabase`를 실행하고, 그 다음 `deploy-vercel`을 실행한다.
- `workflow_dispatch`: 기본은 `validate`만 실행한다. `production_redeploy=true`와 현재 main의
  exact SHA에서 `deploy-supabase`·`deploy-vercel`이 모두 성공한 push run ID를 함께 전달한 경우에만
  Supabase/Auth mutation 없이 Vercel Production을 설정 변경분으로 다시 배포한다.

Vercel Git 연결은 프로젝트 메타데이터용으로 유지하지만, `vercel.json`의 `git.deploymentEnabled: false`로 Vercel Git 자동 배포는 생성하지 않는다. Preview와 production 배포 경로는 GitHub Actions의 Vercel CLI deploy만 사용한다.

`deploy-supabase`는 Supabase Auth Site URL, shared/recovery Redirect URLs, email link/OTP TTL 3,600초와 confirmation/rate-limit 설정을 먼저 확인·동기화하고, custom SMTP 필수 설정이 누락되면 migration을 원격에 push하기 전에 실패한다. Auth 설정 검증이 끝나면 linked Supabase project에 immutable migration만 push하고, 같은 read-only catalog canary로 production baseline을 즉시 확인한다. 이 단계가 Vercel 배포보다 먼저 실행되므로, 이후 `deploy-vercel` secret preflight나 Vercel 배포가 실패해도 migration과 template를 제외한 Auth 설정은 이미 적용됐을 수 있다. 새 token-hash handler가 Production에 성공적으로 배포된 뒤에만 `deploy-vercel`의 마지막 단계가 version-controlled recovery template를 활성화하고 read-back한다.

배포 workflow에는 다음 GitHub Secrets가 필요하다.

```bash
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
SUPABASE_PREVIEW_PROJECT_ID
SUPABASE_PREVIEW_DB_PASSWORD
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
CRON_SECRET
```

- PR에서는 `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, local Supabase migration reset/lint 후 Vercel preview를 배포한다.
- production의 DB→앱 배포는 `main` push에서만 실행한다. 설정만 바뀐 앱 재배포는 동일 SHA의
  성공한 Production source run을 기계적으로 확인한 위 `workflow_dispatch` 경로만 사용한다.
- GitHub Actions의 앱 빌드는 Node 26을 사용한다. Vercel project/runtime Node.js Version은 Vercel production Functions 공식 지원 범위인 24.x로 유지한다.
- deployment secret 검사는 각 deploy job 안에서 수행한다. 누락 시 job이 즉시 실패하며, 필요한 GitHub Secret을 설정한 뒤 rerun해야 한다.
- `.vercel/` 연결 파일은 commit하지 않고, workflow가 `VERCEL_ORG_ID`와 `VERCEL_PROJECT_ID`로 Vercel 원격 build/deploy를 요청한다.
- Vercel 환경변수는 sensitive 상태로 각 환경에 둔다. production deploy job은 기존 관리자 아트워크용 GitHub `CRON_SECRET`만 Vercel production에 동기화한다. Korpay credential·optional canary actor는 Vercel Production에만 별도 등록하고 GitHub, Preview, CI에는 복제하지 않는다. public 목적별 gate의 기본값은 `false`이며 현재 Production은 굿즈만 `true`, 티켓은 `false`다. 결제 재조정 secret은 workflow가 provision/mutate하지 않으며, 값이 이미 있으면 원격 `prebuild` guard가 형식만 검증한다. Preview에는 현재 legacy Toss 환경변수 잔여가 있지만 신규 checkout을 열지 않고 알려지지 않은 거래를 provider 호출 전에 거부한다. 이 잔여 정리는 Korpay rollout과 분리한다. development 환경변수는 별도 요청 전까지 추가하지 않는다.

## 프리뷰 환경

PR 프리뷰는 **전용 Supabase 프로젝트**를 본다. 결정 배경과 trade-off는 [ADR-0006](docs/adr/0006-preview-supabase-project.md)에 있다. `deploy-supabase-preview`가 프리뷰 배포 전에 마이그레이션을 올리고 카탈로그 seed를 다시 적용하므로, 스키마를 바꾸는 PR도 프리뷰에서 앱과 DB의 버전이 맞는다.

프리뷰 Supabase secret이 없으면 `deploy-vercel-preview`는 **건너뛴다**. 프리뷰가 운영 DB에 붙는 상태로 배포하지 않기 위한 기본값이며, 이유는 workflow warning과 job summary에 남는다.

### 최초 구성

프리뷰 프로젝트는 `icons-ip-preview`(ref `glwypjldklwpgdtymktm`, 조직 `icons`, region `ap-northeast-2`)다. 새로 만들어야 하면 같은 조직·region에 만들고, 프로젝트 하나에 월 $10이 든다.

DB 비밀번호와 service_role 키를 다루는 단계는 사람만 할 수 있다. 위저드가 대시보드를 열어주고, 붙여넣은 값을 GitHub Secrets·Vercel에 넣고, 마지막에 확인까지 한다.

```bash
./scripts/setup-preview-supabase.sh
```

다섯 단계다.

1. 프리뷰 DB 비밀번호 재설정 → `SUPABASE_PREVIEW_DB_PASSWORD` secret.
2. 프리뷰 publishable key와 secret key 복사. `SUPABASE_SERVICE_ROLE_KEY` 자리에는 legacy `service_role` JWT와 새 형식 `sb_secret_…` 둘 다 넣을 수 있다 — 앱은 키를 디코드하지 않고 그대로 넘기며, 두 형식 모두 `service_role` 전용 `service_*` RPC를 실행할 수 있다(로컬 스택에서 네 형식 비교로 실측: anon·publishable은 `42501 permission denied`). **현재 프리뷰는 `sb_secret_…`, 프로덕션은 legacy JWT를 쓴다.** 새 프로젝트에는 새 형식을 쓴다.
3. `SUPABASE_SERVICE_ROLE_KEY`에서 **Preview 스코프 떼어내기.** 지금은 Preview·Production이 같은 항목 하나를 공유하므로 이 단계 전까지 프리뷰가 운영 DB에 붙어 있다. CLI로 지우면 레코드 전체가 사라져 운영 키까지 잃으므로 Vercel 대시보드에서 해야 한다.
4. Vercel **Preview 스코프**의 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 프리뷰 값으로 덮고 `ICONS_CATALOG_SOURCE=supabase`를 추가한다. 프리뷰 공개 화면도 프리뷰 DB를 읽어 실제 스테이징이 된다. `ICONS_PROTOTYPE`은 건드리지 않는다 — 프로토타입 공유 배포가 이 값만 읽는다.
5. GitHub Secrets와 Vercel Preview 환경변수를 확인하고 남은 일을 안내한다.

Auth Site URL, redirect allow-list, recovery template와 email link/OTP TTL은 위저드가 다루지 않는다 — workflow가 위 "Supabase Auth URL 설정" 절의 값으로 맞추고 검증한다.

`SUPABASE_PREVIEW_PROJECT_ID`는 비밀이 아니라 프로젝트 ref라 위저드 밖에서도 넣을 수 있다.

```bash
printf '%s' glwypjldklwpgdtymktm | gh secret set SUPABASE_PREVIEW_PROJECT_ID
```

`public-media`·`admin-artwork-staging` 버킷은 마이그레이션이 만들기 때문에 첫 `supabase db push`에서 함께 생성된다 — 프리뷰에서 어드민 아트워크 업로드까지 QA할 수 있다.

### 구성 확인

프리뷰 배포가 실제로 프리뷰 DB를 보는지는 배포된 번들에서 직접 확인한다. Vercel의 sensitive 환경변수는 값을 다시 읽을 수 없으므로 이 확인이 유일하게 신뢰할 수 있는 방법이다.

```bash
curl -s "$PREVIEW_URL" | grep -o '/_next/static/chunks/[^"]*\.js' | sort -u | while read -r chunk; do curl -s "$PREVIEW_URL$chunk"; done | grep -o 'https://[a-z0-9]\{20\}\.supabase\.co' | sort -u
```

프로덕션 ref가 나오면 Preview 환경변수가 아직 프로덕션을 가리키고 있다는 뜻이다.

## 프로젝트 지도

- `app/`: Next.js App Router 라우트.
- `app/auth/callback/route.ts`: 가입·소셜 로그인 code exchange와 onboarding 처리, recovery exchange fail-closed 포함.
- `app/auth/recovery/callback/route.ts`: 비밀번호 재설정 전용 token-hash 검증, state/user 검증, 세션 정리와 update-password redirect 처리.
- `app/login/actions.ts`: 이메일 로그인/회원가입, Google·Apple·Kakao OAuth 시작, 확인 메일 재전송, 비밀번호 재설정 메일 요청, 로그아웃 server action.
- `app/update-password/`: recovery 세션 재검증, 새 비밀번호 저장, 전역 로그아웃.
- `app/onboarding/actions.ts`: 프로필 완성과 추천 IP 팔로우 저장 server action.
- `app/ip/actions.ts`: IP 팔로우/언팔로우 보호 액션.
- `components/screens/`: 라우트별 화면 컴포넌트.
- `components/shell/`: 전역 내비게이션, 모바일 내비게이션, 푸터, 장바구니 provider.
- `components/ui/`: 화면에서 재사용하는 UI 단위.
- `lib/auth/`: 온보딩 판정, 안전한 next path, Auth 오류 메시지, 서명된 Auth/recovery 쿠키, 서버 auth 상태 helper.
- `lib/catalog.ts`: Supabase 카탈로그 읽기와 mock fallback 변환 계층.
- `lib/catalog-source.ts`: catalog/search source 선택 helper. Vercel Preview mock 기본값과 `ICONS_CATALOG_SOURCE` override를 담당한다.
- `lib/data.ts`: 로컬 fallback mock 데이터와 도메인 타입 출발점.
- `lib/ip-follow*.ts`: IP 팔로우 선택/상태/RPC 연동 helper.
- `lib/routes.ts`: 프로토타입 route-id와 실제 Next.js 경로 매핑.
- `lib/supabase/`: Supabase client/server/middleware 스캐폴딩.
- `supabase/migrations/`: 목표 DB 스키마, RLS, RPC 초안.
- `docs/`: 제품 요구사항, 아키텍처, ADR, agent 운영 문서.

## 핵심 문서

- [CONTEXT.md](./CONTEXT.md): 도메인 용어집. 카드/굿즈, 팔로우/팬덤 가입, 트레이드/마켓/교환 같은 용어 경계를 정의한다.
- [docs/PRD.md](./docs/PRD.md): v1 제품 범위, 출시 단계, 규제/법무 요구사항.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md): 목표 아키텍처, Supabase/TossPayments/RPC 경계, mock에서 real로 가는 이전 경로.
- [docs/adr/0001-paid-digital-gacha.md](./docs/adr/0001-paid-digital-gacha.md): 디지털 유료 가챠 채택과 규제 의무 수용 결정.
- [AGENTS.md](./AGENTS.md): Codex/agent 작업 규칙.

## 작업 경계

- 공개 브라우징이 기본이다. IP, 굿즈, 카드, 이벤트, 커뮤니티 읽기는 로그인 없이 접근 가능해야 한다.
- 보호 액션은 구매, 가챠, 예매, 작성, 팔로우 시점에 로그인 게이트를 둔다.
- `/exchange`와 `/market`은 v2 전까지 프로토타입/플레이스홀더로 유지한다.
- 돈, 재고, 가챠 RNG, 천장, 티켓 검표는 클라이언트 상태에 맡기지 않는다. Supabase Postgres RPC, RLS, 행 잠금, 멱등 처리를 기준으로 구현한다.
- 결제 확정은 provider-neutral `PaymentGateway.confirm/reconcile` 결과와 DB finalizer를 진실원으로 삼는다. 기존 Toss 거래만 provider 재조회·웹훅 계약을 유지하며, 어느 경로도 클라이언트 성공 콜백만으로 주문·티켓을 확정하지 않는다.
- Next.js 16 관련 API, 라우팅, proxy/middleware, metadata, caching 코드를 수정하기 전에는 `node_modules/next/dist/docs/`의 현재 버전 문서를 확인한다.

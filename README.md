# ICONS

ICONS는 서브컬처 팬덤을 위한 슈퍼앱 프로토타입이다. 공식 라이선스 **굿즈** 커머스, 수집형 디지털 **카드**(가챠), 팝업 티케팅, 커뮤니티, IP 허브를 하나의 "Holographic Midnight" 경험으로 묶는다.

## 현재 상태

- Next.js 16, React 19, Tailwind v4 기반 App Router 프로젝트다.
- Claude Design 핸드오프를 옮긴 시각적 프로토타입에서 출발했다.
- 화면은 `app/**/page.tsx`가 `components/screens/*` 컴포넌트를 렌더링하는 구조다.
- 공개 카탈로그(IP, 굿즈, 카드, 이벤트)는 Supabase 환경변수가 있으면 DB를 읽고, 로컬 개발에서 환경변수가 없으면 `lib/data.ts` mock으로 fallback한다. Vercel Preview는 새 static mock catalog 확인을 위해 기본적으로 mock을 사용한다.
- Supabase Auth/SSR은 이메일/비밀번호 가입·로그인, 확인 메일 콜백·재전송, 비밀번호 재설정 요청·콜백·새 비밀번호 저장·전역 로그아웃, 온보딩 완료 게이트와 IP 팔로우 보호 액션에 연결되어 있다. 환경변수가 없으면 인증 폼은 비활성화되고 세션 갱신은 no-op으로 동작한다.
- 커뮤니티 공개 피드는 Supabase `posts`/`public_profiles`와 최근 7일 visible 포스트의 트렌딩 태그를 읽고, 로그인·온보딩 완료 사용자는 텍스트, 태그, 선택 이미지를 포함한 포스트를 작성할 수 있다. 댓글, 좋아요, 작성자 삭제, 신고, 차단도 Server Action + RPC로 연결되어 있다.
- 검색은 Supabase 환경변수가 있으면 Postgres `search_public_content` RPC로 IP, 굿즈, 카드, visible 포스트, 태그를 그룹 검색하고, 로컬 fallback에서는 mock 데이터를 사용한다.
- `/admin`은 staff/admin 게이트, 카탈로그 CRUD·보관/복원·아트워크 업로드, 카드풀 운영 기간·등급별 발급 확률·카드 풀 바인딩, 뽑기권 발급 정책, 카드 보상형 참여형 게임 등록·운영과 PII-free 플레이 집계, 감사 로그, 커뮤니티 신고 상태 변경과 포스트 숨김 처리 경로에 연결되어 있다. 기존 굿즈 variant는 #115 전까지 읽기 전용이다.
- Google, Kakao, Apple 버튼은 Supabase 관리형 OAuth Server Action에 연결되어 있고 production Supabase provider도 모두 활성화되어 있다. Google은 production 공개 상태이며 Apple App ID·Services ID·callback·서명 키 구성이 완료됐다. Kakao는 `(주) 아이콘스` 비즈 앱, 로그인용 client secret, `account_email` 필수 동의·계정 정보 수집까지 설정했고 Supabase의 이메일 없는 사용자 허용은 꺼져 있다. 코드가 production에 배포된 뒤 controlled login smoke가 남아 있다.
- 굿즈·티켓 결제와 주문 원장, 티켓 현장 검표는 서버 경계에 연결되어 있다. production 실제 결제는 라이브 상점 설정 검증 전까지 비활성이다. 단, 승인된 사람 검토 동안에만 토스 테스트 결제위젯을 임시로 열 수 있으며 테스트 결제는 실제 결제수단을 출금하지 않는다.

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
CRON_SECRET=
```

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase 프로젝트 URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable public key. 새 프로젝트는 이 값을 우선 사용한다.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: legacy Supabase anon public key. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`가 없을 때 fallback으로만 사용한다.
- `ICONS_CATALOG_SOURCE`: 서버 전용 catalog/search source override. 값은 `mock` 또는 `supabase`만 허용한다. 비워두면 Vercel Preview는 `mock`, Supabase 환경변수가 있는 production/local은 `supabase`, Supabase 환경변수가 없으면 `mock`을 쓴다.
- `AUTH_SIGNUP_RESEND_SECRET`: 회원가입 확인 메일 재전송 상태, 인증 `next`, 비밀번호 재설정 요청 제한 쿠키를 domain-separated HMAC으로 서명하는 서버 전용 secret. 긴 랜덤 값을 사용하고 `NEXT_PUBLIC_` prefix를 붙이지 않는다.
- `CRON_SECRET`: production Vercel Cron이 만료된 관리자 아트워크 staging 객체를 정리할 때 쓰는 서버 전용 bearer secret. 16~128자의 URL-safe 랜덤 값을 사용하고 preview에는 필요하지 않다.

### Production 토스 테스트 결제 검토 모드 (임시)

`iconsip.com`에서 사람 검토를 해야 할 때만, Vercel Production 환경변수에 Preview/로컬에서 검증한 결제위젯 세트의 `NEXT_PUBLIC_TOSS_CLIENT_KEY=test_gck_…`, `TOSS_SECRET_KEY=test_gsk_…`, 가상계좌를 제외한 테스트 UI의 `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY=ICONS_REVIEW`, 두 원문 키 값의 승인된 SHA-256인 `TOSS_PAYMENT_KEY_PAIR_SHA256`, 서버 전용 `ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION=true`를 함께 설정한다. override는 정확히 소문자 `true`, variantKey는 정확히 `ICONS_REVIEW`여야 하며, 키 모드·variantKey·지문이 틀리거나 누락되면 fail closed로 결제를 열지 않는다. 이 기간에는 정지되지 않은 `staff`/`admin` 계정만 주문·예매 생성과 승인·웹훅 확정을 진행할 수 있고, 그 밖의 계정이 우회해 만든 승인 건은 자동 취소한다. 테스트 결제는 실제 결제수단을 출금하지 않는다.

이 모드는 라이브 상점 검증을 대체하지 않는 임시 검토용이다. 검토 승인 뒤에는 `ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION`과 테스트 전용 `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY`를 제거하고, 동일한 결제위젯 세트의 `live_gck_…`/`live_gsk_…` 키와 그 지문을 복원한 다음 production 배포로 확인한다. 라이브 키는 override 없이 기본 UI로 정상 동작한다.

URL과 public key 둘 중 하나라도 없으면 인증 미들웨어는 세션 갱신을 건너뛰고, 공개 카탈로그는 로컬 개발용 mock 데이터로 fallback한다. `AUTH_SIGNUP_RESEND_SECRET`이 없으면 회원가입 재전송 제한과 서명된 `next` 보존을 신뢰할 수 없으며, 비밀번호 재설정 요청은 fail closed한다. Vercel preview와 production 배포는 Supabase 공개 환경변수 또는 이 secret이 없으면 workflow preflight에서 실패한다.

## Supabase Auth URL 설정

Auth URL 설정은 손으로 관리하지 않는다. `scripts/sync-supabase-auth.mjs`가 진실원이고, workflow가 production과 preview 프로젝트에 각각 적용·검증한다. 대시보드에서 직접 바꾼 값은 다음 배포에서 되돌아간다.

**Production** (`deploy-supabase`, `main` push):

- Site URL: `https://iconsip.com`
- Redirect URLs: `https://iconsip.com/auth/callback`, `https://www.iconsip.com/auth/callback`, `https://icons-ip.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`, `http://127.0.0.1:3000/auth/callback`
- 제거 대상: `https://icons-ip-*.vercel.app/auth/callback`. preview가 전용 프로젝트를 보게 된 뒤로는 운영 allow-list에 있을 이유가 없고, 애초에 실제 preview 호스트와 맞지도 않았다(아래).

**Preview** (`deploy-supabase-preview`, PR):

- Site URL: `https://icons-ip.vercel.app`
- Redirect URLs: `https://icons-ip.vercel.app/auth/callback`, `https://icons-hongshil-vn.vercel.app/auth/callback`, `https://icons-*-sangwopark19icons-1055s-projects.vercel.app/auth/callback`, `https://icons-git-*-sangwopark19icons-1055s-projects.vercel.app/auth/callback`, local callback
- preview 배포 호스트는 프로젝트 이름(`icons-ip`)이 아니라 **배포 접두 `icons-`**를 쓴다 — `icons-nb9vdpqs8-sangwopark19icons-1055s-projects.vercel.app` 형태다. 그래서 `icons-ip-*` 패턴은 어떤 preview URL과도 매칭되지 않았다. 팀 접미까지 붙여 좁힌다: `icons-*.vercel.app`은 남의 프로젝트까지 허용한다.
- preview에는 custom SMTP가 없어 SMTP 강제와 mailer 설정 강제를 켜지 않는다. 이메일 확인이 필요한 가입 플로우는 preview에서 끝까지 갈 수 없다.

Production의 가입 확인·비밀번호 재설정 메일은 allow-list와 정확히 맞도록 query 없는 `/auth/callback`만 사용한다. Server Action은 안전한 `next`, 목적, 발급 시각을 서명된 `icons_auth_next` httpOnly 쿠키에 보존하며 일반 가입은 10분, recovery는 1시간 동안 신뢰한다.

Server Action이 만드는 callback origin은 production·www·기본 Vercel·local 고정 origin과 플랫폼이 제공한 현재 `VERCEL_URL`만 허용한다. 인식하지 못한 `Origin`·`X-Forwarded-Host`·`Host`는 신뢰하지 않고 `https://iconsip.com`으로 닫는다.

비밀번호 재설정 요청은 계정 존재 여부와 무관하게 같은 응답을 반환한다. 같은 브라우저의 정규화 이메일별 요청은 raw email 대신 HMAC digest를 담은 `icons_auth_password_reset` 쿠키로 총 3회/10분 제한하고, 활성 이메일 bucket은 12개로 제한해 브라우저 cookie 크기를 넘지 않게 한다. Supabase provider rate limit은 실제 상한으로 둔다. PKCE verifier도 요청 브라우저에 저장되므로 최신 메일 링크는 재설정을 요청한 브라우저에서 열어야 한다.

Recovery callback은 code exchange 뒤 `getUser()`로 세션을 재검증하고 온보딩 여부와 무관하게 `/update-password`로 보낸다. 브라우저가 redirect 응답의 세션 cookie를 첫 SSR 요청보다 늦게 반영하면 callback이 붙인 1회성 `session_ready` 표식으로 전체 탐색을 한 번 다시 수행하며, 세션 확인 전에는 비밀번호 폼을 노출하지 않는다. 새 비밀번호 저장 뒤 global sign-out을 완료하면 `/login?password_reset=success`로 이동한다. 일반 가입 callback은 기존 온보딩 게이트를 유지하고, 회원가입 확인 메일 재전송은 서명된 httpOnly 쿠키로 3회/10분 window를 추적한 뒤 Supabase `auth.resend({ type: 'signup' })`를 사용한다. `main` 배포 workflow는 Site URL, Redirect URLs, 이메일 confirmation, 보안 이메일 변경, 이메일 전송 rate limit을 확인하고 누락 시 보정한다.

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
npm run lint   # ESLint
npm run build  # production build
npm run start  # build 결과 실행
npm run hong-sil:download # 홍실퀘스트 신규·누락 이미지 다운로드
```

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

GitHub Actions는 `CI/CD Pipeline` workflow 하나로 PR 검증(lint/test/build/Supabase local lint), Vercel preview 배포, production 배포를 처리한다.

- `pull_request`: `validate` 통과 후 같은 repo 브랜치 PR이면 `deploy-supabase-preview`를 실행하고, 그 다음 `deploy-vercel-preview`를 실행한다. fork PR은 secret 경계 때문에 preview 배포 없이 검증만 실행한다.
- `merge_group`: `validate` job만 실행한다.
- `push` to `main`: `validate` 통과 후 `deploy-supabase`를 실행하고, 그 다음 `deploy-vercel`을 실행한다.
- `workflow_dispatch`: 수동 실행용 trigger다. 현재 수동 실행에서는 `validate`만 실행된다.

Vercel Git 연결은 프로젝트 메타데이터용으로 유지하지만, `vercel.json`의 `git.deploymentEnabled: false`로 Vercel Git 자동 배포는 생성하지 않는다. Preview와 production 배포 경로는 GitHub Actions의 Vercel CLI deploy만 사용한다.

`deploy-supabase`는 Supabase Auth Site URL, Redirect URLs, confirmation/rate-limit 설정을 production callback 설정으로 먼저 확인·동기화하고, custom SMTP 필수 설정이 누락되면 migration을 원격에 push하기 전에 실패한다. Auth 설정 검증이 끝나면 linked Supabase project에 immutable migration만 push하고, 같은 read-only catalog canary로 production baseline을 즉시 확인한다. 이 단계가 Vercel 배포보다 먼저 실행되므로, 이후 `deploy-vercel` secret preflight나 Vercel 배포가 실패해도 Supabase migration과 Auth 설정은 이미 적용됐을 수 있다.

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

- PR에서는 `npm run lint`, `npm run build`, local Supabase migration reset/lint 후 Vercel preview를 배포한다.
- production 배포는 `main` push에서만 실행한다.
- GitHub Actions의 앱 빌드는 Node 26을 사용한다. Vercel project/runtime Node.js Version은 Vercel production Functions 공식 지원 범위인 24.x로 유지한다.
- deployment secret 검사는 각 deploy job 안에서 수행한다. 누락 시 job이 즉시 실패하며, 필요한 GitHub Secret을 설정한 뒤 rerun해야 한다.
- `.vercel/` 연결 파일은 commit하지 않고, workflow가 `VERCEL_ORG_ID`와 `VERCEL_PROJECT_ID`로 Vercel 원격 build/deploy를 요청한다.
- Vercel 환경변수는 sensitive 상태로 preview와 production에 둔다. production deploy job은 GitHub `CRON_SECRET`을 Vercel production sensitive env에 stdin으로 동기화한 뒤 배포한다. 원격 build 안의 `prebuild` guard가 Supabase/Auth/결제 필수 변수, production `CRON_SECRET`, 토스 결제위젯 키 모드와 임시 테스트 결제 override를 검증하며 누락·불일치 시 배포를 실패시킨다. development 환경변수는 별도 요청 전까지 추가하지 않는다.

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

Auth Site URL과 redirect allow-list는 위저드가 다루지 않는다 — workflow가 위 "Supabase Auth URL 설정" 절의 값으로 맞추고 검증한다.

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
- `app/auth/callback/route.ts`: Supabase Auth code exchange와 가입·소셜 로그인/onboarding 또는 recovery/update-password redirect 처리.
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

- [CONTEXT.md](./CONTEXT.md): 도메인 용어집. 카드/굿즈, 팔로우/팬덤 가입, 교환/마켓 같은 용어 경계를 정의한다.
- [docs/PRD.md](./docs/PRD.md): v1 제품 범위, 출시 단계, 규제/법무 요구사항.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md): 목표 아키텍처, Supabase/TossPayments/RPC 경계, mock에서 real로 가는 이전 경로.
- [docs/adr/0001-paid-digital-gacha.md](./docs/adr/0001-paid-digital-gacha.md): 디지털 유료 가챠 채택과 규제 의무 수용 결정.
- [AGENTS.md](./AGENTS.md): Codex/agent 작업 규칙.

## 작업 경계

- 공개 브라우징이 기본이다. IP, 굿즈, 카드, 이벤트, 커뮤니티 읽기는 로그인 없이 접근 가능해야 한다.
- 보호 액션은 구매, 가챠, 예매, 작성, 팔로우 시점에 로그인 게이트를 둔다.
- `/exchange`와 `/market`은 v2 전까지 프로토타입/플레이스홀더로 유지한다.
- 돈, 재고, 가챠 RNG, 천장, 티켓 검표는 클라이언트 상태에 맡기지 않는다. Supabase Postgres RPC, RLS, 행 잠금, 멱등 처리를 기준으로 구현한다.
- 결제 확정의 진실원은 토스페이먼츠 웹훅이다. 클라이언트 성공 콜백만으로 주문, 충전, 티켓을 확정하지 않는다.
- Next.js 16 관련 API, 라우팅, proxy/middleware, metadata, caching 코드를 수정하기 전에는 `node_modules/next/dist/docs/`의 현재 버전 문서를 확인한다.

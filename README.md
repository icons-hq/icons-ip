# ICONS

ICONS는 서브컬처 팬덤을 위한 슈퍼앱 프로토타입이다. 공식 라이선스 **굿즈** 커머스, 수집형 디지털 **카드**(가챠), 팝업 티케팅, 커뮤니티, IP 허브를 하나의 "Holographic Midnight" 경험으로 묶는다.

## 현재 상태

- Next.js 16, React 19, Tailwind v4 기반 App Router 프로젝트다.
- Claude Design 핸드오프를 옮긴 시각적 프로토타입에서 출발했다.
- 화면은 `app/**/page.tsx`가 `components/screens/*` 컴포넌트를 렌더링하는 구조다.
- 공개 카탈로그(IP, 굿즈, 카드, 이벤트)는 Supabase 환경변수가 있으면 DB를 읽고, 로컬 개발에서 환경변수가 없으면 `lib/data.ts` mock으로 fallback한다. Vercel Preview는 새 static mock catalog 확인을 위해 기본적으로 mock을 사용한다.
- Supabase Auth/SSR은 이메일/비밀번호 가입·로그인, 확인 메일 콜백·재전송, 비밀번호 재설정 요청·콜백·새 비밀번호 저장·전역 로그아웃, 온보딩 완료 게이트와 IP 팔로우 보호 액션에 연결되어 있다. 환경변수가 없으면 인증 폼은 비활성화되고 세션 갱신은 no-op으로 동작한다.
- 커뮤니티 공개 피드는 Supabase `posts`/`public_profiles`를 읽고, 로그인·온보딩 완료 사용자는 텍스트, 태그, 선택 이미지를 포함한 포스트를 작성할 수 있다. 댓글, 좋아요, 작성자 삭제, 신고, 차단도 Server Action + RPC로 연결되어 있다.
- 검색은 Supabase 환경변수가 있으면 Postgres `search_public_content` RPC로 IP, 굿즈, 카드, visible 포스트, 태그를 그룹 검색하고, 로컬 fallback에서는 mock 데이터를 사용한다.
- `/admin`은 staff/admin 게이트, 카탈로그 CRUD, 카드풀 운영 기간·등급별 발급 확률·카드 풀 바인딩, 뽑기권 발급 정책, 카드 보상형 참여형 게임 등록·운영과 PII-free 플레이 집계, 감사 로그, 커뮤니티 신고 상태 변경과 포스트 숨김 처리 경로에 연결되어 있다. 기존 굿즈 variant는 #115 전까지 읽기 전용이다.
- Google, Kakao, Apple 버튼은 UI 자리만 있으며 아직 비활성화되어 있다.
- 굿즈·티켓 결제와 주문 원장, 티켓 현장 검표는 서버 경계에 연결되어 있다. production 실제 결제는 라이브 상점 설정 검증 전까지 비활성이다.

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
```

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase 프로젝트 URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable public key. 새 프로젝트는 이 값을 우선 사용한다.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: legacy Supabase anon public key. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`가 없을 때 fallback으로만 사용한다.
- `ICONS_CATALOG_SOURCE`: 서버 전용 catalog/search source override. 값은 `mock` 또는 `supabase`만 허용한다. 비워두면 Vercel Preview는 `mock`, Supabase 환경변수가 있는 production/local은 `supabase`, Supabase 환경변수가 없으면 `mock`을 쓴다.
- `AUTH_SIGNUP_RESEND_SECRET`: 회원가입 확인 메일 재전송 상태, 인증 `next`, 비밀번호 재설정 요청 제한 쿠키를 domain-separated HMAC으로 서명하는 서버 전용 secret. 긴 랜덤 값을 사용하고 `NEXT_PUBLIC_` prefix를 붙이지 않는다.

URL과 public key 둘 중 하나라도 없으면 인증 미들웨어는 세션 갱신을 건너뛰고, 공개 카탈로그는 로컬 개발용 mock 데이터로 fallback한다. `AUTH_SIGNUP_RESEND_SECRET`이 없으면 회원가입 재전송 제한과 서명된 `next` 보존을 신뢰할 수 없으며, 비밀번호 재설정 요청은 fail closed한다. Vercel preview와 production 배포는 Supabase 공개 환경변수 또는 이 secret이 없으면 workflow preflight에서 실패한다.

## Supabase Auth URL 설정

이메일 회원가입 확인 링크와 비밀번호 재설정 링크가 앱 세션으로 교환되려면 Supabase Dashboard → Authentication → URL Configuration에서 다음 값을 유지한다.

- Site URL: `https://iconsip.com`
- Redirect URLs:
  - `https://iconsip.com/auth/callback`
  - `https://www.iconsip.com/auth/callback`
  - `https://icons-ip.vercel.app/auth/callback`
  - `https://icons-ip-*.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback`
  - `http://127.0.0.1:3000/auth/callback`

Production의 가입 확인·비밀번호 재설정 메일은 allow-list와 정확히 맞도록 query 없는 `/auth/callback`만 사용한다. `iconsip.com`을 기본 Site URL로 쓰고, `www.iconsip.com`과 Vercel 기본 도메인 `icons-ip.vercel.app`도 같은 callback 경로로 허용하며, Vercel preview는 wildcard callback을 허용한다. Server Action은 안전한 `next`, 목적, 발급 시각을 서명된 `icons_auth_next` httpOnly 쿠키에 보존하며 일반 가입은 10분, recovery는 1시간 동안 신뢰한다.

Server Action이 만드는 callback origin은 production·www·기본 Vercel·local 고정 origin과 플랫폼이 제공한 현재 `VERCEL_URL`만 허용한다. 인식하지 못한 `Origin`·`X-Forwarded-Host`·`Host`는 신뢰하지 않고 `https://iconsip.com`으로 닫는다.

비밀번호 재설정 요청은 계정 존재 여부와 무관하게 같은 응답을 반환한다. 같은 브라우저의 정규화 이메일별 요청은 raw email 대신 HMAC digest를 담은 `icons_auth_password_reset` 쿠키로 총 3회/10분 제한하고, 활성 이메일 bucket은 12개로 제한해 브라우저 cookie 크기를 넘지 않게 한다. Supabase provider rate limit은 실제 상한으로 둔다. PKCE verifier도 요청 브라우저에 저장되므로 최신 메일 링크는 재설정을 요청한 브라우저에서 열어야 한다.

Recovery callback은 code exchange 뒤 `getUser()`로 세션을 재검증하고 온보딩 여부와 무관하게 `/update-password`로 보낸다. 브라우저가 redirect 응답의 세션 cookie를 첫 SSR 요청보다 늦게 반영하면 callback이 붙인 1회성 `session_ready` 표식으로 전체 탐색을 한 번 다시 수행하며, 세션 확인 전에는 비밀번호 폼을 노출하지 않는다. 새 비밀번호 저장 뒤 global sign-out을 완료하면 `/login?password_reset=success`로 이동한다. 일반 가입 callback은 기존 온보딩 게이트를 유지하고, 회원가입 확인 메일 재전송은 서명된 httpOnly 쿠키로 3회/10분 window를 추적한 뒤 Supabase `auth.resend({ type: 'signup' })`를 사용한다. `main` 배포 workflow는 Site URL, Redirect URLs, 이메일 confirmation, 보안 이메일 변경, 이메일 전송 rate limit을 확인하고 누락 시 보정한다.

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
```

## CI/CD

GitHub Actions는 `CI/CD Pipeline` workflow 하나로 PR 검증(lint/test/build/Supabase local lint), Vercel preview 배포, production 배포를 처리한다.

- `pull_request`: `validate` 통과 후 같은 repo 브랜치 PR이면 `deploy-vercel-preview`를 실행한다. fork PR은 secret 경계 때문에 preview 배포 없이 검증만 실행한다.
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
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

- PR에서는 `npm run lint`, `npm run build`, local Supabase migration reset/lint 후 Vercel preview를 배포한다.
- production 배포는 `main` push에서만 실행한다.
- GitHub Actions의 앱 빌드는 Node 26을 사용한다. Vercel project/runtime Node.js Version은 Vercel production Functions 공식 지원 범위인 24.x로 유지한다.
- deployment secret 검사는 각 deploy job 안에서 수행한다. 누락 시 job이 즉시 실패하며, 필요한 GitHub Secret을 설정한 뒤 rerun해야 한다.
- `.vercel/` 연결 파일은 commit하지 않고, workflow가 `VERCEL_ORG_ID`와 `VERCEL_PROJECT_ID`로 Vercel 원격 build/deploy를 요청한다.
- Vercel 환경변수는 sensitive 상태로 preview와 production에 둔다. 원격 build 안의 `prebuild` guard가 Supabase/Auth/결제 필수 변수와 토스 결제위젯 키 모드를 검증하며, 누락·불일치 시 배포를 실패시킨다. development 환경변수는 별도 요청 전까지 추가하지 않는다.

## 프로젝트 지도

- `app/`: Next.js App Router 라우트.
- `app/auth/callback/route.ts`: Supabase Auth code exchange와 가입/onboarding 또는 recovery/update-password redirect 처리.
- `app/login/actions.ts`: 이메일 로그인/회원가입, 확인 메일 재전송, 비밀번호 재설정 메일 요청, 로그아웃 server action.
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

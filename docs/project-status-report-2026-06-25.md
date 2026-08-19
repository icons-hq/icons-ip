# ICONS 프로젝트 현황 보고서

> **Historical snapshot — 2026-06-25 시점 기록.** 현재 제품 범위·구현 상태·법무 gate는 [`PRD.md`](./PRD.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [ADR-0003](./adr/0003-free-reward-pivot.md), [ADR-0004](./adr/0004-draw-ticket-card-packs.md)를 따른다. 이 문서의 유료 가챠·지갑과 미연결 쓰기 흐름 설명은 superseded됐으며 현행 상태로 사용하지 않는다. 편집 전 원문은 [`_archive/project-status-report-2026-06-25.original.md`](./_archive/project-status-report-2026-06-25.original.md)에 보존돼 있다.

작성일: 2026-06-25 KST
대상 저장소: `/Users/sangwopark19/icons/icons-ip`
기준 브랜치: `main` (`origin/main`과 동기화 상태에서 확인 시작)
최근 커밋: `32b327b feat(community): 댓글과 좋아요 반응을 구현 (#32)`

## 1. 요약

ICONS는 서브컬처 팬덤 슈퍼앱 프로토타입에서 실제 서비스 구조로 전환 중인 Next.js 16 애플리케이션이다. 현재 제품의 중심 범위는 공식 라이선스 굿즈, 수집형 디지털 카드, 팝업/티케팅, 커뮤니티, IP 허브다.

현재 구현 상태를 한 줄로 정리하면 다음과 같다.

- P0 기반 영역은 상당 부분 실제 Supabase backend와 연결되어 있다.
- 공개 카탈로그, 이메일/PW Auth, 이메일 확인 콜백, 온보딩, IP 팔로우, 커뮤니티 포스트/댓글/좋아요, 관리자 카탈로그 upsert는 실제 구현이 있다.
- P1~P3의 커머스, 가챠, 티케팅은 DB 스키마와 핵심 RPC가 준비되어 있으나, 사용자 화면과 결제 웹훅 Route Handler 연결은 아직 없다.
- 검색, 교환, 마켓은 현재 mock/prototype 성격이 강하다.
- 검증은 `npm run test`, `npm run lint`, `npm run build` 모두 통과했다.

## 2. 전체 상태

| 영역 | 현재 상태 | 판단 |
|---|---|---|
| 프레임워크 | Next.js 16.2.9, React 19.2.4, Tailwind v4 | 최신 구조 기반 |
| 라우팅 | App Router, `app/**/page.tsx`가 `components/screens/*` 렌더링 | 구조 안정 |
| 디자인 시스템 | `app/globals.css`의 Holographic Midnight 스타일 유지 | 시각 프로토타입 완성도 높음 |
| 공개 카탈로그 | Supabase 환경변수 있으면 DB, 없으면 `lib/data.ts` fallback | 실제 연결됨 |
| 인증 | Supabase Auth 이메일/PW, callback, 온보딩 게이트 | 실제 연결됨 |
| 소셜 로그인 | Google/Kakao/Apple 버튼은 비활성 UI | 미구현 |
| IP 팔로우 | Server Action + `follow_ip`/`unfollow_ip` RPC | 실제 연결됨 |
| 커뮤니티 | 포스트 작성, 이미지 업로드, 댓글, 좋아요, 작성자 삭제 | 실제 연결됨 |
| 관리자 | staff/admin 게이트 + 카탈로그 IP/굿즈/카드/이벤트 upsert | 부분 구현 |
| 커머스 | DB/RPC 존재, 화면은 굿즈 목록 + local cart count | 미연결 |
| 가챠/지갑 | DB/RPC 존재, 바인더 화면은 catalog/mock 중심 | 미연결 |
| 티케팅 | DB/RPC 존재, 이벤트 화면은 목록/CTA 중심 | 미연결 |
| 검색 | `DATA` mock 기반 클라이언트 검색 | 미연결 |
| 교환/마켓 | v2 범위 prototype/mock 화면 | v2 placeholder |
| CI/CD | GitHub Actions validate/deploy workflow 존재 | 구성됨 |

## 3. 기술 스택과 런타임

### 3.1 애플리케이션

- Next.js `16.2.9`
- React `19.2.4`
- TypeScript strict
- Tailwind CSS v4
- Supabase JS `^2.108.2`
- Supabase SSR `^0.12.0`
- Vitest `^4.1.9`

주요 스크립트:

| 명령 | 용도 | 현재 결과 |
|---|---|---|
| `npm run test` | Vitest 단위 테스트 | 9 files / 84 tests 통과 |
| `npm run lint` | ESLint | 통과 |
| `npm run build` | Next production build | 통과 |
| `npm run dev` | 로컬 개발 서버 | 미실행 |

### 3.2 Next.js 16 구조

현재 앱은 Next.js 16의 `proxy.ts`를 사용한다. 루트 `proxy.ts`는 모든 일반 요청에서 `lib/supabase/middleware.ts`의 `updateSession()`을 호출해 Supabase 세션을 갱신한다.

중요한 설계점:

- middleware/proxy 레벨에서 비로그인 사용자를 redirect하지 않는다.
- 공개 브라우징 정책에 따라 로그인 요구는 보호 액션 시점에서 처리한다.
- 정적 asset, `_next/static`, `_next/image`, favicon, 이미지 확장자는 proxy matcher에서 제외한다.

## 4. 백엔드 인프라

### 4.1 Supabase 구성

Supabase는 현재 다음 역할을 담당한다.

- Auth: 이메일/비밀번호 로그인, 회원가입, 이메일 확인 링크, session cookie 교환
- Postgres: 도메인 데이터, RLS, RPC, 감사 로그
- Storage: 공개 catalog media와 사용자 업로드
- RLS: 사용자별 데이터 격리와 staff/admin 권한 제어

환경변수:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` fallback
- `AUTH_SIGNUP_RESEND_SECRET`

환경변수가 없으면 공개 카탈로그는 mock data로 fallback하고, 인증 UI는 비활성/오류 메시지 상태로 동작한다.

### 4.2 Supabase Auth

구현 파일:

- `app/login/actions.ts`
- `app/auth/callback/route.ts`
- `app/onboarding/actions.ts`
- `lib/auth/onboarding.ts`
- `lib/auth/server.ts`
- `lib/supabase/server.ts`
- `lib/supabase/middleware.ts`

구현 상세:

- 이메일/PW 로그인은 `supabase.auth.signInWithPassword()`를 사용한다.
- 회원가입은 `supabase.auth.signUp()`을 사용한다.
- 확인 메일 callback은 `/auth/callback`에서 `exchangeCodeForSession()`으로 session을 수립한다.
- 보호 액션에서 온 `next` 경로는 safe path 검증을 거친다.
- 이메일 확인 callback에서 query 없는 allow-list URL을 쓰기 위해 `next`는 `icons_auth_next` httpOnly cookie로 보존한다.
- 회원가입 확인 메일 재전송 상태는 `icons_auth_signup_resend` httpOnly cookie에 HMAC 서명된 payload로 저장한다.
- 같은 브라우저에서 같은 이메일에 대해 10분 window, 최대 3회 재요청 제한을 둔다.
- 온보딩 완료 여부는 이메일, 닉네임, 생년월일, 필수 동의, `onboarded_at`으로 판단한다.

미구현:

- Google/Kakao/Apple OAuth provider 연결
- 계정 삭제
- 동의 철회 UI/flow
- PASS 본인인증

### 4.3 Postgres/RLS/RPC

마이그레이션은 `supabase/migrations/`에 9개가 있다.

| 파일 | 범위 |
|---|---|
| `20260617090001_p0_foundation.sql` | 프로필, 공개 카탈로그, 커뮤니티, 검색 index, Storage bucket, RLS |
| `20260617090002_p1_commerce.sql` | 장바구니, 주문, 결제, 환불, 재고 RPC |
| `20260617090003_p2_gacha.sql` | 지갑, 장부, 카드풀, 확률, 천장, 가챠 RPC |
| `20260617090004_p3_ticketing.sql` | 티켓 회차, 예매, 전자티켓, 검표, 환불 RPC |
| `20260623090001_ip_follow_rpc.sql` | IP 팔로우/언팔로우 RPC와 follower count 갱신 |
| `20260624090001_community_visible_upload_read.sql` | visible post 이미지 공개 읽기 정책 |
| `20260624093001_community_reaction_counts.sql` | 커뮤니티 반응 count RPC |
| `20260624100001_admin_catalog_crud.sql` | 관리자 카탈로그 upsert RPC와 audit log |
| `20260624103001_community_comment_like_actions.sql` | 댓글/좋아요/삭제 RPC |

핵심 설계:

- 공개 카탈로그는 anon read 가능.
- 사용자별 데이터는 본인 또는 staff/admin만 read.
- 돈, 재고, 가챠, 티켓은 직접 table write가 아니라 `SECURITY DEFINER` RPC로 처리한다.
- 웹훅 확정 성격의 RPC는 `service_role` execute 권한을 전제로 한다.
- 관리자 write는 audited RPC로만 수행한다.
- `audit_log`는 staff read, write는 RPC/service role 경계다.

### 4.4 Storage

버킷:

- `public-media`: 공개 catalog/IP/goods/card/event artwork
- `user-uploads`: 커뮤니티/프로필 사용자 업로드용 private bucket

현재 앱 연결:

- catalog row의 `image_path`는 `public-media` public URL로 변환한다.
- 커뮤니티 업로드는 `<user_id>/community/<uuid>.<ext>` 경로로 저장한다.
- 커뮤니티 feed는 visible post에 연결된 `user-uploads` 객체만 signed URL로 렌더링한다.
- 업로드 파일은 JPEG/PNG/WebP/GIF, 5MB 이하만 허용한다.

### 4.5 CI/CD와 배포

구현 파일:

- `.github/workflows/pipeline.yml`
- `vercel.json`

CI/CD 흐름:

- `pull_request`: validate 후 같은 repo branch PR이면 Vercel preview deploy
- `merge_group`: validate만 실행
- `push` to `main`: validate → Supabase deploy → Vercel production deploy
- `workflow_dispatch`: 현재 validate 중심

validate job:

- Node 26 설치
- `npm ci`
- `npm run lint`
- `npm run test`
- `npm run build`
- Supabase CLI 설치
- local Supabase DB start/reset
- 커뮤니티 DB smoke test 실행
- `supabase db lint --local --fail-on error`

production deploy:

- Supabase Auth Site URL/Redirect URL을 확인하고 필요 시 Management API로 동기화한다.
- custom SMTP 설정 누락 시 Supabase migration push 전에 실패한다.
- Supabase migrations/seed push 후 Vercel production deploy를 수행한다.

Vercel:

- `vercel.json`에서 Git 자동 배포는 `deploymentEnabled: false`로 꺼져 있다.
- Preview/production은 GitHub Actions의 Vercel CLI 경로를 사용한다.

문서 기준 운영 인프라:

- Primary domain: `https://iconsip.com`
- WWW alias: `https://www.iconsip.com`
- Vercel fallback: `https://icons-ip.vercel.app`
- DNS: Cloudflare
- Auth mail: Supabase custom SMTP → Resend, sender `no-reply@iconsip.com`

## 5. 아키텍처 설계

### 5.1 원칙

프로젝트 문서와 코드가 따르는 핵심 원칙은 다음과 같다.

- 공개 브라우징 우선: IP, 굿즈, 카드, 이벤트, 커뮤니티 읽기는 공개.
- 보호 액션 시점 로그인: 구매, 가챠, 예매, 작성, 팔로우 시점에 인증 요구.
- 돈/재고/RNG/티켓 검표는 DB 신뢰 경계에서 처리.
- 결제 확정은 TossPayments 웹훅을 단일 진실원으로 삼는 설계.
- 사용자별 데이터 격리는 RLS로 보장.
- `lib/data.ts` mock을 seed/fallback 원천으로 두고 Supabase로 점진 이전.

### 5.2 데이터 흐름

현재 실제 연결된 read 흐름:

1. Server Component page가 `getCatalogSnapshot()` 또는 `getCommunitySnapshot()`을 호출한다.
2. Supabase 환경변수가 있으면 Postgres를 조회한다.
3. 환경변수가 없으면 `lib/data.ts` mock snapshot을 반환한다.
4. screen component는 props로 받은 snapshot을 렌더링한다.

현재 실제 연결된 write 흐름:

1. Client screen에서 form action을 submit한다.
2. Server Action이 auth/onboarding 상태를 확인한다.
3. 간단한 사용자 데이터는 Supabase table insert/update 또는 RPC로 처리한다.
4. 돈/재고/반응 count/권한이 중요한 mutation은 RPC를 호출한다.
5. 관련 route는 `revalidatePath()`로 갱신한다.

목표 결제 흐름:

1. 사용자가 주문/티켓/충전 pending 상태를 생성한다.
2. 클라이언트에서 TossPayments 결제를 시작한다.
3. TossPayments 웹훅 Route Handler가 서명 검증을 수행한다.
4. 웹훅 handler가 `service_role` 경계에서 확정 RPC를 호출한다.
5. RPC가 멱등 키로 중복 처리를 막고 주문/티켓/지갑 상태를 확정한다.

현재 이 목표 흐름에서 웹훅 Route Handler와 TossPayments 클라이언트 연결은 아직 없다.

## 6. 기능별 구현 현황

### 6.1 홈

구현 파일:

- `app/page.tsx`
- `components/screens/Home.tsx`
- `lib/catalog.ts`

현재 구현:

- 서버에서 `getCatalogSnapshot()`을 호출한다.
- IP, 굿즈, 카드, 이벤트 수를 기반으로 hero stats를 계산한다.
- featured IP, 공식 굿즈, 카드 highlight, 이벤트 strip을 렌더링한다.
- Supabase catalog가 비어 있으면 empty state를 보여준다.

주의:

- 홈의 커뮤니티 preview와 trending tag는 아직 `DATA.POSTS`, `DATA.TRENDING` mock을 사용한다.
- 홈 커뮤니티 preview는 Supabase 커뮤니티 feed와 직접 연결되어 있지 않다.

### 6.2 IP 허브와 IP 상세

구현 파일:

- `app/ip/page.tsx`
- `app/ip/[id]/page.tsx`
- `components/screens/IpHub.tsx`
- `components/screens/IpDetail.tsx`
- `lib/catalog.ts`
- `lib/ip-follow.server.ts`
- `app/ip/actions.ts`

현재 구현:

- IP 허브는 Supabase/mock catalog의 IP 목록과 vertical filter를 렌더링한다.
- IP 상세는 IP, 연결 굿즈, 카드, 이벤트, 커뮤니티 preview를 표시한다.
- Supabase catalog일 때 IP 상세 커뮤니티 preview는 `posts`/`public_profiles`에서 visible post를 읽는다.
- IP 팔로우 버튼은 Server Action으로 연결되어 있다.
- 비로그인 사용자가 팔로우를 시도하면 `/login?next=...`로 이동한다.
- 온보딩 미완료 사용자는 `/onboarding?next=...`로 이동한다.
- 완료 사용자는 `follow_ip` 또는 `unfollow_ip` RPC를 호출한다.
- RPC는 `ip_follows`를 변경하고 `ips.fans_count` cache를 증감한다.

미구현:

- 알림 받기 버튼은 실제 알림 설정과 연결되지 않았다.
- follower count 기반 개인화 feed는 아직 없다.

### 6.3 인증과 온보딩

구현 파일:

- `app/login/page.tsx`
- `components/screens/Login.tsx`
- `app/login/actions.ts`
- `app/auth/callback/route.ts`
- `app/onboarding/page.tsx`
- `components/screens/Onboarding.tsx`
- `app/onboarding/actions.ts`

현재 구현:

- 로그인/회원가입 모드 전환 UI가 있다.
- 이메일/PW 로그인과 회원가입 Server Action이 구현되어 있다.
- Supabase 설정이 없으면 form submit이 막히고 안내 오류가 표시된다.
- 이메일 확인 callback에서 session 교환 후 온보딩 여부에 따라 redirect한다.
- 온보딩은 닉네임, 생년월일, 약관/개인정보/마케팅 동의, 추천 IP 팔로우를 저장한다.
- 온보딩 완료 시 `profiles.onboarded_at`을 기록한다.
- 추천 IP 선택 변경은 `follow_ip`/`unfollow_ip` RPC를 통해 반영한다.

미구현:

- Google/Kakao/Apple OAuth 버튼은 비활성이다.
- 계정 삭제, 동의 철회, social account merge는 없다.

### 6.4 굿즈샵과 커머스

구현 파일:

- `app/shop/page.tsx`
- `components/screens/Shop.tsx`
- `components/shell/CartProvider.tsx`
- `supabase/migrations/20260617090002_p1_commerce.sql`

현재 화면 구현:

- 굿즈 목록은 Supabase/mock catalog에서 읽는다.
- IP filter, 굿즈 type filter, 가격 정렬이 있다.
- 품절 상태면 add button이 disabled된다.
- 장바구니 버튼은 `/shop`으로 매핑되어 있고 dedicated cart route는 없다.
- `CartProvider`는 local state count만 제공하며 초기값은 2다.

DB/RPC 준비 상태:

- `cart_items`, `orders`, `order_items`, `payments`, `refunds` 테이블이 있다.
- `goods.stock_qty`가 수량 재고로 추가되어 있다.
- `place_order(p_address)` RPC는 카트 항목을 잠그고 재고를 선점한 뒤 pending 주문을 만든다.
- `confirm_order_payment(...)` RPC는 웹훅 확정용 멱등 결제 확정 함수다.
- `cancel_order(...)` RPC는 재고 복원과 refund record 생성을 수행한다.

미구현:

- 실제 cart CRUD UI/server action
- checkout screen
- 배송지 입력
- TossPayments 결제창/위젯
- `/api/webhooks/tosspayments` Route Handler
- 주문 내역/상태 화면
- 환불/취소 사용자 flow

판단:

- 커머스는 DB 설계와 핵심 transaction 함수는 준비되어 있으나, 제품 기능으로는 아직 prototype 단계다.

### 6.5 카드/바인더와 가챠

구현 파일:

- `app/binder/page.tsx`
- `components/screens/Binder.tsx`
- `supabase/migrations/20260617090003_p2_gacha.sql`
- `docs/adr/0001-paid-digital-gacha.md`

현재 화면 구현:

- 바인더는 Supabase/mock catalog의 card 목록을 렌더링한다.
- Supabase catalog인 경우에는 “카드 탐색” 성격으로 동작한다.
- mock catalog인 경우에는 보유/미보유 filter, collection progress, daily pack modal이 동작한다.
- Supabase catalog에서는 “보유 연동 준비 중”으로 표시된다.

DB/RPC 준비 상태:

- `wallets`, `wallet_ledger`로 충전금 잔액과 장부를 관리한다.
- `card_pools`, `pool_odds`로 카드풀과 확률 공시값을 관리한다.
- `pool_odds` 합계는 deferrable constraint trigger로 1.0을 강제한다.
- `gacha_pity`로 사용자별 카드풀 천장 카운터를 저장한다.
- `pulls`, `pull_results`, `user_cards`로 가챠 이력과 보유 카드를 관리한다.
- `charge_wallet_init(...)`는 wallet 충전 pending payment를 만든다.
- `confirm_wallet_charge(...)`는 웹훅 확정 후 wallet balance와 ledger를 갱신한다.
- `pull_gacha(pool_id, count)`는 1 또는 10회 뽑기를 지원하고, 지갑 차감, RNG, 천장, 카드 적립, 장부 기록을 한 트랜잭션에서 처리한다.

ADR 상태:

- 디지털 유료 가챠 채택은 accepted 상태다.
- 확률형 아이템 공시, 게임물 등급분류 검토, 선불 충전금 환불 의무를 제품 요구사항으로 수용했다.

미구현:

- wallet 충전 UI
- TossPayments 충전 flow
- 카드풀 목록/상세 UI
- 확률 공시 UI
- 실제 유료 가챠 실행 UI
- `user_cards` 기반 내 보유 카드 조회
- 천장 counter 노출
- 미사용 충전금 환불 flow
- 카드풀/확률 관리자 UI

판단:

- 가챠는 backend transaction 설계는 가장 깊게 준비되어 있으나, 사용자-facing 기능 연결은 아직 없다.

### 6.6 팝업/티케팅

구현 파일:

- `app/events/page.tsx`
- `components/screens/Events.tsx`
- `supabase/migrations/20260617090004_p3_ticketing.sql`

현재 화면 구현:

- 이벤트 목록은 Supabase/mock catalog에서 읽는다.
- 온라인/오프라인/진행중 filter가 있다.
- 대표 이벤트 카드에 “티켓 예매” CTA가 보이지만 실제 action은 없다.

DB/RPC 준비 상태:

- `ticket_types`는 회차/티켓 종류, 가격, 정원, 판매 수량, 1인 한도, 판매 시작 시각을 저장한다.
- `ticket_orders`는 예매 order 상태와 만료 시각을 저장한다.
- `tickets`는 QR token과 valid/used/refunded 상태를 저장한다.
- `check_ins`는 검표 이력을 저장한다.
- `reserve_tickets(...)`는 `ticket_types` row를 잠그고 정원/1인 한도 검증 후 pending 예매와 placeholder ticket을 만든다.
- `confirm_ticket_payment(...)`는 웹훅 확정 후 QR token을 발급하고 예매를 paid로 바꾼다.
- `check_in_ticket(...)`은 staff 권한에서 QR 1회 사용을 보장한다.
- `refund_ticket_order(...)`는 미사용 티켓만 환불하고 재고를 복원한다.

미구현:

- 이벤트 상세 route
- 회차/수량 선택 UI
- 티켓 결제 flow
- 전자티켓/QR 화면
- 현장 staff 검표 UI
- 예매 취소/환불 UI
- 티켓 관리자 UI

판단:

- 티케팅도 DB/RPC는 설계되어 있으나 화면 연결은 아직 없다.

### 6.7 커뮤니티

구현 파일:

- `app/community/page.tsx`
- `components/screens/Community.tsx`
- `app/community/actions.ts`
- `lib/community.ts`
- `lib/community.server.ts`
- `supabase/migrations/20260624090001_community_visible_upload_read.sql`
- `supabase/migrations/20260624093001_community_reaction_counts.sql`
- `supabase/migrations/20260624103001_community_comment_like_actions.sql`

현재 구현:

- 커뮤니티 page는 현재 viewer id를 조회하고 `getCommunitySnapshot({ viewerId })`를 호출한다.
- Supabase catalog인 경우 `posts`에서 visible post를 최신순으로 읽는다.
- 작성자명은 `public_profiles`에서 nickname만 읽는다.
- reaction count는 `community_post_reaction_counts(uuid[])` RPC로 계산한다.
- 댓글 preview는 post별 최대 3개까지 읽는다.
- 로그인 사용자의 좋아요 여부를 표시한다.
- 사용자 업로드 이미지는 signed URL로 표시한다.
- composer는 IP 채널, tag, text, image upload를 지원한다.
- 포스트 작성은 로그인과 온보딩 완료가 필요하다.
- 댓글 작성, 좋아요/취소, 자기 포스트 삭제, 자기 댓글 삭제가 Server Action + RPC로 구현되어 있다.
- 좋아요는 idempotent하게 동작한다.
- 직접 table insert/delete를 막고 RPC 경유를 테스트하는 DB smoke test가 있다.

미구현:

- 신고 UI/action
- 차단 UI/action
- 운영자 모더레이션 UI
- hidden post 관리 UI
- 팔로우 IP 기반 feed personalization
- pagination/infinite scroll
- 이미지 삭제 cleanup

판단:

- 커뮤니티는 현재 가장 실제 서비스 기능에 가까운 영역이다. 다만 UGC 안전장치 전체는 아직 끝나지 않았다.

### 6.8 검색

구현 파일:

- `app/search/page.tsx`
- `components/screens/Search.tsx`
- `supabase/migrations/20260617090001_p0_foundation.sql`

현재 화면 구현:

- 클라이언트 state 기반 검색 UI가 있다.
- `DATA.IPS`, `DATA.GOODS`에서 `title.includes(q)`, `name.includes(q)`로 검색한다.
- 인기 검색어는 static 배열이다.

DB 준비 상태:

- `ips.title`, `goods.name`, `cards.name`, `posts.text`에 pg_trgm GIN index가 있다.

미구현:

- Supabase 검색 RPC 또는 view
- cards/posts/tag 검색 연결
- 결과 grouping
- 최근 검색어/인기 검색어 persistence

판단:

- 검색은 DB index만 준비됐고 앱 기능은 mock 단계다.

### 6.9 관리자 `/admin`

구현 파일:

- `app/admin/page.tsx`
- `components/screens/Admin.tsx`
- `app/admin/actions.ts`
- `lib/auth/admin.ts`
- `lib/admin/catalog.ts`
- `lib/admin/catalog.server.ts`
- `supabase/migrations/20260624100001_admin_catalog_crud.sql`

현재 구현:

- `/admin` 접근 시 Supabase 설정과 로그인 여부를 확인한다.
- 비로그인 사용자는 `/login?next=/admin`으로 redirect된다.
- staff/admin이 아니면 `notFound()` 처리한다.
- 관리자 화면은 IP, 굿즈, 카드, 이벤트 tab을 제공한다.
- 기존 record list와 신규 등록/수정 form이 있다.
- form validation은 client가 아니라 server action의 normalizer에서 수행한다.
- date-time 입력은 KST local input을 UTC instant로 변환한다.
- upsert는 직접 table write가 아니라 `admin_upsert_*` RPC로 수행한다.
- RPC는 `is_staff()`를 확인하고 `audit_log`에 action/diff를 남긴다.
- 굿즈/카드 upsert 후 IP의 `goods_count`, `cards_count` cache를 갱신한다.
- pool에 연결된 card는 IP/rarity 변경을 막아 가챠 계약을 보호한다.

미구현:

- 삭제 기능
- card pool/odds 관리
- 주문/결제/환불 관리
- 티켓 회차/검표 관리
- 커뮤니티 신고/숨김/차단 moderation
- 관리자 이미지 업로드 UI

판단:

- 관리자 기능은 P0 카탈로그 운영 골격으로 구현되어 있다. v1 운영 백오피스 전체 기준으로는 일부만 완료다.

### 6.10 교환과 마켓

구현 파일:

- `app/exchange/page.tsx`
- `components/screens/Exchange.tsx`
- `app/market/page.tsx`
- `components/screens/Market.tsx`
- `lib/data.ts`

현재 구현:

- 둘 다 `DATA` mock 기반 화면이다.
- 교환은 카드 C2C 직거래/경매 prototype이다.
- 마켓은 굿즈 C2C 중고 거래 prototype이다.

제품 범위:

- `CONTEXT.md`, `docs/PRD.md`, `AGENTS.md` 기준으로 교환과 마켓은 v2 범위다.
- v1에서는 placeholder/prototype으로 유지하는 것이 현재 설계와 맞다.

## 7. 데이터와 seed 상태

`supabase/seed.sql`은 P0 공개 카탈로그 seed를 제공한다.

현재 seed 범위:

- verticals: 5개
- IP: 8개
- goods: 12개
- cards: 12개
- events: 5개

seed 특징:

- `ips.fans_count`는 최초 seed 값만 넣고, conflict update에서는 덮어쓰지 않는다.
- follower count는 이후 `follow_ip`/`unfollow_ip` RPC가 유지한다.
- goods는 `stock_qty`까지 seed한다.
- cards는 현재 `pool_id` 없이 공개 catalog card로 seed된다.

`lib/data.ts`는 local fallback과 v2 placeholder/mock UI의 원천으로 남아 있다.

## 8. 테스트 현황

현재 test file:

- `lib/ip-follow.test.ts`
- `lib/community.server.test.ts`
- `lib/community.test.ts`
- `lib/admin/catalog.test.ts`
- `lib/auth/onboarding.test.ts`
- `lib/catalog.test.ts`
- `app/login/actions.test.ts`
- `app/community/actions.test.ts`
- `app/admin/actions.test.ts`

로컬 실행 결과:

```text
npm run test
Test Files  9 passed (9)
Tests       84 passed (84)
```

테스트가 커버하는 주요 영역:

- catalog adapter와 IP 상세 build
- auth onboarding 판정, safe next path, auth error message
- login action 일부
- IP follow helper
- community form normalization, server snapshot, actions
- admin catalog form normalization과 admin actions

CI에서 추가로 수행하는 DB 검증:

- local Supabase migration reset
- `supabase/tests/community_comment_like_actions.sql`
- `supabase db lint --local --fail-on error`

이번 로컬 확인에서 Supabase local DB reset/lint는 별도로 실행하지 않았다. 단, CI workflow에는 포함되어 있다.

## 9. 빌드와 라우트 상태

`npm run build` 결과 통과했다.

빌드 결과 route 분류:

| Route | 상태 |
|---|---|
| `/` | dynamic |
| `/admin` | dynamic |
| `/auth/callback` | dynamic route handler |
| `/binder` | dynamic |
| `/community` | dynamic |
| `/events` | dynamic |
| `/exchange` | static |
| `/ip` | dynamic |
| `/ip/[id]` | dynamic |
| `/login` | dynamic |
| `/market` | static |
| `/onboarding` | dynamic |
| `/search` | static |
| `/shop` | dynamic |

해석:

- Supabase/catalog/auth를 읽는 화면은 dynamic으로 빌드된다.
- mock만 쓰는 교환/마켓/검색은 static으로 prerender된다.

## 10. 주요 갭과 리스크

### 10.1 제품 기능 갭

- 커머스는 DB/RPC가 있지만 실제 checkout과 TossPayments 연결이 없다.
- 가챠는 DB/RPC가 있지만 wallet, 확률 공시, pull UI가 없다.
- 티케팅은 DB/RPC가 있지만 예매/QR/검표 flow가 없다.
- 검색은 mock 기반이다.
- 홈 커뮤니티 preview는 실제 Supabase feed를 쓰지 않는다.
- 관리자 백오피스는 catalog upsert만 가능하다.

### 10.2 규제/운영 리스크

- 유료 디지털 가챠는 ADR에서 채택했으나, 게임물 등급분류와 연령 게이트 결정이 P2 출시의 blocker가 될 수 있다.
- 선불 충전금 환불 정책과 전자금융 적용 범위 확인이 필요하다.
- UGC 신고/차단/모더레이션 flow가 완성되지 않았다.
- 결제 확정은 웹훅 진실원으로 설계되어 있으나 handler가 없기 때문에 아직 운영 결제 안전성을 검증할 수 없다.

### 10.3 기술 리스크

- P1~P3 RPC는 스키마와 transaction 설계가 있지만, 실제 UI/API 연결 후 integration test가 필요하다.
- `public-media` 이미지 업로드/관리 UI가 없다.
- cart state는 현재 local count라 실제 cart와 혼동될 수 있다.
- Supabase seed와 앱 UI 간 계약은 비교적 명확하지만, card pool과 catalog card의 연결 정책은 관리자 UI가 붙을 때 추가 검증이 필요하다.

## 11. 다음 작업 우선순위 제안

1. P0 마무리
   - 홈 커뮤니티 preview를 Supabase feed로 전환
   - 커뮤니티 신고/차단 action과 관리자 moderation 최소 기능 추가
   - 검색을 Supabase pg_trgm RPC로 전환

2. P1 커머스 연결
   - cart_items 기반 장바구니 CRUD
   - checkout page와 배송지 form
   - TossPayments 결제창/위젯 연결
   - `/api/webhooks/tosspayments` Route Handler
   - 주문 내역/취소 flow

3. 관리자 확장
   - catalog delete 정책 결정
   - card pool/odds 관리
   - 주문/환불 관리
   - ticket type 관리
   - UGC moderation

4. P2/P3는 결제 웹훅 공통 경계 확정 후 연결
   - wallet charge와 gacha pull UI
   - ticket reserve/pay/QR/check-in UI
   - 각 도메인별 integration test

## 12. 결론

현재 ICONS는 단순 정적 prototype을 넘어 Supabase 기반 P0 실제 기능이 붙은 상태다. 특히 인증, 온보딩, 공개 카탈로그, IP 팔로우, 커뮤니티 작성/댓글/좋아요, 관리자 카탈로그 관리는 실제 서비스 골격으로 구현되어 있다.

반면 v1의 수익/거래 핵심인 굿즈 커머스, 유료 가챠, 티케팅은 backend schema와 RPC 설계는 준비됐지만 아직 사용자 flow와 결제 웹훅이 연결되지 않았다. 따라서 현재 프로젝트 상태는 “P0 backend-connected prototype, P1~P3 transaction backend scaffold complete, product flow integration pending”으로 보는 것이 정확하다.

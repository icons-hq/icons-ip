# ICONS — 아키텍처

> 상태: Draft · 최종 수정 2026-08-13 · 짝 문서: [`PRD.md`](./PRD.md)
> 이 문서는 **어떻게 만들 것인가**를 정의한다. 현재 코드베이스(프로토타입)에서 출발해 목표 아키텍처와 이전 경로를 기술한다.
>
> ⚠️ 이 프로젝트의 Next.js 16은 학습 데이터와 API/관례가 다를 수 있다(`AGENTS.md`). 실제 코드 작성 전 `node_modules/next/dist/docs/`를 확인한다. 본 문서가 코드 디테일과 어긋나면 코드를 따른다.

---

## 1. 설계 원칙

1. **공개 우선 브라우징**: 카탈로그·피드는 비로그인 공개. 보호는 액션 단위(결제·카드팩 개봉·게임 플레이·작성·팔로우).
2. **돈·재고·무작위 결과는 DB에서 지킨다**: 주문·티켓 재고·카드 발급과 향후 실물 경품 배정의 원자성은 Postgres 함수(RPC)+행 잠금으로 보장한다. 앱 레벨 동시성이나 클라이언트 RNG에 의존하지 않는다.
3. **결제는 provider 재검증이 확정한다**: 클라이언트 성공 신호와 callback body는 입력일 뿐이다. 서버가 `PaymentGateway`를 통해 provider 결과를 확인하고 DB 멱등 경계에서만 주문·티켓을 확정한다.
4. **데이터 격리는 RLS로**: 사용자 데이터는 소유자 범위, 카탈로그는 공개 읽기, 관리자는 역할 + 감사 로그.
5. **점진 이전**: `lib/data.ts` mock을 시드로 삼아 도메인별로 DB·페치로 교체. 프로토타입 화면을 버리지 않는다.

---

## 2. 현재 스택 (as-built)

| 레이어 | 구현 | 위치 |
|---|---|---|
| 프레임워크 | Next.js **16** (App Router, Turbopack) | `next.config.ts` (`turbopack.root` 고정) |
| UI | React **19**, TypeScript strict | `app/`, `components/` |
| 스타일 | Tailwind **v4** + "Holographic Midnight" 디자인 시스템 | `app/globals.css`, `postcss.config.mjs` |
| 화면 | App Router 라우트 ↔ screen 컴포넌트 | `app/**/page.tsx` → `components/screens/*` |
| 셸 | Nav · MobNav · SiteFooter · CartProvider · AuthPresenceProvider · 로그인 사용자 unread-count 알림 벨 · `useGo` | `components/shell/*` |
| 라우팅 맵 | 프로토타입 route-id ↔ 경로 | `lib/routes.ts` |
| 실행 표면 | 현재 제품 런타임은 Next.js 웹 하나다. 범용 온라인 팝업 운영 레이어와 Expo/webview 호스트는 현 로드맵에 없으며 기존 `PopupGameHost` 이름은 네이티브 지원 약속이 아니다 | `app/`, `lib/games/*`, superseded ADR-0002 |
| 데이터 | Supabase 공개 카탈로그(보관 항목 제외)와 현재 활성 홈 히어로·공지·특집 IP, 커뮤니티 visible 전체 피드·본인 `ip_follows` 기반 내 팬덤 피드/comment preview, Postgres 검색 읽기 + mock fallback. 보관된 IP의 기존 주문·바인더·팔로우·커뮤니티 이력 조회는 유지한다. Vercel Preview의 공개 카탈로그 기본값은 static mock이며 `ICONS_CATALOG_SOURCE=supabase`로 프리뷰 DB를 읽게 바꾼다 — 어드민 콘솔은 언제나 Supabase를 본다. IP 상세 커뮤니티 preview도 Supabase `posts`/`public_profiles`에서 읽음 | `lib/catalog.ts`, `lib/home-catalog.ts`, `lib/catalog-source.ts`, `lib/community.server.ts`, `lib/search.ts`, `lib/data.ts` |
| 인증 | Supabase SSR 이메일/PW Auth, 가입/OAuth shared callback과 recovery 전용 callback, 비밀번호 재설정, 온보딩 게이트. 표시 전용 AuthPresenceProvider가 unknown/signed-in/signed-out 상태를 AuthButton·MobNav에 동기화하고 보호 판정은 각 Server Page가 수행한다. env 없으면 no-op/폼 비활성화 | `app/login/*`, `app/auth/callback/route.ts`, `app/auth/recovery/callback/route.ts`, `app/update-password/*`, `app/onboarding/*`, `app/my/*`, `components/shell/AuthPresenceProvider.tsx`, `components/shell/AuthButton.tsx`, `lib/auth/*`, `lib/supabase/*`, 루트 `proxy.ts` |
| 보호 액션 | IP 팔로우/언팔로우·IP별 드롭/이벤트 알림 설정, 알림 읽음 처리, 온보딩 추천 IP 저장. 커뮤니티 포스트·댓글 작성 코드는 연결돼 있지만 생성·수정은 private control을 읽는 단일 trigger seam에서 기본 OFF다. 공개 읽기·좋아요·작성자 삭제·신고·차단과 운영자 숨김은 유지 | `app/ip/actions.ts`, `app/notifications/actions.ts`, `app/onboarding/actions.ts`, `app/community/actions.ts`, `app/admin/actions.ts`, `lib/ip-follow*`, `lib/notifications*`, `supabase/migrations/20260623090001_ip_follow_rpc.sql`, `supabase/migrations/20260624103001_community_comment_like_actions.sql`, `supabase/migrations/20260626090001_community_moderation_actions.sql`, `supabase/migrations/20260716090001_in_app_notifications.sql`, `supabase/migrations/20260716151616_community_post_editing.sql`, `supabase/migrations/20260717090001_community_comment_moderation.sql`, `supabase/migrations/20260813081224_community_write_gate.sql`, `supabase/migrations/20260813083505_deepen_community_write_guard.sql` |
| 인앱 알림 | 본인 RLS 수신함 최신 50건·unread count, 보호 알림함/IP 설정 화면. 주문 상태·카드팩 발급·runtime staff 카탈로그 INSERT trigger와 audited 관리자 즉시 공지가 같은 transaction에서 멱등 발급 | `app/notifications/*`, `components/screens/Notifications.tsx`, `components/screens/NotificationSettings.tsx`, `components/shell/NotificationBell.tsx`, `components/admin/sections/NotificationSection.tsx`, `supabase/migrations/20260716090001_in_app_notifications.sql`, `supabase/migrations/20260716100001_admin_notification_console.sql` |
| 굿즈 커머스 | 비로그인 localStorage·로그인 `cart_items` 병합, 멱등 `place_order` 재고 선점, 토스 결제위젯 redirect 승인, 웹훅 확정·만료 복원, 본인 주문 내역·상세·청약철회 요청·상태 조회 | `app/cart/*`, `app/checkout/*`, `app/orders/*`, `app/api/orders/*`, `app/api/payments/confirm`, `app/api/webhooks/tosspayments`, `lib/checkout*`, `lib/orders*`, `lib/payments/*` |
| 티켓 예매 | 공개 이벤트 상세·회차 잔여 조회, 멱등 `reserve_tickets` 정원 선점, 티켓용 토스 결제위젯, 웹훅 확정·QR 발급·만료 복원, 본인 티켓 목록/상세·보호 QR·예매 전체 취소/환불 | `app/events/[eventId]/*`, `app/ticket-checkout/*`, `app/tickets/*`, `app/api/tickets/*`, `app/api/ticket-orders/*`, `app/api/payments/confirm`, `app/api/webhooks/tosspayments`, `lib/ticketing*`, `lib/payments/*` |
| 운영 | staff/admin 게이트, 카탈로그 CRUD·보관/복원과 private staging 기반 아트워크 검증·promote, 홈 히어로·특집 IP·공지 배너 큐레이션, 카드풀 운영 기간·등급별 확률·카드 풀 바인딩, 주문 대상별 뽑기권 발급 정책, 카드 보상형 참여형 게임 등록·운영과 PII-free 플레이 집계, 전체/IP 팔로워 인앱 공지의 추정·즉시 발송·이력, 감사 로그, 커뮤니티 신고·포스트/댓글 숨김 처리, 주문 검색·배송 전이·청약철회 승인/거절/재정합화, 실재고 입고·보정, 마스킹 회원 검색·상세·계정 정지/해제 | `app/admin/*`, `components/admin/*`, `lib/admin/*`, `supabase/migrations/20260714190001_admin_order_console.sql`, `supabase/migrations/20260714200001_admin_stock_adjustment.sql`, `supabase/migrations/20260715010001_admin_card_pool_console.sql`, `supabase/migrations/20260715020001_admin_reward_policy_console.sql`, `supabase/migrations/20260715030001_admin_game_console.sql`, `supabase/migrations/20260716100001_admin_notification_console.sql`, `supabase/migrations/20260717090001_community_comment_moderation.sql`, `supabase/migrations/20260717100001_admin_member_suspension.sql`, `supabase/migrations/20260717110001_admin_artwork_upload_storage.sql`, `supabase/migrations/20260717120001_catalog_archiving.sql`, `supabase/migrations/20260721060440_home_curations.sql` |
| CI/CD | GitHub Actions `CI/CD Pipeline`: PR 검증 + 프리뷰 Supabase migration push 후 Vercel preview 배포, merge queue 검증, `main` push production 배포. Actions 앱 빌드 Node는 26 | `.github/workflows/pipeline.yml` |
| 배포 | PR은 프리뷰 Supabase migration push·seed 후 Vercel 원격 preview build/deploy, `main` push는 production Supabase linked migration push 후 Vercel 원격 production build/deploy. Sensitive 환경변수는 Vercel build 안에서 검증하며 Vercel Git 자동 배포는 비활성화 | GitHub Secrets + `.github/workflows/pipeline.yml`, `vercel.json` |
| 프리뷰 환경 | PR 프리뷰는 전용 Supabase 프로젝트를 본다. 프리뷰 ref가 운영 ref와 같으면 job이 실패하고, 프리뷰 secret이 없으면 프리뷰 배포를 건너뛴다. 프리뷰 DB에는 운영 데이터를 두지 않는다 | [ADR-0006](adr/0006-preview-supabase-project.md), `.github/workflows/pipeline.yml` |
| Production runtime | Vercel project/runtime Node.js Version은 공식 지원 범위인 24.x 유지 | Vercel Project Settings |
| 도메인/DNS | `iconsip.com` primary, `www.iconsip.com` alias, `icons-ip.vercel.app` fallback. DNS는 Cloudflare에서 관리 | Cloudflare DNS, Vercel Domains |
| Auth 메일 | Supabase Auth custom SMTP → Resend. Sender는 `no-reply@iconsip.com`, Resend domain은 `iconsip.com` | Supabase Auth SMTP, Resend |
| 트랜잭션 메일 | 앱이 직접 보내는 주문 확인·배송 시작 메일. Resend 호환 HTTP(SDK 의존성 없음), env 없으면 no-op. 멱등·재발송은 `email_deliveries` 클레임이 담당하고 발송 실패는 주문·결제 상태에 영향을 주지 않는다 | `lib/email/*`, `supabase/migrations/20260807130001_transactional_email_deliveries.sql`, [`transactional-email.md`](./transactional-email.md) |

**요청 프록시 주의**: 루트 `proxy.ts`가 `export function proxy()` + `config.matcher`로 동작한다(Next 16에서 미들웨어가 이 형태). `lib/supabase/middleware.ts`의 `updateSession`을 호출하며 **보호 액션 전까지 로그인 리다이렉트는 하지 않는다**(공개 브라우징 정책).

화면↔라우트 매핑(현재):
`/`·`/ip`·`/ip/[id]`·`/shop`·`/cart`·`/checkout`·`/checkout/[orderId]`·`/checkout/success`·`/checkout/fail`·`/orders`·`/orders/[orderId]`·`/packs`·`/binder`·`/exchange`·`/community`·`/events`·`/events/[eventId]`·`/ticket-checkout/[ticketOrderId]`·`/ticket-checkout/success`·`/ticket-checkout/fail`·`/tickets`·`/tickets/[ticketOrderId]`·`/notifications`·`/notifications/settings`·`/my`·`/settings`·`/market`·`/search`·`/login`·`/update-password`·`/account-suspended`·`/admin`

---

## 3. 목표 아키텍처

```
┌────────────────────────── Vercel (Next.js 16) ───────────────────────────┐
│  Server Components  ──read──▶ Supabase (anon, RLS)                         │
│    └ /events/[id] → /ticket-checkout/[id] ──▶ 회차·예매·결제 상태          │
│  Server Actions     ──rpc──▶ Supabase (인증 검증 + 최소 권한 RPC)          │
│  Route Handlers                                                           │
│    └ /api/payments/*                ──▶ provider-neutral 준비·확정·정합화    │
│    └ /api/orders/[id]/cancel        ──▶ 청약철회 요청/무결제 즉시 원복      │
│    └ /api/webhooks/tosspayments  ◀── 기존 Toss 거래만 조회·취소·웹훅      │
│    └ /api/cron/admin-artwork      ──▶ 만료 staging/public 후보 재조정      │
│  /admin (role-gated)                                                      │
└──────────────┬───────────────────────────────────────────┬──────────────┘
               │                                             │
        ┌──────▼────────────┐                         ┌───────▼────────┐
        │ PaymentGateway     │                         │   Supabase     │
        │ Korpay (신규)      │                         │  Postgres+RLS  │
        │ Toss (기존 거래만) │                         │  RPC(SECDEF)   │
        └───────────────────┘                         │  Auth          │
                                                      │  Storage       │
                                                      └────────────────┘
                                                              │
                                                              ▼
                                                      Resend custom SMTP
```

Cloudflare DNS는 `iconsip.com`/`www.iconsip.com`을 Vercel로 보내고, 같은 zone에 Resend 발송 인증용 DKIM/SPF/DMARC/MX 레코드를 둔다.

핵심: **읽기**는 Server Component가 RLS 하에서 직접 조회. **상태 변경**은 Server Action이 검증 후 **RPC 함수** 호출. **돈 확정**은 `PaymentGateway.confirm/reconcile`의 검증 결과 → RPC이며 callback만으로 확정하지 않는다. 신규 결제는 Korpay, Toss는 이미 알려진 기존 거래의 조회·취소·웹훅에만 남긴다. Auth 메일은 Supabase 기본 메일 provider가 아니라 Resend custom SMTP를 사용한다.

---

## 4. 기술 스택 (목표)

| 영역 | 선택 | 비고 |
|---|---|---|
| 호스팅 | **Vercel** (Fluid Compute) | Next 16, Route Handler 웹훅·Cron |
| DB/Auth/Storage | **Supabase** (Postgres + Auth + Storage) | 스캐폴딩 이미 존재 |
| 인증 | Supabase Auth: **이메일/PW + Google + Apple + Kakao** OAuth 구현 | production provider 3종과 공급자 이메일 claim 설정 완료. 모든 가입 경로는 온보딩에서 프로필 완성하며 production 배포 후 controlled smoke 필요 |
| 결제 | **Provider-neutral gateway** | 현재 Toss checkout을 #205·#206 전환까지 호환 유지한다. 신규 목표는 Korpay이며 전환 뒤 Toss는 기존 거래의 조회·취소·웹훅만 남긴다 |
| 검색 | **Postgres** pg_trgm + ILIKE | 외부 검색엔진 없음(v1) |
| 미디어 | **Supabase Storage** | public `public-media`(검증된 카탈로그/아트워크) + private `admin-artwork-staging`(검증 전 관리자 업로드)·`user-uploads`(사용자 업로드) |
| 무결성 | **Postgres RPC**(SECURITY DEFINER) + RLS | 카드 발급·티켓·주문·재고 |

---

## 5. 데이터 모델

`lib/data.ts`의 타입을 출발점으로 한다. 도메인별 핵심 테이블(키 컬럼만):

### 5.1 신원 & 사용자
- `profiles` (id=auth.users.id, email, nickname, birth_date, **role** `user|staff|admin`, consents jsonb, suspended_at, suspension_reason, created_at) — 직접 SELECT는 self-only이고 `suspension_reason`은 일반 Data API SELECT에서 제외해 staff 상세 RPC로만 읽는다.
- `private.report_subjects` (report_id, target_user_id) — 신고 생성 시 대상 회원을 불변 snapshot으로 귀속해 원문 포스트·댓글 삭제 뒤에도 받은 신고 집계를 보존한다. Data API role에는 미노출.
- `ip_follows` (user_id, ip_id, notify_drops, notify_events) — 관심 IP와 인앱 드롭·이벤트 알림 설정. 두 설정은 기본 true이며 언팔로우 시 행과 함께 삭제된다.
- `notifications` (id, user_id, type, title, body, link_path, source_type, source_id, dedupe_key, read_at, created_at) — 본인 인앱 수신함. 원본 source id는 보존하고 `(user_id, dedupe_key)`로 재처리를 멱등화한다.

### 5.2 카탈로그 (공개 읽기)

- `ips`·`goods`·`cards`·`events`의 nullable `archived_at`이 soft-delete 진실원이다. 공개 카탈로그·검색·신규 팔로우·구매·예매는 보관 항목을 제외한다.
- RLS의 공개 SELECT와 FK는 그대로 유지해 기존 주문·바인더·발급·팔로우·커뮤니티 이력을 읽을 수 있다. IP의 굿즈·카드 수는 보관되지 않은 하위 항목만 집계한다.
- `verticals` (key, label, color) — 캐릭터 IP·게임·애니메이션
- `ips` (id, title, sub, vertical_key, glyph, bg, tagline, synopsis, featured, archived_at, fans/goods/cards 집계)
- `goods` (id, ip_id, name, type, price, badge, stock, image_path, archived_at)
- `events` (id, ip_id?, title, mode, status, starts_at, ends_at, location, accent, image_path, archived_at)
- `home_curations` (id, kind `hero|featured_ip|announcement`, ip_id?, title, image_path?, link_path, display_order, active_from/to, enabled) — `[active_from, active_to)` 노출 창을 가진 홈 운영 원장이다. 공개 RLS는 enabled·현재 창·연결 IP 미보관을 모두 검사하고, staff는 예약·종료·비활성 행까지 읽는다.
- 공개 홈은 `display_order, active_from, id` 순서의 첫 hero와 첫 announcement, 중복·누락 IP를 제외한 최대 5개 featured IP를 소비한다. 특집 전용 이미지가 있으면 해당 선택기의 아트워크를 덮어쓴다. Supabase source는 큐레이션이 비어도 legacy `ips.featured`로 돌아가지 않고 첫 5개 IP를 사용하며, mock source만 기존 featured fallback을 유지한다.
- migration과 local seed는 기존 `ips.featured = true`인 미보관 IP를 결정적 UUID·순서의 featured 큐레이션으로 승계한다. 컬럼과 기존 카탈로그 RPC 인자는 배포 호환을 위해 유지한다.

### 5.3 무료 카드 리워드 (P2)
- `card_pools` (id, ip_id, name, active_from/to) — 풀(픽업/한정 포함). 종료는 시작보다 뒤여야 한다.
- `cards` (id, ip_id, pool_id, name, no, rarity `N|R|SR|SSR|HOLO`, image_path, archived_at) — 풀 바인딩 시 복합 FK로 같은 IP를 강제한다.
- `pool_odds` (pool_id, rarity, probability) — 카드팩·게임 결과의 운영 확률 원천. 5등급 전체가 범위·소수 5자리·정확한 합계 1을 만족하고, 양수 확률 등급에는 소속 카드가 있어야 한다.
- `reward_policies` (id, pool_id, trigger, target_ip_id, target_good_id?, min_amount, tickets_per_grant, active, active_from/to) — 주문 대상 IP와 선택 same-IP 굿즈를 독립 보상 카드풀에 연결한다. 동일 주문에 매칭되는 정책은 모두 누적 적용한다.
- `draw_tickets` (id, user_id, pool_id, source/source_id, ordinal, reward_policy_id?, consumed_at, revoked_at, created_at) — 발급 정책 attribution과 발급 이력을 보존한다. 기존 티켓은 `reward_policy_id`가 null일 수 있고, 주문 취소는 미개봉 티켓을 삭제하지 않고 soft revoke한다.
- `wallets` / `wallet_ledger` / `pulls` / `pull_results` — ADR-0001 시기의 legacy schema. ADR-0003으로 폐기됐으며 신규 제품 경로에서 읽거나 쓰지 않는다.
- `user_cards` (user_id, card_id, qty, acquired_at) — 바인더(보유)
- `games` (id=slug, type, title, event_id?, config, reward_pool_id?, per_user_daily_limit, active_from/to) — 카드 variant의 IP는 보상 카드풀에서 파생한다. 신규 운영 경로는 `marble_roulette`·10개 구슬·서버 생성 등급 라인업으로 고정한다.
- `game_plays` (id, game_id, user_id, result, idempotency_key, created_at) — 서버가 결정한 결과의 멱등 재생 원장. 관리자 집계에는 사용자 ID·결과 payload를 노출하지 않는다.

### 5.4 커머스 (P1)
- `carts` / `cart_items` (user_id, good_id, qty)
- `orders` (id, user_id, status `pending|paid|shipping|done|canceled`, total, address jsonb, created_at)
- `order_items` (order_id, good_id, qty, unit_price, good_name/type/ip_id_snapshot) — 주문 시점 굿즈 정체성·가격 장부
- `payments` (id, provider `toss|korpay`, user_id, purpose, ref_id, amount, status, payment_key, **idempotency_key**, raw jsonb) — 기존 Toss raw 감사 원장은 서버 전용으로 보존한다.
- `payment_attempts` (id, provider, user_id, purpose, ref_id, amount/currency, state, provider order/product code, claim lease, expires_at) — provider-neutral 승인 시도 원장. service role만 읽고 쓴다.
- `private.payment_provider_evidence` (payment_attempt_id, kind, provider key/transaction/approval reference, result/payment method, approved_at) — allowlist 증거를 append-only로 보존하고 provider 원문 payload는 저장하지 않는다.
- `payment_summaries` — `payments` owner/staff RLS를 따르는 security-invoker 안전 조회 표면. provider 비밀·멱등 키·raw를 노출하지 않는다.
- `refunds` (id, payment_id, amount, reason, status)
- `order_cancellation_requests` (id, order_id, requested_by, status, decision, provider 상태 코드, 시각) — 사용자 요청과 운영 결정의 durable 원장

### 5.5 티케팅 (P3)
- `ticket_types` (id, event_id, name, price, capacity, sold) — 회차/종류. 공개 읽기, staff 쓰기는 audited RPC만 허용
- `ticket_orders` (id, user_id, event_id, status, total, expires_at, reservation_key) — 사용자별 reservation key로 동일 예매 요청을 멱등화
- `tickets` (id, ticket_order_id, ticket_type_id, qr_token, status `valid|used|refunded`)
- `ticket_cancellation_requests` (ticket_order_id, requested_by, status, policy/cutoff/금액 snapshot, attempt lease) — 사용자·provider 취소를 멱등 정합화하는 durable 원장
- `check_ins` (ticket_id, checked_at, by_staff)

### 5.6 커뮤니티 (P0)
- `posts` (id, user_id, ip_id?, text, image_path?, tag, status `visible|hidden`, created_at, updated_at)
- `comments` (id, post_id, user_id, text, status `visible|hidden`, created_at)
- `likes` (post_id, user_id)
- `reports` (id, target_type `post|comment|user`, target_id, reporter_id, reason, status)
- `blocks` (user_id, blocked_user_id)
- `community_trending_tags(window_days, result_limit)`는 RLS를 유지하는 security-invoker RPC로 최근 visible 포스트 태그를 집계한다. 기본은 최근 7×24시간·상위 10개이며 오류나 0행은 mock fallback 없이 빈 결과로 닫는다.
- `/community?feed=fandom`은 본인 `ip_follows.ip_id`를 읽어 `posts.ip_id IN (...)`을 정렬·30건 제한 전에 적용한다. 알림 채널 설정은 포함 여부와 무관하고, `ip_id`가 없는 포스트는 제외한다. 전체 피드와 트렌딩은 개인화하지 않으며 기존 visible/작성자/staff RLS와 앱의 작성자 차단 필터를 유지한다.
- 홈은 온보딩 완료 viewer의 팔로우 ID만 받아 기존 이벤트·재고 티커 우선순위를 보존하고 커뮤니티 preview 그룹 안에서만 팔로우 IP를 stable-first로 정렬한다.
- `edit_own_post(target_post_id, post_text, post_ip_id, post_tag)`는 인증된 작성자의 visible 포스트를 행 잠금한 뒤 텍스트·태그·IP 연결만 수정한다. `posts` 직접 UPDATE 권한과 정책은 제거하며 이미지·작성자·상태·작성 시각은 보존한다.
- 공개 댓글 preview와 댓글 수는 `comments.status = visible`을 정렬·limit·집계 전에 적용한다. hidden 원문은 댓글 작성자·부모 포스트 작성자·staff만 DB에서 읽을 수 있고 공개 DTO에는 tombstone 없이 제외한다.
- `admin_hide_community_comment`는 staff를 재검사하고 댓글·선택 신고를 잠근 뒤 정확히 연결된 댓글 신고만 함께 해결한다. 댓글 상태가 실제 전환될 때만 PII-free `community_comment_hide` audit을 한 건 남기며, 동일 resolved 요청 replay는 무변경으로 반환한다.

### 5.7 운영
- `audit_log` (id, actor_id, action, target, diff jsonb, created_at)

> v2(연기) 테이블: `listings`/`offers`/`trades`/`escrow`/`payouts`(마켓·교환), `memberships`/`subscriptions`(유료 팬덤). 스키마 자리만 예약.

---

## 6. 권한 모델 (RLS)

| 테이블군 | 읽기 | 쓰기 |
|---|---|---|
| 일반 카탈로그(verticals/ips/goods/events) | **공개(anon)** | staff/admin only |
| 홈 큐레이션(home_curations) | anon/authenticated는 enabled·현재 노출 창·미보관 연결 IP 행만, staff는 전체 | 직접 DML 없음. staff를 재검사하는 audited RPC only |
| 카드 리워드 카탈로그(cards/card_pools/pool_odds/reward_policies) | **공개(anon)** | 역할을 재검사하는 audited RPC only. 단 신규 발급·개봉·게임·운영 활성화는 DB 전역 gate 기본 OFF |
| 참여형 게임 카탈로그(games) | **공개(anon)** | 역할을 재검사하는 audited RPC only |
| game_plays | **본인만** | `play_game` 신뢰 RPC만 |
| draw_tickets/card_grants | **본인만** | 신뢰 RPC/service role만 |
| profiles/ip_follows/carts/orders/wallets/user_cards/ticket_orders | **본인만**. profiles의 교차 회원 읽기와 내부 정지 사유 직접 읽기 불가 | 본인 읽기, staff 회원 목록·상세·가입 집계는 목적별 RPC, 쓰기는 신뢰 RPC/service role만 |
| notifications | **본인만** | 직접 쓰기 없음. 읽음 처리는 `open_notification`, 발급은 신뢰 trigger 또는 staff를 재검사하는 audited RPC만 |
| tickets/ticket_cancellation_requests | **본인만 안전 컬럼** | QR 원문·provider/attempt/error 정보는 서버 경계 전용, 쓰기는 신뢰 RPC/service role만 |
| posts/comments/likes | 공개 읽기(visible). hidden 댓글 원문은 댓글/포스트 작성자와 staff만 | post/comment 생성·수정은 private control 기반 단일 trigger에서 기본 OFF이며 앱 역할은 control을 바꾸지 못한다. 삭제·반응·신고·숨김은 각 최소 권한 RPC로 유지 |
| reports/blocks | 본인+운영 | 본인 |
| audit_log | admin only | RPC만 |

- 돈/재고가 걸린 INSERT/UPDATE는 테이블 직접 쓰기 대신 **RPC(SECURITY DEFINER)** 로만 허용.
- 카드풀·확률·카드·발급 정책의 직접 write 권한과 정책도 제거하고, staff/admin audited RPC만 허용한다.
- 관리자 권한은 `profiles.role`로 판정, `/admin` 라우트와 RLS 양쪽에서 검사.

---

## 7. 트랜잭션 & 무결성 (RPC)

핵심 원자 연산은 `SECURITY DEFINER` Postgres 함수로 구현하고, Server Action에서 인증 컨텍스트로 호출한다.

- **legacy `pull_gacha` / `charge_wallet`** — ADR-0003으로 폐기된 유료 경로다. 현재 제품·관리자·클라이언트에서 호출하지 않으며 신규 기능의 기반으로 삼지 않는다.
- **`reserve_tickets(user_id, ticket_type_id, qty, reservation_key)`** — 결제 환경·인증·온보딩을 확인한 Server Action만 service role로 호출하며 브라우저 롤에는 execute를 열지 않는다. DB에서도 사용자 온보딩을 재확인하고 사용자+요청 키 advisory lock과 unique index로 재시도를 멱등화한다. 이벤트를 먼저 잠근 뒤 회차를 `FOR UPDATE`로 잠그고 예매 상태·유료 가격·오픈 시각·1인 한도·잔여를 재검증해 10분 `pending` 예매와 QR 없는 티켓 placeholder를 만든다. QR은 웹훅의 `confirm_ticket_payment`에서만 발급한다.
- **`admin_upsert_ticket_type(operation_id, ticket_type_id, event_id, name, price, capacity)`** — operation/type UUID advisory lock 뒤 이벤트를 `FOR KEY SHARE`, 기존 회차를 `FOR UPDATE`로 잠근다. 최신 `sold` 미만 capacity를 거절하고, 티켓 이력이 생기면 이벤트·회차명·가격을 잠그며, 전후 상태를 `audit_log`에 멱등 기록한다. `sold`·`per_user_limit`·`sales_open_at`은 입력받거나 덮어쓰지 않는다.
- **`place_order(user_id, address, checkout_key)`** — 결제 환경·인증·온보딩·production 검토 권한을 확인한 Server Action만 service role로 호출하며 브라우저 롤에는 execute를 열지 않는다. DB가 장바구니와 굿즈를 잠근 뒤 재고 검증·차감, 주문 당시 가격·이름·유형·IP를 고정한 `orders`/`order_items` 생성(`pending`)을 한 트랜잭션에서 수행한다.
- **provider-neutral payment attempt / `confirm_order_payment` / `confirm_ticket_payment`** — 티켓은 provider 승인 호출 전에 order→active cancellation request→attempt 순서로 잠그고 claim을 먼저 남겨 무결제 취소와 외부 승인이 엇갈리지 않게 한다. `PaymentGateway.confirm/reconcile`의 검증된 공통 outcome만 service role finalizer에 전달하고 attempt idempotency key로 중복을 막는다. Toss paymentKey 멱등은 기존 Toss 거래 호환 경로에만 남긴다. (충전 `charge_wallet`은 ADR-0003으로 폐기)
- **`request_order_cancellation` / `admin_decide_order_cancellation` / `complete_order_cancellation_request`** — 사용자 요청을 durable 원장에 남기고 staff 승인 뒤에만 provider 정합화를 시작한다. fresh GET으로 모든 대상 결제의 전액 취소를 검증한 뒤 재고·미사용 카드팩·환불 장부·주문 상태를 원자적으로 정리한다. 불확실한 결과는 claim을 유지한 `needs_review`로 격리하며 같은 멱등키로만 재정합화한다.
- **`request_ticket_cancellation` / `begin_ticket_cancellation_reconcile` / `complete_ticket_cancellation_request`** — 이벤트 시작 전 미사용 예매 전체의 정책·마감·전액 환불 금액을 snapshot으로 남긴다. order→request→payments→tickets→ticket_types 잠금 순서와 5분 attempt lease로 confirm/check-in 경합과 중복 provider 처리를 막고, 모든 비실패 결제의 fresh GET→필요 시 전액 취소→fresh GET 증거가 일치할 때만 티켓·정원·환불을 원자 완료한다. 검증된 provider 원문과 실제 환불 근거를 결제 원장에 함께 보존하며, 불확실한 결과는 QR을 차단한 `needs_review`로 남긴다.
- **`check_in_ticket(staff_id, qr_token)`** — service role만 실행하고 staff/admin을 DB에서 다시 확인한다. order→active cancellation request→ticket 순서로 잠근 뒤 `valid→used` 전이와 `check_ins`·`admin.ticket.checked_in` 감사를 한 트랜잭션에 기록한다. 재검표는 최초 시각을 반환하며, 환불·취소 진행·원장 불일치는 쓰기 없이 차단한다. QR 원문은 응답·감사에 남기지 않는다.
- **`admin_update_order_status` / `admin_update_order_tracking` / `admin_search_orders`** — staff를 DB에서 다시 확인하고 `paid → shipping → done`만 허용·감사하며, 주문/구매자/상태/KST 기간 필터를 DB에서 페이지 처리한다. `shipping` 전이는 택배사·운송장번호를 요구하고(없으면 fail closed), 운송장 정정은 이전 값과 함께 감사한다. 택배사 코드는 `lib/orders/shipment.ts`와 DB check 제약이 같은 허용 목록을 갖는다 — 형식만 맞고 목록에 없는 코드가 저장되면 고객 화면에서 배송 정보가 통째로 사라지므로, 택배사 추가는 앱 상수와 마이그레이션을 함께 바꿔야 한다.
- **`admin_adjust_stock`** — 화면별 UUID 멱등키를 advisory lock으로, 굿즈를 `FOR UPDATE`로 잠근다. 화면에서 본 수량과 현재 수량이 같을 때만 델타를 반영하고 감사 로그 ID·전후 수량·사유를 원장으로 남긴다. persisted `stock`은 수동 판매 게이트로 보존하며 공개 유효 상태는 `stock_qty <= 0 ? soldout : stock`으로 파생한다.
- **`admin_upsert_card_pool` / `admin_set_pool_odds` / 확장된 `admin_upsert_card`** — 앞의 두 RPC는 operation UUID로 재시도를 멱등화한다. 세 RPC 모두 대상 풀 잠금 아래 같은 IP 바인딩·확률 합계·양수 등급 coverage를 검증한 뒤 전후 상태를 감사한다. 기존 7인자 카드 호출은 배포 호환을 위해 현재 풀 바인딩을 보존한다.
- **`admin_upsert_reward_policy` / `admin_list_reward_policies`** — operation/policy UUID로 재시도를 멱등화하고, target IP·선택 same-IP 굿즈·독립 카드풀·금액·수량·기간·풀 준비도를 검증한 뒤 전후 상태를 감사한다. 직접 DML은 봉인하며 목록 RPC는 PII 없이 누적 발급·사용 가능·개봉·회수·주문 집계만 반환한다.
- **`admin_upsert_game(target_operation_id, target_previous_game_id, target_game_id, target_title, target_reward_pool_id, target_event_id, target_per_user_daily_limit, target_active_from, target_active_to, target_end_now) → text` / `admin_list_games`** — `previous_game_id`와 operation UUID로 플레이 전 slug rename을 포함한 재시도를 멱등화한다. 신규 게임은 card variant·`marbleCount=10`으로만 만들고, 준비된 보상 카드풀의 양수 `pool_odds`를 largest-remainder 방식으로 10칸에 결정적으로 배분한다. 카드풀은 게임 창 전체를 덮어야 하고 optional 이벤트는 같은 IP의 `온라인` 모드여야 하며, 카드풀·이벤트 mutation도 이 계약을 깨뜨리지 못한다. 최초 플레이 뒤 slug·type·pool·event·config를 잠근다. `end_now=true`는 현재 시각이 운영 창에 포함되는 기존 카드 게임만 DB `statement_timestamp()`로 종료하고 같은 operation replay에는 최초 종료 시각을 보존한 채 멱등 성공한다. 직접 DML은 봉인하며 목록 RPC는 사용자 ID·결과 payload 없이 플레이 수·최근 플레이 시각만 집계한다. 기존 `goods` variant는 운영 콘솔에서 읽기 전용이다. 남은 mock 연출은 실제 경품·구매권을 만들지 않으며 신규 실물 판매에 재사용하지 않는다.
- **`confirm_order_payment`의 리워드 발급** — 결제 시점 주문 스냅샷으로 각 정책의 IP/선택 굿즈 소계를 계산하고 조건이 맞는 활성 정책을 모두 누적 적용한다. 티켓마다 `reward_policy_id`를 기록해 정책 attribution을 보존한다.
- **`grant_cards` / `play_game` / `open_draw_ticket`** — 모든 카드 발급은 `grant_cards`가 풀을 공유 잠그고, `play_game`의 신규 결과만 현재 풀 운영 기간을 추가 검사한다. 이미 확정된 게임 결과는 이후 풀 종료에도 그대로 재생하고, 기존 미사용 카드팩은 풀 종료 후에도 개봉할 수 있다. 카드팩은 발급 시 확률 snapshot을 만들지 않아 개봉 시점의 최신 풀 구성·확률을 사용한다. 회수된 티켓은 개봉할 수 없고 공개 UX에서는 존재를 노출하지 않는 `not_found`로 정규화한다.
- **카드 리워드 전역 gate** — `private.card_reward_control` singleton은 기본 OFF이고 앱 역할은 직접 읽기·수정할 수 없다. 공개 boolean capability는 fail-closed UI readback에만 사용한다. OFF일 때 `play_game`·`open_draw_ticket`·수동 발급과 발급 정책/게임 활성화 wrapper가 거부하고, `draw_tickets` BEFORE INSERT guard는 결제 확정 transaction을 되돌리지 않은 채 주문 리워드 행만 억제한다. `/packs`·게임과 모든 공개 CTA는 숨기고 기존 `user_cards` 바인더 조회는 유지한다. 활성화는 법무·운영 증거를 반영한 별도 migration으로만 한다.
- **`open_notification(notification_id)` / `set_ip_notification_preferences(ip_id, drops?, events?, auto_follow=false)`** — 두 RPC 모두 `auth.uid()`를 다시 확인하는 `SECURITY DEFINER` 함수다. 전자는 본인 알림의 `read_at`을 단조롭게 기록하고 앱 내부 `link_path`를 반환한다. 후자는 선택적으로 팔로우 생성과 채널 설정을 한 transaction에서 처리하고, 기존 팔로우에서는 null channel을 보존한다. 테이블 직접 mutation 권한은 열지 않는다.
- **`edit_own_post(target_post_id, post_text, post_ip_id, post_tag)`** — `auth.uid()`와 작성자·visible 상태를 한 경계에서 확인하고 대상 포스트를 `FOR UPDATE`, 새 IP를 `FOR KEY SHARE`로 잠근다. 직접 UPDATE는 봉인하고 수정 가능한 세 필드만 변경하며 이전·현재 IP와 수정 시각을 반환한다.
- **인앱 알림 trigger** — 주문의 최초 `paid`·`shipping` 전이, `draw_tickets` statement INSERT, 인증된 staff의 runtime `goods`·`events` INSERT가 권위 변경과 같은 transaction에서 `notifications`를 발급한다. `(user_id, dedupe_key)`로 중복을 막고 긴 catalog id는 원문 `source_id`와 SHA-256 dedupe를 분리한다. 카드팩은 사용자·source별 advisory lock 뒤 현재 총량을 다시 집계하며 후속 발급 시 기존 행을 최신 unread로 갱신한다. 카탈로그 fan-out은 `INSERT ... SELECT`이고 seed/migration INSERT와 IP 없는 이벤트는 건너뛴다.
- **`admin_estimate_notification_recipients` / `admin_send_notification` / `admin_list_notification_history`** — staff를 DB에서 다시 확인하고 전체 profile 또는 특정 IP 팔로워 수를 추정한다. 발송은 operation UUID advisory lock 아래 대상 table에서 한 번의 `INSERT ... SELECT`로 `/notifications` 인앱 공지를 발급하고 `ROW_COUNT` 실제 수신자 수와 대상 snapshot을 `audit_log`에 멱등 기록한다. `all`은 임의 상한이나 일부 truncation 없이 현재 전체 profile을 뜻한다. 드롭·이벤트 preference는 운영 공지에 적용하지 않으며 이력은 수신자 PII를 반환하지 않는다.
- **`admin_upsert_home_curation`** — staff를 재검사하고 operation UUID advisory lock과 대상 curation·featured IP 행 잠금 아래 생성·수정·활성 토글을 처리한다. 같은 actor·operation·정규화 요청 replay만 기존 결과를 반환하고 actor 또는 payload 충돌은 거절하며, before/after와 요청을 `audit_log`에 같은 transaction으로 기록한다. table 직접 쓰기와 기본 함수 실행 권한은 봉인하고 authenticated role에만 RPC 실행을 부여한다.
- **`admin_archive_*` / `admin_unarchive_*`** — IP·굿즈·카드·이벤트를 hard delete 없이 보관/복원한다. staff를 DB에서 재검사하고 상태 전이만 한 번 감사하며 반복 호출은 멱등 성공한다. 판매 재고, 활성·예정 카드풀/발급 정책/게임/예매와 활성 하위 카탈로그가 남으면 보관을 거부하고, enabled이고 종료되지 않은 featured 큐레이션이 연결된 IP도 보관을 거부한다. 큐레이션 upsert와 IP 보관이 같은 IP 행을 잠가 경합을 직렬화하며, 보관된 부모 IP 아래 하위 항목 복원·신규 연결도 DB trigger가 거부한다.
- **`admin_search_members` / `admin_get_member_detail` / `admin_profile_signup_counts` / `admin_suspend_user` / `admin_unsuspend_user`** — profiles RLS는 self-only다. 목록은 이메일을 DB에서 마스킹하고, 명시적 상세만 전체 이메일·현재 `consents`·내부 사유·주문/예매/신고 집계를 반환하며, 대시보드 가입 수는 PII-free 집계만 반환한다. 받은 신고는 private subject snapshot으로 원문 삭제 뒤에도 보존한다. active staff는 user, active admin은 user/staff만 정지·해제하며 본인/admin 대상은 제외한다. 실제 상태 전이만 PII-free 감사하고 replay는 no-op이다. 정지된 privileged profile은 `is_staff()`가 false가 되며 정지 대상의 privileged role 승격도 거절한다. posts/comments/orders/ticket_orders/game_plays INSERT, 작성자 post UPDATE, draw-ticket 소비, staff check-in과 community Storage 업로드에는 DB guard를 두어 앱 사전 검사와 경합해도 전체 transaction을 롤백한다.

규칙: 카드팩·참여형 게임의 결과는 DB(또는 DB가 호출하는 신뢰 경로)만 확정하고 클라이언트는 그 결과를 연출한다. 이 서버 신뢰 불변식은 전달 계층이나 superseded ADR-0002에 의존하지 않는다. 모든 금전·재고·발급 RPC는 멱등·감사 가능해야 한다.

19+ 유한 실물 쿠지는 기존 `games`·`game_plays`·`draw_tickets`·카드 RNG와 데이터·경제·운영을 공유하지 않는다. 아직 as-built 스키마에는 없으며, `prize_sale` 예약→결제→개별 unit 배정은 [#212](https://github.com/icons-hq/icons-ip/issues/212), 공개 snapshot·last-one·결과 영수증·운영은 [#213](https://github.com/icons-hq/icons-ip/issues/213)의 acceptance evidence가 정본이다.

---

## 8. 인증 & 온보딩 흐름

1. 진입: 보호 액션 클릭 → `/login`.
2. 현재 수단: 이메일/PW와 Google/Apple/Kakao. 소셜 버튼은 공급자 allow-list를 둔 Server Action에서 Supabase `signInWithOAuth()`를 호출한다.
3. 회원가입: Supabase `signUp()`으로 확인 메일을 발송한다. 같은 브라우저에서 같은 이메일을 반복 제출하면 서명된 httpOnly cookie로 3회/10분 window를 추적하고 `auth.resend({ type: 'signup' })`로 재발송한다.
4. 비밀번호 재설정: `/login?mode=reset`은 계정 존재 여부와 무관한 응답을 반환하고, 정규화 이메일별 브라우저 요청을 서명 쿠키로 총 3회/10분 제한한다. 쿠키에는 raw email 대신 domain-separated HMAC digest만 저장하고, 활성 bucket은 12개로 제한한다.
5. 가입 확인·OAuth의 `redirectTo`는 query 없는 `/auth/callback`이다. recovery 메일은 `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`로 전용 `/auth/recovery/callback`을 호출하고 서버가 `verifyOtp`한다. query에는 `next`나 계정 식별자를 넣지 않는다. signup/OAuth는 `icons_auth_next`에 목적·안전한 `next`·발급 시각을 10분, recovery는 경로가 분리된 `icons_auth_recovery_next`에 같은 값을 최대 3,600초 동안 서명해 보존한다. 신규 recovery 요청은 shared callback state를 발급하지 않는다.
   - Callback origin은 고정 production/local origin 또는 플랫폼이 제공한 현재 `VERCEL_URL`만 허용하며, 임의의 요청 `Origin`/Host는 production canonical origin으로 정규화한다.
6. 전용 recovery callback은 `token_hash`와 `type=recovery`만 허용한다. token-hash `verifyOtp(type=recovery)`, 유효한 전용 서명 state, `getUser()` 재검증을 모두 통과한 뒤에만 계정 정지·온보딩 게이트를 건너뛰고 `/update-password`로 보낸다. `code`만 있는 PKCE 링크는 session exchange 없이 reset 오류 allow-list로 닫는다. 조건 불일치 시 검증 과정에서 만들어진 local session만 폐기하되, signed recovery state는 최신 유효 링크를 다시 쓸 수 있도록 성공 또는 자체 TTL까지 보존한다. provider 원문은 노출하지 않는다. 공용 callback의 code exchange 결과가 recovery이면 signed marker 유무와 관계없이 local session과 응답 cookie를 폐기하고 reset 오류로 닫는다. 일반 로그인·가입·OAuth callback은 profile이 정지 상태면 내부 사유 없는 `/account-suspended`로 먼저 보낸다. Redirect 직후 첫 SSR 요청이 아직 세션 cookie를 보지 못하면 성공 callback이 붙인 1회성 `session_ready` 표식으로 전체 탐색을 다시 수행하고, 세션 확인 전에는 비밀번호 폼을 렌더링하지 않는다. 가입과 OAuth는 profile/onboarding 판정 뒤 안전한 원래 경로로 복귀한다.
7. `/update-password`는 인증 세션에서 `updateUser({ password })`를 호출한다. 성공 뒤 global sign-out을 완료하고 로그인 화면으로 보내며, 전역 로그아웃 실패는 비밀번호 변경 성공과 잔여 세션 위험을 분리해 안내한다.
8. 일반 가입은 온보딩 완료 후 추천 IP 팔로우를 저장하고 보존된 `next` 경로로 이동한다.

Production Auth 설정:

- Site URL: `https://iconsip.com`
- Redirect URLs: production·www·기본 Vercel·local origin마다 `/auth/callback`과 `/auth/recovery/callback`을 허용한다. preview 호스트의 두 callback은 전용 preview 프로젝트 allow-list에서만 관리하며 production allow-list에서는 제거한다. Site URL·allow-list는 `scripts/sync-supabase-auth.mjs`가 두 프로젝트에 각각 적용·검증한다.
- 이메일 confirmation은 켜고, 가입 확인·비밀번호 재설정 메일은 Resend `iconsip.com` custom SMTP를 사용한다.
- workflow가 Supabase Management API로 Site URL, 두 callback의 redirect allow-list, `mailer_otp_exp=3600`, secure email change와 email rate limit을 먼저 PATCH 후 read-back한다. Production Vercel 배포가 성공한 뒤에만 `supabase/templates/recovery.html` 원문을 활성화·read-back하며, shared preview Auth 프로젝트의 template는 PR workflow에서 바꾸지 않는다. custom SMTP 필수 필드가 비어 있으면 production 배포를 실패시킨다.
- 외부 OAuth callback은 세 공급자 모두 `https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback`이다. Google은 production 공개 앱, Apple은 `com.iconsip.app` primary App ID와 `com.iconsip.web` Services ID, Kakao는 앱 ID `1520482`의 REST API 키를 사용한다. Apple secret은 2027-01-18 이전에 교체한다.
- Kakao 앱은 `(주) 아이콘스` 비즈 앱이고 `account_email`을 필수 동의·계정 정보 수집으로 요청한다. Supabase provider의 이메일 없는 사용자 허용은 꺼서 현재 `isOnboarded()`의 profile/auth email 필수 조건과 맞춘다.

연령 상태: 현재 온보딩의 `profiles.birth_date`는 자가신고 프로필 값이며 연령보증 증거가 아니다. v1 14+ 강제 seam·경계일·기존 계정 처리·법정 문서는 [#188](https://github.com/icons-hq/icons-ip/issues/188)이 승인·구현될 때까지 미완료다. 목표 `AgeAssurance`는 `minimum_age_14`와 NICE 기반 `adult_19` purpose를 분리하며, 결제사 인증은 어느 purpose도 대체하지 않는다. 19+ 계약 discovery는 #209, 상품 gate는 #210에서 추적한다.

---

## 9. 결제 통합 (provider-neutral 목표와 Toss legacy)

- 공개 계약은 `PaymentGateway.prepare(attempt)`, `confirm(returnInput)`, `reconcile(attempt)`, `refund(request)`다. 결과는 `approved | declined | canceled | unknown | needs_review`로 정규화한다. provider 구현은 `KorpayGateway`, 기존 거래 전용 `TossGateway`, 테스트 경계의 `FakePaymentGateway`다.
- 신규 checkout은 후속 전환 티켓에서 Korpay adapter로 이동한다. 이 expand 단계에서는 아래 Toss 경로를 기존 거래 호환 모드로 유지하되 모든 조회·취소·웹훅 DB 접근을 `LegacyTossPaymentRepository`의 `provider=toss` 경계에 모은다. #205·#206이 끝나기 전에는 provider 승인이 local pending 기록보다 먼저 도착할 수 있어 웹훅의 unknown payment key 조회를 명시적 `unknown_compatibility` 예외로 허용한다. 두 checkout 전환 뒤에는 이 상태에서 provider를 호출하지 않는 known-only 테스트로 교체한다.

- 기존 Toss 클라이언트: 현재 결제위젯으로 결제 요청(주문·티켓 공용). Toss 신규 checkout/confirm을 닫기 전까지 `orderId`는 `order_<uuid>`/`ticket_<uuid>`로 결제 목적을 실어 발급한다(`lib/payments/toss.ts`).
- 승인: successUrl 콜백이 **`/api/payments/confirm`** 을 호출 → 본인 소유·pending·미만료·금액 일치를 검증한 뒤 토스 승인 API를 호출하고 `payments`에 `pending`으로 기록한다. **승인 성공은 UX 반영용이다.**
- 확정: **웹훅 `/api/webhooks/tosspayments`(Route Handler)** 가 단일 진실원. 결제 웹훅에는 서명이 없으므로(서명 헤더는 지급대행 웹훅 전용) payload를 신뢰하지 않고 paymentKey로 **결제 조회 API를 재호출해 검증**한 뒤 `confirm_order_payment`/`confirm_ticket_payment` RPC(service_role, 멱등 키=paymentKey)를 호출한다. 검증된 조회 응답 원문을 `payments.raw`에 보존한다.
- 주문 상세의 브라우저 조회는 본인 RLS와 결제 안전 컬럼(`id`,`user_id`,`purpose`,`ref_id`,`provider`,`amount`,`status`,`created_at`), 환불 안전 컬럼(`id`,`payment_id`,`amount`,`status`,`created_at`), 본인 청약철회 요청의 공개 상태·처리 시각·결정 메모로 제한한다. security-invoker view가 base relation의 column privilege를 요구하므로 authenticated는 이 안전 컬럼을 직접 SELECT할 수도 있지만 table-wide SELECT와 `payment_key`·`idempotency_key`·`raw`는 거부한다. 내부 오류 코드·요청 사유·actor와 provider 원문은 서버 신뢰 경계에만 둔다.
- 기존 Toss 흐름: ① RPC로 `pending` 생성(재고 선점) → ② Toss 결제 → ③ 티켓은 승인 직전 DB payment claim, 승인 뒤 provider raw 보강(굿즈는 승인 뒤 `pending` 기록) → ④ 웹훅 확정(`paid`, 티켓 QR 발급/주문 확정) → ⑤ 실패·만료 시 선점 복원. 신규 provider 흐름은 공통 attempt와 outcome으로 교체한다.
- 실패·만료 복원: 만료 등 확정 불가 결제는 웹훅이 **토스 취소 API로 자동 환불**하고, 해당 paymentKey를 `refund_ticket_order_with_provider_evidence`에 전달해 그 결제 시도만 정합화한다. 같은 예매에 다른 pending/paid 결제가 남아 있으면 예매·정원은 유지한다. 승인 이력 없는 만료 pending 주문·예매는 pg_cron이 매분 `expire_stale_checkouts()`로 `cancel_order`/`refund_ticket_order`를 재사용해 정리한다(승인 진행 중 건 제외, 만료 후 5분 유예).
- 미지원 가상계좌: 입금 전 `WAITING_FOR_DEPOSIT`이면 토스를 먼저 자동 취소한 뒤 로컬 주문·재고를 원복한다. 입금 완료 건은 환불계좌 없이 자동 취소하지 않고 운영 오류로 노출한다.
- 사용자 취소: 본인 `pending` 무결제 주문만 즉시 선점을 원복한다. 결제 행이 있는 `pending`과 `paid`는 `/api/orders/[orderId]/cancel`이 provider 식별자 없이 `requested` 원장만 만들고 결제 확정·배송 전이를 막는다. staff 승인 뒤 서버가 결제사 fresh GET → 전액 취소 POST → fresh GET을 수행하며, 전액 취소가 모두 확인된 경우에만 주문·재고·미사용 카드팩 soft revoke·환불을 원자적으로 완료한다. 발급 attribution과 누적 발급 이력은 보존하고 `/packs`와 개봉 경로에서는 회수 티켓을 제외한다. 주문 상세의 발급 수는 개봉·회수를 포함한 전체 이력, 사용 가능 수는 `consumed_at`과 `revoked_at`이 모두 null인 티켓만 센다. 타임아웃·부분 취소·응답 불일치는 `needs_review`에 남겨 같은 멱등키로 재정합화하고, provider 호출 전 `requested`만 거절할 수 있다. `shipping`·`done`도 같은 요청 경로를 쓴다. 반품 입고 확인은 별도 상태가 아니라 staff 승인 행위에 내포되고, 재고 복원은 기존과 같이 승인 뒤 finalizer 시점에 일어난다.
- 티켓 취소: `/api/ticket-orders/[ticketOrderId]/cancel`은 same-origin·auth·onboarding·owner를 확인하고 order UUID 외 provider 입력을 받지 않는다. 시작 전 미사용 예매 전체만 수수료 없이 취소하며, 무결제 `pending`은 즉시 원복하고 결제 예매는 서버가 모든 결제를 fresh provider 증거로 정합화한다. QR은 raw token을 DTO·DOM·URL에 싣지 않고 paid+valid+비취소 상태를 재검증하는 no-store PNG Route Handler로만 제공한다.
- 환불: `refunds` 완료 기록 + 재고 원복은 RPC가 담당한다. 토스 쪽 취소(`CANCELED` 웹훅) 등 기존 호환 경로는 active 청약철회 요청을 완료할 수 없고, 해당 요청은 관리자 fresh GET 전체 검증 경로에서만 종결한다. 현재 배송·수령 시각이 없으므로 법정 7일을 앱이 자동 판정하지 않는다.
- 결제 원장은 `payments.provider`(`toss|korpay`)와 service-role 전용 `payment_attempts`로 provider-neutral expand를 마쳤다. 기존 행과 기존 confirm RPC는 호환 기본값 `toss`를 유지하고 기존 Toss `payment_key/raw`도 legacy 서버 감사 경로로 보존한다. Production workflow는 provider column이 없을 때 기존 행이 정확히 2건인지 read-only preflight로 먼저 확인하고, migration의 pre/post count를 `private.payment_migration_evidence`에 기록한 뒤 [Production readback runbook](./runbooks/provider-neutral-payment-backfill.md)을 자동 실행한다. 브라우저·staff 조회는 owner/staff RLS를 따르는 `payment_summaries`를 표준 표면으로 사용한다. 신규 provider 식별자·승인 참조는 allowlist 컬럼만 `private.payment_provider_evidence`에 append하며 원문 payload는 저장하지 않는다. 실제 신규 checkout 전환과 어댑터 선택은 후속 티켓에서 수행한다.

### 9.1 환경 변수 · 로컬/프리뷰 Toss 호환 검증과 Production 전환 경계

- 서버 전용 env: `TOSS_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION`, `TOSS_PAYMENT_KEY_PAIR_SHA256`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_PROVIDER_ENDPOINT`, `SITE_URL`. 클라이언트 번들에 노출하지 않는다(`NEXT_PUBLIC_` 접두사 금지). 위젯 공개 키와 공개 variantKey만 `NEXT_PUBLIC_TOSS_CLIENT_KEY`, `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY`로 전달한다.
- 이메일 env는 `prebuild` 필수 변수에 넣지 않는다. 미설정이면 트랜잭션 메일을 조용히 건너뛰고 로그만 남긴다 — 메일 미구성은 배포를 막을 사유가 아니고, 발송 실패가 결제 확정을 흔들어서도 안 된다. 발신 도메인 인증(SPF·DKIM·DMARC) 절차는 [`transactional-email.md`](./transactional-email.md) §3에 있다.
- 토스 키는 개발자센터 **API 키 > 결제위젯 연동 키**의 것을 쓴다: `TOSS_SECRET_KEY` = 위젯 시크릿 키(테스트 `test_gsk_…` / 라이브 `live_gsk_…`), `NEXT_PUBLIC_TOSS_CLIENT_KEY` = 위젯 클라이언트 키(`test_gck_…` / `live_gck_…`, 체크아웃 #90에서 사용). 두 키는 **같은 연동 키 세트**여야 한다 — 세트가 어긋나면 승인 API가 `INVALID_API_KEY`/`UNAUTHORIZED_KEY`/`NOT_FOUND_PAYMENT_SESSION`으로 실패한다. `test_sk_…`(API 개별연동 키)는 위젯 결제 승인에 쓰지 않는다.
- 키 미구성 환경에서 두 라우트는 503(`not_configured`)으로 응답한다 — mock/카탈로그-only 모드에서 안전.
- 로컬 검증 경로(테스트 키):
  1. 결제위젯 연동 테스트 시크릿 키(`test_gsk_…`)를 `.env.local`의 `TOSS_SECRET_KEY`로, 가상계좌를 제외한 테스트 UI의 variantKey를 `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY=ICONS_REVIEW`로, 로컬 Supabase service key(`supabase status`)를 `SUPABASE_SERVICE_ROLE_KEY`로 설정한다.
  2. 순수 로직은 `npm run test`(`lib/payments/toss.test.ts`), DB 계층(확정 RPC·만료 sweep)은 로컬 psql로 RPC를 직접 호출해 확인한다.
  3. 웹훅 실수신은 ngrok 등으로 로컬을 노출해 개발자센터에 웹훅 URL(`https://<host>/api/webhooks/tosspayments`, `PAYMENT_STATUS_CHANGED`)을 등록하고 테스트 결제로 유발한다. 성공 기준은 10초 내 200 응답, 실패 시 최대 7회 재전송된다.
- 프리뷰는 테스트 키와 정확히 `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY=ICONS_REVIEW`인 테스트 UI를 transitional compatibility 검증에만 쓴다. Production에서 신규 Toss live checkout이나 Toss 실결제 canary를 활성화하지 않는다. #205·#206 이전에는 기존 checkout 코드가 남지만 공개 판매 gate는 닫고, 전환 뒤에는 `provider=toss`로 확인된 기존 두 거래의 조회·취소·웹훅만 유지한다. 신규 결제는 #87의 승인 범위·rotated credential·보안/운영 답변과 #207 dark deploy 뒤 Korpay로 연다. 기존 Toss 거래가 공급사 콘솔과 내부 원장에서 모두 종결된 뒤에만 Toss runtime과 server secret 제거를 별도 PR로 수행한다.
- Vercel preview/production 변수는 sensitive로 유지한다. GitHub Actions는 값을 복호화할 수 없는 `vercel pull` + prebuilt 경로를 쓰지 않고 Vercel 원격 build를 요청하며, `prebuild` guard가 Vercel build 안에서 필수 변수와 남은 Toss 호환 키 모드를 검증한다. Toss는 Preview/로컬 fixture와 기존 known-only 거래 readback으로만 확인한다. 실제 provider-backed canary는 #207의 rotated Korpay credential·공급사 취소 조율·직전 사용자 확인 뒤 최소 금액 1회로 한정한다.

---

## 10. 미디어 / 스토리지

- **Supabase Storage**
  - `public-media` 버킷: 검증을 마친 굿즈·카드·IP·이벤트·홈 큐레이션 아트워크의 public read 전용 표면이다. 브라우저 쓰기는 열지 않고, service role만 `catalog/<kind>/<uuid>.<ext>` 신규 경로로 promote한다. 큐레이션은 `catalog/curation/<uuid>.<ext>`를 사용하며, 같은 URL overwrite 대신 새 UUID 경로를 발급한다.
  - `admin-artwork-staging` 버킷: 검증 전 관리자 아트워크를 두는 private 표면이다. 브라우저는 authenticated Storage 요청으로 업로드하며 RLS가 active staff와 actor·경로·선언 MIME·크기·만료 시각이 일치하는 pending claim만 허용한다. claim이 처리·거절·만료되는 즉시 같은 경로 재업로드도 차단한다. actor별 미만료 claim 예산은 두 갈래다 — staging에 쓰고 있는 pending/processing은 최대 12개(가장 큰 폼인 굿즈 6칸을 한 번에 채울 수 있어야 한다), 이미 public-media로 승격돼 저장을 기다리는 verified는 별도로 최대 60개다. verified를 같은 통에 세면 저장하지 않고 떠난 폼 두 장이 그 운영자의 업로드를 전부 막는다.
  - `user-uploads` 버킷: 커뮤니티 업로드·프로필 이미지. 쓰기는 RLS로 본인 폴더(`<uid>/...`)에 제한하며 community path는 restrictive policy에서 post-create capability가 기본 OFF다. 프로필 이미지 claim과 기존 community 객체 읽기·본인 삭제는 유지하고, 공개 피드는 `visible` 포스트에 연결된 작성자 본인 경로의 이미지만 signed URL로 읽는다.
- 서버는 actor advisory lock 아래 claim을 `pending→processing`으로 먼저 전이한 뒤에만 staging 객체를 읽는다. actor별 동시 processing은 1개, 시작은 1분당 12회로 제한한다. 두 숫자가 지키는 것이 다르다 — 동시 1개는 한 운영자가 Sharp decode를 병렬로 돌리지 못하게 하는 자원 직렬화이고, 1분당 12회는 남용 억제 창이다. 후자는 굿즈 폼 6칸을 채우고(6회) 한 번 갈아끼울 수 있는(6회) 크기이며, `pending`·`processing` 클레임 예산 12와 같은 근거를 쓴다. 4회로 두면 예산은 통과하고 다섯 번째 검증 시작에서 막혀 실패 지점만 옮겨진다. 그 뒤 Sharp로 선언 MIME과 실제 JPEG/PNG/WebP 형식, 5MiB 이하, 축별 8192px 이하, 총 40MP 이하, 단일 프레임을 완전히 decode해 검증한다. 통과한 이미지는 같은 형식으로 다시 인코딩해 metadata와 부가 payload를 제거한 뒤 service role로 `public-media`에 promote하고 claim을 verified로 바꾼다. verified 전이는 만료를 최소 2시간 뒤로 밀어 운영자가 폼을 다 채우는 동안 클레임이 죽지 않게 한다 — 업로드 칸이 6개인 굿즈 폼에서 10분 창은 첫 이미지가 저장 전에 만료돼 트랜잭션 전체를 되돌린다.
- 브라우저 업로드 실패는 active claim만 최초 1회 `rejected`로 전이하는 취소 RPC로 즉시 정리하며, 이미 종료된 claim의 반복 취소는 DB·Storage 작업 없이 종료한다. 검증 실패·거절·만료 claim은 정확한 actor/path와 attached 여부를 재검증하는 service role 경로로 정리한다. 요청 시 소량 opportunistic sweep 외에도 `CRON_SECRET` exact bearer로 보호된 `/api/cron/admin-artwork` Vercel Cron이 매일 Storage API 정리를 수행한다. attached claim은 만료와 무관하게 staging만 정리해 카탈로그가 참조하는 public 원본을 보존한다.
- 카탈로그와 `home_curations`의 `image_path` INSERT/변경 trigger는 같은 transaction에서 actor 소유의 verified·미만료 claim을 `attached`로 원자적으로 소비한다. 따라서 Storage 직접 쓰기나 관리자 RPC 직접 호출만으로는 미검증 경로를 연결할 수 없다.
- 관리자 폼은 선택 파일을 먼저 미리보고 검증된 경로를 자동 반영하되, 파일 선택·업로드 중에는 바깥 카탈로그 form 저장을 차단한다. IP 키아트는 가로형 preview와 가로 이미지 안내를 사용하고, 업로드 후 카탈로그 저장이 별도 단계임을 표시한다.
- 카탈로그 테이블은 경로(`image_path`)만 저장하고 렌더 시 public URL로 변환한다. 교체 전 객체의 일괄 정리는 별도 운영 범위다.

---

## 11. 검색

- Postgres `pg_trgm` 확장 + ILIKE/유사도 정렬. 대상: `ips`·`goods`·`cards`·`posts`·태그.
- 구현은 검색용 RPC 또는 뷰. 한국어 형태소 한계는 v1 규모에서 수용, 확장 시 외부 인덱스 검토.

---

## 12. 운영 백오피스 `/admin`

- 같은 Next 앱의 라우트 그룹. 진입 시 `profiles.role ∈ {staff, admin}` 검사(라우트 + RLS 이중).
- 기능: 카탈로그 CRUD·보관 상태 필터·참조 가드 보관/복원, 홈 히어로·특집 IP·공지 배너의 순서·KST 기간·활성 관리(`/admin?section=curations`), **카드풀 운영 기간·등급별 발급 확률·카드 풀 바인딩**, 뽑기권 발급 정책(`/admin?section=policy`), 참여형 게임(`/admin?section=game`) 관리, 이벤트·티켓 회차, 독립 모바일 현장 검표(`/admin/check-in`), 주문 검색·배송 전이·청약철회/환불 정합화, 인앱 공지 수신자 추정·즉시 발송·이력(`/admin?section=notifications`), 커뮤니티 신고·포스트/댓글 숨김, 마스킹 회원 검색·명시적 상세·정지/해제(`/admin?section=members`). 큐레이션 공지 저장은 알림 fan-out을 일으키지 않고 공지 발송 콘솔로의 navigation만 제공한다.
- 모든 민감 작업은 `audit_log` 기록.

---

## 13. mock → real 이전 경로

1. **스키마**: §5 테이블을 Supabase 마이그레이션으로 생성, RLS·RPC 적용.
2. **시드**: `lib/data.ts`의 IP/굿즈/카드/이벤트/포스트를 시드 스크립트로 적재(타입 이미 정의됨 → 매핑 단순).
3. **읽기 교체**: screen 컴포넌트의 `DATA.*` 접근을 Server Component 페치로 점진 교체. `'use client'` 화면은 데이터를 props로 받도록 분리.
4. **액션 도입**: 장바구니/팔로우/작성 등은 Server Action으로, 돈/재고는 RPC로.
5. **결제 연결**: provider-neutral attempt/finalizer → Korpay 신규 결제, Toss 기존 거래 정리.
6. 단계는 [PRD §9](./PRD.md#9-출시-단계)의 P0→P3 순서를 따른다.

`lib/routes.ts`의 라우트 맵·`useGo`는 유지(프로토타입 네비게이션 자산 재사용). 프로토타입의 `/exchange`·`/market` 화면은 v2까지 읽기/플레이스홀더로 둔다.

---

## 14. 목표 디렉토리 (증분)

```
app/
  (existing screens)                  # 점진적으로 서버 페치 + 액션 연결
  auth/callback/route.ts              # 가입/OAuth exchange + recovery fail-closed
  auth/recovery/callback/route.ts     # recovery token-hash 검증 + fail-closed 세션 정리
  login/actions.ts                    # 이메일 Auth + signup resend + password reset request + logout
  update-password/                    # recovery 세션 재검증 + 비밀번호 변경 + global sign-out
  onboarding/actions.ts               # 프로필 완성 + 추천 IP 팔로우
  my/                                 # 로그인·온보딩 보호 통합 진입 허브
  notifications/                      # 본인 알림함 + 팔로우 IP별 설정
  ip/actions.ts                       # IP 팔로우 + 인앱 알림 설정 보호 액션
  admin/                              # 역할 게이트 백오피스 + 공지 발송 action
  api/
    webhooks/tosspayments/route.ts    # 결제 확정 웹훅(재조회 검증)
    payments/confirm/route.ts         # 결제 승인 서버 경로 (만료 정리는 pg_cron)
lib/
  auth/                               # 온보딩·next/error helper, signed auth/recovery cookie, auth server state
  catalog.ts                          # Supabase catalog read + mock fallback adapter
  data.ts                             # → 시드 소스로 격하, 로컬 fallback 유지
  ip-follow*.ts                       # 팔로우 상태/알림 설정/RPC helper
  notifications*.ts                  # 알림 DTO + 본인 최신 50건 loader
  admin/notifications*.ts            # 관리자 공지 form/추정/발송 이력 경계
  payments/                           # PaymentGateway 계약 + legacy Toss ledger + provider adapter/Fake
  supabase/{client,server,middleware} # 유지
  db/                                 # 쿼리·RPC 래퍼
supabase/
  migrations/                         # 스키마 + RLS + RPC 함수
  seed.sql                            # data.ts 기반 시드
docs/
  PRD.md  ARCHITECTURE.md
```

---

## 15. 규제의 기술적 매핑

| 규제(요구사항) | 기술 반영 |
|---|---|
| 카드 리워드 운영 증거 | `pool_odds` 변경과 카드 발급·개봉·회수 이력을 감사 가능하게 보존. 이것만으로 법적 적용 제외를 주장하지 않는다 |
| 14+ 가입 기준 | 현재 `birth_date` 자가신고와 목표 `minimum_age_14` 증거를 구분. #188 전에는 강제 완료로 보지 않는다 |
| 19+ 성인 상품 | NICE `adult_19` receipt와 private 상세·미디어 gate를 #209·#210에서 별도 구현. PG 인증으로 대체 금지 |
| 전자상거래(청약철회) | `orders`/`refunds` 상태기계 + 환불 RPC |
| PIPA/청소년보호 | `profiles.consents`·`birth_date`, 최소수집·동의·파기 |
| UGC 안전 | `reports`/`blocks` + `/admin` 모더레이션 + 게시물 `status` |

---

## 16. 미해결 결정

- **14+ 연령보증 세부 계약** — timezone·경계일·기존 계정 처리·증거 TTL은 #188 human acceptance가 필요하다.
- **19+ NICE와 유한 실물 쿠지** — #209·#210·#212·#213의 계약·법률·IP·재고·환불 evidence가 필요하며 현재 as-built 기능이 아니다.
- **결제 provider 전환** — provider-neutral 원장과 `PaymentGateway` seam은 expand를 마쳤다. #205·#206에서 신규 checkout을 Korpay로 옮길 때까지 Toss checkout을 호환 유지하고, 이후에는 기존 거래 정리 전용으로 축소한다(§9, #204~#207).
- 한국어 검색 품질이 임계 넘는 시점의 외부 검색엔진 도입.

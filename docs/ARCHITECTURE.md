# ICONS — 아키텍처

> 상태: Draft · 최종 수정 2026-07-16 · 짝 문서: [`PRD.md`](./PRD.md)
> 이 문서는 **어떻게 만들 것인가**를 정의한다. 현재 코드베이스(프로토타입)에서 출발해 목표 아키텍처와 이전 경로를 기술한다.
>
> ⚠️ 이 프로젝트의 Next.js 16은 학습 데이터와 API/관례가 다를 수 있다(`AGENTS.md`). 실제 코드 작성 전 `node_modules/next/dist/docs/`를 확인한다. 본 문서가 코드 디테일과 어긋나면 코드를 따른다.

---

## 1. 설계 원칙

1. **공개 우선 브라우징**: 카탈로그·피드는 비로그인 공개. 보호는 액션 단위(결제·가챠·작성·팔로우).
2. **돈·재고는 DB에서 지킨다**: 가챠·티켓 재고·주문·지갑의 원자성은 Postgres 함수(RPC)+행 잠금으로 보장. 앱 레벨 동시성에 의존하지 않는다.
3. **결제는 웹훅이 확정한다**: 클라이언트 성공 신호는 UX용. 주문/충전 확정은 토스페이먼츠 웹훅 + 멱등 처리.
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
| 데이터 | Supabase 공개 카탈로그, 커뮤니티 visible feed/comment preview, Postgres 검색 읽기 + mock fallback. Vercel Preview는 static mock catalog를 기본 사용. IP 상세 커뮤니티 preview도 Supabase `posts`/`public_profiles`에서 읽음 | `lib/catalog.ts`, `lib/catalog-source.ts`, `lib/community.server.ts`, `lib/search.ts`, `lib/data.ts` |
| 인증 | Supabase SSR 이메일/PW Auth, 확인·recovery 메일 callback, 비밀번호 재설정, 온보딩 게이트. 표시 전용 AuthPresenceProvider가 unknown/signed-in/signed-out 상태를 AuthButton·MobNav에 동기화하고 보호 판정은 각 Server Page가 수행한다. env 없으면 no-op/폼 비활성화 | `app/login/*`, `app/auth/callback/route.ts`, `app/update-password/*`, `app/onboarding/*`, `app/my/*`, `components/shell/AuthPresenceProvider.tsx`, `components/shell/AuthButton.tsx`, `lib/auth/*`, `lib/supabase/*`, 루트 `proxy.ts` |
| 보호 액션 | IP 팔로우/언팔로우·IP별 드롭/이벤트 알림 설정, 알림 읽음 처리, 온보딩 추천 IP 저장. 커뮤니티 포스트 작성, 댓글, 좋아요, 작성자 삭제, 신고, 차단은 Server Action + RPC로 연결 | `app/ip/actions.ts`, `app/notifications/actions.ts`, `app/onboarding/actions.ts`, `app/community/actions.ts`, `lib/ip-follow*`, `lib/notifications*`, `supabase/migrations/20260623090001_ip_follow_rpc.sql`, `supabase/migrations/20260624103001_community_comment_like_actions.sql`, `supabase/migrations/20260626090001_community_moderation_actions.sql`, `supabase/migrations/20260716090001_in_app_notifications.sql` |
| 인앱 알림 | 본인 RLS 수신함 최신 50건·unread count, 보호 알림함/IP 설정 화면. 주문 상태·카드팩 발급·runtime staff 카탈로그 INSERT trigger와 audited 관리자 즉시 공지가 같은 transaction에서 멱등 발급 | `app/notifications/*`, `components/screens/Notifications.tsx`, `components/screens/NotificationSettings.tsx`, `components/shell/NotificationBell.tsx`, `components/admin/sections/NotificationSection.tsx`, `supabase/migrations/20260716090001_in_app_notifications.sql`, `supabase/migrations/20260716100001_admin_notification_console.sql` |
| 굿즈 커머스 | 비로그인 localStorage·로그인 `cart_items` 병합, 멱등 `place_order` 재고 선점, 토스 결제위젯 redirect 승인, 웹훅 확정·만료 복원, 본인 주문 내역·상세·배송 전 청약철회 요청·상태 조회 | `app/cart/*`, `app/checkout/*`, `app/orders/*`, `app/api/orders/*`, `app/api/payments/confirm`, `app/api/webhooks/tosspayments`, `lib/checkout*`, `lib/orders*`, `lib/payments/*` |
| 티켓 예매 | 공개 이벤트 상세·회차 잔여 조회, 멱등 `reserve_tickets` 정원 선점, 티켓용 토스 결제위젯, 웹훅 확정·QR 발급·만료 복원, 본인 티켓 목록/상세·보호 QR·예매 전체 취소/환불 | `app/events/[eventId]/*`, `app/ticket-checkout/*`, `app/tickets/*`, `app/api/tickets/*`, `app/api/ticket-orders/*`, `app/api/payments/confirm`, `app/api/webhooks/tosspayments`, `lib/ticketing*`, `lib/payments/*` |
| 운영 | staff/admin 게이트, 카탈로그 CRUD, 카드풀 운영 기간·등급별 확률·카드 풀 바인딩, 주문 대상별 뽑기권 발급 정책, 카드 보상형 참여형 게임 등록·운영과 PII-free 플레이 집계, 전체/IP 팔로워 인앱 공지의 추정·즉시 발송·이력, 감사 로그, 커뮤니티 신고 처리, 주문 검색·배송 전이·청약철회 승인/거절/재정합화, 실재고 입고·보정 | `app/admin/*`, `components/admin/*`, `lib/admin/*`, `supabase/migrations/20260714190001_admin_order_console.sql`, `supabase/migrations/20260714200001_admin_stock_adjustment.sql`, `supabase/migrations/20260715010001_admin_card_pool_console.sql`, `supabase/migrations/20260715020001_admin_reward_policy_console.sql`, `supabase/migrations/20260715030001_admin_game_console.sql`, `supabase/migrations/20260716100001_admin_notification_console.sql` |
| CI/CD | GitHub Actions `CI/CD Pipeline`: PR 검증 + Vercel preview 배포, merge queue 검증, `main` push production 배포. Actions 앱 빌드 Node는 26 | `.github/workflows/pipeline.yml` |
| 배포 | PR은 Vercel 원격 preview build/deploy, `main` push는 Supabase linked migration push 후 Vercel 원격 production build/deploy. Sensitive 환경변수는 Vercel build 안에서 검증하며 Vercel Git 자동 배포는 비활성화 | GitHub Secrets + `.github/workflows/pipeline.yml`, `vercel.json` |
| Production runtime | Vercel project/runtime Node.js Version은 공식 지원 범위인 24.x 유지 | Vercel Project Settings |
| 도메인/DNS | `iconsip.com` primary, `www.iconsip.com` alias, `icons-ip.vercel.app` fallback. DNS는 Cloudflare에서 관리 | Cloudflare DNS, Vercel Domains |
| Auth 메일 | Supabase Auth custom SMTP → Resend. Sender는 `no-reply@iconsip.com`, Resend domain은 `iconsip.com` | Supabase Auth SMTP, Resend |

**요청 프록시 주의**: 루트 `proxy.ts`가 `export function proxy()` + `config.matcher`로 동작한다(Next 16에서 미들웨어가 이 형태). `lib/supabase/middleware.ts`의 `updateSession`을 호출하며 **보호 액션 전까지 로그인 리다이렉트는 하지 않는다**(공개 브라우징 정책).

화면↔라우트 매핑(현재):
`/`·`/ip`·`/ip/[id]`·`/shop`·`/cart`·`/checkout`·`/checkout/[orderId]`·`/checkout/success`·`/checkout/fail`·`/orders`·`/orders/[orderId]`·`/packs`·`/binder`·`/exchange`·`/community`·`/events`·`/events/[eventId]`·`/ticket-checkout/[ticketOrderId]`·`/ticket-checkout/success`·`/ticket-checkout/fail`·`/tickets`·`/tickets/[ticketOrderId]`·`/notifications`·`/notifications/settings`·`/my`·`/settings`·`/market`·`/search`·`/login`·`/update-password`

---

## 3. 목표 아키텍처

```
┌────────────────────────── Vercel (Next.js 16) ───────────────────────────┐
│  Server Components  ──read──▶ Supabase (anon, RLS)                         │
│    └ /events/[id] → /ticket-checkout/[id] ──▶ 회차·예매·결제 상태          │
│  Server Actions     ──rpc──▶ Supabase (인증 검증 + 최소 권한 RPC)          │
│  Route Handlers                                                           │
│    └ /api/payments/confirm          ──▶ 토스 승인(UX용 pending 기록)        │
│    └ /api/orders/[id]/cancel        ──▶ 청약철회 요청/무결제 즉시 원복      │
│    └ /api/webhooks/tosspayments  ◀── 주문·티켓 결제 확정 (멱등)           │
│    └ /api/cron/*                  (경매 마감·예약 정리 등, v2 포함)         │
│  /admin (role-gated)                                                      │
└──────────────┬───────────────────────────────────────────┬──────────────┘
               │                                             │
        ┌──────▼──────┐                              ┌───────▼────────┐
        │ TossPayments │  결제/충전/환불               │   Supabase     │
        │  결제창/위젯  │                              │  Postgres+RLS  │
        │  + 웹훅       │                              │  RPC(SECDEF)   │
        └─────────────┘                               │  Auth          │
                                                      │  Storage       │
                                                      └────────────────┘
                                                              │
                                                              ▼
                                                      Resend custom SMTP
```

Cloudflare DNS는 `iconsip.com`/`www.iconsip.com`을 Vercel로 보내고, 같은 zone에 Resend 발송 인증용 DKIM/SPF/DMARC/MX 레코드를 둔다.

핵심: **읽기**는 Server Component가 RLS 하에서 직접 조회. **상태 변경**은 Server Action이 검증 후 **RPC 함수** 호출. **돈 확정**은 토스 웹훅(Route Handler) → RPC. Auth 메일은 Supabase 기본 메일 provider가 아니라 Resend custom SMTP를 사용한다.

---

## 4. 기술 스택 (목표)

| 영역 | 선택 | 비고 |
|---|---|---|
| 호스팅 | **Vercel** (Fluid Compute) | Next 16, Route Handler 웹훅·Cron |
| DB/Auth/Storage | **Supabase** (Postgres + Auth + Storage) | 스캐폴딩 이미 존재 |
| 인증 | Supabase Auth: 현재 **이메일/PW** 구현, 목표 **Google + Apple + Kakao** 추가 | 소셜 버튼은 UI만 있고 아직 비활성화. 모든 가입 경로는 온보딩에서 프로필 완성 |
| 결제 | **토스페이먼츠** 직접(결제창/위젯 + 웹훅) | 단일 PG. 굿즈·티켓·지갑 충전 공용 |
| 검색 | **Postgres** pg_trgm + ILIKE | 외부 검색엔진 없음(v1) |
| 미디어 | **Supabase Storage** | public(카탈로그/아트워크) + private `user-uploads`(사용자 업로드) |
| 무결성 | **Postgres RPC**(SECURITY DEFINER) + RLS | 가챠·티켓·주문·지갑 |

---

## 5. 데이터 모델

`lib/data.ts`의 타입을 출발점으로 한다. 도메인별 핵심 테이블(키 컬럼만):

### 5.1 신원 & 사용자
- `profiles` (id=auth.users.id, email, nickname, birth_date, **role** `user|staff|admin`, consents jsonb, created_at)
- `ip_follows` (user_id, ip_id, notify_drops, notify_events) — 관심 IP와 인앱 드롭·이벤트 알림 설정. 두 설정은 기본 true이며 언팔로우 시 행과 함께 삭제된다.
- `notifications` (id, user_id, type, title, body, link_path, source_type, source_id, dedupe_key, read_at, created_at) — 본인 인앱 수신함. 원본 source id는 보존하고 `(user_id, dedupe_key)`로 재처리를 멱등화한다.

### 5.2 카탈로그 (공개 읽기)
- `verticals` (key, label, color) — 캐릭터 IP·게임·애니메이션
- `ips` (id, title, sub, vertical_key, glyph, bg, tagline, synopsis, featured, fans/goods/cards 집계)
- `goods` (id, ip_id, name, type, price, badge, stock, image_path)
- `events` (id, ip_id?, title, mode, status, starts_at, ends_at, location, accent, image_path)

### 5.3 가챠 & 카드 (P2)
- `card_pools` (id, ip_id, name, active_from/to) — 풀(픽업/한정 포함). 종료는 시작보다 뒤여야 한다.
- `cards` (id, ip_id, pool_id, name, no, rarity `N|R|SR|SSR|HOLO`, image_path) — 풀 바인딩 시 복합 FK로 같은 IP를 강제한다.
- `pool_odds` (pool_id, rarity, probability) — **확률 공시 원천**. 5등급 전체가 범위·소수 5자리·정확한 합계 1을 만족하고, 양수 확률 등급에는 소속 카드가 있어야 한다.
- `reward_policies` (id, pool_id, trigger, target_ip_id, target_good_id?, min_amount, tickets_per_grant, active, active_from/to) — 주문 대상 IP와 선택 same-IP 굿즈를 독립 보상 카드풀에 연결한다. 동일 주문에 매칭되는 정책은 모두 누적 적용한다.
- `draw_tickets` (id, user_id, pool_id, source/source_id, ordinal, reward_policy_id?, consumed_at, revoked_at, created_at) — 발급 정책 attribution과 발급 이력을 보존한다. 기존 티켓은 `reward_policy_id`가 null일 수 있고, 주문 취소는 미개봉 티켓을 삭제하지 않고 soft revoke한다.
- `wallets` (user_id, balance) — 충전 잔액
- `wallet_ledger` (id, user_id, delta, reason `charge|pull|refund`, ref_id, created_at) — 장부
- `pulls` (id, user_id, pool_id, cost, pity_before/after, created_at)
- `pull_results` (pull_id, card_id, rarity)
- `user_cards` (user_id, card_id, qty, acquired_at) — 바인더(보유)
- `games` (id=slug, type, title, event_id?, config, reward_pool_id?, per_user_daily_limit, active_from/to) — 카드 variant의 IP는 보상 카드풀에서 파생한다. 신규 운영 경로는 `marble_roulette`·10개 구슬·서버 생성 등급 라인업으로 고정한다.
- `game_plays` (id, game_id, user_id, result, idempotency_key, created_at) — 서버가 결정한 결과의 멱등 재생 원장. 관리자 집계에는 사용자 ID·결과 payload를 노출하지 않는다.

### 5.4 커머스 (P1)
- `carts` / `cart_items` (user_id, good_id, qty)
- `orders` (id, user_id, status `pending|paid|shipping|done|canceled`, total, address jsonb, created_at)
- `order_items` (order_id, good_id, qty, unit_price, good_name/type/ip_id_snapshot) — 주문 시점 굿즈 정체성·가격 장부
- `payments` (id, provider `toss`, order_id?/charge_id?, amount, status, payment_key, **idempotency_key**, raw jsonb)
- `refunds` (id, payment_id, amount, reason, status)
- `order_cancellation_requests` (id, order_id, requested_by, status, decision, provider 상태 코드, 시각) — 사용자 요청과 운영 결정의 durable 원장

### 5.5 티케팅 (P3)
- `ticket_types` (id, event_id, name, price, capacity, sold) — 회차/종류. 공개 읽기, staff 쓰기는 audited RPC만 허용
- `ticket_orders` (id, user_id, event_id, status, total, expires_at, reservation_key) — 사용자별 reservation key로 동일 예매 요청을 멱등화
- `tickets` (id, ticket_order_id, ticket_type_id, qr_token, status `valid|used|refunded`)
- `ticket_cancellation_requests` (ticket_order_id, requested_by, status, policy/cutoff/금액 snapshot, attempt lease) — 사용자·provider 취소를 멱등 정합화하는 durable 원장
- `check_ins` (ticket_id, checked_at, by_staff)

### 5.6 커뮤니티 (P0)
- `posts` (id, user_id, ip_id?, text, image_path?, tag, status `visible|hidden`, created_at)
- `comments` (id, post_id, user_id, text)
- `likes` (post_id, user_id)
- `reports` (id, target_type `post|comment|user`, target_id, reporter_id, reason, status)
- `blocks` (user_id, blocked_user_id)
- `community_trending_tags(window_days, result_limit)`는 RLS를 유지하는 security-invoker RPC로 최근 visible 포스트 태그를 집계한다. 기본은 최근 7×24시간·상위 10개이며 오류나 0행은 mock fallback 없이 빈 결과로 닫는다.

### 5.7 운영
- `audit_log` (id, actor_id, action, target, diff jsonb, created_at)

> v2(연기) 테이블: `listings`/`offers`/`trades`/`escrow`/`payouts`(마켓·교환), `memberships`/`subscriptions`(유료 팬덤). 스키마 자리만 예약.

---

## 6. 권한 모델 (RLS)

| 테이블군 | 읽기 | 쓰기 |
|---|---|---|
| 일반 카탈로그(verticals/ips/goods/events) | **공개(anon)** | staff/admin only |
| 카드 리워드 카탈로그(cards/card_pools/pool_odds/reward_policies) | **공개(anon)** | 역할을 재검사하는 audited RPC only |
| 참여형 게임 카탈로그(games) | **공개(anon)** | 역할을 재검사하는 audited RPC only |
| game_plays | **본인만** | `play_game` 신뢰 RPC만 |
| draw_tickets/card_grants | **본인만** | 신뢰 RPC/service role만 |
| profiles/ip_follows/carts/orders/wallets/user_cards/ticket_orders | **본인만** | 본인 읽기, 쓰기는 신뢰 RPC/service role만 |
| notifications | **본인만** | 직접 쓰기 없음. 읽음 처리는 `open_notification`, 발급은 신뢰 trigger 또는 staff를 재검사하는 audited RPC만 |
| tickets/ticket_cancellation_requests | **본인만 안전 컬럼** | QR 원문·provider/attempt/error 정보는 서버 경계 전용, 쓰기는 신뢰 RPC/service role만 |
| posts/comments/likes | 공개 읽기(visible) | 작성자 본인, 신고/숨김은 본인+운영 |
| reports/blocks | 본인+운영 | 본인 |
| audit_log | admin only | RPC만 |

- 돈/재고가 걸린 INSERT/UPDATE는 테이블 직접 쓰기 대신 **RPC(SECURITY DEFINER)** 로만 허용.
- 카드풀·확률·카드·발급 정책의 직접 write 권한과 정책도 제거하고, staff/admin audited RPC만 허용한다.
- 관리자 권한은 `profiles.role`로 판정, `/admin` 라우트와 RLS 양쪽에서 검사.

---

## 7. 트랜잭션 & 무결성 (RPC)

핵심 원자 연산은 `SECURITY DEFINER` Postgres 함수로 구현하고, Server Action에서 인증 컨텍스트로 호출한다.

- **`pull_gacha(pool_id, count)`** — 1 트랜잭션:
  1) 지갑 잔액 `FOR UPDATE` 잠금·차감 검증
  2) `pool_odds` 기반 RNG 추첨 (+ **천장**: `pulls.pity` 누계로 보장 발동)
  3) `pulls`/`pull_results` 기록, `user_cards` 적립(중복 시 정책 처리)
  4) `wallet_ledger`에 `pull` 기록
- **`reserve_tickets(user_id, ticket_type_id, qty, reservation_key)`** — 결제 환경·인증·온보딩을 확인한 Server Action만 service role로 호출하며 브라우저 롤에는 execute를 열지 않는다. DB에서도 사용자 온보딩을 재확인하고 사용자+요청 키 advisory lock과 unique index로 재시도를 멱등화한다. 이벤트를 먼저 잠근 뒤 회차를 `FOR UPDATE`로 잠그고 예매 상태·유료 가격·오픈 시각·1인 한도·잔여를 재검증해 10분 `pending` 예매와 QR 없는 티켓 placeholder를 만든다. QR은 웹훅의 `confirm_ticket_payment`에서만 발급한다.
- **`admin_upsert_ticket_type(operation_id, ticket_type_id, event_id, name, price, capacity)`** — operation/type UUID advisory lock 뒤 이벤트를 `FOR KEY SHARE`, 기존 회차를 `FOR UPDATE`로 잠근다. 최신 `sold` 미만 capacity를 거절하고, 티켓 이력이 생기면 이벤트·회차명·가격을 잠그며, 전후 상태를 `audit_log`에 멱등 기록한다. `sold`·`per_user_limit`·`sales_open_at`은 입력받거나 덮어쓰지 않는다.
- **`place_order(cart)`** — 굿즈 재고 검증·차감, 주문 당시 가격·이름·유형·IP를 고정한 `orders`/`order_items` 생성(`pending`).
- **`begin_ticket_payment_approval` / `confirm_order_payment` / `confirm_ticket_payment`** — 티켓은 provider 승인 호출 전에 order→active cancellation request→payment 순서로 잠그고 `pending` payment claim을 먼저 남겨 무결제 취소와 외부 승인이 엇갈리지 않게 한다. 결제 확정은 웹훅에서 service role로 호출하며 **멱등 키=토스 paymentKey**로 중복 방지한다. (충전 `charge_wallet`은 ADR-0003으로 폐기)
- **`request_order_cancellation` / `admin_decide_order_cancellation` / `complete_order_cancellation_request`** — 사용자 요청을 durable 원장에 남기고 staff 승인 뒤에만 provider 정합화를 시작한다. fresh GET으로 모든 대상 결제의 전액 취소를 검증한 뒤 재고·미사용 카드팩·환불 장부·주문 상태를 원자적으로 정리한다. 불확실한 결과는 claim을 유지한 `needs_review`로 격리하며 같은 멱등키로만 재정합화한다.
- **`request_ticket_cancellation` / `begin_ticket_cancellation_reconcile` / `complete_ticket_cancellation_request`** — 이벤트 시작 전 미사용 예매 전체의 정책·마감·전액 환불 금액을 snapshot으로 남긴다. order→request→payments→tickets→ticket_types 잠금 순서와 5분 attempt lease로 confirm/check-in 경합과 중복 provider 처리를 막고, 모든 비실패 결제의 fresh GET→필요 시 전액 취소→fresh GET 증거가 일치할 때만 티켓·정원·환불을 원자 완료한다. 검증된 provider 원문과 실제 환불 근거를 결제 원장에 함께 보존하며, 불확실한 결과는 QR을 차단한 `needs_review`로 남긴다.
- **`check_in_ticket(staff_id, qr_token)`** — service role만 실행하고 staff/admin을 DB에서 다시 확인한다. order→active cancellation request→ticket 순서로 잠근 뒤 `valid→used` 전이와 `check_ins`·`admin.ticket.checked_in` 감사를 한 트랜잭션에 기록한다. 재검표는 최초 시각을 반환하며, 환불·취소 진행·원장 불일치는 쓰기 없이 차단한다. QR 원문은 응답·감사에 남기지 않는다.
- **`admin_update_order_status` / `admin_search_orders`** — staff를 DB에서 다시 확인하고 `paid → shipping → done`만 허용·감사하며, 주문/구매자/상태/KST 기간 필터를 DB에서 페이지 처리한다.
- **`admin_adjust_stock`** — 화면별 UUID 멱등키를 advisory lock으로, 굿즈를 `FOR UPDATE`로 잠근다. 화면에서 본 수량과 현재 수량이 같을 때만 델타를 반영하고 감사 로그 ID·전후 수량·사유를 원장으로 남긴다. persisted `stock`은 수동 판매 게이트로 보존하며 공개 유효 상태는 `stock_qty <= 0 ? soldout : stock`으로 파생한다.
- **`admin_upsert_card_pool` / `admin_set_pool_odds` / 확장된 `admin_upsert_card`** — 앞의 두 RPC는 operation UUID로 재시도를 멱등화한다. 세 RPC 모두 대상 풀 잠금 아래 같은 IP 바인딩·확률 합계·양수 등급 coverage를 검증한 뒤 전후 상태를 감사한다. 기존 7인자 카드 호출은 배포 호환을 위해 현재 풀 바인딩을 보존한다.
- **`admin_upsert_reward_policy` / `admin_list_reward_policies`** — operation/policy UUID로 재시도를 멱등화하고, target IP·선택 same-IP 굿즈·독립 카드풀·금액·수량·기간·풀 준비도를 검증한 뒤 전후 상태를 감사한다. 직접 DML은 봉인하며 목록 RPC는 PII 없이 누적 발급·사용 가능·개봉·회수·주문 집계만 반환한다.
- **`admin_upsert_game(target_operation_id, target_previous_game_id, target_game_id, target_title, target_reward_pool_id, target_event_id, target_per_user_daily_limit, target_active_from, target_active_to, target_end_now) → text` / `admin_list_games`** — `previous_game_id`와 operation UUID로 플레이 전 slug rename을 포함한 재시도를 멱등화한다. 신규 게임은 card variant·`marbleCount=10`으로만 만들고, 준비된 보상 카드풀의 양수 `pool_odds`를 largest-remainder 방식으로 10칸에 결정적으로 배분한다. 카드풀은 게임 창 전체를 덮어야 하고 optional 이벤트는 같은 IP의 `온라인` 모드여야 하며, 카드풀·이벤트 mutation도 이 계약을 깨뜨리지 못한다. 최초 플레이 뒤 slug·type·pool·event·config를 잠근다. `end_now=true`는 현재 시각이 운영 창에 포함되는 기존 카드 게임만 DB `statement_timestamp()`로 종료하고 같은 operation replay에는 최초 종료 시각을 보존한 채 멱등 성공한다. 직접 DML은 봉인하며 목록 RPC는 사용자 ID·결과 payload 없이 플레이 수·최근 플레이 시각만 집계한다. goods variant는 #115 전까지 읽기 전용이다.
- **`confirm_order_payment`의 리워드 발급** — 결제 시점 주문 스냅샷으로 각 정책의 IP/선택 굿즈 소계를 계산하고 조건이 맞는 활성 정책을 모두 누적 적용한다. 티켓마다 `reward_policy_id`를 기록해 정책 attribution을 보존한다.
- **`grant_cards` / `play_game` / `open_draw_ticket`** — 모든 카드 발급은 `grant_cards`가 풀을 공유 잠그고, `play_game`의 신규 결과만 현재 풀 운영 기간을 추가 검사한다. 이미 확정된 게임 결과는 이후 풀 종료에도 그대로 재생하고, 기존 미사용 카드팩은 풀 종료 후에도 개봉할 수 있다. 카드팩은 발급 시 확률 snapshot을 만들지 않아 개봉 시점의 최신 풀 구성·확률을 사용한다. 회수된 티켓은 개봉할 수 없고 공개 UX에서는 존재를 노출하지 않는 `not_found`로 정규화한다.
- **`open_notification(notification_id)` / `set_ip_notification_preferences(ip_id, drops?, events?, auto_follow=false)`** — 두 RPC 모두 `auth.uid()`를 다시 확인하는 `SECURITY DEFINER` 함수다. 전자는 본인 알림의 `read_at`을 단조롭게 기록하고 앱 내부 `link_path`를 반환한다. 후자는 선택적으로 팔로우 생성과 채널 설정을 한 transaction에서 처리하고, 기존 팔로우에서는 null channel을 보존한다. 테이블 직접 mutation 권한은 열지 않는다.
- **인앱 알림 trigger** — 주문의 최초 `paid`·`shipping` 전이, `draw_tickets` statement INSERT, 인증된 staff의 runtime `goods`·`events` INSERT가 권위 변경과 같은 transaction에서 `notifications`를 발급한다. `(user_id, dedupe_key)`로 중복을 막고 긴 catalog id는 원문 `source_id`와 SHA-256 dedupe를 분리한다. 카드팩은 사용자·source별 advisory lock 뒤 현재 총량을 다시 집계하며 후속 발급 시 기존 행을 최신 unread로 갱신한다. 카탈로그 fan-out은 `INSERT ... SELECT`이고 seed/migration INSERT와 IP 없는 이벤트는 건너뛴다.
- **`admin_estimate_notification_recipients` / `admin_send_notification` / `admin_list_notification_history`** — staff를 DB에서 다시 확인하고 전체 profile 또는 특정 IP 팔로워 수를 추정한다. 발송은 operation UUID advisory lock 아래 대상 table에서 한 번의 `INSERT ... SELECT`로 `/notifications` 인앱 공지를 발급하고 `ROW_COUNT` 실제 수신자 수와 대상 snapshot을 `audit_log`에 멱등 기록한다. `all`은 임의 상한이나 일부 truncation 없이 현재 전체 profile을 뜻한다. 드롭·이벤트 preference는 운영 공지에 적용하지 않으며 이력은 수신자 PII를 반환하지 않는다.

규칙: 천장·확률 로직은 DB(또는 DB가 호출하는 신뢰 경로)에만 둔다(클라이언트 신뢰 금지). 모든 금전·재고 RPC는 멱등·감사 가능.

---

## 8. 인증 & 온보딩 흐름

1. 진입: 보호 액션 클릭 → `/login`.
2. 현재 수단: 이메일/PW. Google/Apple/Kakao는 v1 목표지만 아직 provider 연동 전이며 UI 버튼은 비활성 상태다.
3. 회원가입: Supabase `signUp()`으로 확인 메일을 발송한다. 같은 브라우저에서 같은 이메일을 반복 제출하면 서명된 httpOnly cookie로 3회/10분 window를 추적하고 `auth.resend({ type: 'signup' })`로 재발송한다.
4. 비밀번호 재설정: `/login?mode=reset`은 계정 존재 여부와 무관한 응답을 반환하고, 정규화 이메일별 브라우저 요청을 서명 쿠키로 총 3회/10분 제한한다. 쿠키에는 raw email 대신 domain-separated HMAC digest만 저장하고, 활성 bucket은 12개로 제한한다.
5. 가입 확인·recovery의 `redirectTo`는 query 없는 `/auth/callback`이다. 서명된 `icons_auth_next`는 목적·안전한 `next`·발급 시각을 저장하고 signup 10분/recovery 1시간을 검증한다. Recovery 목적지는 query보다 이 쿠키를 우선한다.
   - Callback origin은 고정 production/local origin 또는 플랫폼이 제공한 현재 `VERCEL_URL`만 허용하며, 임의의 요청 `Origin`/Host는 production canonical origin으로 정규화한다.
6. Callback은 code exchange 뒤 `getUser()`로 사용자를 재검증한다. Recovery는 온보딩 게이트를 건너뛰고 `/update-password`로 보낸다. Redirect 직후 첫 SSR 요청이 아직 세션 cookie를 보지 못하면 성공 callback이 붙인 1회성 `session_ready` 표식으로 전체 탐색을 다시 수행하고, 세션 확인 전에는 비밀번호 폼을 렌더링하지 않는다. 일반 가입만 기존 profile/onboarding 판정을 유지한다.
7. `/update-password`는 인증 세션에서 `updateUser({ password })`를 호출한다. 성공 뒤 global sign-out을 완료하고 로그인 화면으로 보내며, 전역 로그아웃 실패는 비밀번호 변경 성공과 잔여 세션 위험을 분리해 안내한다.
8. 일반 가입은 온보딩 완료 후 추천 IP 팔로우를 저장하고 보존된 `next` 경로로 이동한다.

Production Auth 설정:

- Site URL: `https://iconsip.com`
- Redirect URLs: `https://iconsip.com/auth/callback`, `https://www.iconsip.com/auth/callback`, `https://icons-ip.vercel.app/auth/callback`, Vercel preview wildcard, local callback.
- 이메일 confirmation은 켜고, 가입 확인·비밀번호 재설정 메일은 Resend `iconsip.com` custom SMTP를 사용한다.
- `main` 배포 workflow가 Supabase Management API로 Site URL, redirect allow-list, secure email change, email rate limit을 확인·동기화한다. custom SMTP 필수 필드가 비어 있으면 production 배포를 실패시킨다.

본인확인: 자가신고 생년월일 + 결제 시 결제사 위임. (게임물 연령등급이 요구하면 §PRD 5.1대로 PASS 본인인증을 가챠/고액 결제 게이트에 추가.)

---

## 9. 결제 통합 (토스페이먼츠)

- 클라이언트: 결제위젯으로 결제 요청(주문·티켓 공용). 토스 `orderId`는 `order_<uuid>`/`ticket_<uuid>`로 결제 목적을 실어 발급한다(`lib/payments/toss.ts`).
- 승인: successUrl 콜백이 **`/api/payments/confirm`** 을 호출 → 본인 소유·pending·미만료·금액 일치를 검증한 뒤 토스 승인 API를 호출하고 `payments`에 `pending`으로 기록한다. **승인 성공은 UX 반영용이다.**
- 확정: **웹훅 `/api/webhooks/tosspayments`(Route Handler)** 가 단일 진실원. 결제 웹훅에는 서명이 없으므로(서명 헤더는 지급대행 웹훅 전용) payload를 신뢰하지 않고 paymentKey로 **결제 조회 API를 재호출해 검증**한 뒤 `confirm_order_payment`/`confirm_ticket_payment` RPC(service_role, 멱등 키=paymentKey)를 호출한다. 검증된 조회 응답 원문을 `payments.raw`에 보존한다.
- 주문 상세의 브라우저 조회는 본인 RLS와 결제 안전 컬럼(`id`,`user_id`,`purpose`,`ref_id`,`amount`,`status`,`created_at`), 환불 안전 컬럼(`id`,`payment_id`,`amount`,`status`,`created_at`), 본인 청약철회 요청의 공개 상태·처리 시각·결정 메모로 제한한다. 내부 오류 코드·요청 사유·actor와 `payment_key`·`idempotency_key`·`raw`는 서버 신뢰 경계에만 둔다.
- 흐름: ① RPC로 `pending` 생성(재고 선점) → ② 토스 결제 → ③ 티켓은 승인 직전 DB payment claim, 승인 뒤 provider raw 보강(굿즈는 승인 뒤 `pending` 기록) → ④ 웹훅 확정(`paid`, 티켓 QR 발급/주문 확정) → ⑤ 실패·만료 시 선점 복원.
- 실패·만료 복원: 만료 등 확정 불가 결제는 웹훅이 **토스 취소 API로 자동 환불**하고, 해당 paymentKey를 `refund_ticket_order_with_provider_evidence`에 전달해 그 결제 시도만 정합화한다. 같은 예매에 다른 pending/paid 결제가 남아 있으면 예매·정원은 유지한다. 승인 이력 없는 만료 pending 주문·예매는 pg_cron이 매분 `expire_stale_checkouts()`로 `cancel_order`/`refund_ticket_order`를 재사용해 정리한다(승인 진행 중 건 제외, 만료 후 5분 유예).
- 미지원 가상계좌: 입금 전 `WAITING_FOR_DEPOSIT`이면 토스를 먼저 자동 취소한 뒤 로컬 주문·재고를 원복한다. 입금 완료 건은 환불계좌 없이 자동 취소하지 않고 운영 오류로 노출한다.
- 사용자 취소: 본인 `pending` 무결제 주문만 즉시 선점을 원복한다. 결제 행이 있는 `pending`과 `paid`는 `/api/orders/[orderId]/cancel`이 provider 식별자 없이 `requested` 원장만 만들고 결제 확정·배송 전이를 막는다. staff 승인 뒤 서버가 결제사 fresh GET → 전액 취소 POST → fresh GET을 수행하며, 전액 취소가 모두 확인된 경우에만 주문·재고·미사용 카드팩 soft revoke·환불을 원자적으로 완료한다. 발급 attribution과 누적 발급 이력은 보존하고 `/packs`와 개봉 경로에서는 회수 티켓을 제외한다. 주문 상세의 발급 수는 개봉·회수를 포함한 전체 이력, 사용 가능 수는 `consumed_at`과 `revoked_at`이 모두 null인 티켓만 센다. 타임아웃·부분 취소·응답 불일치는 `needs_review`에 남겨 같은 멱등키로 재정합화하고, provider 호출 전 `requested`만 거절할 수 있다. `shipping`·`done`은 셀프 취소를 막고 CS 확인으로 보낸다.
- 티켓 취소: `/api/ticket-orders/[ticketOrderId]/cancel`은 same-origin·auth·onboarding·owner를 확인하고 order UUID 외 provider 입력을 받지 않는다. 시작 전 미사용 예매 전체만 수수료 없이 취소하며, 무결제 `pending`은 즉시 원복하고 결제 예매는 서버가 모든 결제를 fresh provider 증거로 정합화한다. QR은 raw token을 DTO·DOM·URL에 싣지 않고 paid+valid+비취소 상태를 재검증하는 no-store PNG Route Handler로만 제공한다.
- 환불: `refunds` 완료 기록 + 재고 원복은 RPC가 담당한다. 토스 쪽 취소(`CANCELED` 웹훅) 등 기존 호환 경로는 active 청약철회 요청을 완료할 수 없고, 해당 요청은 관리자 fresh GET 전체 검증 경로에서만 종결한다. 현재 배송·수령 시각이 없으므로 법정 7일을 앱이 자동 판정하지 않는다.
- 단일 PG 가정. 멀티 PG 필요 시 `payments.provider` + 어댑터 계층 도입.

### 9.1 환경 변수 · 로컬/프리뷰 검증 (테스트 키)

- 서버 전용 env: `TOSS_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. 클라이언트 번들에 노출하지 않는다(`NEXT_PUBLIC_` 접두사 금지). 위젯 공개 키만 `NEXT_PUBLIC_TOSS_CLIENT_KEY`로 전달한다.
- 토스 키는 개발자센터 **API 키 > 결제위젯 연동 키**의 것을 쓴다: `TOSS_SECRET_KEY` = 위젯 시크릿 키(테스트 `test_gsk_…` / 라이브 `live_gsk_…`), `NEXT_PUBLIC_TOSS_CLIENT_KEY` = 위젯 클라이언트 키(`test_gck_…` / `live_gck_…`, 체크아웃 #90에서 사용). 두 키는 **같은 연동 키 세트**여야 한다 — 세트가 어긋나면 승인 API가 `INVALID_API_KEY`/`UNAUTHORIZED_KEY`/`NOT_FOUND_PAYMENT_SESSION`으로 실패한다. `test_sk_…`(API 개별연동 키)는 위젯 결제 승인에 쓰지 않는다.
- 키 미구성 환경에서 두 라우트는 503(`not_configured`)으로 응답한다 — mock/카탈로그-only 모드에서 안전.
- 로컬 검증 경로(테스트 키):
  1. 결제위젯 연동 테스트 시크릿 키(`test_gsk_…`)를 `.env.local`의 `TOSS_SECRET_KEY`로, 로컬 Supabase service key(`supabase status`)를 `SUPABASE_SERVICE_ROLE_KEY`로 설정한다.
  2. 순수 로직은 `npm run test`(`lib/payments/toss.test.ts`), DB 계층(확정 RPC·만료 sweep)은 로컬 psql로 RPC를 직접 호출해 확인한다.
  3. 웹훅 실수신은 ngrok 등으로 로컬을 노출해 개발자센터에 웹훅 URL(`https://<host>/api/webhooks/tosspayments`, `PAYMENT_STATUS_CHANGED`)을 등록하고 테스트 결제로 유발한다. 성공 기준은 10초 내 200 응답, 실패 시 최대 7회 재전송된다.
- 프리뷰는 짝이 맞는 테스트 키를 허용한다. Vercel production은 `live_gck_…`/`live_gsk_…` 쌍일 때만 주문 생성·위젯·승인·웹훅을 활성화하며 테스트 키면 fail closed한다. 라이브 상점 계약·키·웹훅 등록(#87) 전에는 production 결제가 비활성 상태다.
- Vercel preview/production 변수는 sensitive로 유지한다. GitHub Actions는 값을 복호화할 수 없는 `vercel pull` + prebuilt 경로를 쓰지 않고 Vercel 원격 build를 요청하며, `prebuild` guard가 Vercel build 안에서 필수 변수와 토스 키 모드만 검증한다.

---

## 10. 미디어 / 스토리지

- **Supabase Storage**
  - `public/` 버킷: 굿즈·카드·IP·이벤트 아트워크 (프로토타입의 그라디언트+글리프 플레이스홀더를 실제 이미지로 교체).
  - `user-uploads` 버킷: 커뮤니티 업로드·프로필 이미지. 쓰기는 RLS로 본인 폴더(`<uid>/...`)에 제한하고, 공개 커뮤니티 피드는 `visible` 포스트에 연결된 작성자 본인 경로의 이미지만 signed URL로 읽는다.
- 카탈로그 테이블은 경로(`image_path`)만 저장, 렌더 시 URL 변환. 이미지 변환/최적화 활용.

---

## 11. 검색

- Postgres `pg_trgm` 확장 + ILIKE/유사도 정렬. 대상: `ips`·`goods`·`cards`·`posts`·태그.
- 구현은 검색용 RPC 또는 뷰. 한국어 형태소 한계는 v1 규모에서 수용, 확장 시 외부 인덱스 검토.

---

## 12. 운영 백오피스 `/admin`

- 같은 Next 앱의 라우트 그룹. 진입 시 `profiles.role ∈ {staff, admin}` 검사(라우트 + RLS 이중).
- 기능: 카탈로그 CRUD, **카드풀 운영 기간·등급별 발급 확률·카드 풀 바인딩**, 뽑기권 발급 정책(`/admin?section=policy`), 참여형 게임(`/admin?section=game`) 관리, 이벤트·티켓 회차, 독립 모바일 현장 검표(`/admin/check-in`), 주문 검색·배송 전이·청약철회/환불 정합화, 인앱 공지 수신자 추정·즉시 발송·이력(`/admin?section=notifications`), 커뮤니티 신고 처리.
- 모든 민감 작업은 `audit_log` 기록.

---

## 13. mock → real 이전 경로

1. **스키마**: §5 테이블을 Supabase 마이그레이션으로 생성, RLS·RPC 적용.
2. **시드**: `lib/data.ts`의 IP/굿즈/카드/이벤트/포스트를 시드 스크립트로 적재(타입 이미 정의됨 → 매핑 단순).
3. **읽기 교체**: screen 컴포넌트의 `DATA.*` 접근을 Server Component 페치로 점진 교체. `'use client'` 화면은 데이터를 props로 받도록 분리.
4. **액션 도입**: 장바구니/팔로우/작성 등은 Server Action으로, 돈/재고는 RPC로.
5. **결제 연결**: 토스 위젯 + 웹훅.
6. 단계는 [PRD §9](./PRD.md#9-출시-단계)의 P0→P3 순서를 따른다.

`lib/routes.ts`의 라우트 맵·`useGo`는 유지(프로토타입 네비게이션 자산 재사용). 프로토타입의 `/exchange`·`/market` 화면은 v2까지 읽기/플레이스홀더로 둔다.

---

## 14. 목표 디렉토리 (증분)

```
app/
  (existing screens)                  # 점진적으로 서버 페치 + 액션 연결
  auth/callback/route.ts              # Auth code exchange + 가입/recovery 분기
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
| 확률형 아이템 공시 | `pool_odds`를 가챠 화면에 노출, 변경 이력 `audit_log` |
| 게임물 등급분류(연령) | 분류 결과에 따라 가챠 라우트에 연령 게이트(자가신고→필요 시 PASS) |
| 전자금융(선불 충전 환불) | `wallets`/`wallet_ledger` + 환불 RPC, 미사용분 환불 경로 |
| 전자상거래(청약철회) | `orders`/`refunds` 상태기계 + 환불 RPC |
| PIPA/청소년보호 | `profiles.consents`·`birth_date`, 최소수집·동의·파기 |
| UGC 안전 | `reports`/`blocks` + `/admin` 모더레이션 + 게시물 `status` |

---

## 16. 미해결 결정

- **디지털 유료 가챠 채택 + 규제 스탠스** — 채택 완료. 결정 배경과 결과는 `docs/adr/0001-paid-digital-gacha.md`에 기록되어 있다.
- 단일 PG(토스페이먼츠) vs 멀티 PG 추상화 시점.
- 천장/중복카드 환원 등 가챠 세부 규칙.
- 한국어 검색 품질이 임계 넘는 시점의 외부 검색엔진 도입.

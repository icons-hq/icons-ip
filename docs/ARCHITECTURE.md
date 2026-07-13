# ICONS — 아키텍처

> 상태: Draft · 최종 수정 2026-06-26 · 짝 문서: [`PRD.md`](./PRD.md)
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
| 화면 | 11개 라우트 ↔ screen 컴포넌트 | `app/**/page.tsx` → `components/screens/*` |
| 셸 | Nav · MobNav · SiteFooter · CartProvider · `useGo` | `components/shell/*` |
| 라우팅 맵 | 프로토타입 route-id ↔ 경로 | `lib/routes.ts` |
| 데이터 | Supabase 공개 카탈로그, 커뮤니티 visible feed/comment preview, Postgres 검색 읽기 + mock fallback. Vercel Preview는 static mock catalog를 기본 사용. IP 상세 커뮤니티 preview도 Supabase `posts`/`public_profiles`에서 읽음 | `lib/catalog.ts`, `lib/catalog-source.ts`, `lib/community.server.ts`, `lib/search.ts`, `lib/data.ts` |
| 인증 | Supabase SSR 이메일/PW Auth, 확인 메일 callback, 온보딩 게이트, 우상단 AuthButton 상태 동기화. env 없으면 no-op/폼 비활성화 | `app/login/*`, `app/auth/callback/route.ts`, `app/onboarding/*`, `components/shell/AuthButton.tsx`, `lib/auth/*`, `lib/supabase/*`, 루트 `proxy.ts` |
| 보호 액션 | IP 팔로우/언팔로우 server action + 온보딩 추천 IP 저장. 커뮤니티 포스트 작성, 댓글, 좋아요, 작성자 삭제, 신고, 차단은 Server Action + RPC로 연결 | `app/ip/actions.ts`, `app/onboarding/actions.ts`, `app/community/actions.ts`, `lib/ip-follow*`, `supabase/migrations/20260623090001_ip_follow_rpc.sql`, `supabase/migrations/20260624103001_community_comment_like_actions.sql`, `supabase/migrations/20260626090001_community_moderation_actions.sql` |
| 운영 | staff/admin 게이트, 카탈로그 CRUD, 감사 로그, 커뮤니티 신고 상태 변경과 포스트 숨김 처리 최소 경로 | `app/admin/*`, `lib/admin/*`, `supabase/migrations/20260624100001_admin_catalog_crud.sql`, `supabase/migrations/20260626090001_community_moderation_actions.sql` |
| CI/CD | GitHub Actions `CI/CD Pipeline`: PR 검증 + Vercel preview 배포, merge queue 검증, `main` push production 배포. Actions 앱 빌드 Node는 26 | `.github/workflows/pipeline.yml` |
| 배포 | PR은 Vercel prebuilt preview deploy, `main` push는 Supabase linked migration push 후 Vercel prebuilt production deploy. Vercel Git 자동 배포는 비활성화 | GitHub Secrets + `.github/workflows/pipeline.yml`, `vercel.json` |
| Production runtime | Vercel project/runtime Node.js Version은 공식 지원 범위인 24.x 유지 | Vercel Project Settings |
| 도메인/DNS | `iconsip.com` primary, `www.iconsip.com` alias, `icons-ip.vercel.app` fallback. DNS는 Cloudflare에서 관리 | Cloudflare DNS, Vercel Domains |
| Auth 메일 | Supabase Auth custom SMTP → Resend. Sender는 `no-reply@iconsip.com`, Resend domain은 `iconsip.com` | Supabase Auth SMTP, Resend |

**요청 프록시 주의**: 루트 `proxy.ts`가 `export function proxy()` + `config.matcher`로 동작한다(Next 16에서 미들웨어가 이 형태). `lib/supabase/middleware.ts`의 `updateSession`을 호출하며 **보호 액션 전까지 로그인 리다이렉트는 하지 않는다**(공개 브라우징 정책).

화면↔라우트 매핑(현재):
`/`·`/ip`·`/ip/[id]`·`/shop`·`/binder`·`/exchange`·`/community`·`/events`·`/market`·`/search`·`/login`

---

## 3. 목표 아키텍처

```
┌────────────────────────── Vercel (Next.js 16) ───────────────────────────┐
│  Server Components  ──read──▶ Supabase (anon, RLS)                         │
│  Server Actions     ──rpc──▶ Supabase (인증 사용자 컨텍스트)               │
│  Route Handlers                                                           │
│    └ /api/webhooks/tosspayments  ◀── 결제 확정 (멱등)                      │
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
- `ip_follows` (user_id, ip_id) — 관심 IP

### 5.2 카탈로그 (공개 읽기)
- `verticals` (key, label, color) — 캐릭터 IP·게임·애니메이션
- `ips` (id, title, sub, vertical_key, glyph, bg, tagline, synopsis, featured, fans/goods/cards 집계)
- `goods` (id, ip_id, name, type, price, badge, stock, image_path)
- `events` (id, ip_id?, title, mode, status, starts_at, ends_at, location, accent, image_path)

### 5.3 가챠 & 카드 (P2)
- `card_pools` (id, ip_id, name, active_from/to) — 풀(픽업/한정 포함)
- `cards` (id, ip_id, pool_id, name, no, rarity `N|R|SR|SSR|HOLO`, image_path)
- `pool_odds` (pool_id, rarity, probability) — **확률 공시 원천**
- `wallets` (user_id, balance) — 충전 잔액
- `wallet_ledger` (id, user_id, delta, reason `charge|pull|refund`, ref_id, created_at) — 장부
- `pulls` (id, user_id, pool_id, cost, pity_before/after, created_at)
- `pull_results` (pull_id, card_id, rarity)
- `user_cards` (user_id, card_id, qty, acquired_at) — 바인더(보유)

### 5.4 커머스 (P1)
- `carts` / `cart_items` (user_id, good_id, qty)
- `orders` (id, user_id, status `pending|paid|shipping|done|canceled`, total, address jsonb, created_at)
- `order_items` (order_id, good_id, qty, unit_price)
- `payments` (id, provider `toss`, order_id?/charge_id?, amount, status, payment_key, **idempotency_key**, raw jsonb)
- `refunds` (id, payment_id, amount, reason, status)

### 5.5 티케팅 (P3)
- `ticket_types` (id, event_id, name, price, capacity, sold) — 회차/종류
- `ticket_orders` (id, user_id, event_id, status)
- `tickets` (id, ticket_order_id, ticket_type_id, qr_token, status `valid|used|refunded`)
- `check_ins` (ticket_id, checked_at, by_staff)

### 5.6 커뮤니티 (P0)
- `posts` (id, user_id, ip_id?, text, image_path?, tag, status `visible|hidden`, created_at)
- `comments` (id, post_id, user_id, text)
- `likes` (post_id, user_id)
- `reports` (id, target_type `post|comment|user`, target_id, reporter_id, reason, status)
- `blocks` (user_id, blocked_user_id)

### 5.7 운영
- `audit_log` (id, actor_id, action, target, diff jsonb, created_at)

> v2(연기) 테이블: `listings`/`offers`/`trades`/`escrow`/`payouts`(마켓·교환), `memberships`/`subscriptions`(유료 팬덤). 스키마 자리만 예약.

---

## 6. 권한 모델 (RLS)

| 테이블군 | 읽기 | 쓰기 |
|---|---|---|
| 카탈로그(verticals/ips/goods/events/cards/pool_odds) | **공개(anon)** | staff/admin only |
| profiles/ip_follows/carts/orders/wallets/user_cards/tickets | **본인만** | 본인만(+RPC) |
| posts/comments/likes | 공개 읽기(visible) | 작성자 본인, 신고/숨김은 본인+운영 |
| reports/blocks | 본인+운영 | 본인 |
| audit_log | admin only | RPC만 |

- 돈/재고가 걸린 INSERT/UPDATE는 테이블 직접 쓰기 대신 **RPC(SECURITY DEFINER)** 로만 허용.
- 관리자 권한은 `profiles.role`로 판정, `/admin` 라우트와 RLS 양쪽에서 검사.

---

## 7. 트랜잭션 & 무결성 (RPC)

핵심 원자 연산은 `SECURITY DEFINER` Postgres 함수로 구현하고, Server Action에서 인증 컨텍스트로 호출한다.

- **`pull_gacha(pool_id, count)`** — 1 트랜잭션:
  1) 지갑 잔액 `FOR UPDATE` 잠금·차감 검증
  2) `pool_odds` 기반 RNG 추첨 (+ **천장**: `pulls.pity` 누계로 보장 발동)
  3) `pulls`/`pull_results` 기록, `user_cards` 적립(중복 시 정책 처리)
  4) `wallet_ledger`에 `pull` 기록
- **`reserve_tickets(ticket_type_id, qty)`** — `ticket_types.sold`를 `FOR UPDATE`로 잠그고 `capacity` 초과 검증 후 차감, `ticket_orders` 생성(상태 `pending`). 결제 확정 시 `tickets`(QR) 발급.
- **`place_order(cart)`** — 굿즈 재고 검증·차감, `orders`/`order_items` 생성(`pending`).
- **`confirm_order_payment` / `confirm_ticket_payment`** — 결제 확정(service_role 전용). 웹훅에서 호출, **멱등 키=토스 paymentKey**로 중복 방지. (충전 `charge_wallet`은 ADR-0003으로 폐기)
- **`cancel/refund_*`** — 환불 시 재고/잔액 원복 + `refunds`/`wallet_ledger` 기록.

규칙: 천장·확률 로직은 DB(또는 DB가 호출하는 신뢰 경로)에만 둔다(클라이언트 신뢰 금지). 모든 금전 RPC는 멱등·감사 가능.

---

## 8. 인증 & 온보딩 흐름

1. 진입: 보호 액션 클릭 → `/login`.
2. 현재 수단: 이메일/PW. Google/Apple/Kakao는 v1 목표지만 아직 provider 연동 전이며 UI 버튼은 비활성 상태다.
3. 회원가입: Supabase `signUp()`으로 확인 메일 발송. 같은 브라우저에서 같은 이메일을 반복 제출하면 서명된 httpOnly cookie로 3회/10분 window를 추적하고 `auth.resend({ type: 'signup' })`로 확인 메일을 재발송한다. 10분 window가 지나도 같은 이메일 cookie가 유효하면 `signUp()` 반복 대신 `resend` 흐름으로 재개한다.
4. 확인 메일 콜백: `/auth/callback`에서 code를 session으로 교환한다. `next`는 query가 아니라 `icons_auth_next` httpOnly cookie로 보존하고, callback path allow-list는 query 없는 exact URL만 사용한다.
5. 세션 수립 후 **온보딩 게이트**: `profiles` 미완성(이메일/닉네임/생년월일/동의 누락) 시 온보딩 폼으로 보낸다. 소셜 가입을 추가해도 같은 게이트를 사용한다.
6. 온보딩 완료 후 추천 IP 팔로우를 저장하고 보존된 `next` 경로로 이동한다.

Production Auth 설정:

- Site URL: `https://iconsip.com`
- Redirect URLs: `https://iconsip.com/auth/callback`, `https://www.iconsip.com/auth/callback`, `https://icons-ip.vercel.app/auth/callback`, Vercel preview wildcard, local callback.
- 이메일 confirmation은 켜고, custom SMTP는 Resend `iconsip.com` domain을 사용한다.
- `main` 배포 workflow가 Supabase Management API로 Site URL, redirect allow-list, secure email change, email rate limit을 확인·동기화한다. custom SMTP 필수 필드가 비어 있으면 production 배포를 실패시킨다.

본인확인: 자가신고 생년월일 + 결제 시 결제사 위임. (게임물 연령등급이 요구하면 §PRD 5.1대로 PASS 본인인증을 가챠/고액 결제 게이트에 추가.)

---

## 9. 결제 통합 (토스페이먼츠)

- 클라이언트: 결제위젯으로 결제 요청(주문·티켓 공용). 토스 `orderId`는 `order_<uuid>`/`ticket_<uuid>`로 결제 목적을 실어 발급한다(`lib/payments/toss.ts`).
- 승인: successUrl 콜백이 **`/api/payments/confirm`** 을 호출 → 본인 소유·pending·미만료·금액 일치를 검증한 뒤 토스 승인 API를 호출하고 `payments`에 `pending`으로 기록한다. **승인 성공은 UX 반영용이다.**
- 확정: **웹훅 `/api/webhooks/tosspayments`(Route Handler)** 가 단일 진실원. 결제 웹훅에는 서명이 없으므로(서명 헤더는 지급대행 웹훅 전용) payload를 신뢰하지 않고 paymentKey로 **결제 조회 API를 재호출해 검증**한 뒤 `confirm_order_payment`/`confirm_ticket_payment` RPC(service_role, 멱등 키=paymentKey)를 호출한다. 검증된 조회 응답 원문을 `payments.raw`에 보존한다.
- 흐름: ① RPC로 `pending` 생성(재고 선점) → ② 토스 결제 → ③ 승인 경로(`pending` 기록) → ④ 웹훅 확정(`paid`, 티켓 QR 발급/주문 확정) → ⑤ 실패·만료 시 선점 복원.
- 실패·만료 복원: 만료 등 확정 불가 결제는 웹훅이 **토스 취소 API로 자동 환불**하고, 승인 이력 없는 만료 pending 주문·예매는 pg_cron이 매분 `expire_stale_checkouts()`로 `cancel_order`/`refund_ticket_order`를 재사용해 정리한다(승인 진행 중 건 제외, 만료 후 5분 유예).
- 환불: `refunds` 기록 + 재고 원복은 기존 RPC가 담당하고, 토스 쪽 취소(`CANCELED` 웹훅)도 같은 수신부가 반영한다.
- 단일 PG 가정. 멀티 PG 필요 시 `payments.provider` + 어댑터 계층 도입.

### 9.1 환경 변수 · 로컬/프리뷰 검증 (테스트 키)

- 서버 전용 env: `TOSS_SECRET_KEY`(테스트 `test_sk…` / 라이브 `live_sk…`), `SUPABASE_SERVICE_ROLE_KEY`. 클라이언트 번들에 노출하지 않는다(`NEXT_PUBLIC_` 접두사 금지). 위젯 클라이언트 키는 체크아웃(#90)에서 `NEXT_PUBLIC_TOSS_CLIENT_KEY`로 추가한다.
- 키 미구성 환경에서 두 라우트는 503(`not_configured`)으로 응답한다 — mock/카탈로그-only 모드에서 안전.
- 로컬 검증 경로(테스트 키):
  1. 개발자센터 테스트 시크릿 키를 `.env.local`의 `TOSS_SECRET_KEY`로, 로컬 Supabase service key(`supabase status`)를 `SUPABASE_SERVICE_ROLE_KEY`로 설정한다.
  2. 순수 로직은 `npm run test`(`lib/payments/toss.test.ts`), DB 계층(확정 RPC·만료 sweep)은 로컬 psql로 RPC를 직접 호출해 확인한다.
  3. 웹훅 실수신은 ngrok 등으로 로컬을 노출해 개발자센터에 웹훅 URL(`https://<host>/api/webhooks/tosspayments`, `PAYMENT_STATUS_CHANGED`)을 등록하고 테스트 결제로 유발한다. 성공 기준은 10초 내 200 응답, 실패 시 최대 7회 재전송된다.
- 프리뷰/프로덕션: Vercel env에 `TOSS_SECRET_KEY`·`SUPABASE_SERVICE_ROLE_KEY`를 추가해야 결제 라우트가 활성화된다. 라이브 키 전환은 상점 계약(#87) 이후.

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
- 기능: 카탈로그 CRUD, **카드풀·확률 공시값** 관리, 이벤트·티켓 회차, 주문/티켓/환불 처리, 커뮤니티 신고 처리.
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
  auth/callback/route.ts              # Supabase Auth code exchange
  login/actions.ts                    # 이메일 Auth + signup resend + logout
  onboarding/actions.ts               # 프로필 완성 + 추천 IP 팔로우
  ip/actions.ts                       # IP 팔로우 보호 액션
  admin/                              # 역할 게이트 백오피스
  api/
    webhooks/tosspayments/route.ts    # 결제 확정 웹훅(재조회 검증)
    payments/confirm/route.ts         # 결제 승인 서버 경로 (만료 정리는 pg_cron)
lib/
  auth/                               # 온보딩 판정, next/callback helper, auth server state
  catalog.ts                          # Supabase catalog read + mock fallback adapter
  data.ts                             # → 시드 소스로 격하, 로컬 fallback 유지
  ip-follow*.ts                       # 팔로우 상태/선택/RPC helper
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

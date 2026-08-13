# ICONS 온라인 팝업 — 개발 기획서

> 작성일 2026-06-30 · 문서 4/4 · 짝 문서: [02-prd.md](./02-prd.md) · 기존 [docs/ARCHITECTURE.md](../ARCHITECTURE.md) · 게임 미니앱: [05-game-miniapp-spec.md](./05-game-miniapp-spec.md)
> 전제: 무료 리워드 모델. 기존 ICONS 아키텍처 원칙(공개 브라우징·DB에서 돈/재고 보호·웹훅 확정·RLS·점진 이전)을 그대로 따른다.
> 주문 연동 무작위 카드팩과 참여형 게임 보상은 게임물·간접 유상성·확률 표시의무 확인 전 공개하지 않는다. 표시가 필요하면 `pool_odds`를 공개 진실원으로 사용한다.
> **상태·범위:** 2026-08-12 #115와 #66을 current product scope에서 제거해 이 개발안은 historical candidate다. 아래 P0~P3·M·MVP/V1과 Expo 설계는 active AC·backlog가 아니며, 실제 pilot이 생기면 현행 코드·법무·운영 사실을 기준으로 새 RFC를 작성한다.
> ⚠️ 이 repo의 Next.js 16은 API/관례가 다를 수 있다 — 코드 작성 전 `node_modules/next/dist/docs/` 확인([AGENTS.md](../../AGENTS.md)).

---

## 1. 추천 아키텍처

기존 ICONS 목표 아키텍처(ARCHITECTURE §3)를 재사용한다. 추가/변경만 표시한다.

```
┌──────────────── Vercel (Next.js 16, App Router) ─────────────────┐
│  Server Components ──read(anon,RLS)──▶ Supabase Postgres          │
│  Server Actions    ──rpc(auth)──▶ SECURITY DEFINER RPC            │
│  Route Handlers                                                  │
│    └ /api/webhooks/tosspayments  ◀ 결제 확정(멱등) → 주문확정+카드팩발급│
│    └ /api/cron/holds-expire       재고 hold 만료 복원              │
│    └ /api/turnstile/verify(서버검증은 Action 내에서)              │
│  /admin (role-gated)                                             │
└─────────┬───────────────────────────────────────┬──────────────┘
   Cloudflare(엣지)                          Supabase
   - DNS/프록시                              - Postgres + RLS + RPC
   - Turnstile(봇)                           - Auth / Storage / Realtime
   - Rate Limiting Rules                     TossPayments(위젯+웹훅)
   - (확장) Waiting Room
```

**원칙 (그대로 유지):**
- 읽기는 Server Component가 RLS 하에서 직접 조회. 카탈로그는 **ISR 정적화**로 오픈런 부하를 엣지에서 흡수.
- 상태 변경은 Server Action → **RPC(SECURITY DEFINER)**. 돈·재고·카드 발급·래플은 RPC + 행 잠금 + 멱등.
- 결제 확정의 진실원은 **토스 웹훅**. 클라이언트 콜백은 임시 표시용.
- **발급 경계를 구조로 강제**: 주문 확정은 조건에 맞는 `draw_tickets`만 발급한다. 카드는 사용자 개봉 `open_draw_ticket` 또는 참여형 게임 `play_game`이 내부 `grant_cards`를 호출할 때만 결정하며 카드 자체를 직접 결제하는 RPC는 두지 않는다.
- **#66 인증 경계**: Expo WebView에는 refresh token·범용 Supabase session을 주입하지 않는다. native 인증 subject/session과 first-party origin/audience, nonce, 정확한 capability·resource에 묶인 짧은 TTL·single-use bridge token을 BFF가 한 번만 소비해 allowlist 작업을 수행하는 방식을 권장한다. BFF는 client user ID나 범용 service-role RPC 대행을 허용하지 않고 cross-user token swap을 거부한다. 짧은 access JWT 직접 주입은 명시 승인된 예외뿐이다. 현재 `lib/games/host.ts`의 access-token interface는 웹 호스트용이며 #66 구현 시 교체 대상이다.

---

## 2. Post-launch #115 DB 개념 초안 (핵심 컬럼)

아래 블록은 `popups`·미션·래플·브랜드 리포트용 **개념 초안**이며 현행 schema나 실행 가능한 DDL이 아니다. 현재 진실원은 [`ARCHITECTURE.md` §5](../ARCHITECTURE.md)와 최신 `supabase/migrations/`다. 특히 현행에는 `carts`·`stock_holds`가 없고 `cart_items`와 `expires_at`을 가진 `pending orders`가 재고 예약을 표현한다. 구현 시 새 migration으로 추가하고 공유된 migration은 수정하지 않는다.

```sql
-- 팝업: 한 IP의 기간 한정 운영 단위
popups(
  id uuid pk, ip_id text fk, title text, theme jsonb,
  status text check(status in ('scheduled','live','ended')),
  starts_at timestamptz, ends_at timestamptz,
  landing jsonb,            -- 티저/카운트다운/스토리 랜딩 구성
  archived_at timestamptz   -- 종료 후 아카이브
)
goods( ... , popup_id uuid fk, limited_qty int, per_user_limit int )  -- 기존 goods에 연결

-- 재고 예약(hold→확정→만료 복원)
stock_holds(
  id uuid pk, good_id text fk, user_id uuid fk, qty int,
  status text check(status in ('held','confirmed','expired')),
  order_id uuid null, expires_at timestamptz, created_at timestamptz
)

-- 무료 카드 발급 (유료 pulls/wallet 대체)
card_pools( id, ip_id, popup_id, name, active_from, active_to )       -- 기존 재사용
cards( id, ip_id, pool_id, name, no, rarity, image_path )             -- 기존 재사용
pool_odds( pool_id, rarity, probability )  -- 서버 발급 가중치·조건부 공개 진실원(법적 분류·표시 방법은 human gate)
reward_policies(  -- 뽑기권 발급 정책(ADR-0004). 게임 보상은 games.reward_pool_id로 직접 발급(여기 안 거침).
  id uuid pk, popup_id uuid fk, pool_id uuid fk,
  trigger text check(trigger = 'order_paid'),
  min_amount int null, tickets_per_grant int default 1, active bool
)
draw_tickets(  -- 뽑기권(UI "카드팩"). 낱장 = 개봉 1회 = 카드 1장. 풀 바인딩·무기한·천장 없음(ADR-0004).
  id uuid pk, user_id uuid fk, pool_id uuid fk,
  source text, source_id uuid, ordinal int,   -- 발급 멱등: unique(source, source_id, ordinal)
  consumed_at timestamptz null, created_at timestamptz
)
card_grants(  -- 카드 발급 이력(개봉·게임 트리거). 유료 pulls 대체.
  id uuid pk, user_id uuid fk, pool_id uuid fk, source text, source_id uuid,
  granted_cards jsonb, idempotency_key text unique, created_at timestamptz
)
user_cards( user_id, card_id, qty, acquired_at )                      -- 바인더(기존)

-- 미션/참여(비현금 보상)
missions( id, popup_id, type, condition jsonb, reward jsonb, period tstzrange )
mission_progress( user_id, mission_id, progress jsonb, cleared_at )
points_ledger( id, user_id, delta int, reason text, ref_id, created_at )  -- 비현금·비환금

-- 래플(commit-reveal)
raffles( id, popup_id, good_id, capacity int, entry_opens_at, entry_closes_at,
         draw_at, server_seed_hash text, server_seed text null, revealed_at )
raffle_entries( id, raffle_id, user_id, created_at, unique(raffle_id,user_id) )  -- 1인1회
raffle_draws( raffle_id, winner_user_ids jsonb, client_seed text, drawn_at )

-- 운영
brand_reports( id, popup_id, metrics jsonb, generated_at )  -- IP사 리포트 스냅샷
-- 재사용: profiles, ip_follows, cart_items, orders, order_items,
--          payments(idempotency_key), refunds, posts, comments, likes,
--          reports, blocks, audit_log
-- 이미 제거됨(20260707100001): wallets, wallet_ledger, 유료 pulls/pull_gacha
```

---

## 3. 현재 API / RPC 계약과 post-launch 목표

상태 변경은 Server Action에서 호출하는 **SECURITY DEFINER RPC**로 구현(인증 컨텍스트). 읽기는 Server Component 직접 조회.

### 3.1 현재 구현

시그니처의 진실원은 최신 migration이다. 아래는 2026-08-11 기준 공개 계약이다.

| RPC | 역할 | 무결성 |
|---|---|---|
| `place_order(p_address, p_checkout_key)` | 본인 `cart_items`·굿즈를 잠그고 재고를 차감해 15분 `pending` 주문 생성 | checkout key 멱등, DB 가격·배송비 계산, 초과판매 금지 |
| `confirm_order_payment(p_idempotency_key, p_order_id, p_payment_key, p_amount, p_raw)` | 웹훅 신뢰 경계에서 주문을 `paid`로 확정하고 활성 정책의 카드팩 발급 | 금액·상태 검증, payment/card-pack 멱등 |
| `expire_stale_checkouts()` | cron에서 만료 pending 주문·예매를 취소하고 선점 재고를 복원 | 승인 진행 payment 제외, 멱등 |
| `grant_cards(p_user_id, p_pool_id, p_source, p_source_id, p_idempotency_key, p_count=1)` | `pool_odds` 기반 카드 발급의 공용 프리미티브 | `card_grants.idempotency_key` 유니크, 내부 호출 전용 |
| `open_draw_ticket(p_ticket_id)` | 본인·미사용 카드팩 검증 → `grant_cards` → `consumed_at` | 행 잠금, ticket id 멱등, 풀 종료 뒤에도 개봉 가능 |
| `play_game(p_game_id)` | 일일 한도·운영 기간을 검사하고 서버 결과와 카드 보상을 원자 기록 | 사용자+게임+일자 직렬화, 확정 결과 재생 |
| `request_order_cancellation(p_order_id, p_user_id, p_reason, p_reason_type)` | 청약철회 요청과 정책 snapshot을 durable 기록 | 본인·기한·상태 검증, active request 유니크 |
| `finalize_order_cancellation_with_provider_evidence(p_order_id, p_reason, p_provider_payment_keys)` | 토스 취소 증거 확인 뒤 주문·재고·미개봉 카드팩·환불 원장을 정합화 | provider evidence·상태·배송 후 승인 claim 검증 |

### 3.2 Post-launch #115 목표 — 현재 없음

| 목표 RPC | 역할 | 필요 무결성 |
|---|---|---|
| `clear_mission(mission_id)` | 미션 진행·완료·보상 | 멱등, 조건 검증 |
| `enter_raffle(raffle_id)` | 추가 결제 없는 응모 | 1인1회 유니크, 마감 검증 |
| `draw_raffle(raffle_id, client_seed)` | admin commit-reveal 추첨 | 멱등, seed 해시 검증 |

> 핵심 설계: 주문 확정은 카드가 아니라 **뽑기권**을 발급하고, **`grant_cards`는 `open_draw_ticket`·`play_game`(·향후 `clear_mission`·`draw_raffle`) 내부에서만 호출**된다. 카드·카드팩 자체를 직접 결제·충전하는 RPC는 존재하지 않는다. 이는 기술적 경계일 뿐 주문 연동 보상의 법적 분류나 면제를 보장하지 않는다(ADR-0003·ADR-0004).

---

## 4. 결제 / 재고 / 리워드 처리 흐름

```
[구매]
1. place_order(address, checkout_key) → cart_items·재고 FOR UPDATE 검증/차감, 15분 order(pending)
2. TossPayments 결제위젯 requestPayment()  (클라)
3. (클라 successUrl = 임시 표시만, 확정 아님)
4. 웹훅 PAYMENT_STATUS_CHANGED=DONE  → /api/webhooks/tosspayments
     └ paymentKey 추출 → 토스 결제 조회 API로 결제·주문·금액 재검증
       → confirm_order_payment(payment_key, order_id, payment_key, amount, raw)
         ├ 금액 검증(order.total == amount)
         ├ order: pending→paid
         └ ★뽑기권(카드팩) 발급(reward_policies 평가, 발급 멱등)
5. (이후 아무 때나) 카드팩 개봉 → open_draw_ticket(ticket_id) → 내부 grant_cards → 바인더
6. 미결제/만료 → expire_stale_checkouts() cron → order canceled·재고 복원
[청약철회] request_order_cancellation → staff/provider 정합화 → finalize_order_cancellation_with_provider_evidence
             → order canceled·재고 복원·미개봉 카드팩 회수·refunds 기록
```

- **멱등 키**: 결제 웹훅은 서명이나 `transmission-id`를 전제로 하지 않는다. 조회로 검증한 `paymentKey`를 `payments.idempotency_key`와 확정 RPC의 멱등 키로 사용한다. 뽑기권은 `unique(source, source_id, ordinal)`로, 카드는 `card_grants.idempotency_key`(=ticket_id)로 이중 발급을 막는다.
- **뽑기권 발급 정책**: `reward_policies`(trigger=order_paid, target IP/good, min_amount, pool, tickets_per_grant). 개봉 시 카드는 `pool_odds` 가중치로 결정되고 천장은 없다. 카드팩 자체 가격·별도 결제는 없으며 법적 분류·표시는 별도 human gate다.

---

## 5. 대기열 / 봇방지 구조 (다층)

```
(엣지) Cloudflare: Rate Limiting Rules(세션/계정 기준, IP 단독 금지) + Turnstile(보호액션)
   │       (확장) Waiting Room — Enterprise+Advanced부터 Random/Reject. MVP는 미적용
(앱)  Server Action/Route Handler: Turnstile siteverify(토큰 1회·5분) + 인증 요구
(DB)  RPC: 행 잠금 + 1인 구매/응모 한도(유니크 제약) + 멱등
```

- **MVP**: Waiting Room 없이 **Turnstile(무료) + Rate Limiting + 카탈로그 ISR 정적화 + DB 행잠금**으로 오픈런·봇 대응. 트래픽이 Enterprise를 정당화하면 Waiting Room을 드롭 라우트에 추가.
- **래플**은 선착순 동시성 자체를 회피하는 설계(응모 무과금→비동기 추첨)라 트래픽 분산에 유리.
- 중복 주문·응모의 **최종 권위는 항상 DB**다. 현재 주문은 pending order·checkout key·행 잠금·멱등으로, 향후 래플은 유니크 제약으로 보호한다. 엣지는 감축용이다.

---

## 6. Supabase RLS 고려사항

현재와 post-launch #115 목표를 구분한다.

- **현재 카탈로그**(`goods/cards/pool_odds/games`): 공개 읽기(anon), 쓰기 staff/admin audited RPC.
- **현재 본인 데이터**(`orders/user_cards/draw_tickets`): 본인만 읽기, 쓰기는 목적별 RPC.
- **현재 돈·재고·발급**(`orders/payments/card_grants`): 직접 쓰기 금지, 신뢰 RPC/service boundary만 허용.
- **#115 목표**(`popups/missions/raffles`, `mission_progress/raffle_entries/points_ledger/raffle_draws`): 카탈로그는 공개 읽기, 사용자 행은 본인 읽기, 쓰기는 목적별 RPC로 설계한다.
- **SECURITY DEFINER 주의**(기술 리서치): 함수에 반드시 `set search_path = ''` + 모든 객체 스키마 한정(`public.table`). 노출 스키마에 두지 말고 `revoke execute … from public/anon` 후 필요한 롤에만 `grant`.
- **캐시 컬럼 보호**(기존 ICONS invariant): `fans_count`·`stock`/`limited_qty` 등 집계·재고 캐시는 발급·차감·복원이 같은 RPC 안에서 일관 갱신.
- **service role**은 서버 신뢰 경계(웹훅 Route Handler) 안에서만. 클라이언트 번들 노출 금지.
- 관리자: `profiles.role ∈ {staff,admin}`, 라우트 + RLS 이중 검사.

---

## 7. 관리자 페이지 구조 (`/admin`)

기존 ICONS admin(역할 게이트·카탈로그 CRUD·모더레이션·audit_log) 확장.

```
/admin
  /popups        팝업 생성·상태 전환(scheduled/live/ended)·아카이브·랜딩/티저/카운트다운
  /goods         굿즈 CRUD·재고·한정수량·1인한도·배지
  /orders        주문·배송·취소·환불(청약철회)·CS
  /cards         카드풀·등급 확률·리워드 정책(reward_policies)·발급 이력(card_grants)
  /missions      미션 정의·조건·보상·기간
  /raffles       응모조건·정원·추첨 실행(commit-reveal)·당첨자·결제권한
  /community     신고 처리·숨김·차단(기존 재사용)
  /banners       팝업별 랜딩/배너/티저
  /stats         매출·방문·가입률·전환·재방문·객단가·수집률·미션완료·공유·퍼널·품절/이탈
  /brand-reports IP사 리포트 생성(가명·집계)
  /cs            환불·반품·재배송·미성년 취소 워크플로
```
- 모든 민감 작업은 `audit_log` 기록. 확률·발급 정책 변경 이력 추적.

---

## 8. 배포 / 모니터링 전략

- **배포 경로(기존)**: GitHub Actions `CI/CD Pipeline` — PR=Vercel preview, `main` push=Supabase linked migration + Vercel production. Vercel Git 자동배포는 비활성(`vercel.json`). **`main` push/merge는 production write** — 사용자 확인 범위에서만(AGENTS.md).
- **migration 규율**: 공유/적용된 migration 수정 금지, 신규 추가. 로컬 DB 적용 검증(Supabase CLI). 돈/재고 RPC는 로컬 SQL smoke(docker exec) 권장.
- **런타임**: Vercel Node 24.x(Functions 지원), Actions 빌드 Node 26.
- **모니터링**: 결제·재고·카드 발급·래플 트랜잭션 로깅·실패 알림. 토스 웹훅 수신/멱등 로그, 승인된 최소 결제 증거, `audit_log` 추적성, pending 주문·예매 만료 job 상태, ISR 캐시 적중(`x-nextjs-cache`).
- **컴플라이언스 모니터**: 마케팅 동의 이력(2년 재확인), 야간 발송 차단 로그, 미성년 결제·취소 로그.

---

## 9. 테스트 체크리스트

> 이 repo `next dev`는 Playwright 하이드레이션 이슈 → **행동 QA는 prod 빌드(`next build && next start`)** 로. 변경 후 `npm run lint`·`npm run build`.

### 돈·재고 무결성 (최우선)
- [ ] 동시 N요청에 한정수량 1개 → 1건만 성공(오버셀 0). `FOR UPDATE` 검증.
- [ ] 1인 구매/응모 한도 초과 차단(유니크 제약).
- [ ] `place_order`의 pending 주문 생성 시 재고 선점, 미결제 만료 시 복원, 결제 확정 시 중복 차감 없음.
- [ ] 같은 `paymentKey`의 토스 웹훅 중복 수신 → 결제·주문·카드팩을 1회만 확정(멱등).
- [ ] confirm 금액 변조(amount≠order.total) → 거부.
- [ ] 클라이언트 successUrl만으로는 주문 미확정(웹훅 전 paid 안 됨).

### 카드/컴플라이언스
- [ ] **카드 발급은 카드팩 개봉·게임 외 경로 없음**(카드·카드팩 자체 직접 결제 RPC 부재 검증).
- [ ] 같은 주문 재처리 시 뽑기권 이중 발급 없음(`unique(source, source_id, ordinal)`), 같은 티켓 재개봉 시 카드 이중 발급 없음(`card_grants.idempotency_key`).
- [ ] 상품가가 카드 발급 유무와 무관하게 동일(전가 없음).
- [ ] 충전금/포인트로 카드 구매 불가(엔드포인트 부재).
- [ ] 주문 연동 카드팩·카드의 청약철회 효과와 회수 범위를 법무 승인한 약관·고지·로그에 반영하고, 실물 청약철회 흐름을 검증.

### 래플
- [ ] commit: server_seed_hash가 응모 시작 시 공개, 결과 공개 전 seed 비공개.
- [ ] reveal 후 seed+client_seed로 재계산→당첨자 일치(검증 가능).
- [ ] 추첨 멱등(재실행 시 결과 불변), 당첨자만 결제 권한.

### 봇·트래픽
- [ ] 보호 액션 Turnstile siteverify 실패→거부, 토큰 재사용→거부(5분/1회).
- [ ] Rate Limiting 초과→차단(세션/계정 기준).
- [ ] 카탈로그 ISR 정적 응답(`x-nextjs-cache: HIT`), on-demand 무효화 동작.

### 권한·운영
- [ ] RLS: 타인 주문/카드/응모 접근 차단, 카탈로그 공개 읽기.
- [ ] SECURITY DEFINER `search_path=''`·스키마 한정·execute 권한 최소.
- [ ] admin 비권한 차단(라우트+RLS), 민감 작업 audit_log 기록.

### 개인정보·미성년
- [ ] 마케팅 분리 동의(미동의도 가입·구매 가능), 야간(21시~) 푸시 게이트.
- [ ] #188의 Asia/Seoul 기준 만 14세 이상·법정대리인 동의 예외 없음·신규 `reason='underage_rejected'` durable 파기 후보를 제품·법무가 승인했는지 먼저 확인한다. 승인 전에는 이 항목을 구현 AC로 사용하지 않는다. 승인되면 만 14세 이상 미성년의 결제 취소권·법정대리인 동의 필요 여부·고지·로그도 별도 법무 gate로 확정해 테스트한다.

---

## 부록: 기존 ICONS 자산 재사용 매핑

| 영역 | 재사용 | 변경 |
|---|---|---|
| 인증·온보딩 | Supabase SSR Auth, 콜백, 온보딩 게이트 | consents 분리 동의 항목 확장 |
| 커뮤니티 | posts/comments/likes/reports/blocks + 모더레이션 | 팝업/IP별 피드 연결 |
| 검색 | `search_public_content` RPC(pg_trgm) | popups·missions 포함 |
| admin | 역할 게이트·카탈로그 CRUD·audit_log | 팝업/발급정책/래플/통계 추가 |
| 결제 | 토스 위젯+웹훅+멱등 골격(ARCH §9) | `confirm_order_payment`에 조건부 카드팩 발급 부수효과 |
| 카드/바인더 | cards/user_cards/바인더 UI, card_pools/pool_odds | wallet/유료 pulls→draw_tickets(카드팩 자체 결제 없음)+card_grants 치환, Gacha 화면→카드팩 개봉 화면 재목적화 |
| 라우팅 | `lib/routes.ts`·`useGo` | popup 라우트 추가 |

# ICONS 온라인 팝업 — 게임 미니앱 & 크로스플랫폼 개발 스펙

> 작성일 2026-07-03 · 게임 미니앱 부록(4부작 확장) · 짝 문서: [02-prd.md §4.10](./02-prd.md) · [04-dev-spec.md](./04-dev-spec.md) · 결정: [ADR-0002](../adr/0002-cross-platform-popup-game-miniapps.md)
> 전제: 무료 리워드 모델 + 서버 신뢰 경계(돈·발급·추첨은 RPC). **게임 = 렌더러, 결과 = 서버.**
> **상태·범위:** 2026-08-12 #115와 #66을 current product scope에서 제거해 이 문서는 historical security/design candidate다. 현행 웹 게임 구현의 진실원은 루트 PRD·ARCHITECTURE이며, Expo WebView나 online-popup 전용 레이어의 active AC가 아니다.
> ⚠️ Next.js 16 API/관례는 코드 작성 전 `node_modules/next/dist/docs/` 확인([AGENTS.md](../../AGENTS.md)).

---

## 1. 아키텍처 — 하나의 번들, 두 호스트

```
        ┌──────────── 웹 (Next.js) ────────────┐   ┌────── 앱 (Expo, V2+) ──────┐
        │  /games/[gameId] 라우트로 직접 렌더     │   │  react-native-webview        │
        │                                       │   │   → 같은 원격 URL 로드         │
        └──────────────────┬────────────────────┘   └──────────────┬──────────────┘
                          같은 웹 게임 번들 (box2d-wasm 등, 동일 WASM)
                                             │  PopupGameHost 고수준 메서드(§2)
                                             ▼
                    ┌──────── 첫파티 서버 경계 ─────────┐
                    │ 웹 Server Action / #66 Expo BFF  │
                    └────────────────┬─────────────────┘
                                     ▼
                    ┌──────────── Supabase (진실원) ────────────┐
                    │  play_game / draw_raffle / grant_cards RPC │
                    │   = 자격·한도 → 서버 RNG/commit-reveal →   │
                    │     무상 발급(멱등) → audit_log            │
                    └───────────────────────────────────────────┘
```

- 게임은 **자기완결 웹 번들**. 웹은 라우트로 직접, Expo는 webview로 같은 URL을 로드한다. **새 게임 = 웹 배포**(앱 재빌드 없이).
- 게임은 결과·경품을 결정하지 않는다. 서버 RPC 결과를 받아 **코스메틱 연출**로 재생만 한다.
- 웹·Expo 둘 다 webview에서 **동일 WASM/JS**를 실행 → 같은 시드 → 같은 연출(크로스런타임 물리 불일치 없음).

---

## 2. 호스트↔게임 브리지 (PopupGameHost)

게임이 의존하는 최소 기능 계약이다. 인증 material을 게임 인터페이스로 노출하지 않고, 웹은 same-origin Server Action을 사용하며 Expo는 아래 BFF bridge가 고수준 메서드를 수행한다. "토스 미니앱 SDK"의 발라낸 최소 버전이다.

```ts
interface PopupGameHost {
  // 참여형 게임 1회 플레이 — 서버가 결과 결정, 게임은 재생만.
  playGame(gameId: string): Promise<GamePlayResult>;

  // 래플 추첨 시각화 — 이미 확정·검증(commit-reveal)된 결과를 받아 연출.
  getRaffleResult(raffleId: string): Promise<RaffleResult>;
  // 래플 당첨자 결제(구매권) 핸드오프 — 호스트가 결제 플로우로 인계.
  startPrizeCheckout(raffleId: string): Promise<void>;

  // 네이티브 편의(웹은 no-op/폴백).
  haptics(type: 'light' | 'success'): void;
  share(payload: { title: string; url: string }): Promise<void>;
  close(): void;
  track(event: string, props?: Record<string, unknown>): void;
}

interface GamePlayResult {
  playId: string;             // 멱등 키(재생/중복 방지)
  rewards: GrantedReward[];   // 서버가 정한 무상 보상(카드/도장/포인트)
  animationSeed: string;      // rewards에 도달하는 결정론적 코스메틱 연출 시드
}

interface RaffleResult {
  raffleId: string;
  winners: string[];          // 검증된 당첨자(마스킹 표시명)
  serverSeed: string;         // reveal된 시드(공개 검증 가능)
  clientSeed: string;
  animationSeed: string;      // winners 순서에 도달하는 코스메틱 연출 시드
  isWinner: boolean;          // 현재 사용자 당첨 여부
}
```

- **웹 호스트**: 같은 오리진의 Supabase SSR cookie와 Server Action → RPC를 사용한다. access token을 게임 렌더러에 전달할 필요가 없다. 네이티브 편의는 폴백(Web Share API·no-op)이다.
- **PoC 편차(PR #75, 2026-07-06)**: 웹 PoC는 `GrantedReward`에 `{ kind: 'goods' }` **데모 변형**을 추가해 굿즈 마블 룰렛(`/games/goods-marble`)의 래플 *연출*을 미리 보여준다. 실물 굿즈 지급 계약이 아니며(경품 경계 그대로), 실배선 시 굿즈 경품은 `getRaffleResult`/`draw_raffle` 계약으로만 존재한다.
- **현행 코드 crosswalk**: `lib/games/host.ts`의 `getSession(): Promise<{ accessToken, userId }>`는 현재 same-origin 웹 호스트용 인터페이스다. #66 Expo 계약에는 stale하며, 코드를 그대로 RN session 주입에 재사용하지 않고 이 절의 credential-free 고수준 메서드+BFF 경계로 교체한다.
- **Expo 호스트(V2+)**: RN의 Supabase refresh token·범용 session은 Keychain/Keystore/SecureStore 경계에만 두고 WebView·게임 JS·cookie/localStorage/sessionStorage에 주입하지 않는다. native가 현재 인증 subject/session으로 BFF에 발급을 요청한 bridge token은 `subject`, native `session_id` 또는 검증 가능한 session handle, first-party origin/audience, nonce, 정확한 capability와 resource/argument scope, 짧은 TTL, single-use ID에 묶는다.
- **BFF 소비 경계**: `postMessage` 요청은 versioned schema·origin·source·sequence를 검증한다. BFF는 bridge token을 원자적으로 한 번 소비하고 `playGame|getRaffleResult|startPrizeCheckout`의 명시적 allowlist만 bound subject로 수행한다. client가 보낸 user ID를 신뢰하거나 임의 RPC 이름·인자를 범용 service-role로 대행하지 않는다. token subject/session과 native handshake가 다르거나 다른 사용자에게 바꿔 끼운 token은 거부한다.
- **직접 JWT 예외**: BFF를 사용할 수 없다는 보안 검토와 명시 승인이 있을 때만 짧은 Supabase access JWT를 WebView memory에 직접 전달할 수 있다. refresh token·전체 session은 예외가 아니며, JWT는 로그·스크린샷·persistent storage·backup에 남기지 않고 만료·logout·정지·탈퇴 시 native와 WebView 양쪽에서 제거한다.
- **신뢰 경계**: 게임 코드는 결과·경품 결정 권한이 없고 위 고수준 메서드만 호출한다. `haptics`/`share`/`close`는 Expo 모듈로 구현한다.
- **오리진 허용리스트**: Expo webview는 **첫파티 오리진만** 로드(Apple 4.7 대응, §5).

---

## 3. DB 확장 개념 초안 ([04-dev-spec §2](./04-dev-spec.md) 재사용 + 아래)

> `games`·`game_plays`는 이미 구현돼 있다. 아래는 현행 `text` 카탈로그 식별자와 기존 테이블을 유지하며 post-launch `popups` 연결을 더하는 마크다운 스케치다. 실제 반영은 신규 migration으로 한다(공유/적용 migration 수정 금지, [AGENTS.md](../../AGENTS.md)). 법무 게이트([03-roadmap §3](./03-roadmap.md))·미완성 도메인 의존 때문에 지금 라이브 적용은 부적절하다.

```sql
-- 현행 참여형 게임 카탈로그 확장. 공개 읽기, staff/admin 쓰기.
games(
  id text pk, popup_id uuid fk null, type text check(type in ('marble_roulette')),
  title text, config jsonb,          -- 연출·룰(구슬 수·테마·연출 파라미터)
  reward_pool_id uuid fk null,       -- 무상 보상 카드풀(card_pools)
  per_user_daily_limit int default 1,
  active_from timestamptz, active_to timestamptz
)

-- 현행 참여형 게임 플레이 이력 = 무상 보상 발급 트리거. 멱등.
game_plays(
  id uuid pk, game_id text fk, user_id uuid fk,
  result jsonb,                      -- 서버 결정 결과(보상·animationSeed)
  idempotency_key text unique,       -- 플레이 한도·중복 방지
  created_at timestamptz
)

-- reward_policies는 뽑기권 발급 정책 전용(ADR-0004) — 게임 보상은 games.reward_pool_id로
-- 직접 발급하므로 trigger 확장이 필요 없다.
-- raffles(...) 는 04-dev-spec §2 그대로. draw_raffle 결과에 animationSeed 파생(§4).
```

RLS: `games` 공개 읽기·staff 쓰기. `game_plays` 본인 읽기, 쓰기는 **RPC만**(직접 쓰기 금지). 기존 invariant(재고·집계 캐시 보호, `search_path=''`, execute 최소 grant) 준수.

---

## 4. RPC 설계 초안 ([04-dev-spec §3](./04-dev-spec.md) 확장)

| RPC | 역할 | 무결성 |
|---|---|---|
| `play_game(game_id)` | 참여형 게임 1회. 자격·일일 한도 검증 → **서버 RNG로 결과 결정** → `grant_cards`(무상) → `game_plays` 기록 → `{playId, rewards, animationSeed}` 반환 | 멱등(`game_plays.idempotency_key`), `grant_cards` 내부 호출, **유상 경로 없음** |
| `draw_raffle(raffle_id, client_seed)` | (기존) commit-reveal 추첨. **결과 payload에 `animationSeed` 파생**(revealed `server_seed`+`client_seed`) → 마블 연출이 결정론적으로 당첨자 순서에 도달 | 멱등, seed 해시 검증(기존) |

- **코스메틱 보장(참여형, c1 사전 시뮬)**: `play_game`이 결과를 먼저 정하고, 클라이언트는 `animationSeed`로 **헤드리스 사전 시뮬레이션**을 돌려 우승 구슬을 알아낸 뒤 **그 구슬에 서버 보상 라벨을 배치**하고 같은 시드로 화면 재생한다. 물리는 100% 장식(조작 없음), 결과는 100% 서버 — 라벨이 처음부터 노출돼도 바꿔치기가 보이지 않는다. (#63 그릴링에서 "종료 시 매핑" 원안을 대체, 2026-07-06)
- **연출 ≠ 선정(래플)**: `draw_raffle` 당첨자 선정은 commit-reveal로 검증가능하고, 마블 연출은 그 **검증된 결과를 표시**할 뿐이다. `animationSeed`는 이미 공개된 seed에서 파생하므로 스키마 변경 없이 계약으로만 추가된다.
- `grant_cards`는 여전히 `open_draw_ticket`(뽑기권 개봉)·**`play_game`**(·향후 `clear_mission`·`draw_raffle`) **내부에서만** 호출된다. 게임 보상은 뽑기권을 거치지 않고 직접 발급된다(게임 연출이 곧 개봉 경험, [ADR-0004](../adr/0004-draw-ticket-card-packs.md)) — 결제로 카드·뽑기권을 직접 사는 RPC는 존재하지 않는다(무상 구조 코드 보장, [04-dev-spec §3](./04-dev-spec.md)).

---

## 5. 크로스플랫폼 · 앱스토어 · 결정론

- **Apple App Store 4.7(2025.11 강화)**: webview 동적 미니게임이 전면 심사 대상. 게임을 **첫파티·앱 경험의 일부**로 프레이밍(미니앱 마켓 아님), WebKit 사용, 연령 장치·네이티브 API 노출 제약 준수, 원격 URL은 **첫파티 오리진 허용리스트**만. 앱 출시 시 재점검.
- **결정론**: 웹·Expo 둘 다 webview에서 같은 WASM 번들 실행 → 같은 `animationSeed`면 동일 재생. 네이티브 재구현이 아니므로 부동소수점·타임스텝 불일치가 없다.
- **웹 우선**: 게임은 online-popup V1(#115 post-launch)에 웹으로 먼저 만들되 처음부터 `PopupGameHost` 계약 뒤에서 구현 → Expo webview 임베딩(#66 V2)이 렌더러 재작성 없이 얹힌다. 인증 bridge는 별도 교체 대상이다.

---

## 6. 테스트 체크리스트 (추가 — [04-dev-spec §9](./04-dev-spec.md)에 이어서)

### 게임 미니앱
- [ ] `play_game` 결과는 **서버 결정**, 클라이언트 조작 불가(같은 요청 재생 시 결과 불변).
- [ ] 일일 한도 초과 플레이 차단(`game_plays.idempotency_key`·`per_user_daily_limit`).
- [ ] `animationSeed` 재생이 웹·(모의)webview에서 동일 결과에 도달(결정론).
- [ ] 게임에서 서버 RPC 외 경로로 카드·보상 발급 불가(유상/직접 발급 부재).

### 래플 시각화
- [ ] 마블 연출이 `draw_raffle` **검증 결과**와 항상 일치(연출이 선정을 바꾸지 않음).
- [ ] `serverSeed` reveal 후 `winners` 재계산 일치(검증 가능, 기존 §래플 유지).

### 크로스플랫폼 · 보안
- [ ] webview는 첫파티 오리진 허용리스트 외 URL 로드 거부.
- [ ] refresh token·범용 Supabase session이 WebView JS·cookie/localStorage/sessionStorage·로그·스크린샷에 없고 logout·정지·탈퇴 때 native/WebView 양쪽에서 제거됨.
- [ ] bridge token은 native 인증 subject/session·origin/audience·nonce·정확한 capability/resource·짧은 TTL·single-use에 묶이고 replay·만료·unknown method·argument scope 이탈을 거부함.
- [ ] 사용자 A token을 사용자 B handshake/request로 바꿔 끼우면 거부하고, BFF가 client user ID·임의 RPC·범용 service-role 대행을 허용하지 않음.
- [ ] 짧은 access JWT 직접 주입 경로는 명시 승인 없이는 존재하지 않고, 승인된 예외도 refresh token 없이 memory-only·만료/zeroization을 검증함.

---

## 7. 당시 구현 순서 & 이슈 보드

아래 표는 2026-07 당시의 추적 상태를 보존한 historical snapshot이다. 신규·잔여 실행 지시가 아니며, #66과 #115는 2026-08-13 현재 제품 범위에서 제거됐다.

| 순서 | 이슈 | Dependency |
|---|---|---|
| 아키텍처 증명 | [#63](https://github.com/icons-hq/icons-ip/issues/63) 마블 룰렛 웹 게임 PoC (mock) | ✅ 완료 (PR #75, 2026-07-06) |
| 무료 모델 심장 | [#62](https://github.com/icons-hq/icons-ip/issues/62) 무료 리워드 발급 코어 (`card_grants`·`grant_cards`) | ✅ 완료 (PR #72, 2026-07-06) |
| 게임 서버 경로 | [#64](https://github.com/icons-hq/icons-ip/issues/64) 참여형 게임 서버 (`play_game`) | ✅ 완료 (2026-07-07) |
| 피벗 정리 | [#65](https://github.com/icons-hq/icons-ip/issues/65) 유료 가챠 코드 비활성 | ✅ 완료 (2026-07-07) |
| 크로스플랫폼(V2) | [#66](https://github.com/icons-hq/icons-ip/issues/66) Expo webview 임베딩 | 당시 Blocked, 이후 current scope에서 제거 |
| — | [#67](https://github.com/icons-hq/icons-ip/issues/67) [Epic] 온라인 팝업 게임 레이어 & 무료 리워드 피벗 | Epic |

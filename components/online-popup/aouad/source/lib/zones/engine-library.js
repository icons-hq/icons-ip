// 도서관 엔진 — 서가 탈출 플랫포머 (2026-09-04 · PM 「너무 재밌어」 판정 통과 판).
//
// **회색 상자 `/prototypes/aouad-library-run-graybox.html` §1부를 그대로 옮긴 것이다.**
// 이름·수치를 바꾸지 않는다 — 관문(`npm run test:library-engine`)이 회색 상자 HTML 에서
// 같은 블록을 직접 뽑아 대조한다. 로직을 고치려면 **회색 상자를 먼저 고치고 재미 판정을 다시 받는다.**
// P3 통과 = 자동 달리기 · 뒤에서 오는 위험(무리 웨이브 · 기습 2종) · 연속 두 번 = 멀리뛰기.
// 규칙 동결 근거 = `ICONS-지우학-도서관-서가탈출-플랫포머-P2-2026-09-03.md` §6 · §11.
//
// 이 파일은 **화면을 모른다.** DOM·컴포넌트·Phaser·에셋 경로가 들어오면 그 순간
// 「그림 교체가 규칙 코드를 안 건드린다」는 P5 통과 조건이 깨진다.
//
// 이전 판(서가 추격전 · 갈림길 7구간)은 이 파일로 대체됐다 — 기록 키 `libScore`·`libBest` 폐기.

/* ── 1부. 함정 강도 프리셋 ──
   판정은 **보통**으로 받았다(P2 §8-B 확정). 온화·짓궂음은 운영 중 조정 여지로 남긴다.
   난이도 축은 셋 = 예고 시간 · 무리 압박(기본·파고·거리) · 기습이 나타나는 거리. */
export const TRAPS = {
  mild: {
    name: "온화", shelfWarn: 1.4, chargeWarn: 0.9, cartWarn: 1.1, hand: false, fakeDoor: false,
    hordeBase: 145, hordeSurge: 225, surgeFor: 1300, gap0: 340, maxGap: 440, lungeBehind: 640,
  },
  normal: {
    name: "보통", shelfWarn: 1.0, chargeWarn: 0.6, cartWarn: 0.8, hand: true, fakeDoor: true,
    hordeBase: 155, hordeSurge: 260, surgeFor: 1600, gap0: 300, maxGap: 400, lungeBehind: 520,
  },
  mean: {
    name: "짓궂음", shelfWarn: 0.6, chargeWarn: 0.4, cartWarn: 0.5, hand: true, fakeDoor: true,
    hordeBase: 165, hordeSurge: 265, surgeFor: 1600, gap0: 260, maxGap: 360, lungeBehind: 400,
  },
};
export const DEFAULT_TRAP = "normal";

/* ── 2부. CONFIG ── */
export const CONFIG = {
  world: 11000, ground: 320,                  // 길이 · 바닥 y
  run: 180,                                   // 달리기 px/s
  jumpV: 520, gravity: 1500,                  // 한 번 = 정점 90px
  doubleMs: 260, longApex: 140,               // 두 번째 탭이 이 안에 들어오면 정점 140px (거리 ≈155px)
  bufMs: 110, coyoteMs: 100,                  // 점프 버퍼 · 코요테
  slideMs: 700,                               // 슬라이드 지속 (126px)
  vaultMax: 24, vaultV: 0.55,                 // 저절로 넘는 턱 높이 · 그 때 뛰는 힘(초속 비율)
  patrolSpeed: 90, chargeSpeed: 260, cartSpeed: 240,
  surgeWarn: 700,                             // 웨이브 예고
  lungeSpeed: 400, lungeClear: 60,            // 기습이 달려오는 속도(전 난이도 같다 — 난이도는 나타나는 거리로) · 지나갔다고 보는 거리
  segments: [0, 3700, 7400],                  // 체크포인트 = 구간 시작 x
  exit: { x: 10800, yMax: 200 },              // 진짜 출구 — 계단 끝 창 (이름을 window 로 두면 브라우저 전역과 헷갈린다)
  fakeDoor: 9800, stunMs: 500, deathMs: 260,  // 잡힘 → 재시작까지 (연출이 아니라 규칙 — 트윈에 걸지 않는다)
  ctrl: "auto",                               // 자동 달리기 (P2 §8-A 확정). "arrows" 는 데스크톱 선택지
};

/* ── 3부. 배치 — 전부 고정. 숨은 확률 없음 ── */
export const LEVEL = {
  bookmarks: [{ x: 1400, y: 280 }, { x: 3000, y: 150 }, { x: 4900, y: 170 }, { x: 7000, y: 290 }, { x: 10200, y: 130 }],
  patrols: [{ a: 900, b: 1200 }, { a: 1900, b: 2200 }],
  shelf: { x: 2600, trigger: 2200 },          // 흔들리다 넘어진다 → 눕는 동안 통과하면 잡힘 → 눕고 나면 60px 턱
  desks: [{ x: 3900, w: 220, y: 260 }, { x: 4300, w: 200, y: 240 }, { x: 4750, w: 260, y: 220 }, { x: 5500, w: 200, y: 260 }, { x: 5800, w: 220, y: 250 }],   // 책상 위 = 돌진·카트가 밑으로 지나가는 안전지대
  gaps: [{ x: 4140, w: 90 }, { x: 5100, w: 90 }],     // 책상 사이 — 떨어지면 잡힌 것과 같다. 탭 한 번이면 넘는다
  charge: { x: 4600, detect: 500 },
  hand: { x: 5400, y: 256 },                  // 머리 높이 — 미끄러져야 지난다
  cart: { trigger: 5900 },
  secret: { doorX: 6800, topsX: 6800, topsW: 500, topsY: 200, exitX: 7300 },   // 서가 윗길(정상 · 두 번 탭) vs 서가 밑 통로(비밀 — 문을 민다)
  stairs: Array.from({ length: 9 }, (_, i) => ({ x: 8200 + i * 300, w: 300, y: 300 - i * 20 })),   // 20px 계단 — 저절로 오른다
  piles: [{ x: 8550, y: 280 }, { x: 9350, y: 240 }, { x: 10150, y: 180 }],   // 책 더미 40px — 직접 뛰어야 한다. 막히면 무리가 온다
  surges: [1800, 3400, 5000, 6500, 8400, 9900],                              // 무리 웨이브가 밀려드는 자리
  lungers: [{ at: 1250, kind: "low" }, { at: 2900, kind: "leap" }, { at: 6100, kind: "low" }, { at: 7500, kind: "leap" }],   // 뒤에서 한 마리씩 튀어나오는 자리
};

export const SEGMENT_NAMES = ["서가", "열람실", "비상계단"];

/* ── 4부. 순수 함수 ── */
export const segmentOf = (x) => CONFIG.segments.reduce((s, sx, i) => (x >= sx ? i : s), 0);
export const escaped = (x, y) => x >= CONFIG.exit.x && y <= CONFIG.exit.yMax;

/* 한 판의 결과 → 미션 넷. 탈출은 그 자체가 하나고, 무피격은 탈출해야 성립한다 */
export const missions = (run) => ({
  bookmarks: bookmarkCount(run) >= LEVEL.bookmarks.length,
  noHit: !!run.escaped && run.hits === 0,
  secret: !!run.secret,
  escaped: !!run.escaped,
});

/* 책갈피는 Set 으로도 수로도 들어올 수 있다(회색 상자는 Set, 시연판 기록은 수) */
export function bookmarkCount(run) {
  const b = run.bookmarks;
  if (b == null) return 0;
  if (typeof b === "number") return b;
  return typeof b.size === "number" ? b.size : b.length || 0;
}

/* 얻는 구매권 — 탈출 하나 + 미션 셋.
   탈출(`libPhoto`)은 **잠금**(존 대표 보상 · PM 판정 ⓑ), 미션 셋은 **선구매·에디션**(PM 판정 C). 둘 다 2026-09-04.
   여기는 어떤 미션이 어떤 구매권을 여는지만 안다 — 잠금이냐 선구매냐는 상품 데이터(`aouad-data`)의 몫이다. */
export const RIGHT_OF_MISSION = { escaped: "libPhoto", bookmarks: "libBookmarkSet", noHit: "libDeskmat", secret: "libJournal" };
export function rightsOfRun(run) {
  const m = missions(run);
  return Object.keys(RIGHT_OF_MISSION).filter((k) => m[k]).map((k) => RIGHT_OF_MISSION[k]);
}

/* 점프 — 한 번은 정점 apex(jumpV), 두 번째 탭은 «남은 높이»로 초속을 다시 잡아
   누른 시점과 무관하게 정점 longApex 를 보장한다 */
export const apex = (v) => (v * v) / (2 * CONFIG.gravity);
export const boostV = (rise) => Math.sqrt(Math.max(0, 2 * CONFIG.gravity * (CONFIG.longApex - rise)));

/* 기습 판정 — 낮은 놈은 좁고 낮아 탭 한 번으로 넘고, 덮치는 놈은 크고 높아
   정점 140px 로 뛰어도 걸린다. 미끄러져 흘리는 수밖에 없다 — 그래야 「선택」이 된다 */
export const lungeBox = (kind) => (kind === "low"
  ? { w: 34, h: 28, y: CONFIG.ground - 14 }
  : { w: 50, h: 120, y: CONFIG.ground - 100 });

/* 피할 여유 = 몸이 높이 h 위에 있는 시간 − 놈이 나를 스쳐 지나는 시간 */
export function dodgeSlack(kind) {
  const box = lungeBox(kind);
  const pass = (box.w + 24) / (CONFIG.lungeSpeed - CONFIG.run);
  if (kind === "leap") return CONFIG.slideMs / 1000 - pass;
  const d = Math.sqrt(CONFIG.jumpV * CONFIG.jumpV - 2 * CONFIG.gravity * box.h);
  return (d / CONFIG.gravity) * 2 - pass;
}

/* 기습을 보고 고를 시간 — 난이도는 속도가 아니라 이 거리다 */
export const lungeReactSec = (trap) => (TRAPS[trap].lungeBehind - 34) / (CONFIG.lungeSpeed - CONFIG.run);

/* 무리 수지 — 파고 한 번이 좁히는 거리 vs 다음 파고까지 벌리는 거리.
   웨이브 사이 간격 ≈ 1,600px / 달리기 = 8.9초. 이 둘이 「깨끗이 달리면 견딘다」를 만든다 */
export const WAVE_CYCLE_SEC = 1600 / CONFIG.run;
export const surgeCost = (trap) => (TRAPS[trap].hordeSurge - CONFIG.run) * TRAPS[trap].surgeFor / 1000;
export const surgeRecover = (trap) => (CONFIG.run - TRAPS[trap].hordeBase) * (WAVE_CYCLE_SEC - TRAPS[trap].surgeFor / 1000);

/* 무리 속도 — 파고 중이면 파고 속도, 아니면 벌어진 만큼 빨라진다.
   **순간이동으로 상한을 잡으면 파고가 매 프레임 상쇄된다**(2026-09-04 실측) — 반드시 속도로 잡는다 */
export function hordeSpeed(trap, gap, surging) {
  const t = TRAPS[trap];
  if (surging) return t.hordeSurge;
  return Math.min(CONFIG.run + 20, t.hordeBase + Math.max(0, gap - t.maxGap) * 1.5);
}

/* 한 판의 빈 기록 */
export const freshRun = () => ({ seg: 0, bookmarks: 0, hits: 0, dodged: 0, secret: false, escaped: false, ms: 0 });

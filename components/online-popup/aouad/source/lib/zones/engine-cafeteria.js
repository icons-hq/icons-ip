// 급식실 엔진 — 크래시 (2026-09-03 단순화 · PM 재교정 반영).
//
// 한 판 = **5회차**, 점수 = **최고 3회차의 합**(원래 로직 그대로). 회차마다 포인트가 오르고,
// 유리문이 뚫리기 전에 탈출하면 그 회차 포인트가 내 것이다 — 뚫리면 그 회차는 0.
// 회차 포인트에는 **상한**이 있다 — 상한에 닿으면 그 회차는 거기서 끝난다(더 머물 이유가 없다).
// 자리·챙긴 것·메고 나온 자리 — 없다. 포인트를 모으면 된다.
//
// 무료 참여다. 보상은 점수별 차등 구매권(aouad-data RIGHTS game:"cafeteria", score) — 규칙은 여기, 보상은 데이터.
// 무인 시연(오락실 데모)도 같은 규칙으로 돈다 — 게임 방식을 보여 주기 위해서다.
//
// 이 파일은 **화면을 모른다.** 관문 = `npm run test:cafeteria-engine`.

/* ── 1부. CONFIG ── */
export const CONFIG = {
  rounds: 5,          // 한 판의 회차 수
  countBest: 3,       // 점수로 세는 회차 = 최고 몇 개
  cap: 1600,          // 회차 포인트 상한 — 최대 점수 = cap × countBest = 4,800
  waitMs: 3000,       // 회차 사이 대기 (내 판)
  demoWaitMs: 1500,   // 무인 시연의 회차 사이 — 카운트다운 없이 잠깐 비었다가 다시 오른다
  resultMs: 1500,     // 회차가 끝난 뒤 머무는 시간
  summaryMs: 5000,    // 5회차가 끝난 뒤 합계·보상이 머무는 시간
  tMax: 12,           // 차트 가로 상한(초) — 상한 시각 11.9초
};

/* ── 2부. 유리문 ──
   **시간이 갈수록 뚫릴 확률이 오른다. 무기억이 아니다.** 금이 보이는 만큼 위험도 커진다.
   누적 뚫림 4s 8% · 8s 39% · 상한(11.9s) 74%. 기대 포인트(포인트 × 생존률)는 **8초**에서 정점 —
   상한까지 버티는 것은 손해이고, A상은 3회차를 상한 근처까지 버텨야 나온다(천장이 높다). */
export const GLASS = [
  { to: 4, h: 0.02, name: "문은 멀쩡하다" },
  { to: 8, h: 0.10, name: "실금이 갔다" },
  { to: 12, h: 0.22, name: "금이 번진다" },
  { to: Infinity, h: 0.50, name: "문이 휜다" },
];

export function breakTime(u) {
  const need = -Math.log(1 - u);
  let prev = 0;
  let acc = 0;
  for (const g of GLASS) {
    const seg = g.to - prev;
    if (acc + g.h * seg >= need) return prev + (need - acc) / g.h;
    acc += g.h * seg;
    prev = g.to;
  }
  return Infinity;
}

export const glassAt = (t) => GLASS.findIndex((g) => t < g.to);

export function breakProb(t) {
  let prev = 0;
  let acc = 0;
  for (const g of GLASS) {
    const to = Math.min(t, g.to);
    acc += g.h * (to - prev);
    prev = to;
    if (t <= g.to) break;
  }
  return 1 - Math.exp(-acc);
}

/* ── 3부. 포인트 곡선 ──
   머문 시간이 포인트다. 볼록 곡선 — 뒤로 갈수록 빨리 오른다. 상한에서 멈춘다. */
export const rawPoints = (t) => Math.round(5 * t * t + 75 * t);
export const pointsAt = (t) => Math.min(CONFIG.cap, rawPoints(t));
export const timeFor = (p) => (-75 + Math.sqrt(75 * 75 + 20 * Math.min(p, CONFIG.cap))) / 10;
export const capTime = () => timeFor(CONFIG.cap);

/* 탈출 시각과 뚫린 시각으로 회차 결과가 난다 — 뚫린 뒤면 0 */
export const resultOf = (escapeAt, breakAt) => (escapeAt < breakAt ? pointsAt(escapeAt) : 0);

/* 점수 = 최고 countBest 회차의 합 */
export const best3 = (got) =>
  [...got].sort((a, b) => b - a).slice(0, CONFIG.countBest).reduce((a, b) => a + b, 0);
export const maxScore = () => CONFIG.cap * CONFIG.countBest;

/* ── 4부. 결정론 ── */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 한 판(5회차)의 뚫리는 시각을 통째로 미리 뽑는다 — 「선확정 → 재생」 */
export function buildPlay(seed) {
  const r = mulberry32(seed);
  const out = [];
  for (let i = 0; i < CONFIG.rounds; i++) out.push(breakTime(Math.min(0.999999, r())));
  return out;
}

/* ── 5부. 인구 가정 ──
   구매권 도달률(관문 실측)과 무인 시연이 같은 분포를 쓴다 —
   노리는 시각(초)과 비율. 마지막은 「상한까지」. */
export const PLAY_MIX = [[4, 0.06], [5.5, 0.18], [7, 0.24], [8.5, 0.22], [10, 0.14], [Infinity, 0.16]];

const targetOf = (u) => {
  let acc = 0;
  for (const [t, w] of PLAY_MIX) { acc += w; if (u < acc) return t; }
  return PLAY_MIX[PLAY_MIX.length - 1][0];
};

/* 한 판을 노리는 시각 5개 — 판 단위로 성향을 하나 뽑고 회차마다 ±1초 흔든다. 상한 이후는 상한 */
export function demoPlan(seed) {
  const r = mulberry32(seed);
  const T = targetOf(r());
  const out = [];
  for (let i = 0; i < CONFIG.rounds; i++) out.push(Math.min(capTime(), T === Infinity ? capTime() : Math.max(1, T + (r() - 0.5) * 2)));
  return out;
}

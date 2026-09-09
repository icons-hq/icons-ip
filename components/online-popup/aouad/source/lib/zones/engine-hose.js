// 방송실 엔진 — 소화전 호스 하강 (2026-09-04 · PM 「다 좋아 재밌어」 판정 통과 판).
//
// **회색 상자 `/prototypes/aouad-hose-graybox.html` §1부를 그대로 옮긴 것이다.**
// 이름·수치를 바꾸지 않는다 — 관문(`npm run test:hose-engine`)이 회색 상자 HTML 에서
// 같은 블록을 직접 뽑아 필드 단위로 대조한다. 로직을 고치려면 **회색 상자를 먼저 고치고 재미 판정을 다시 받는다.**
// 규칙 동결 근거 = `ICONS-지우학-방송실-소화전호스-P3-회색상자-2026-09-04.md` §10 · §11.
//
// P3 통과 = 놓으면 미끄러지고 누르고 있으면 잡는다 · 창문 10개 · 좀비 창은 보이되 때만 모른다 ·
//           갑자기 미끄러진다 · 마지막 창에서 멈추면 들어간다.
//
// **깨면 판이 성립하지 않는 관계 넷** (P3 도중 실제로 깨져 못 굴러갔던 것들 — 값을 만지면 여기부터 확인한다)
//   ① 전속력 제동거리(59) < 창 간격(150)      — 아니면 브레이크 지점을 지나쳐 설 수가 없다
//   ② 미끄러짐은 움직일 때만(속도 > slipMinV) — 서 있을 때도 미끄러지면 간격 안에 피할 자리가 없다
//   ③ 좀비가 안 나오는 틈(1.2초+) ≥ 건너는 시간 — 아니면 애초에 건널 수 없다
//   ④ 좀비 시계와 사람 시계는 같은 dt          — 벽시계로 재면 프레임이 밀릴 때 좀비만 빨라진다(화면 몫)
//
// 이 파일은 **화면을 모른다.** DOM·컴포넌트·에셋 경로가 들어오면 그 순간
// 「그림 교체가 규칙 코드를 안 건드린다」는 P5 통과 조건이 깨진다.
//
// 앞선 두 판(커튼 줄 하강 · 주파수 정렬)은 이 파일로 대체됐다 — 기록 키 `castClean`·`castDone`·`castTry` 폐기.

/* ── 1부. CONFIG (문서 §10 동결표) ── */
export const CONFIG = {
  people: 8,
  windows: 10,        // 지나가는 창문 — 마지막이 방송실이다
  first: 130,         // 첫 창문까지
  gap: 150,           // 창문 사이
  winHalf: 34,        // 창문의 반폭 — 여기 있으면 좀비 손이 닿는다
  goalHalf: 46,       // 마지막 창은 조금 넓다 — 들어가야 하니까
  traps: 3,           // 좀비가 나오는 창문 수 (1~9번 중) — **어느 창인지는 보인다**
  aDown: 480,         // 놓으면 붙는 가속
  vMax: 360,          // 미끄러질 때 결국 닿는 속도
  aBrake: 1100,       // 잡으면 붙는 감속
  vIn: 150,           // 마지막 창에서 이 속도 아래면 들어간다
  grip: 3.2,          // 잡고 버틸 수 있는 시간(초)
  gripBack: 2.0,      // 놓으면 초당 이만큼 돌아온다
  slipRate: 0.30,     // **움직이면서** 잡는 1초마다 갑자기 미끄러질 확률
  slipMinV: 40,       // 완전히 선 뒤에는 안 미끄러진다 — 아니면 피할 자리가 없다
  slipV: 180,         // 미끄러지면 속도가 이만큼 튄다
  slipFor: 0.35,      // 미끄러지는 동안은 못 잡는다(초)
  zPer: [1.8, 2.8],   // 좀비가 튀어나오는 주기
  zOut: 0.60,         // 나와 있는 시간
  zTell: 0.50,        // 나오기 전 낌새
  tail: 260,          // 마지막 창 아래로 이만큼 = 바닥
  lead: 190,          // 화면이 내 아래로 보여 주는 거리
};

/* ── 2부. 자리 ── */
/* 창문 자리 — 0번이 첫 창, 마지막이 방송실 */
export const winY = (k) => CONFIG.first + k * CONFIG.gap;
export const goalIdx = () => CONFIG.windows - 1;
export const goalY = () => winY(goalIdx());
export const bottomY = () => goalY() + CONFIG.tail;
export const halfOf = (k) => (k === goalIdx() ? CONFIG.goalHalf : CONFIG.winHalf);
/* 지금 어느 창문 안에 있나 (없으면 -1) */
export const winAt = (y) => {
  const k = Math.round((y - CONFIG.first) / CONFIG.gap);
  return k >= 0 && k < CONFIG.windows && Math.abs(y - winY(k)) <= halfOf(k) ? k : -1;
};
/* 전속력에서 서는 데 걸리는 거리 — 창 간격보다 길면 미리 줄여야 한다는 뜻이다 */
export const brakeDist = (v) => (v * v) / (2 * CONFIG.aBrake);

/* ── 3부. 좀비 ── */
/* 좀비 한 마리의 상태 — 나옴 → 숨음 → 낌새 → 나옴 … */
export const zAt = (t, tr) => {
  const p = (((t - tr.phase) % tr.period) + tr.period) % tr.period;
  return p < CONFIG.zOut ? "out" : p < tr.period - CONFIG.zTell ? "hidden" : "tell";
};

/* ── 4부. 한 걸음 ── */
/* 화면을 모르고, 상태를 새로 만들어 돌려준다. hold = 누르고 있나 · roll = 0~1 난수 하나 */
export function advance(s, dt, hold, roll) {
  const o = { y: s.y, v: s.v, grip: s.grip, slipLeft: Math.max(0, s.slipLeft - dt), slipped: false };
  const canHold = hold && o.grip > 0 && o.slipLeft <= 0;
  if (canHold) {
    o.v = Math.max(0, o.v - CONFIG.aBrake * dt);
    o.grip = Math.max(0, o.grip - dt);
    if (o.v > CONFIG.slipMinV && roll < CONFIG.slipRate * dt) {   // 갑자기 미끄러진다 — 아직 움직이는 중일 때만
      o.v += CONFIG.slipV; o.slipLeft = CONFIG.slipFor; o.slipped = true;
    }
  } else {
    o.v = Math.min(CONFIG.vMax, o.v + CONFIG.aDown * dt);
    if (!hold) o.grip = Math.min(CONFIG.grip, o.grip + CONFIG.gripBack * dt);  // 놓아야 힘이 돌아온다
  }
  o.y += o.v * dt;
  return o;
}

/* 이 자리에서 판이 끝났나 — 셋 중 하나이거나 아직이거나 */
export function outcome(s, t, traps) {
  if (s.y >= bottomY()) return "ground";
  const k = winAt(s.y);
  if (k < 0) return null;
  if (k === goalIdx()) return s.v <= CONFIG.vIn ? "in" : null;
  const tr = traps.find((x) => x.k === k);
  return tr && zAt(t, tr) === "out" ? "zombie" : null;
}

/* ── 5부. 결정론 ── */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* 창문 배치와 좀비 시간표를 판이 열릴 때 통째로 뽑는다(선확정 → 재생) */
export function buildPlay(seed) {
  const r = mulberry32(seed);
  return Array.from({ length: CONFIG.people }, () => {
    const pool = Array.from({ length: CONFIG.windows - 1 }, (_, i) => i);   // 마지막 창엔 좀비가 없다
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const traps = pool.slice(0, Math.min(CONFIG.traps, pool.length)).sort((a, b) => a - b).map((k) => ({
      k, period: CONFIG.zPer[0] + r() * (CONFIG.zPer[1] - CONFIG.zPer[0]), phase: r() * 3,
    }));
    return { traps, seed: (r() * 4294967296) >>> 0 };
  });
}

/* ── 6부. 말 ── */
export const KIND_KO = { in: "방송실로 들어갔다", zombie: "좀비에게 붙잡혔다", ground: "바닥까지 떨어졌다" };
export const KIND_WHY = { in: "마지막 창에서 멈췄다", zombie: "좀비가 나와 있는 창문에 있었다", ground: "마지막 창에서 못 멈췄다" };

/* 한 판이 열릴 때의 사람 상태 */
export const freshRider = () => ({ y: 0, v: 0, grip: CONFIG.grip, slipLeft: 0, slipped: false });

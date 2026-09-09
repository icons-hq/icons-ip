// 상자 엔진 — G3 배선도.
//
// **회색 상자에서 그대로 옮긴 것이다.** G1·G2 와 따로 두는 이유는 규칙이 다르기 때문이다 —
// G3 에는 `buildLadder`·`tracePath` 가 있고, **사다리는 회차 내 고정**이라 씨앗에서 한 번
// 만들어 회차 내내 같은 배선을 쓴다. 이 성질이 「밝혀진 경로가 쌓인다」의 근거다.
//
// 주의 — 시연판 무대의 `ladderRungs` 는 **그림용 장식**이다. 규칙은 여기 있다.
//
// 이 파일은 화면을 모른다.

/* ── 1부. CONFIG ── */
export const CONFIG = {
  cols: 10, rows: 8, slots: 80, price: 5000, dailyLimit: 10,
  rewireEvery: 10,       // 이 횟수마다 배선이 다시 꽂힌다 — 일 구매 한도와 수는 같아도 다른 개념이다
  rungRows: 8,           // 사다리 단수
  rungDensity: 0.42,     // 각 단에 가로줄이 놓일 확률
  stepMs: 130,           // 한 단 따라가는 시간 — 「미뤄지는 구간」이 이 게임의 재미다
  rivalEveryMs: [5000, 12000],
  prizes: [
    { g:"A", name:"방송부 헤비웨이트 후디", value:65000, count:1 },
    { g:"B", name:"남라 노이즈캔슬링 이어폰", value:39000, count:1 },
    { g:"B", name:"이병찬 실험노트 세트", value:32000, count:1 },
    { g:"B", name:"2-5반 렌티큘러 블록", value:32000, count:1 },
    { g:"C", name:"주파수 다이얼 참", value:12000, count:4 },
    { g:"C", name:"방송부 마이크 미니어처", value:11500, count:4 },
    { g:"C", name:"ON AIR 아크릴 마그넷", value:10000, count:4 },
    { g:"D", name:"방송부 배지", value:7000, count:8 },
    { g:"D", name:"카세트테이프 케이스", value:6500, count:8 },
    { g:"D", name:"케이블 타이 세트", value:5500, count:8 },
    { g:"E", name:"주파수 스티커 시트", value:3000, count:14 },
    { g:"E", name:"방송 대본 리플리카", value:2500, count:13 },
    { g:"E", name:"방송실 스틸 미니엽서", value:2500, count:13 },
  ],
  lastPrize: { g:"LAST", name:"방송부 후디 — 넘버링 각인판", value:65000 },
};

/* ── 2부. LOGIC ── */
function mulberry32(seed){ let a = seed >>> 0; return function(){
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; };}
function buildRound(seed){
  const rng = mulberry32(seed), pool = [];
  CONFIG.prizes.forEach((p, pi) => { for (let i = 0; i < p.count; i++) pool.push(pi); });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool;
}
/* 사다리 — **뽑기 묶음 안에서만** 고정. rungs[r] = 그 단에서 (c,c+1) 을 잇는 열들.
   회차 내내 고정하면 하루 10회로 10열이 전부 밝혀지고, 남은 70회는 아는 길을 다시 따라가는 재생이 된다
   (PM 2026-08-31 재미 판정: 「G3 지도는 좀 김빠져」). 그래서 `dailyLimit` 회마다 누가 배선을 다시 꽂는다.
   같은 묶음 안에서는 흔들리지 않는다 — 흔들리면 「따라가서 알아낸다」가 성립하지 않는다. */
function ladderBlock(draws){ return Math.floor(draws / CONFIG.rewireEvery); }
function buildLadder(seed, block = 0){
  const rng = mulberry32((seed ^ 0x1AD0 ^ Math.imul(block, 0x9E3779B1)) >>> 0), rungs = [];
  for (let r = 0; r < CONFIG.rungRows; r++) {
    const row = [];
    for (let c = 0; c < CONFIG.cols - 1; c++) {
      if (row.includes(c - 1)) continue;          // 인접 가로줄 금지(정통 아미다쿠지)
      if (rng() < CONFIG.rungDensity) row.push(c);
    }
    rungs.push(row);
  }
  return rungs;
}
/* 출발점 → 도착 열. 경로를 통째로 돌려준다(재생·지도용) */
function tracePath(rungs, start){
  let c = start; const path = [{ r: 0, c }];
  for (let r = 0; r < CONFIG.rungRows; r++) {
    if (rungs[r].includes(c)) c += 1;
    else if (rungs[r].includes(c - 1)) c -= 1;
    path.push({ r: r + 1, c });
  }
  return { path, col: c };
}
const cellIdx = (col, row) => row * CONFIG.cols + col;
function colLeft(state, col){ let n = 0; for (let r = 0; r < CONFIG.rows; r++) if (state.cell[cellIdx(col, r)] === "open") n++; return n; }
function topOpen(state, col){ for (let r = 0; r < CONFIG.rows; r++) { const i = cellIdx(col, r); if (state.cell[i] === "open") return i; } return -1; }
function settleCol(state, col){
  if (colLeft(state, col) > 0) return col;
  for (let d = 1; d < CONFIG.cols; d++) {
    if (col - d >= 0 && colLeft(state, col - d) > 0) return col - d;
    if (col + d < CONFIG.cols && colLeft(state, col + d) > 0) return col + d;
  } return -1;
}
function remainingByPrize(state){ const rem = CONFIG.prizes.map(() => 0);
  state.assign.forEach((pi, i) => { if (state.cell[i] === "open") rem[pi]++; }); return rem; }
const leftCount = s => s.cell.filter(c => c === "open").length;
function aCol(state){ for (let i = 0; i < CONFIG.slots; i++)
  if (state.cell[i] === "open" && CONFIG.prizes[state.assign[i]].g === "A") return i % CONFIG.cols; return -1; }

export { mulberry32, buildRound, buildLadder, ladderBlock, tracePath, cellIdx, colLeft, topOpen, settleCol, remainingByPrize, leftCount, aCol };

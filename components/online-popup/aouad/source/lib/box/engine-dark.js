// 상자 엔진 — G4 소등 후.
//
// **회색 상자에서 그대로 옮긴 것이다.** 다른 셋과 따로 두는 이유 —
// G4 에는 `beamCells`·`scanResult` 가 있고, **정보가 소비된다**.
// G3 은 밝혀진 것이 회차 내내 남지만 G4 의 손전등은 열면 초기화된다(P2 §1).
// 이 대비가 성립하지 않으면 두 회차 중 하나는 중복이다.
//
// 정보 계약 — `scanResult` 는 **범위 안 상위상 개수만** 돌려준다.
// 어느 칸인지는 어떤 방법으로도 나오지 않는다(P2 §4-4). 반환값에 칸 식별자를 넣지 마라.
//
// 이 파일은 화면을 모른다.

/* ── 1부. CONFIG ── */
export const CONFIG = {
  cols: 10, rows: 8, slots: 80, price: 5000, dailyLimit: 10,
  scansPerDraw: 3,       // 뽑기 1회당 손전등 — 정보의 가격이다
  beamR: 1,              // 3×3
  highTiers: ["A", "B", "C"],
  revealMs: 520,
  rivalEveryMs: [5000, 12000],
  prizes: [
    { g:"A", name:"남라 '면벽' 오버핏 니트 집업", value:89000, count:1 },
    { g:"B", name:"옥상 S.O.S 블랭킷", value:39000, count:1 },
    { g:"B", name:"은지 레트로 방풍 라이터", value:35000, count:1 },
    { g:"B", name:"모닥불 캔들", value:24000, count:1 },
    { g:"C", name:"손전등 미니 참", value:12000, count:4 },
    { g:"C", name:"모닥불 불씨 아크릴 참", value:11000, count:4 },
    { g:"C", name:"옥상 S.O.S 아크릴 마그넷", value:10000, count:4 },
    { g:"D", name:"미니 캔들", value:7000, count:8 },
    { g:"D", name:"야광 스티커팩", value:6000, count:8 },
    { g:"D", name:"비상등 키링", value:5500, count:8 },
    { g:"E", name:"야광 참", value:3500, count:14 },
    { g:"E", name:"불씨 스티커", value:2500, count:13 },
    { g:"E", name:"소등 카드", value:2500, count:13 },
  ],
  lastPrize: { g:"LAST", name:"남라 집업 — 넘버링 각인판", value:89000 },
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
const idx = (c, r) => r * CONFIG.cols + c;
function beamCells(center){
  const cc = center % CONFIG.cols, cr = Math.floor(center / CONFIG.cols), out = [];
  for (let r = cr - CONFIG.beamR; r <= cr + CONFIG.beamR; r++)
    for (let c = cc - CONFIG.beamR; c <= cc + CONFIG.beamR; c++)
      if (r >= 0 && r < CONFIG.rows && c >= 0 && c < CONFIG.cols) out.push(idx(c, r));
  return out;
}
/* 비추기 결과 = 그 범위 안 「상위상 개수」뿐. 어느 칸인지는 알려주지 않는다 */
function scanResult(state, center){
  const cells = beamCells(center).filter(i => state.cell[i] === "open");
  const high = cells.filter(i => CONFIG.highTiers.includes(CONFIG.prizes[state.assign[i]].g)).length;
  return { cells, open: cells.length, high };
}
function remainingByPrize(state){ const rem = CONFIG.prizes.map(() => 0);
  state.assign.forEach((pi, i) => { if (state.cell[i] === "open") rem[pi]++; }); return rem; }
const leftCount = s => s.cell.filter(c => c === "open").length;

export { mulberry32, buildRound, idx, beamCells, scanResult, remainingByPrize, leftCount };

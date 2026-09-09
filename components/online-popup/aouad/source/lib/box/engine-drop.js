// 상자 엔진 — G2 보급 낙하.
//
// **회색 상자에서 그대로 옮긴 것이다**(G1 엔진과 같은 규율, P5 착수 사양 §0).
// G1 과 따로 두는 이유는 규칙이 실제로 다르기 때문이다 —
// G2 는 `settleCol`·`topOpen`·`dropPath` 가 있고, 잔여 판정도 `=== "open"` 으로
// 점유 중인 칸을 남은 것으로 세지 않는다(G1 은 `!== "taken"`).
// 공통처럼 보인다고 합치면 그 차이가 지워진다.
//
// 이 파일은 화면을 모른다.

/* ── 1부. CONFIG ── */
export const CONFIG = {
  cols: 10, rows: 8, slots: 80,
  price: 5000, dailyLimit: 10,
  pegRows: 8,              // 갈톤 보드 단수 — 클수록 퍼진다
  stepMs: 90,              // 낙하 1단 재생 시간
  rivalEveryMs: [4500, 12000],
  prizes: [                // 4회차 구성 G2 (A1·B3·C12·D24·E40)
    { g:"A", name:"효산고 양궁부 트레이닝 세트", value:79000, count:1 },
    { g:"B", name:"구급 파우치 & 블랭킷 팩",     value:28000, count:1 },
    { g:"B", name:"텍티컬 플래시",               value:24000, count:1 },
    { g:"B", name:"생존 키트 파우치",            value:22000, count:1 },
    { g:"C", name:"보급 카라비너 & 태그",        value:12000, count:4 },
    { g:"C", name:"휘슬 & 파라코드 키홀더",      value:11000, count:4 },
    { g:"C", name:"미니 구급 파우치",            value:10000, count:4 },
    { g:"D", name:"무전기 키링 단품 「다방」",    value:7000,  count:8 },
    { g:"D", name:"야간 반사 스트랩",            value:6000,  count:8 },
    { g:"D", name:"응급 밴드 틴케이스",          value:5500,  count:8 },
    { g:"E", name:"배급표 리플리카",             value:3000,  count:14 },
    { g:"E", name:"응급 표식 스티커팩",          value:3000,  count:13 },
    { g:"E", name:"생존 수칙 카드",              value:2500,  count:13 },
  ],
  lastPrize: { g:"LAST", name:"트레이닝 세트 — 넘버링 각인판", value:79000 },
};

/* ── 2부. LOGIC ── */
function mulberry32(seed){ let a = seed >>> 0; return function(){
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};}

/* 회차를 열 때 80칸에 등급이 이미 배정된다 — 낙하는 어느 칸을 여는가만 정한다 */
function buildRound(seed){
  const rng = mulberry32(seed), pool = [];
  CONFIG.prizes.forEach((p, pi) => { for (let i = 0; i < p.count; i++) pool.push(pi); });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
/* 갈톤 보드 — 투입구에서 시작해 단마다 좌/우. 경로를 통째로 돌려준다(재생용) */
function dropPath(entry, rng){
  const W = CONFIG.cols * 2 - 1;            // 2배 해상도(반칸 이동)
  let x = entry * 2, path = [x];
  for (let r = 0; r < CONFIG.pegRows; r++) {
    x += rng() < 0.5 ? -1 : 1;
    x = Math.max(0, Math.min(W - 1, x));
    path.push(x);
  }
  return { path, col: Math.round(x / 2) };
}
/* 착지 열이 비었으면 가장 가까운 남은 열로 굴러간다 */
function settleCol(state, col){
  if (colLeft(state, col) > 0) return col;
  for (let d = 1; d < CONFIG.cols; d++) {
    if (col - d >= 0 && colLeft(state, col - d) > 0) return col - d;
    if (col + d < CONFIG.cols && colLeft(state, col + d) > 0) return col + d;
  }
  return -1;
}
const cellIdx = (col, row) => row * CONFIG.cols + col;
function colLeft(state, col){
  let n = 0;
  for (let r = 0; r < CONFIG.rows; r++) if (state.cell[cellIdx(col, r)] === "open") n++;
  return n;
}
/* 그 열의 남은 칸 중 위에서부터 열린다 */
function topOpen(state, col){
  for (let r = 0; r < CONFIG.rows; r++) { const i = cellIdx(col, r); if (state.cell[i] === "open") return i; }
  return -1;
}
function remainingByPrize(state){
  const rem = CONFIG.prizes.map(() => 0);
  state.assign.forEach((pi, i) => { if (state.cell[i] === "open") rem[pi]++; });
  return rem;
}
const leftCount = s => s.cell.filter(c => c === "open").length;
function aCol(state){                       // A상이 남아 있는 열 — 조준의 근거
  for (let i = 0; i < CONFIG.slots; i++)
    if (state.cell[i] === "open" && CONFIG.prizes[state.assign[i]].g === "A") return i % CONFIG.cols;
  return -1;
}

export { mulberry32, buildRound, dropPath, settleCol, cellIdx, colLeft, topOpen, remainingByPrize, leftCount, aCol };

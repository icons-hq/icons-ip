// 상자 엔진 — G1 사물함.
//
// **회색 상자에서 그대로 옮긴 것이다.** 함수 이름을 바꾸지 않는다 —
// 헤드리스 테스트를 그대로 재사용해야 이관이 성공했다고 말할 수 있기 때문이다
// (P5 착수 사양 §0 · §4-1). 로직을 고치고 싶으면 회색 상자를 먼저 고치고
// 재미 판정을 다시 받는다.
//
// 이 파일은 **화면을 모른다.** DOM·React·에셋 경로가 들어오면 그 순간
// 「그림 교체가 규칙 코드를 안 건드린다」는 P5 통과 조건이 깨진다.

/* ── 1부. CONFIG ── */
export const CONFIG = {
  slots: 80,
  price: 5000,
  dailyLimit: 10,          // 정책 P10 — 1인 1일 10회
  maxPick: 5,              // 1회 선택 칸 수 상한
  holdSec: 90,             // 칸 점유 시간 — 결제 완료 소요 상한
  holdWarnSec: 20,         // 만료 경고 시작
  openMs: 1200,            // 개봉 연출 1칸당
  rivalEveryMs: [4000, 11000],   // 경쟁자 점유 간격
  rivalHoldMs: [1800, 5200],     // 경쟁자 점유 유지 후 뽑음
  // 구성 — 4회차 구성 문서 G1 (A1·B3·C12·D24·E40)
  prizes: [
    { g:"A", name:"효산고 공식 교복 세트 (여)", value:98000, count:1 },
    { g:"B", name:"2-5반 출석부 바인더",        value:25000, count:1 },
    { g:"B", name:"생존 작전도 장패드",          value:22000, count:1 },
    { g:"B", name:"캐비닛 펜꽂이",               value:19000, count:1 },
    { g:"C", name:"사물함 다이얼 자물쇠 키링",   value:12000, count:4 },
    { g:"C", name:"2-5반 교실 열쇠 & 태그",      value:11000, count:4 },
    { g:"C", name:"효산고 실내화 미니 참",       value:10000, count:4 },
    { g:"D", name:"사물함 번호 아크릴 마그넷",   value:7000,  count:8 },
    { g:"D", name:"가정통신문 리플리카 세트",    value:6000,  count:8 },
    { g:"D", name:"급식 식권 리플리카",          value:5500,  count:8 },
    { g:"E", name:"효산고 로고 스티커 시트",     value:3000,  count:14 },
    { g:"E", name:"종이 명찰 리플리카",          value:3000,  count:13 },
    { g:"E", name:"사물함 라벨 스티커",          value:2500,  count:13 },
  ],
  lastPrize: { g:"LAST", name:"교복 세트 — 넘버링 각인판", value:98000 },
};

/* ── 2부. LOGIC ── */
function mulberry32(seed){ let a = seed >>> 0; return function(){
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};}

/* 회차를 열 때 80칸에 등급이 이미 배정된다 — 개봉은 그 값을 공개하는 것이지 그때 정하는 것이 아니다 */
function buildRound(seed){
  const rng = mulberry32(seed);
  const pool = [];
  CONFIG.prizes.forEach((p, pi) => { for (let i = 0; i < p.count; i++) pool.push(pi); });
  for (let i = pool.length - 1; i > 0; i--) {           // Fisher-Yates, 씨앗 고정
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;                                          // pool[칸index] = prize index
}
function remainingByPrize(state){
  const rem = CONFIG.prizes.map(() => 0);
  state.assign.forEach((pi, i) => { if (state.cell[i] !== "taken") rem[pi]++; });
  return rem;
}
function leftCount(state){ return state.cell.filter(c => c !== "taken").length; }
function canPick(state, i){
  return state.cell[i] === "open" && state.picks.length < CONFIG.maxPick
      && state.today + state.picks.length < CONFIG.dailyLimit;
}
/* 천장 — 마지막 칸까지 가면 반드시 A상이 나온다(확정 구성의 구조적 보장) */
function ceilingProb(state){
  const rem = remainingByPrize(state);
  const aLeft = rem[0], k = leftCount(state);
  return k > 0 ? aLeft / k : 0;
}

export { mulberry32, buildRound, remainingByPrize, leftCount, canPick, ceilingProb };

// 상자 세션 — 원장 역할.
//
// P5-a 는 서버가 없다. 그래서 **서버가 할 일을 이 파일 하나에 가둔다** —
// 회차 배정·칸 점유·개봉·한도. P5-b 에서는 이 파일만 RPC 어댑터로 갈아 끼우고
// 화면은 그대로 둔다(P5 착수 사양 §2).
//
// 화면은 engine 을 직접 부르지 않는다. 여기만 본다.

import { CONFIG, buildRound, canPick, ceilingProb, leftCount, remainingByPrize } from "./engine.js";
import * as D from "./engine-drop.js";
import * as W from "./engine-wire.js";
import * as K from "./engine-dark.js";

const RIVAL_EVERY = CONFIG.rivalEveryMs;
const RIVAL_HOLD = CONFIG.rivalHoldMs;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

/** The local demo's daily limit uses the Korean calendar, independently of its countdown. */
export function drawDayKey(at) {
  if (!Number.isSafeInteger(at) || at <= 0 || at > 8_640_000_000_000_000 - 9 * 3600_000) return null;
  return new Date(at + 9 * 3600_000).toISOString().slice(0, 10);
}

const validIndex = (value, size) => Number.isSafeInteger(value) && value >= 0 && value < size;
const restoredCells = (slots, taken) => {
  const cells = Array(slots).fill("open");
  if (Array.isArray(taken)) taken.forEach((cell) => { if (validIndex(cell, slots)) cells[cell] = "taken"; });
  return cells;
};

function dailyUsage(st, limit, { initialToday = 0, initialDay, getDrawState, now, onRestored }) {
  let day = drawDayKey(now());
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, limit) : 0;
  st.today = initialDay == null || initialDay === day ? count(initialToday) : 0;
  return () => {
    const current = drawDayKey(now());
    if (current !== day) { day = current; st.today = 0; }
    const saved = getDrawState?.();
    // A storage read may lag this session's just-committed draw; never move its count backward.
    if (saved?.day === day) st.today = Math.max(st.today, count(saved.today));
    let restored = 0;
    if (Array.isArray(saved?.taken)) for (const cell of saved.taken) {
      if (!validIndex(cell, st.cell.length) || st.cell[cell] === "taken") continue;
      st.cell[cell] = "taken";
      if (st.holdUntil) st.holdUntil[cell] = 0;
      st.rivalDue?.delete(cell);
      st.lit?.delete(cell);
      restored += 1;
    }
    if (restored) {
      if (st.picks) st.picks = st.picks.filter((cell) => st.cell[cell] === "mine");
      onRestored?.(restored);
    }
    return st.today;
  };
}

export function createBoxSession({ seed, rivals = 3, now = () => Date.now(), initialToday = 0, initialDay, initialTaken, getDrawState }) {
  const st = {
    assign: buildRound(seed),
    cell: restoredCells(CONFIG.slots, initialTaken),   // open | mine | rival | taken
    holdUntil: Array(CONFIG.slots).fill(0),
    picks: [],
    today: 0,
    results: [],        // 이번 개봉으로 나온 것
    rivalNext: now() + rand(...RIVAL_EVERY),
    rivalDue: new Map(),
  };
  const today = dailyUsage(st, CONFIG.dailyLimit, { initialToday, initialDay, getDrawState, now });

  const snapshot = () => {
    today();
    return {
    cell: st.cell.slice(),
    holdUntil: st.holdUntil.slice(),
    picks: st.picks.slice(),
    today: st.today,
    left: leftCount(st),
    total: CONFIG.slots,
    remaining: remainingByPrize(st),
    ceiling: ceilingProb(st),
    price: CONFIG.price,
    maxPick: CONFIG.maxPick,
    dailyLimit: CONFIG.dailyLimit,
    holdSec: CONFIG.holdSec,
    holdWarnSec: CONFIG.holdWarnSec,
    prizes: CONFIG.prizes,
    };
  };

  return {
    snapshot,
    /** 칸을 고른다 / 이미 고른 칸이면 해제한다. 반환 = 무슨 일이 있었나(소리는 화면이 정한다) */
    toggle(i) {
      if (!validIndex(i, CONFIG.slots)) return null;
      today();
      if (st.cell[i] === "mine") {
        st.cell[i] = "open"; st.holdUntil[i] = 0;
        st.picks = st.picks.filter((x) => x !== i);
        return "released";
      }
      if (!canPick(st, i)) return null;
      st.cell[i] = "mine";
      st.holdUntil[i] = now() + CONFIG.holdSec * 1000;   // 점유 90초 — 결제 완료 소요의 상한
      st.picks.push(i);
      return "picked";
    },
    /** 개봉 — 서버가 이미 정해 둔 값을 공개한다. 여기서 결과를 만들지 않는다. */
    draw() {
      today();
      const count = st.picks.length;
      if (!count || count > CONFIG.maxPick || st.today + count > CONFIG.dailyLimit
        || new Set(st.picks).size !== count
        || st.picks.some((i) => !validIndex(i, CONFIG.slots) || st.cell[i] !== "mine" || st.holdUntil[i] <= now())) return [];
      const out = st.picks.map((i) => {
        st.cell[i] = "taken"; st.holdUntil[i] = 0;
        const p = CONFIG.prizes[st.assign[i]];
        return { cell: i + 1, prizeIndex: st.assign[i], grade: p.g, name: p.name, value: p.value };
      });
      st.today += st.picks.length;
      st.picks = [];
      st.results = out;
      return out;
    },
    /** 시간이 흐르며 벌어지는 일 — 점유 만료와 경쟁자. 화면이 주기적으로 부른다. */
    tick() {
      const t = now();
      const events = [];
      st.picks.slice().forEach((i) => {
        if (st.holdUntil[i] && t > st.holdUntil[i]) {
          st.cell[i] = "open"; st.holdUntil[i] = 0;
          st.picks = st.picks.filter((x) => x !== i);
          events.push({ type: "expired", cell: i });
        }
      });
      for (const [i, due] of [...st.rivalDue]) {
        if (t < due) continue;
        st.rivalDue.delete(i);
        if (st.cell[i] === "rival") { st.cell[i] = "taken"; events.push({ type: "rivalTook", cell: i }); }
      }
      if (rivals > 0 && t >= st.rivalNext) {
        st.rivalNext = t + rand(...RIVAL_EVERY) / rivals;
        const free = st.cell.map((c, i) => (c === "open" ? i : -1)).filter((i) => i >= 0);
        if (free.length) {
          const i = free[Math.floor(Math.random() * free.length)];
          st.cell[i] = "rival";
          st.rivalDue.set(i, t + rand(...RIVAL_HOLD));
          events.push({ type: "rivalHeld", cell: i });
        }
      }
      return events;
    },
  };
}

/* ── G2 보급 낙하 ──
 * 고르는 것이 칸이 아니라 **투입구**다. 상품은 칸에 고정돼 있고
 * 낙하는 「어느 열을 여는가」만 정한다 — 그래서 조준이 의미를 갖되
 * 구성은 확정으로 남는다(P2 §2-4). 점유가 없는 대신 낙하가 있다.
 */
export function createDropSession({ seed, rivals = 3, now = () => Date.now(), initialToday = 0, initialDay, initialTaken, getDrawState }) {
  const st = {
    assign: D.buildRound(seed),
    cell: restoredCells(D.CONFIG.slots, initialTaken),
    today: 0,
    rivalNext: now() + rand(...D.CONFIG.rivalEveryMs),
  };
  let draws = st.cell.filter((cell) => cell === "taken").length;
  const today = dailyUsage(st, D.CONFIG.dailyLimit, { initialToday, initialDay, getDrawState, now,
    onRestored: (count) => { draws += count; } });

  const snapshot = () => {
    today();
    return {
    cell: st.cell.slice(),
    today: st.today,
    left: D.leftCount(st),
    total: D.CONFIG.slots,
    cols: D.CONFIG.cols,
    remaining: D.remainingByPrize(st),
    aCol: D.aCol(st),                 // A상이 남은 열 — 조준의 근거
    price: D.CONFIG.price,
    dailyLimit: D.CONFIG.dailyLimit,
    pegRows: D.CONFIG.pegRows,
    prizes: D.CONFIG.prizes,
    };
  };

  return {
    snapshot,
    canDrop: () => today() < D.CONFIG.dailyLimit && D.leftCount(st) > 0,
    /** 투입 — 경로·착지 열·열린 칸을 한 번에 돌려준다. 화면은 이 값을 재생만 한다. */
    drop(entry) {
      if (!validIndex(entry, D.CONFIG.cols) || today() >= D.CONFIG.dailyLimit || D.leftCount(st) === 0) return null;
      const { path, col } = D.dropPath(entry, D.mulberry32((seed ^ (draws + 1) * 2654435761) >>> 0));
      const settled = D.settleCol(st, col);
      if (settled < 0) return null;
      const cell = D.topOpen(st, settled);
      st.cell[cell] = "taken";
      st.today += 1;
      draws += 1;
      const p = D.CONFIG.prizes[st.assign[cell]];
      return { path, aimCol: col, col: settled, cell, prizeIndex: st.assign[cell], grade: p.g, name: p.name, value: p.value };
    },
    tick() {
      const t = now();
      const events = [];
      if (rivals > 0 && t >= st.rivalNext) {
        st.rivalNext = t + rand(...D.CONFIG.rivalEveryMs) / rivals;
        const free = st.cell.map((c, i) => (c === "open" ? i : -1)).filter((i) => i >= 0);
        if (free.length) {
          const i = free[Math.floor(Math.random() * free.length)];
          st.cell[i] = "taken";
          events.push({ type: "rivalTook", cell: i });
        }
      }
      return events;
    },
  };
}

/* ── G3 배선도 ──
 * 사다리는 **회차 내 고정**이다. 그래서 한 번 따라간 경로는 회차 내내 유효하고,
 * 밝혀진 것이 쌓인다 — 이것이 G4(정보가 소비된다)와 G3 을 가르는 유일한 선이다(P2 §1).
 */
export function createWireSession({ seed, rivals = 3, now = () => Date.now(), initialToday = 0, initialDay, initialTaken, getDrawState }) {
  const cells = restoredCells(W.CONFIG.slots, initialTaken);
  let draws = cells.filter((cell) => cell === "taken").length;
  const initialBlock = W.ladderBlock(draws);
  const st = {
    assign: W.buildRound(seed),
    rungs: W.buildLadder(seed, initialBlock),       // 묶음마다 한 번. 묶음 안에서는 다시 짜지 않는다.
    block: initialBlock,                          // 지금 몇 번째 배선인가
    cell: cells,
    known: {},                            // 출발점 → 도착 열. 배선이 다시 꽂히면 같이 사라진다.
    today: 0,
    rivalNext: now() + rand(...W.CONFIG.rivalEveryMs),
  };
  const today = dailyUsage(st, W.CONFIG.dailyLimit, { initialToday, initialDay, getDrawState, now, onRestored: (count) => {
    draws += count;
    const block = W.ladderBlock(draws);
    if (block !== st.block) { st.block = block; st.rungs = W.buildLadder(seed, block); st.known = {}; }
  } });

  const snapshot = () => {
    today();
    return {
    cell: st.cell.slice(),
    rungs: st.rungs.map((r) => r.slice()),
    known: { ...st.known },
    knownCount: Object.keys(st.known).length,
    block: st.block,
    rewireEvery: W.CONFIG.rewireEvery,
    untilRewire: W.CONFIG.rewireEvery - (draws % W.CONFIG.rewireEvery),
    today: st.today,
    left: W.leftCount(st),
    total: W.CONFIG.slots,
    cols: W.CONFIG.cols,
    rungRows: W.CONFIG.rungRows,
    remaining: W.remainingByPrize(st),
    aCol: W.aCol(st),
    price: W.CONFIG.price,
    dailyLimit: W.CONFIG.dailyLimit,
    prizes: W.CONFIG.prizes,
    };
  };

  return {
    snapshot,
    /** 미리 보기 — 이미 밝혀진 출발점이면 도착 열을 안다. 아니면 따라가 봐야 안다. */
    peek: (start) => { today(); return start in st.known ? st.known[start] : null; },
    /** 따라가기 — 경로는 사다리가 이미 정해 뒀다. 화면은 그 길을 재생만 한다. */
    trace(start) {
      if (!validIndex(start, W.CONFIG.cols) || today() >= W.CONFIG.dailyLimit || W.leftCount(st) === 0) return null;
      const { path, col } = W.tracePath(st.rungs, start);
      const settled = W.settleCol(st, col);
      if (settled < 0) return null;
      const cell = W.topOpen(st, settled);
      st.cell[cell] = "taken";
      st.today += 1;
      draws += 1;
      st.known[start] = col;               // 밝혀진 것은 이 배선이 살아 있는 동안 남는다
      const p = W.CONFIG.prizes[st.assign[cell]];
      /* 묶음이 넘어가면 배선이 다시 꽂힌다 — 그린 지도도 같이 사라진다(PM 2026-08-31 판정 A).
         영구 지도는 10회면 완성돼서, 남은 70회가 아는 길을 다시 따라가는 재생이 됐다. */
      const nb = W.ladderBlock(draws);
      const rewired = nb !== st.block;
      if (rewired) { st.block = nb; st.rungs = W.buildLadder(seed, nb); st.known = {}; }
      return { path, endCol: col, col: settled, cell, prizeIndex: st.assign[cell], grade: p.g, name: p.name, value: p.value, rewired };
    },
    tick() {
      const t = now();
      const events = [];
      if (rivals > 0 && t >= st.rivalNext) {
        st.rivalNext = t + rand(...W.CONFIG.rivalEveryMs) / rivals;
        const free = st.cell.map((c, i) => (c === "open" ? i : -1)).filter((i) => i >= 0);
        if (free.length) {
          const i = free[Math.floor(Math.random() * free.length)];
          st.cell[i] = "taken";
          events.push({ type: "rivalTook", cell: i });
        }
      }
      return events;
    },
  };
}

/* ── G4 소등 후 ──
 * 정보가 **소비된다**. 손전등은 뽑기 1회당 3번이고 열면 초기화된다 —
 * G3(밝혀진 것이 회차 내내 남는다)과 이 회차를 가르는 유일한 선이다(P2 §1).
 * 그리고 비추기는 **범위 안 상위상 개수만** 답한다. 어느 칸인지는 주지 않는다.
 */
export function createDarkSession({ seed, rivals = 3, now = () => Date.now(), initialToday = 0, initialDay, initialTaken, getDrawState }) {
  const st = {
    assign: K.buildRound(seed),
    cell: restoredCells(K.CONFIG.slots, initialTaken),
    lit: new Set(),                       // 이번 회에 비춘 칸들 — 열면 지워진다
    scans: K.CONFIG.scansPerDraw,
    log: [],                              // 이번 회의 비추기 기록
    today: 0,
    rivalNext: now() + rand(...K.CONFIG.rivalEveryMs),
  };
  const today = dailyUsage(st, K.CONFIG.dailyLimit, { initialToday, initialDay, getDrawState, now });

  const snapshot = () => {
    today();
    return {
    cell: st.cell.slice(),
    lit: [...st.lit],
    scans: st.scans,
    scansPerDraw: K.CONFIG.scansPerDraw,
    log: st.log.slice(),
    today: st.today,
    left: K.leftCount(st),
    total: K.CONFIG.slots,
    cols: K.CONFIG.cols,
    remaining: K.remainingByPrize(st),
    price: K.CONFIG.price,
    dailyLimit: K.CONFIG.dailyLimit,
    highTiers: K.CONFIG.highTiers,
    prizes: K.CONFIG.prizes,
    };
  };

  return {
    snapshot,
    beamCells: (center) => K.beamCells(center),
    /** 비추기 — 개수만 돌려준다. 어느 칸인지는 이 함수도 모른다고 쳐야 한다. */
    scan(center) {
      today();
      if (!validIndex(center, K.CONFIG.slots) || st.scans <= 0) return null;
      const r = K.scanResult(st, center);
      st.scans -= 1;
      K.beamCells(center).forEach((i) => st.lit.add(i));
      const entry = { center, open: r.open, high: r.high };
      st.log = [entry, ...st.log].slice(0, 6);
      return entry;                        // cells 를 밖으로 흘리지 않는다
    },
    /** 열기 — 그 순간 손전등이 초기화된다. 정보는 회차에 누적되지 않는다. */
    open(cell) {
      if (!validIndex(cell, K.CONFIG.slots) || today() >= K.CONFIG.dailyLimit || st.cell[cell] !== "open") return null;
      st.cell[cell] = "taken";
      st.today += 1;
      st.scans = K.CONFIG.scansPerDraw;
      st.lit.clear();
      st.log = [];
      const p = K.CONFIG.prizes[st.assign[cell]];
      return { cell, prizeIndex: st.assign[cell], grade: p.g, name: p.name, value: p.value };
    },
    tick() {
      const t = now();
      const events = [];
      if (rivals > 0 && t >= st.rivalNext) {
        st.rivalNext = t + rand(...K.CONFIG.rivalEveryMs) / rivals;
        const free = st.cell.map((c, i) => (c === "open" ? i : -1)).filter((i) => i >= 0);
        if (free.length) {
          const i = free[Math.floor(Math.random() * free.length)];
          st.cell[i] = "taken"; st.lit.delete(i);
          events.push({ type: "rivalTook", cell: i });
        }
      }
      return events;
    },
  };
}

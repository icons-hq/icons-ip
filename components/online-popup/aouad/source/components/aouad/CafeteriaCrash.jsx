"use client";

/* 급식실 크래시 — 화면 (2026-09-03 단순화 판 · PM 재교정).
   규칙은 `lib/zones/engine-cafeteria.js`(뚫림·포인트·최고 3회차 합) 와 `lib/zones/round-cafeteria.js`(등급·구성) 가 갖고 있고
   이 파일은 **읽기만** 한다 — 여기서 수치를 만들면 관문(`npm run test:cafeteria-engine`)이 못 잡는 규칙이 생긴다.

   싱글 게임의 느낌이다. 다른 사람의 참여는 보이지 않는다 — 알림판 한 줄(「○○님이 … 구매권을 획득하셨습니다」)뿐.
   존에 들어오면 **무인 시연**이 돌고 있다(오락실 데모 — 게임 방식을 보여 주기 위한 것). 시연은 **그래프가 오르다 터지는 것과
   포인트 숫자만** 보여 준다 — 회차 카운트다운·회차 5칸·합계·구매권 진행은 내 판에서만 움직인다(PM 2026-09-03 「진짜 게임하는 느낌이 나면 안 된다」). 「참여」를 누르면
   진행 중인 회차가 끝나는 대로 **내 판(5회차)** 이 시작된다. 한 판 = 5회차 · 점수 = 최고 3회차의 합 · 회차 상한 1,600p.
   **무료다.** 보상 = 점수별 차등 구매권 4단(aouad-data RIGHTS game:"cafeteria" · 최고 기록 기준 · 누적) + 옥상 완주권. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CONFIG, GLASS, glassAt, pointsAt, timeFor, capTime, best3, buildPlay, demoPlan } from "../../lib/zones/engine-cafeteria";
import { ASSET, RIGHTS, MD } from "./aouad-data";
import s from "./CafeteriaCrash.module.css";
import GameGate, { useGameLock, fmtLeft as fmtLock } from "./GameGate";

/* 배경 = 유리문 사진 4단계 (0: 멀쩡, 1: 실금, 2: 금 번짐, 3: 문 휨) */
const GLASS_BG = ["stage-cafe-glass-0.jpg", "stage-cafe-glass-1.jpg", "stage-cafe-glass-2.jpg", "stage-cafe-glass-3.jpg"];
/* 구매권 4단 — 데이터가 문턱을 쥔다. 낮은 단부터 */
const TIERS = RIGHTS.filter((r) => r.game === "cafeteria").sort((a, b) => a.score - b.score);
const mdOf = (r) => MD.find((m) => m.id === r.mdId);
const tierOf = (score) => [...TIERS].reverse().find((t) => score >= t.score) || null;
const AUTO = [null, 600, 900, 1200, CONFIG.cap];               // 자동 탈출 눈금(회차 포인트)
const fmt = (p) => p.toLocaleString();

/* ── 판 루프 — 화면이 열려 있는 동안 스스로 돈다 ──
   상태는 ref 에 두고 틱마다 스냅샷을 렌더한다. setState 갱신 함수 안에서 부모를 부르면
   StrictMode 가 두 번 울려 참여권이 두 장 빠진다 — 부작용은 갱신 함수 밖에서 낸다. */
function newPlay(g, seed, mode) {
  g.mode = mode; g.breaks = buildPlay(seed); g.plan = mode === "demo" ? demoPlan(seed ^ 0x9e37) : null;
  g.round = 0; g.got = []; g.phase = "wait"; g.left = mode === "demo" ? CONFIG.demoWaitMs : CONFIG.waitMs; g.t = 0; g.out = false; g.outAt = null; g.locked = 0; g.crashPts = 0; g.summary = null;
}
function initGame() {
  const g = { playNo: 0, autoAt: null, queued: false, flash: 0 };
  newPlay(g, 20260903, "demo");
  return g;
}

function useGame(cbRef) {
  const [initialGame] = useState(initGame);
  const gRef = useRef(initialGame);
  const [v, setV] = useState(() => ({ ...initialGame }));
  const [seed] = useState(() => Math.floor(Math.random() * 1e6));
  const seedRef = useRef(seed);
  const lastRef = useRef(0);

  const startQueued = (g) => {
    g.queued = false; g.playNo += 1;
    cbRef.current.onJoin();
    newPlay(g, seedRef.current + g.playNo * 7919, "play");
  };
  /* 회차는 **언제나 문이 뚫리면서** 끝난다. 내가 나갔든 아니든 곡선은 거기까지 오른다 —
     크래시의 재미가 거기서 나온다(「더 버틸 걸」 / 「잘 나왔다」). PM 2026-09-07. */
  const endRound = (g) => {
    g.crashPts = pointsAt(g.breaks[g.round]);          // 문이 뚫린 시각의 포인트 — 더 버텼다면 받았을 값
    g.got = [...g.got, g.out ? g.locked : 0];
    g.phase = "result"; g.left = CONFIG.resultMs; g.flash = Date.now();
  };
  /* 나간다 = 내 점수만 잠근다. 회차는 계속 돈다 */
  const escapeAt = (g, at) => {
    if (g.phase !== "live" || g.out) return;
    g.out = true; g.outAt = at; g.locked = pointsAt(at);
  };
  const nextAfterResult = (g) => {
    g.round += 1;
    if (g.round < CONFIG.rounds) {
      if (g.mode === "demo" && g.queued) { startQueued(g); return; }
      g.phase = "wait"; g.left = g.mode === "demo" ? CONFIG.demoWaitMs : CONFIG.waitMs; g.t = 0; g.out = false; g.outAt = null; g.locked = 0; g.crashPts = 0;
      return;
    }
    if (g.mode === "demo") {   // 시연은 합계를 내지 않는다 — 바로 다음 시연
      if (g.queued) startQueued(g); else newPlay(g, seedRef.current + 777 + Date.now() % 100000, "demo");
      return;
    }
    const score = best3(g.got);
    g.summary = { score, ...cbRef.current.onResult({ score, no: g.playNo }) };
    g.phase = "summary"; g.left = CONFIG.summaryMs;
  };

  /* 한 틱 — 흐른 시간으로 굴린다. setInterval(50)·2000ms 상한(탭 복귀 시 튐 방지) */
  const step = (g, dt) => {
    if (g.phase === "wait") {
      if (g.mode === "demo" && g.queued) { startQueued(g); return; }
      g.left -= dt;
      if (g.left <= 0) { g.phase = "live"; g.t = 0; g.out = false; g.outAt = null; }
      return;
    }
    if (g.phase === "live") {
      const next = g.t + dt / 1000;
      const brk = g.breaks[g.round];
      const want = g.mode === "demo" ? g.plan[g.round] : g.autoAt != null ? Math.min(timeFor(g.autoAt), capTime()) : capTime();
      if (!g.out && next >= want && want < brk) escapeAt(g, want);   // 노린 시각 · 자동 탈출 · 상한 — 잠그기만 한다
      if (next >= brk) { g.t = brk; endRound(g); return; }            // 회차는 문이 뚫려야 끝난다
      g.t = next;
      return;
    }
    g.left -= dt;
    if (g.left > 0) return;
    if (g.phase === "result") { nextAfterResult(g); return; }
    // summary 끝 — 예약이 있으면 내 판, 없으면 시연
    if (g.queued) startQueued(g);
    else newPlay(g, seedRef.current + 777 + Date.now() % 100000, "demo");
  };

  useEffect(() => {
    lastRef.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const d = Math.min(2000, now - lastRef.current);
      lastRef.current = now;
      if (cbRef.current.paused || document.hidden) return;
      step(gRef.current, d);
      setV({ ...gRef.current });
    }, 50);
    return () => clearInterval(id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const act = {
    escape: () => { const g = gRef.current; if (!cbRef.current.paused && !document.hidden && g.mode === "play") { escapeAt(g, g.t); setV({ ...g }); } },
    queue: () => { if (cbRef.current.paused || cbRef.current.locked || document.hidden) return; const g = gRef.current; g.queued = !g.queued; setV({ ...g }); },
    setAuto: (p) => { const g = gRef.current; g.autoAt = p; setV({ ...g }); },
  };
  return [v, act];
}

/* ── 알림판 한 줄 — 연출 ── */
function Ticker() {
  return <div className={s.ticker}><i />무료 체험 · 내 기록은 이 기기에만 저장됩니다</div>;
}

/* ── 회차 5칸 ── */
function Tracker({ g }) {
  return (
    <div className={s.tracker} aria-label="회차">
      {Array.from({ length: CONFIG.rounds }, (_, i) => {
        const v = g.got[i];
        const now = i === g.round && g.phase !== "summary";
        const held = now && g.phase === "live" && g.out;   // 이미 나가서 잠긴 회차
        return (
          <span key={i} className={s.cell} data-now={now ? "1" : "0"} data-zero={v === 0 ? "1" : "0"} data-done={v > 0 || held ? "1" : "0"}>
            {i + 1}회차<b>{v === undefined
              ? (now && g.phase === "live" ? (g.out ? `${fmt(g.locked)}p` : `${fmt(pointsAt(g.t))}p`) : "—")
              : `${fmt(v)}p`}</b>
          </span>
        );
      })}
    </div>
  );
}

/* ── 무대 — 곡선 + 큰 숫자 ── */
const VW = 600, VH = 250, PAD = { l: 8, r: 52, t: 30, b: 22 };
function Chart({ g }) {
  const live = g.phase === "live" || g.phase === "result";
  const t = live ? g.t : 0;
  const xMax = CONFIG.tMax, yMax = CONFIG.cap * 1.08;
  const cx = (x) => PAD.l + (x / xMax) * (VW - PAD.l - PAD.r);
  const cy = (p) => VH - PAD.b - (p / yMax) * (VH - PAD.b - PAD.t);
  const path = [];
  for (let x = 0; x <= t + 1e-6; x += 0.1) path.push([cx(Math.min(x, t)), cy(pointsAt(Math.min(x, t)))]);
  if (!path.length) path.push([cx(0), cy(0)]);
  const head = path[path.length - 1];
  return (
    <svg className={s.svg} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
      <line className={s.axis} x1={PAD.l} y1={cy(0)} x2={VW - PAD.r} y2={cy(0)} />
      {[0, 2, 4, 6, 8, 10, 12].map((x) => <text key={x} className={s.tick} x={cx(x)} y={VH - 8} textAnchor="middle">{x}s</text>)}
      <line className={s.mark} data-on={live && pointsAt(t) >= CONFIG.cap ? "1" : "0"} x1={PAD.l} y1={cy(CONFIG.cap)} x2={VW - PAD.r} y2={cy(CONFIG.cap)} />
      <text className={s.markLabel} x={VW - PAD.r + 6} y={cy(CONFIG.cap) + 3}>최대 {fmt(CONFIG.cap)}</text>
      {g.mode === "play" && g.autoAt != null && (
        <>
          <line className={s.autoMark} x1={PAD.l} y1={cy(g.autoAt)} x2={VW - PAD.r} y2={cy(g.autoAt)} />
          <text className={s.markLabel} x={VW - PAD.r + 6} y={cy(g.autoAt) + 3}>자동 {fmt(g.autoAt)}</text>
        </>
      )}
      {live && (
        <>
          <path className={s.area} d={`M${cx(0)},${cy(0)} ${path.map((p) => `L${p[0]},${p[1]}`).join(" ")} L${head[0]},${cy(0)} Z`} />
          <polyline className={s.line} points={path.map((p) => p.join(",")).join(" ")} />
          <circle className={s.dot} r="5" cx={head[0]} cy={head[1]} />
        </>
      )}
      {live && g.out && (
        <>
          <line className={s.outLine} x1={cx(g.outAt)} y1={cy(0)} x2={cx(g.outAt)} y2={cy(pointsAt(g.outAt))} />
          <circle className={s.outDot} r="5" cx={cx(g.outAt)} cy={cy(pointsAt(g.outAt))} />
        </>
      )}
    </svg>
  );
}

function provisional(g) {
  if (g.phase === "live") return best3([...g.got, g.out ? g.locked : pointsAt(g.t)]);
  return g.phase === "summary" ? g.summary.score : best3(g.got);
}

function summaryLine(g) {
  const sm = g.summary;
  if (g.mode === "demo") return "시연 — 참여하면 내 판이 시작된다";
  const top = tierOf(sm.score);
  if (!top) return `구매권 미달 — ${fmt(TIERS[0].score)}p 부터${sm.pass ? " · 옥상 완주권" : ""}`;
  const n = TIERS.filter((t) => t.score <= top.score).length;
  return `${top.name}${n > 1 ? ` 외 ${n - 1}종` : ""}${sm.newly && sm.newly.length ? " 획득" : " (보유)"}${sm.pass ? " · 옥상 완주권" : ""}`;
}

export function CafeteriaStage({ g }) {
  const demo = g.mode === "demo";
  const pts = pointsAt(g.t);
  const broke = g.phase === "result";              // 회차는 언제나 문이 뚫리며 끝난다
  const lost = broke && !g.out;                    // 그때 안에 있었으면 0
  const stage = g.phase === "live" ? Math.max(0, glassAt(g.t)) : broke ? 3 : 0;
  let big, sub, tone = "";
  if (g.phase === "live") {
    big = `${fmt(pts)}p`;
    if (g.out) { sub = `탈출 ${fmt(g.locked)}p 확보`; tone = "out"; }
    else sub = pts >= CONFIG.cap ? "최대" : demo ? "" : "머무는 중";
  } else if (broke) {
    if (g.out) { big = `${fmt(g.locked)}p`; sub = `문은 ${fmt(g.crashPts)}p 에서 뚫렸다`; tone = "out"; }
    else { big = "0p"; sub = "뚫렸다 — 이 회차는 0"; tone = "crash"; }
  } else if (demo) {
    big = "";
  } else if (g.phase === "wait") {
    big = `${(g.left / 1000).toFixed(1)}s`; sub = `${g.round + 1} / ${CONFIG.rounds} 회차 시작까지`; tone = "wait";
  } else {
    big = `${fmt(g.summary.score)}p`; sub = summaryLine(g);
    tone = demo ? "wait" : tierOf(g.summary.score) ? "out" : "crash";
  }
  const crashed = lost;
  return (
    <div className={s.stage} data-phase={g.phase} data-crash={crashed ? "1" : "0"} data-out={g.out ? "1" : "0"}>
      <div className={s.photo} style={{ backgroundImage: `url(${ASSET(GLASS_BG[stage])})` }} aria-hidden="true" />
      <div className={s.veil} data-stage={stage} aria-hidden="true" />
      <Chart g={g} />
      <span className={s.roundNo}>{demo ? <em className={s.demo}>시연</em> : `내 판 · ${Math.min(g.round + 1, CONFIG.rounds)} / ${CONFIG.rounds} 회차`}</span>
      <span className={s.glass} data-stage={stage} data-crash={broke ? "1" : "0"}>
        {broke ? "문이 뚫렸다" : g.phase === "live" ? GLASS[stage].name : "문은 멀쩡하다"}
      </span>
      <div className={s.center} aria-live="polite">
        <b className={s.big} data-tone={tone}>{big}</b>
        {sub && <span className={s.sub} data-tone={tone === "wait" ? "" : tone}>{sub}</span>}
      </div>
      {!demo && <span className={s.total}>합계 <b>{fmt(provisional(g))}p</b> <em>최고 {CONFIG.countBest}회차 · 최대 {fmt(CONFIG.cap * CONFIG.countBest)}</em></span>}
      <div key={g.flash} className={s.flash} data-on={broke ? "1" : "0"} />
    </div>
  );
}

/* ── 조작 ── */
function Controls({ g, act, passAt, lockLeft = 0 }) {
  const pts = pointsAt(g.t);
  if (g.mode === "play") {
    let mode, label;
    if (g.phase === "live" && !g.out) { mode = "escape"; label = [`탈출 · ${fmt(pts)}p`, "Space"]; }
    else if (g.phase === "live") { mode = "out"; label = [`${g.round + 1}회차 탈출 · ${fmt(g.locked)}p`, "문이 뚫릴 때까지 지켜본다"]; }
    else if (g.phase === "wait") { mode = "hold"; label = [`${g.round + 1} / ${CONFIG.rounds} 회차 시작까지 ${(g.left / 1000).toFixed(1)}s`, "내 판"]; }
    else if (g.phase === "result") { mode = g.out ? "out" : "crashed"; label = [g.out ? `${g.round + 1}회차 탈출 · ${fmt(g.got[g.round])}p` : `${g.round + 1}회차 뚫림 · 0p`, g.out ? `문은 ${fmt(g.crashPts)}p 에서 뚫렸다` : `합계 ${fmt(best3(g.got))}p`]; }
    else { mode = tierOf(g.summary.score) ? "out" : "crashed"; label = [`합계 ${fmt(g.summary.score)}p`, summaryLine(g)]; }
    return (
      <div className={s.ctrl}>
        <button type="button" className={s.main} data-mode={mode} onClick={act.escape} disabled={mode !== "escape"}>{label[0]}<small>{label[1]}</small></button>
        <AutoRow g={g} act={act} />
      </div>
    );
  }
  return (
    <div className={s.ctrl}>
      {/* 재참여 타이머(PM 2026-09-09) — 잠긴 동안은 참여도 잠긴다. 관문 카드와 같은 시각을 보여 준다 */}
      <button type="button" className={s.main} data-mode={lockLeft > 0 ? "hold" : g.queued ? "reserved" : "paid"} onClick={act.queue} disabled={lockLeft > 0}>
        {lockLeft > 0 ? `재참여까지 ${fmtLock(lockLeft)}` : g.queued ? "참여 예약됨" : "참여하기 — 무료"}<small>{lockLeft > 0 ? "끝난 판에서 5분" : g.queued ? "이번 회차 끝나면 시작 · 누르면 취소" : `점수별 구매권 · ${fmt(passAt)}p 이상 옥상 완주권`}</small>
      </button>
      <AutoRow g={g} act={act} />
    </div>
  );
}

function AutoRow({ g, act }) {
  return (
    <div className={s.auto} role="group" aria-label="자동 탈출">
      <span>자동 탈출</span>
      {AUTO.map((p) => (
        <button key={p ?? "off"} type="button" data-on={g.autoAt === p ? "1" : "0"} onClick={() => act.setAuto(p)}>
          {p == null ? "끄기" : p === CONFIG.cap ? "최대" : `${fmt(p)}p`}
        </button>
      ))}
    </div>
  );
}

/* ── 보상 진열 — 구매권 4단, 합계 기준 실시간 마일스톤 ── */
function tierState(t, idx, total, rights, active, summary) {
  if (summary && summary.newly && summary.newly.includes(t.id)) return "won";
  if (rights[t.id]) return "have";
  if (!active) return "";
  const cur = tierOf(total);
  const ci = cur ? TIERS.indexOf(cur) : -1;
  if (idx <= ci) return "passed";
  if (idx === ci + 1) return "next";
  return "";
}

function Shelf({ g, rights, best, passAt, hasPass, go }) {
  const active = g.mode === "play";                 // 시연 중에는 움직이지 않는다 — 내 기록만 보인다
  const total = active ? provisional(g) : best;
  const summary = g.phase === "summary" && g.mode === "play" ? g.summary : null;
  const passed = hasPass || (summary && summary.pass);
  const passProg = Math.min(1, total / passAt);
  return (
    <div className={s.rewards} aria-label="보상">
      <div className={s.pass} data-on={passed ? "1" : total >= passAt && active ? "1" : "0"}>
        <span className={s.passName}>옥상 완주권 <em>{fmt(passAt)}p 이상</em></span>
        <span className={s.prog}><i style={{ width: `${passProg * 100}%` }} /></span>
        <b>{passed ? "보유" : `${fmt(total)} / ${fmt(passAt)}`}</b>
      </div>
      <div className={s.shelf} aria-label="점수별 구매권">
        {TIERS.map((t, i) => {
          const m = mdOf(t);
          const state = tierState(t, i, total, rights, active, summary);
          const prevMin = i > 0 ? TIERS[i - 1].score : 0;
          const prog = state === "next" ? Math.max(0, Math.min(1, (total - prevMin) / (t.score - prevMin))) : state === "passed" || state === "have" || state === "won" ? 1 : 0;
          return (
            <div key={t.id} className={s.card} data-state={state}>
              {state === "passed" && g.mode === "play" && <span className={s.tag} data-kind="now">지금 여기</span>}
              <span className={s.thumbBox}>
                <i className={s.thumb} style={m ? { backgroundImage: `url(${ASSET(m.src)})` } : undefined} aria-hidden="true" />
                {/* 획득 도장 — 썸네일 **위에** 찍힌다. 새로 딴 판에서는 찍히는 동작이 보이고(won), 이미 가진 것은 그대로 놓여 있다(have) */}
                {(state === "won" || state === "have") && (
                  <span className={s.stamp} data-kind={state} role="img" aria-label={state === "won" ? "구매권 획득" : "구매권 보유"}>
                    <b>구매권</b><em>획득</em>
                  </span>
                )}
              </span>
              <span className={s.cardText}>
                <b className={s.gradeName}>{fmt(t.score)}p+<em>구매권</em></b>
                <span className={s.itemName} title={m ? m.name : t.name}>{m ? m.name : t.name}</span>
                <span className={s.prog}><i style={{ width: `${prog * 100}%` }} /></span>
                <span className={s.left}>{m ? `${fmt(m.price)}원 · ${t.edition}` : ""}</span>
              </span>
            </div>
          );
        })}
      </div>
      {go && Object.values(rights).some(Boolean) && TIERS.some((t) => rights[t.id]) && (
        <button type="button" className={s.storeGo} onClick={() => go("store")}>보유 구매권으로 굿즈샵 가기</button>
      )}
    </div>
  );
}

/* ── 전체 ── */
export default function CafeteriaCrash({ rights, best, passAt, hasPass, onJoin, onResult, go, paused = false }) {
  const cbRef = useRef({});
  const stageRef = useRef(null);
  const { left: lockLeft, lock } = useGameLock("cafeteria");
  const [played, setPlayed] = useState(false);
  /* 판이 끝나는 순간 재참여 타이머가 돈다 — 결과 콜백에 얹는다(엔진 무접촉) */
  useLayoutEffect(() => {
    cbRef.current = { onJoin, paused, locked: lockLeft > 0, onResult: (r) => { const out = onResult(r); lock(); setPlayed(true); return out; } };
  });
  const [g, act] = useGame(cbRef);
  const controls = { ...act, queue: () => { act.queue(); stageRef.current?.focus({ preventScroll: true }); } };
  /* 잠긴 채로 존에 다시 들어와도(played=false) 관문은 「끝남」이다 — 시작이 열려 있으면 타이머가 뚫린다 */
  const gate = g.mode === "play" ? (g.phase === "summary" ? "over" : "playing") : g.queued ? "queued" : (played || lockLeft > 0) ? "over" : "idle";

  return (
    <div className={s.wrap}>
      <Ticker />
      {g.mode === "play" && <Tracker g={g} />}
      <div className={s.stageBox} ref={stageRef} tabIndex={gate === "playing" && !paused ? 0 : -1}
        role="group" aria-label="급식실 탈출게임 — 스페이스를 누르면 탈출합니다"
        onPointerDown={(e) => {
          if (!paused && gate === "playing" && !e.target.closest("button")) e.currentTarget.focus({ preventScroll: true });
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || paused || !["playing", "queued"].includes(gate) || e.code !== "Space") return;
          e.preventDefault(); e.stopPropagation();
          if (!e.repeat) act.escape();
        }}>
        <CafeteriaStage g={g} />
        <GameGate state={gate} title="급식실 탈출게임" result={g.summary ? `합계 ${fmt(g.summary.score)}p` : null} left={lockLeft}
          onStart={() => { if (!g.queued) controls.queue(); }} />
      </div>
      <div className={s.ctl}><Controls g={g} act={controls} passAt={passAt} lockLeft={lockLeft} /></div>
      <Shelf g={g} rights={rights} best={best} passAt={passAt} hasPass={hasPass} go={go} />
    </div>
  );
}

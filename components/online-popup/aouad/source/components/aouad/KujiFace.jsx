"use client";

/* ── 럭키드로우 화면의 얼굴 — 스틸이 아니라 판이다 ──
   PM 2026-08-31: 「럭키드로우의 섹션 사진은 게임 화면이나 게임 플레이 루프 영상 같은게 있어야지」.
   드라마 스틸은 이 화면이 무엇인지 한 글자도 말하지 않는다. 그래서 **실제 판을 그대로 세우고 혼자 굴린다**.

   영상 파일이 아니라 실판이다 — 회차 무대(`kuji-stage.js`)의 같은 그림과 상자 엔진의 같은 함수로 그린다.
   낙하 경로·배선 추적·빔 범위는 여기서 지어내지 않고 `dropPath`·`tracePath`·`beamCells` 가 계산한다.
   그래서 회차 구성이나 규칙이 바뀌면 얼굴도 같이 바뀐다 — 녹화본이면 그 자리에서 거짓말이 됐을 것이다.

   네 회차를 차례로 돌린다. 회차마다 불확실의 원천이 다르고, 그 차이가 곧 움직임의 차이다 —
   벽은 열리고 · 보급은 떨어지고 · 배선은 이어지고 · 어둠은 훑는다. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import s from "./AouadSample.module.css";
import { ASSET } from "./aouad-data";
import { KUJI_STAGE } from "./kuji-stage";
import { mulberry32 } from "../../lib/box/engine";
import { buildRound as buildAssign, dropPath, topOpen, settleCol } from "../../lib/box/engine-drop";
import { buildLadder, tracePath } from "../../lib/box/engine-wire";
import { beamCells } from "../../lib/box/engine-dark";

const COLS = 10;
const ROWS = 8;
const SLOTS = COLS * ROWS;
const TICK_MS = 145;      // 회차 하나가 약 6초 — 판이 바뀌는 걸 읽을 시간은 주고, 한 바퀴는 25초 안에 끝난다

/* 회차 순서 = 존 탭 순서. 이름은 얼굴에 한 줄로만 붙는다(머리 2줄 규격 — 화면 머리는 이미 있다) */
const REEL = [
  { id: "k1", name: "사물함" },
  { id: "k2", name: "보급 낙하" },
  { id: "k3", name: "배선도" },
  { id: "k4", name: "소등 후" },
];

const SEED = 20260828;
const LEN = { k1: 40, k2: 48, k3: 48, k4: 40 };   // 회차별 재생 길이(틱)

/* 시작 판 — 회차가 이미 얼마쯤 팔린 상태에서 시작한다(빈 판은 「아무도 안 산 매대」로 읽힌다) */
function seedCells(seed, taken) {
  const rng = mulberry32(seed ^ 0x5EED);
  const order = Array.from({ length: SLOTS }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const cell = Array(SLOTS).fill("open");
  order.slice(0, taken).forEach((i) => { cell[i] = "taken"; });
  return { cell, order: order.slice(taken) };   // order = 앞으로 열릴 순서
}

/* 한 틱에서의 판 상태 — 회차마다 다르게 계산한다. 화면은 이 결과만 그린다. */
function frameOf(id, t) {
  if (id === "k1") {
    // 벽 — 문이 곧 칸이다. 4틱마다 하나씩 열린다.
    const { cell, order } = seedCells(SEED, 34);
    const n = Math.min(Math.floor(t / 4), order.length);
    const opened = order.slice(0, n);
    opened.forEach((i) => { cell[i] = "taken"; });
    return { cell, hit: t % 4 < 2 && n > 0 ? opened[n - 1] : -1 };
  }

  if (id === "k2") {
    // 보급 낙하 — 투입구를 고르면 손을 떠난다. 경로는 엔진이 정한다.
    const { cell } = seedCells(SEED, 30);
    const state = { cell, assign: buildAssign(SEED) };
    const rng = mulberry32(SEED ^ 0xD40);
    const runs = [{ at: 2, entry: 3 }, { at: 26, entry: 7 }];
    let mark = null, entry = -1;
    for (const run of runs) {
      const { path, col } = dropPath(run.entry, rng);
      const done = t >= run.at + path.length;
      if (t >= run.at) entry = run.entry;
      if (done) {
        const c = settleCol(state, col);
        const i = c >= 0 ? topOpen(state, c) : -1;
        if (i >= 0) state.cell[i] = "taken";
      } else if (t >= run.at) {
        const step = t - run.at;
        mark = { x: (path[step] + 0.5) * (100 / (COLS * 2 - 1)), y: (step / path.length) * 100 };
      }
    }
    return { cell: state.cell, entry, payload: mark, hit: -1 };
  }

  if (id === "k3") {
    // 배선도 — 출발점은 고르지만 도착은 따라가야 안다.
    const { cell } = seedCells(SEED, 30);
    const state = { cell, assign: buildAssign(SEED) };
    const rungs = buildLadder(SEED);
    const runs = [{ at: 2, start: 2 }, { at: 26, start: 8 }];
    let mark = null, entry = -1;
    for (const run of runs) {
      const { path, col } = tracePath(rungs, run.start);
      const done = t >= run.at + path.length;
      if (t >= run.at) entry = run.start;
      if (done) {
        const c = settleCol(state, col);
        const i = c >= 0 ? topOpen(state, c) : -1;
        if (i >= 0) state.cell[i] = "taken";
      } else if (t >= run.at) {
        const step = t - run.at;
        mark = { x: (path[step].c + 0.5) * (100 / COLS), y: (step / path.length) * 100 };
      }
    }
    return { cell: state.cell, entry, tracer: mark, rungs, hit: -1 };
  }

  // 소등 후 — 어두워서 안 보인다. 빔이 지나간 만큼만 드러난다.
  const { cell } = seedCells(SEED, 26);
  const sweep = [12, 15, 18, 24, 46, 43, 55, 57];
  const center = sweep[Math.min(Math.floor(t / 5), sweep.length - 1)];
  return {
    cell,
    lit: new Set(beamCells(center)),
    beam: { x: ((center % COLS) + 0.5) * (100 / COLS), y: (Math.floor(center / COLS) + 0.5) * (100 / ROWS) },
    hit: -1,
  };
}

/* 릴 전체 길이 — 회차 경계는 여기서 나눈다. 상태를 하나만 두는 이유는
   setState 안에서 다른 setState 를 부르면 StrictMode 이중 호출에 회차가 두 칸씩 뛰기 때문이다. */
const REEL_LEN = REEL.reduce((a, r) => a + LEN[r.id], 0);
function cursorOf(step) {
  let t = ((step % REEL_LEN) + REEL_LEN) % REEL_LEN;
  for (let k = 0; k < REEL.length; k++) {
    const len = LEN[REEL[k].id];
    if (t < len) return { i: k, t };
    t -= len;
  }
  return { i: 0, t: 0 };
}

/* 판이 액자를 채우는 데 필요한 폭 — 높이에서 역산한다.
   CSS 만으로는 「폭도 높이도 넘지 않는 정사각 격자」를 만들 수 없다(aspect-ratio 는 flex 의 늘리기에 진다).
   그래서 자리를 재서 폭 하나만 정해 주고, 나머지 비율은 CSS 가 이어받는다. */
const ROWS_OF = { wall: 8, shaft: 9 + 2.2 };   // 통로 = 투입구 1단 + 길(칸 2.2단분) + 칸 8단

export default function KujiFace() {
  const ref = useRef(null);
  const wallRef = useRef(null);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(false);

  const { i, t } = cursorOf(step);
  const round = REEL[i];
  const stage = KUJI_STAGE[round.id];

  const reduced = useMemo(
    () => typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  /* 화면 밖에서는 돌지 않는다 — 얼굴 하나 때문에 14화면짜리 무대가 계속 계산될 이유가 없다 */
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([e]) => setRun(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  const fit = useCallback(() => {
    const box = ref.current, wall = wallRef.current;
    if (!box || !wall) return;
    const rows = ROWS_OF[wall.dataset.kind] || ROWS_OF.wall;
    const tag = box.lastElementChild === wall ? 0 : (box.lastElementChild?.offsetHeight || 0) + 8;
    const h = box.clientHeight - tag - 14;
    const w = Math.max(0, Math.min(box.clientWidth, (h * COLS) / rows));
    const cur = parseFloat(wall.style.width);          // 첫 회에는 NaN — 비교로 걸러지지 않게 따로 본다
    if (!Number.isFinite(cur) || Math.abs(cur - w) > 0.5) wall.style.width = `${w}px`;
  }, []);

  /* 그릴 때마다 다시 잰다 — 회차가 바뀌면 단 수가 달라지고, 화면이 바뀌면 자리가 달라진다.
     ResizeObserver 만 두면 화면 밖에 있는 동안 일어난 변화를 놓친다(실측 확인: 폭이 옛 값에 묶였다). */
  useLayoutEffect(fit);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !ref.current) return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    if (!run || reduced) return undefined;
    const timer = setInterval(() => setStep((prev) => prev + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [run, reduced]);

  /* 모션 축소 — 굴리지 않고 한 장면에서 멈춘다. 판은 그대로 보인다. */
  const f = frameOf(round.id, reduced ? Math.floor(LEN[round.id] * 0.6) : t);
  const shaft = stage.kind === "shaft";

  return (
    <div className={s.kjFace} ref={ref} role="img"
      aria-label={`럭키드로우 ${round.name} 회차 판 — ${stage.theme}`}>
      {/* 판의 비율은 회차 종류가 정한다 — 벽은 8단, 통로는 투입구+길+칸까지 얹혀 더 길다.
          높이에서 폭을 받아 액자를 넘지 않게 한다(폭에서 높이를 받으면 통로 회차가 흘러넘친다). */}
      <div className={`${s.lkWall} ${s.kjFaceWall}`} ref={wallRef} data-kind={stage.kind} data-dark={stage.dark ? "" : undefined}
        style={{ backgroundImage: stage.bgDim
          ? `linear-gradient(rgba(24,28,22,${stage.bgDim}),rgba(24,28,22,${stage.bgDim})),url(${ASSET(stage.bg)})`
          : `url(${ASSET(stage.bg)})` }}>

        {shaft && (
          <>
            <div className={s.lkEntry}>
              {Array.from({ length: COLS }).map((_, c) => (
                <i key={c} className={f.entry === c ? s.lkMine : ""}
                  style={{ backgroundImage: `url(${ASSET(stage.entry)})` }} />
              ))}
            </div>
            <div className={s.lkField}>
              {stage.field.type === "pegs"
                ? Array.from({ length: stage.field.rows }).flatMap((_, r) =>
                    Array.from({ length: COLS }).map((_, c) => {
                      const x = (c + 0.5 + (r % 2 ? 0.5 : 0)) * 10;
                      if (x > 99) return null;
                      return <i key={`${r}-${c}`} className={s.lkPeg}
                        style={{ backgroundImage: `url(${ASSET(stage.field.sprite)})`,
                          left: `${x}%`, top: `${((r + 0.5) / stage.field.rows) * 100}%` }} />;
                    }))
                : (
                  <>
                    {Array.from({ length: COLS }).map((_, c) => (
                      <i key={`v${c}`} className={s.lkWireV}
                        style={{ backgroundImage: `url(${ASSET(stage.field.v)})`, left: `${(c + 0.5) * 10}%` }} />
                    ))}
                    {(f.rungs || []).flatMap((row, r) => row.map((c) => (
                      <i key={`h${r}-${c}`} className={s.lkWireH}
                        style={{ backgroundImage: `url(${ASSET(stage.field.h)})`,
                          left: `${(c + 0.5) * 10}%`, top: `${((r + 0.5) / stage.field.rows) * 100}%` }} />
                    )))}
                  </>
                )}
              {f.payload && stage.payload && (
                <i className={s.lkPayload}
                  style={{ backgroundImage: `url(${ASSET(stage.payload)})`, left: `${f.payload.x}%`, top: `${f.payload.y}%` }} />
              )}
              {f.tracer && <i className={s.lkTracer} style={{ left: `${f.tracer.x}%`, top: `${f.tracer.y}%` }} />}
            </div>
          </>
        )}

        <div className={s.lkGrid}>
          {f.cell.map((state, n) => {
            const litNow = !!(f.lit && f.lit.has(n));
            /* 존과 같은 규칙 — 빛이 닿은 칸은 밝은 사진으로 갈아 끼운다(밝기 필터로는 안 드러난다) */
            const src = state === "taken" ? stage.open : litNow && stage.lit ? stage.lit : stage.closed;
            return (
              <i key={n}
                className={`${s.lkCell} ${state === "taken" ? s.lkOpen : ""} ${litNow ? s.lkLit : ""} ${f.hit === n ? s.lkOpening : ""}`}
                style={{ backgroundImage: `url(${ASSET(src)})` }} />
            );
          })}
          {f.beam && stage.beam && (
            <span className={s.lkBeam} style={{ backgroundImage: `url(${ASSET(stage.beam)})`,
              inset: `${f.beam.y - 110}% ${110 - f.beam.x}% ${f.beam.y - 110}% ${f.beam.x - 110}%` }} />
          )}
        </div>
      </div>

      {/* 지금 무슨 회차를 보고 있는가 — 네 회차가 돌아간다는 사실 자체가 정보다 */}
      <div className={s.kjFaceTag}>
        <b>{round.name}</b>
        <em>{stage.theme}</em>
        <span className={s.kjFaceDots}>
          {REEL.map((r, n) => <i key={r.id} className={n === i ? s.on : ""} />)}
        </span>
      </div>
    </div>
  );
}

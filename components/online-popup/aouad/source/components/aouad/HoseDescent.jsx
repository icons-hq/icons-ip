"use client";

/* 방송실 소화전 호스 하강 — 화면.
   규칙은 `lib/zones/engine-hose.js` 가 갖는다. 이 파일은 **읽기만** 한다 —
   여기서 수치를 만들면 이관 관문(`npm run test:hose-engine`)이 못 잡는 규칙이 생긴다.

   원칙: 명장면은 배경이고 그 위에서 게임을 한다 — 서사·회상을 얹지 않는다(PM 2026-09-02).
   조작(PM 2026-09-04 확정) = 버튼 하나가 **판 열기 · 호스 잡기 · 놓으면 흐르기**를 겸한다.
   시작을 떼어 내지 않는다 — 떼면 시작시킨 누름이 잡기로 안 이어져 매 판 첫 사람이 버려진다.

   시계는 **한 dt** 로만 돈다 — 좀비를 벽시계로 재면 프레임이 밀릴 때 좀비만 빨라진다(동결 관계 ④). */

import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG, winY, goalIdx, goalY, bottomY, winAt, halfOf, zAt, advance, outcome, mulberry32, buildPlay, KIND_KO, freshRider } from "../../lib/zones/engine-hose";
import s from "./HoseDescent.module.css";

const RIDER_AT = 0.42;                                       // 사람이 화면 42% 지점 — 아래로 보이는 거리(lead)는 규칙값 그대로라 난이도는 그대로, 위가 더 보일 뿐
const VIEW_H = Math.round(CONFIG.lead / (1 - RIDER_AT));
const WORLD_W = 640;                                         // 규칙·그림의 좌표계 폭(벽 타일 1280×300 이 150px 층일 때의 폭). 화면은 이 세계를 배율로 키운다
const NEXT_MS = 850;                                    // 사람과 사람 사이
const LOCK_MS = 800;                                    // 판이 끝난 직후 재시작 잠금 — 결과를 읽을 틈
const WINDOWS = Array.from({ length: CONFIG.windows }, (_, k) => k);
const EMPTY = { phase: "idle", i: 0, saved: 0, res: [], grip: 1, spd: 0, z: {}, traps: [], last: null, slipping: false };

export default function HoseDescent({ onFinish, enabled = true, paused = false }) {
  const shaftRef = useRef(null);
  const riderRef = useRef(null);
  const g = useRef({ play: [], rider: freshRider(), traps: [], rng: null, t: 0, hold: false, phase: "idle", i: 0, saved: 0, res: [], readyAt: 0, timer: null, next: null });
  const [hud, setHud] = useState(EMPTY);
  const controlsRef = useRef({ enabled, paused });
  useEffect(() => {
    controlsRef.current = { enabled, paused };
    if (!enabled || paused) g.current.hold = false;
    else viewRef.current?.focus({ preventScroll: true });
  }, [enabled, paused]);
  const viewRef = useRef(null);
  const [layout, setLayout] = useState({ height: VIEW_H, scale: 1 });
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => {
      const preferred = Math.max(e.contentRect.width < WORLD_W ? 1.3 : 1, e.contentRect.width / WORLD_W);
      // 높이는 폭으로만 정한다. CSS가 확보한 실제 높이에 세계 전체를 맞춰 lead를 자르지 않는다.
      const height = VIEW_H * preferred;
      const scale = Math.min(preferred, e.contentRect.height / VIEW_H);
      setLayout((previous) => previous.height === height && previous.scale === scale ? previous : { height, scale });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const finishRef = useRef(onFinish);
  useEffect(() => { finishRef.current = onFinish; }, [onFinish]);

  const paint = useCallback((full) => {
    const c = g.current;
    if (shaftRef.current) shaftRef.current.style.transform = `translateY(${VIEW_H * RIDER_AT - c.rider.y}px)`;
    if (riderRef.current) {
      const k = c.phase === "land" && c.last ? c.last.kind : c.rider.slipLeft > 0 ? "slip" : c.hold && c.rider.grip > 0 ? "hold" : "run";
      riderRef.current.dataset.state = k;
    }
    if (!full) return;
    const z = {};
    for (const tr of c.traps) z[tr.k] = c.phase === "idle" ? "hidden" : zAt(c.t, tr);
    setHud({
      phase: c.phase, i: c.i, saved: c.saved, res: [...c.res],
      grip: c.rider.grip / CONFIG.grip, spd: Math.min(1, c.rider.v / CONFIG.vMax),
      z, traps: c.traps.map((t) => t.k), last: c.last, slipping: c.rider.slipLeft > 0,
    });
  }, []);

  const stop = useCallback(() => { clearInterval(g.current.timer); clearTimeout(g.current.next); }, []);

  const finish = useCallback(() => {
    const c = g.current;
    stop();
    c.phase = "done"; c.hold = false; c.readyAt = performance.now() + LOCK_MS;
    paint(true);
    finishRef.current?.({ saved: c.saved, of: CONFIG.people });
  }, [paint, stop]);

  const person = useCallback(() => {
    const c = g.current;
    const p = c.play[c.i];
    c.traps = p.traps; c.rng = mulberry32(p.seed);
    c.rider = freshRider(); c.t = 0; c.frame = 0; c.phase = "fall"; c.last = null;
    c.lastAt = performance.now();
    paint(true);
  }, [paint]);

  const tick = useCallback(() => {
    const c = g.current;
    const now = performance.now();
    const dt = Math.min(0.05, (now - c.lastAt) / 1000);
    c.lastAt = now;
    if (!controlsRef.current.enabled || controlsRef.current.paused || document.hidden) { c.hold = false; return; }
    if (c.phase === "land") {
      c.nextLeft -= dt;
      if (c.nextLeft <= 0) { if (c.i >= CONFIG.people) finish(); else person(); }
      return;
    }
    c.t += dt;                                  // 좀비도 사람도 이 dt 하나로 돈다
    c.rider = advance(c.rider, dt, c.hold, c.rng());
    const kind = outcome(c.rider, c.t, c.traps);
    c.frame = (c.frame + 1) % 3;
    if (!kind) { paint(c.frame === 0); return; }
    /* 이 사람의 판이 끝났다 */
    c.phase = "land";
    c.nextLeft = NEXT_MS / 1000;
    c.last = { kind, at: winAt(c.rider.y), passed: Math.max(0, Math.min(CONFIG.windows, Math.floor((c.rider.y - CONFIG.first) / CONFIG.gap) + 1)), t: c.t };
    c.res.push(kind); if (kind === "in") c.saved += 1;
    c.i += 1;
    paint(true);
  }, [paint, finish, person]);

  const start = useCallback((grab) => {
    if (!controlsRef.current.enabled || controlsRef.current.paused || document.hidden) return;
    const c = g.current;
    if (c.phase === "done" && performance.now() < c.readyAt) return;
    stop();
    c.play = buildPlay((Date.now() ^ 0x9e3779b9) >>> 0);
    c.i = 0; c.saved = 0; c.res = []; c.hold = false;
    person();
    c.timer = setInterval(tick, 16);
    if (grab) c.hold = true;                                   // 시작시킨 그 손이 그대로 호스를 잡는다
  }, [person, stop, tick]);

  /* 누르면 잡는다. 아직 판이 안 열렸으면 그 누름이 판을 열고 그대로 잡는 손이 된다 */
  const press = useCallback(() => {
    if (!controlsRef.current.enabled || controlsRef.current.paused || document.hidden) return;
    const c = g.current;
    if (c.phase === "fall") { c.hold = true; paint(false); return; }
    if (c.phase === "idle" || c.phase === "done") start(true);
  }, [paint, start]);
  const release = useCallback(() => { g.current.hold = false; paint(false); }, [paint]);

  useEffect(() => {
    const ku = (e) => { if (e.code === "Space" || e.key === " " || e.key === "Enter") release(); };
    window.addEventListener("keyup", ku); window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release); window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      window.removeEventListener("keyup", ku); window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release); window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
    };
  }, [release]);

  useEffect(() => () => stop(), [stop]);

  const live = hud.phase === "fall";
  const done = hud.phase === "done";
  /* 무대 위 한 줄 — 판이 안 열렸을 때·사람이 끝났을 때·판이 끝났을 때만. 내려가는 동안은 글자가 없다(그림이 말한다) */
  const cue = done ? `${hud.saved}명이 들어갔다 · 다시 하려면 누른다`
    : hud.phase === "land" && hud.last ? KIND_KO[hud.last.kind]
    : hud.phase === "idle" ? "누르면 잡는다" : null;

  return (
    <div className={s.view} ref={viewRef} style={{ height: layout.height }}
      onPointerDown={(e) => {
        if (!enabled || paused || e.button !== 0) return;
        e.preventDefault(); e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId); press();
      }}
      onPointerUp={release} onPointerCancel={release} onBlur={release}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || !enabled || paused) return;
        if (e.code !== "Space" && e.key !== " " && e.key !== "Enter") return;
        e.preventDefault(); e.stopPropagation();
        if (!e.repeat) press();
      }}
      role="button" tabIndex={enabled && !paused ? 0 : -1} aria-disabled={!enabled || paused} aria-label="호스 잡기 — 스페이스 또는 엔터를 누르고 있으면 잡고, 놓으면 내려갑니다">
      {/* 세계 — 규칙 좌표계(640 폭) 그대로 그리고 배율만 건다. 카메라(translateY)는 그 안에서 돈다 */}
      <div className={s.world} style={{ width: WORLD_W, height: VIEW_H, transform: `scale(${layout.scale})` }}>
        <div className={s.shaft} ref={shaftRef} style={{ height: bottomY() + VIEW_H }}>
          <div className={s.roof} />
          <div className={s.ground} style={{ top: bottomY() }} />
          <i className={s.hose} style={{ height: goalY() + 24 }} />
          {WINDOWS.map((k2) => {
            const goal = k2 === goalIdx();
            const trap = hud.traps.includes(k2);
            const state = hud.z[k2] || "hidden";
            return (
              <span key={k2} className={s.win} data-goal={goal || undefined} data-trap={trap || undefined}
                data-z={trap && live ? state : undefined}
                data-pose={k2 % 2 ? "side" : "up"}   /* 좀비 자세는 창마다 번갈아 — 같은 자세가 나란히 보이지 않게 */
                data-bit={hud.last && hud.last.kind === "zombie" && hud.last.at === k2 ? "1" : undefined}
                data-hit={goal && hud.last && hud.last.kind === "in" ? "1" : undefined}
                /* 그림의 높이 = 판정 범위 그대로 — 여기서 숫자를 만들면 보이는 창과 잡히는 창이 어긋난다 */
                style={{ top: winY(k2) - halfOf(k2), height: halfOf(k2) * 2 }}
              />
            );
          })}
        </div>
        <i className={s.rider} ref={riderRef} data-state="run" style={{ top: VIEW_H * RIDER_AT - 44, display: hud.phase === "idle" || done ? "none" : "block" }}   /* 몸 한가운데 = 규칙의 y */ />
      </div>

      {/* 무대 위 층 — 손은 통과한다. 사람 8칸 · 팔 힘 한 줄 · 글자 한 줄. 점수판·속도·기록은 없다(칸의 색과 창의 빛이 같은 말을 한다) */}
      <div className={s.hud} aria-hidden="true">
        <div className={s.queue}>
          {Array.from({ length: CONFIG.people }, (_, i) => (
            <i key={i} className={s.q} data-r={hud.res[i] || (i === hud.i && !done ? "now" : undefined)} />
          ))}
        </div>
        {live && <i className={s.gripBar}><b style={{ width: `${hud.grip * 100}%` }} data-low={hud.grip < 0.3 ? "1" : undefined} /></i>}
        {cue && <p className={s.cue} data-kind={hud.phase === "land" && hud.last ? hud.last.kind : undefined}>{cue}</p>}
      </div>
    </div>
  );
}

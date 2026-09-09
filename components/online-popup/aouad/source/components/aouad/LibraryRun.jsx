"use client";

/* 도서관 서가 탈출 — 화면.
   규칙은 `lib/zones/engine-library.js` 가, 씬은 `library-run-scene.js` 가 갖는다. 이 파일은 **읽기만** 한다 —
   여기서 수치를 만들면 이관 관문(`npm run test:library-engine`)이 못 잡는 규칙이 생긴다.

   원칙: 명장면은 배경이고 그 위에서 게임을 한다 — 서사·회상을 얹지 않는다(PM 2026-09-02).
   Phaser 는 **씬으로** 얹는다(ADR-0027 · iframe 임베드가 아니다). 무거우므로 필요할 때만 받아 온다.
   조작 = 저절로 달린다 · 탭 = 뛴다 · 연속 두 번 = 멀리 뛴다 · 아래로 쓸기 = 미끄러진다.

   모바일(≤640px · PM 2026-09-09 「모바일이 엉망」): 폰에서는 게임 위아래에 붙던 하는 법·구매권·미션 판을 전부 걷고
   **버튼 셋**으로 접는다. 누르면 **HUD 컨텍스트 패널**이 그 항목을 고른 채 열린다(PM 「모달도 다 컨텍스트 패널에서」) —
   이 파일은 시트를 그리지 않는다. 내용은 존(`AouadSample`)이 HUD 문법(`segments`)으로 넘긴다. 넓은 화면은 그대로다. */

import { useCallback, useEffect, useRef, useState } from "react";
import { LEVEL, SEGMENT_NAMES, TRAPS, DEFAULT_TRAP } from "../../lib/zones/engine-library";
import s from "./LibraryRun.module.css";

const MISSION_ROWS = [
  { key: "escaped", label: "탈출", prize: "포토카드 구매권" },   /* 탈출만 잠금 — 나머지 셋은 선구매(PM 판정 ⓑ·C) */
  { key: "bookmarks", label: `책갈피 ${LEVEL.bookmarks.length}개`, prize: "화살 북마크 선구매권" },
  { key: "noHit", label: "무피격 탈출", prize: "데스크 장패드 선구매권" },
  { key: "secret", label: "비밀 서고 통과", prize: "실험노트 선구매권" },
];
const EMPTY = { alive: false, seg: 0, bookmarks: 0, dodged: 0, hits: 0, ms: 0, gap: null, missions: {} };

/* 미션 목록 — 넓은 화면은 옆 판에, 폰은 시트에. 같은 것을 두 자리에 그린다 */
function MissionList({ m, trap, log }) {
  return (
    <>
      <ul className={s.missions}>
        {MISSION_ROWS.map((row) => (
          <li key={row.key} className={m[row.key] ? s.on : ""}>
            <b>{row.label}</b><small>{row.prize}</small>
          </li>
        ))}
      </ul>
      <p className={s.trapNote}>함정 강도 · {(TRAPS[trap] || TRAPS[DEFAULT_TRAP]).name}</p>
      {log.length > 0 && (
        <ul className={s.log}>
          {log.map((entry, i) => <li key={`${entry.text}-${i}`} className={s[entry.kind] || ""}>{entry.text}</li>)}
        </ul>
      )}
    </>
  );
}

export default function LibraryRun({ trap = DEFAULT_TRAP, onFinish, onPane, onMissions, autoStart = false, paused = false }) {
  const hostRef = useRef(null);
  const runRef = useRef(null);
  const finishRef = useRef(onFinish);
  const [hud, setHud] = useState(EMPTY);
  const [log, setLog] = useState([]);
  const [phase, setPhase] = useState("loading");   // loading · ready · playing · done · failed
  const missionsRef = useRef(onMissions);
  useEffect(() => { missionsRef.current = onMissions; }, [onMissions]);

  useEffect(() => { finishRef.current = onFinish; }, [onFinish]);

  const onState = useCallback((next) => {
    setHud(next);
    if (missionsRef.current) missionsRef.current(next.missions || {});   // HUD 컨텍스트의 미션 칩이 이 판을 따라간다
  }, []);
  const onLog = useCallback((entry) => setLog((prev) => [entry, ...prev].slice(0, 6)), []);
  const onDone = useCallback((result) => { setPhase("done"); finishRef.current?.(result); }, []);

  useEffect(() => {
    let cancelled = false;
    let handle;
    (async () => {
      try {
        const [{ default: Phaser }, { createLibraryRun }] = await Promise.all([
          import("phaser"),
          import("./library-run-scene"),
        ]);
        if (cancelled || !hostRef.current) return;
        handle = createLibraryRun({ Phaser, parent: hostRef.current, trap, onState, onFinish: onDone, onLog,
          onReady: () => { if (!cancelled) setPhase("ready"); } });
        runRef.current = handle;
      } catch {
        if (!cancelled) setPhase("failed");
      }
    })();
    return () => { cancelled = true; handle?.destroy(); runRef.current = null; };
  }, [trap, onState, onLog, onDone]);

  useEffect(() => {
    const sync = () => runRef.current?.setPaused(paused || document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [paused, phase]);

  const start = useCallback(() => {
    if (paused || document.hidden || !runRef.current) return;
    setLog([]); runRef.current.start(); setPhase("playing");
    hostRef.current?.focus({ preventScroll: true });
  }, [paused]);
  /* 관문의 「다시 시작」이 씬을 새로 달고 바로 달리게 한다(PM 2026-09-09) — 두 번 누르지 않는다 */
  useEffect(() => { if (autoStart && phase === "ready" && !paused) start(); }, [autoStart, phase, paused, start]);
  const m = hud.missions || {};
  const secs = (hud.ms / 1000).toFixed(1);
  const doneCount = MISSION_ROWS.filter((row) => m[row.key]).length;

  return (
    <div className={s.wrap}>
      {/* 폰 — 판 대신 버튼 셋. 누르면 HUD 컨텍스트 패널이 그 항목으로 열린다. 넓은 화면에서는 안 보인다 */}
      {onPane && (
        <div className={s.mobileBar}>
          <button type="button" onClick={() => onPane("guide")}>하는 법</button>
          <button type="button" onClick={() => onPane("reward")}>구매권</button>
          <button type="button" onClick={() => onPane("missions")}>미션 <b>{doneCount}/{MISSION_ROWS.length}</b></button>
        </div>
      )}
      <div className={s.board}>
        <span>구간 <b>{hud.seg + 1}</b> / {SEGMENT_NAMES.length}</span>
        <span>책갈피 <b>{hud.bookmarks}</b> / {LEVEL.bookmarks.length}</span>
        <span>뒤 <b className={hud.gap !== null && hud.gap < 140 ? s.near : ""}>{hud.gap === null ? "—" : `${hud.gap}px`}</b></span>
        <span>흘림 <b>{hud.dodged}</b></span>
        <span>시간 <b>{secs}</b>s</span>
      </div>

      <div className={s.stageRow}>
        <div className={s.stage}>
          <div ref={hostRef} className={s.canvas} tabIndex={phase === "playing" && !paused ? 0 : -1}
            role="group" aria-label="도서관 서가 탈출 — 스페이스 또는 위 방향키로 점프, 아래 방향키로 미끄러지기"
            onPointerDownCapture={(e) => { if (!paused) e.currentTarget.focus({ preventScroll: true }); }} />
          {phase !== "playing" && (
            <div className={s.overlay}>
              {phase === "loading" && <p className={s.overlayMsg}>도서관을 여는 중…</p>}
              {phase === "failed" && <p className={s.overlayMsg}>도서관을 열지 못했어요. 새로고침해 주세요.</p>}
              {(phase === "ready" || phase === "done") && (
                <>
                  <p className={`${s.overlayMsg} ${s.deskOnly}`}>
                    저절로 달린다 · <b>탭 = 뛴다</b> · <b>연속 두 번 = 멀리 뛴다</b> · <b>아래로 쓸기 = 미끄러진다</b>
                    <br />뒤에서 무리가 밀려온다 — 멈추면 잡힌다. 튀어나오는 놈은 <b>낮으면 뛰고 덮치면 미끄러진다</b>.
                  </p>
                  <button type="button" className={s.startBtn} onClick={start} disabled={paused}>
                    {phase === "done" ? "다시 도전" : "시작"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className={`${s.side} ${s.deskOnly}`}>
          <h3 className={s.sideTitle}>미션</h3>
          <MissionList m={m} trap={trap} log={log} />
        </div>
      </div>
    </div>
  );
}

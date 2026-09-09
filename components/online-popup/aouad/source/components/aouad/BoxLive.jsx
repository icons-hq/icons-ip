"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBoxSession, createDarkSession, createDropSession, createWireSession } from "../../lib/box/session";
import { ambience, playSfx, stopAudio, unlockAudio } from "../../lib/box/audio";
import { createRoundPlayback } from "../../lib/stage/round-playback";
import { commitPresentationDraw } from "./presentation-draws";
import PresentationDialog from "./PresentationDialog";
import s from "./AouadSample.module.css";

const won = (n) => `${n.toLocaleString()}원`;

function useRoundPersistence(roundId, initialDrawState, onDrawCommitted) {
  const latest = useRef({ roundId, initialDrawState, onDrawCommitted });
  useEffect(() => { latest.current = { roundId, initialDrawState, onDrawCommitted }; }, [roundId, initialDrawState, onDrawCommitted]);
  const getDrawState = useCallback(() => latest.current.initialDrawState ?? {}, []);
  const restore = useCallback(() => {
    const saved = getDrawState();
    return { initialToday: saved.today, initialDay: saved.day, initialTaken: saved.taken, getDrawState };
  }, [getDrawState]);
  const commit = useCallback((draw) => commitPresentationDraw({ draw,
    roundId: latest.current.roundId, onDrawCommitted: latest.current.onDrawCommitted }), []);
  return { restore, commit };
}

/* 회차를 실제로 굴린다. 화면은 session 만 보고 engine 을 직접 부르지 않는다(P5 §2). */
export function useBoxRound({ seed, rivals = 3, enabled, roundId = "k1", initialDrawState, onDrawCommitted }) {
  const ref = useRef(null);
  const [snap, setSnap] = useState(null);
  const [opening, setOpening] = useState(null);   // 개봉 중인 칸
  const [results, setResults] = useState(null);   // 개봉이 끝난 뒤 보여줄 것
  const [sheet, setSheet] = useState(false);
  const [playback] = useState(createRoundPlayback);
  const { restore, commit } = useRoundPersistence(roundId, initialDrawState, onDrawCommitted);

  /* eslint-disable react-hooks/set-state-in-effect -- Replacing an external simulation session invalidates its snapshot and any in-flight reveal state. */
  useEffect(() => {
    playback.cancel(); setOpening(null); setResults(null); setSheet(false);
    if (!enabled) return undefined;
    const session = createBoxSession({ seed, rivals, ...restore() });
    ref.current = session;
    const initial = session.snapshot();
    setSnap(initial);
    let previousLeft = initial.left;
    const warned = new Set();
    const id = setInterval(() => {
      const evts = session.tick();
      const next = session.snapshot();
      // 만료 20초 전 경고 — 한 번만 울린다
      next.picks.forEach((i) => {
        const leftMs = next.holdUntil[i] - Date.now();
        if (leftMs > 0 && leftMs < next.holdWarnSec * 1000 && !warned.has(i)) { warned.add(i); playSfx("sfx-hold-warning"); }
      });
      next.picks.forEach((i) => { if (next.holdUntil[i] - Date.now() > next.holdWarnSec * 1000) warned.delete(i); });
      if (evts.some((e) => e.type === "rivalTook")) playSfx("sfx-ui-tick");
      if (previousLeft > 0 && next.left === 0) playSfx("sfx-round-empty");
      previousLeft = next.left;
      setSnap(next);
    }, 500);
    return () => { clearInterval(id); playback.cancel(); ref.current = null; stopAudio(); };
  }, [roundId, seed, rivals, enabled, playback, restore]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggle = useCallback((i) => {
    if (playback.busy || !ref.current) return;
    unlockAudio(); ambience(true);
    const what = ref.current?.toggle(i);
    if (what === "picked") playSfx("sfx-cell-pick");
    if (what === "released") playSfx("sfx-cell-release");
    if (what) setSnap(ref.current.snapshot());
  }, [playback]);

  /* 개봉 — 한 칸씩 순차 재생. 결과는 이미 정해져 있고 여기서는 공개만 한다. */
  const confirm = useCallback(async () => {
    const session = ref.current;
    if (!session || !session.snapshot().picks.length) return;
    const run = playback.begin();
    if (!run) return;
    try {
      setSheet(false);
      const picked = session.snapshot().picks.slice();
      const out = commit(() => session.draw());
      if (!out.length) { setSnap(session.snapshot()); return; }
      for (const cell of picked) {
        setOpening(cell); playSfx("sfx-door-open");
        if (!await playback.wait(run, 1200)) return;
        const hit = out.find((o) => o.cell === cell + 1);
        if (!hit) continue;
        playSfx(["A", "B", "C", "LAST"].includes(hit.grade) ? "sfx-reveal-long" : "sfx-reveal-short");
        setOpening(null); setSnap(session.snapshot()); playSfx("sfx-ui-tick");
        if (!await playback.wait(run, 260)) return;
      }
      setResults(out);
    } finally { playback.finish(run); }
  }, [playback, commit]);

  return { snap, opening, results, sheet, toggle, limitReached: !!snap && snap.today >= snap.dailyLimit,
    openSheet: () => { if (!playback.busy) setSheet(true); },
    closeSheet: () => setSheet(false), confirm, clearResults: () => setResults(null) };
}

/* 확인 시트 — 「돈을 낸다」가 화면에 있어야 유상 상자로 읽힌다(PM 2026-08-31) */
export function BoxConfirmSheet({ snap, onCancel, onConfirm }) {
  if (!snap) return null;
  const n = snap.picks.length;
  return (
    <PresentationDialog className={s.overlay} label="뽑기 확인" onClose={onCancel}>
      <div className={`${s.overlayBox} ${s.bxSheet}`}>
        <b className={s.bxSheetTitle}>고른 칸 {n}개</b>
        <div className={s.bxSheetCells}>{snap.picks.map((i) => <i key={i}>{i + 1}</i>)}</div>
        <dl className={s.bxSheetRows}>
          <div><dt>1회</dt><dd>{won(snap.price)}</dd></div>
          <div><dt>수량</dt><dd>{n}칸</dd></div>
          <div className={s.bxSum}><dt>예시 결제 금액</dt><dd>{won(snap.price * n)}</dd></div>
        </dl>
        <p className={s.bxSheetNote}>
          남은 칸 {snap.left} / {snap.total} · 오늘 {snap.today + n} / {snap.dailyLimit}회
        </p>
        <div className={s.bxSheetBtns}>
          <button type="button" className={s.ghostBtn} onClick={onCancel}>취소</button>
          <button type="button" className={s.primaryBtn} disabled={!n || n > snap.left || snap.today + n > snap.dailyLimit} onClick={onConfirm}>{won(snap.price * n)} 결제 체험</button>
        </div>
        <p className={s.bxDemo}>시연 화면 — 실제로 결제되지 않습니다</p>
      </div>
    </PresentationDialog>
  );
}

export function BoxResult({ results, onClose }) {
  if (!results) return null;
  return (
    <PresentationDialog className={s.overlay} label="개봉 결과" onClose={onClose}>
      <div className={`${s.overlayBox} ${s.bxSheet}`}>
        <b className={s.bxSheetTitle}>{results.length}칸 개봉</b>
        <ul className={s.bxResults}>
          {results.map((r) => (
            <li key={r.cell}><b className={s.grade}>{r.grade}</b><span>{r.name}</span><em>{r.cell}번</em></li>
          ))}
        </ul>
        <div className={s.bxSheetBtns}>
          <button type="button" className={s.primaryBtn} onClick={onClose}>확인</button>
        </div>
        <p className={s.bxDemo}>시연 화면 — 실제 배송되지 않습니다</p>
      </div>
    </PresentationDialog>
  );
}

/* 낙하 회차 — 고르는 것이 칸이 아니라 투입구다. 손을 떠난 뒤에도 화면에서 사건이 이어진다. */
export function useDropRound({ seed, rivals = 3, enabled, roundId = "k2", initialDrawState, onDrawCommitted }) {
  const ref = useRef(null);
  const [snap, setSnap] = useState(null);
  const [entry, setEntry] = useState(null);   // 고른 투입구
  const [fall, setFall] = useState(null);     // 낙하 중 — { path, step }
  const [results, setResults] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [playback] = useState(createRoundPlayback);
  const { restore, commit } = useRoundPersistence(roundId, initialDrawState, onDrawCommitted);

  /* eslint-disable react-hooks/set-state-in-effect -- Publish the new external session and discard the previous round's transient reveal. */
  useEffect(() => {
    playback.cancel(); setEntry(null); setFall(null); setResults(null); setSheet(false);
    if (!enabled) return undefined;
    const session = createDropSession({ seed, rivals, ...restore() });
    ref.current = session;
    const initial = session.snapshot();
    setSnap(initial);
    let previousLeft = initial.left;
    const id = setInterval(() => {
      const evts = session.tick();
      if (evts.some((e) => e.type === "rivalTook")) playSfx("sfx-ui-tick");
      const next = session.snapshot();
      if (previousLeft > 0 && next.left === 0) playSfx("sfx-round-empty");
      previousLeft = next.left;
      setSnap(next);
    }, 900);
    return () => { clearInterval(id); playback.cancel(); ref.current = null; stopAudio(); };
  }, [roundId, seed, rivals, enabled, playback, restore]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pick = useCallback((c) => {
    if (playback.busy || !ref.current) return;
    unlockAudio(); ambience(true);
    setEntry((prev) => (prev === c ? null : c));
    playSfx(entry === c ? "sfx-cell-release" : "sfx-cell-pick");
  }, [entry, playback]);

  /* 투입 — 경로는 이미 정해져 있다. 화면은 그 길을 따라 보여 줄 뿐이다. */
  const confirm = useCallback(async () => {
    const session = ref.current;
    if (!session || entry === null) return;
    const run = playback.begin();
    if (!run) return;
    try {
      setSheet(false);
      const out = commit(() => session.drop(entry));
      if (!out) { setSnap(session.snapshot()); return; }
      for (let i = 0; i < out.path.length; i++) {
        setFall({ path: out.path, step: i });
        if (i > 0) playSfx("sfx-drop-bounce");
        if (!await playback.wait(run, 115)) return;
      }
      setFall(null); playSfx("sfx-drop-land");
      setSnap(session.snapshot()); playSfx("sfx-ui-tick");
      if (!await playback.wait(run, 220)) return;
      playSfx(["A", "B", "C", "LAST"].includes(out.grade) ? "sfx-reveal-long" : "sfx-reveal-short");
      setEntry(null);
      setResults([{ cell: out.cell + 1, prizeIndex: out.prizeIndex, grade: out.grade, name: out.name, value: out.value }]);
    } finally { playback.finish(run); }
  }, [entry, playback, commit]);

  return { snap, entry, fall, results, sheet, pick, limitReached: !!snap && snap.today >= snap.dailyLimit,
    openSheet: () => { if (!playback.busy) setSheet(true); }, closeSheet: () => setSheet(false), confirm,
    clearResults: () => setResults(null) };
}

/* 투입 확인 — 칸이 아니라 투입구를 고른 것이므로 문구가 다르다 */
export function DropConfirmSheet({ snap, entry, onCancel, onConfirm }) {
  if (!snap || entry === null) return null;
  return (
    <PresentationDialog className={s.overlay} label="투입 확인" onClose={onCancel}>
      <div className={`${s.overlayBox} ${s.bxSheet}`}>
        <b className={s.bxSheetTitle}>{entry + 1}번 투입구</b>
        <p className={s.bxSheetNote}>어느 칸이 열릴지는 떨어져 봐야 압니다.</p>
        <dl className={s.bxSheetRows}>
          <div className={s.bxSum}><dt>예시 결제 금액</dt><dd>{won(snap.price)}</dd></div>
        </dl>
        <p className={s.bxSheetNote}>
          남은 칸 {snap.left} / {snap.total} · 오늘 {snap.today + 1} / {snap.dailyLimit}회
        </p>
        <div className={s.bxSheetBtns}>
          <button type="button" className={s.ghostBtn} onClick={onCancel}>취소</button>
          <button type="button" className={s.primaryBtn} disabled={snap.left <= 0 || snap.today >= snap.dailyLimit} onClick={onConfirm}>{won(snap.price)} 결제 체험</button>
        </div>
        <p className={s.bxDemo}>시연 화면 — 실제로 결제되지 않습니다</p>
      </div>
    </PresentationDialog>
  );
}

/* 배선 회차 — 고르는 것은 출발점이고, 따라가야 안다. 밝혀진 것은 회차 내내 남는다. */
export function useWireRound({ seed, rivals = 3, enabled, roundId = "k3", initialDrawState, onDrawCommitted }) {
  const ref = useRef(null);
  const [snap, setSnap] = useState(null);
  const [start, setStart] = useState(null);
  const [trace, setTrace] = useState(null);   // { path, step }
  const [results, setResults] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [rewired, setRewired] = useState(false);   // 방금 배선이 다시 꽂혔는가
  const [playback] = useState(createRoundPlayback);
  const { restore, commit } = useRoundPersistence(roundId, initialDrawState, onDrawCommitted);

  /* eslint-disable react-hooks/set-state-in-effect -- Publish the new external session and discard the previous round's transient reveal. */
  useEffect(() => {
    playback.cancel(); setStart(null); setTrace(null); setResults(null); setSheet(false); setRewired(false);
    if (!enabled) return undefined;
    const session = createWireSession({ seed, rivals, ...restore() });
    ref.current = session;
    const initial = session.snapshot();
    setSnap(initial);
    let previousLeft = initial.left;
    const id = setInterval(() => {
      const evts = session.tick();
      if (evts.some((e) => e.type === "rivalTook")) playSfx("sfx-ui-tick");
      const next = session.snapshot();
      if (previousLeft > 0 && next.left === 0) playSfx("sfx-round-empty");
      previousLeft = next.left;
      setSnap(next);
    }, 900);
    return () => { clearInterval(id); playback.cancel(); ref.current = null; stopAudio(); };
  }, [roundId, seed, rivals, enabled, playback, restore]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!rewired) return undefined;
    const id = setTimeout(() => setRewired(false), 3200);
    return () => clearTimeout(id);
  }, [rewired]);

  const pick = useCallback((c) => {
    if (playback.busy || !ref.current) return;
    unlockAudio(); ambience(true);
    setStart((prev) => (prev === c ? null : c));
    playSfx(start === c ? "sfx-cell-release" : "sfx-cell-pick");
  }, [start, playback]);

  const confirm = useCallback(async () => {
    const session = ref.current;
    if (!session || start === null) return;
    const run = playback.begin();
    if (!run) return;
    try {
      setSheet(false);
      const out = commit(() => session.trace(start));
      if (!out) { setSnap(session.snapshot()); return; }
      for (let i = 0; i < out.path.length; i++) {
        setTrace({ path: out.path, step: i });
        if (i > 0) playSfx("sfx-wire-trace");
        if (!await playback.wait(run, 130)) return;
      }
      setTrace(null); playSfx("sfx-wire-arrive");
      setSnap(session.snapshot()); playSfx("sfx-ui-tick");
      if (!await playback.wait(run, 220)) return;
      playSfx(["A", "B", "C", "LAST"].includes(out.grade) ? "sfx-reveal-long" : "sfx-reveal-short");
      setStart(null);
      setResults([{ cell: out.cell + 1, prizeIndex: out.prizeIndex, grade: out.grade, name: out.name, value: out.value }]);
      if (out.rewired) { setRewired(true); playSfx("sfx-wire-arrive"); }
    } finally { playback.finish(run); }
  }, [start, playback, commit]);

  return { snap, start, trace, results, sheet, pick, rewired, limitReached: !!snap && snap.today >= snap.dailyLimit,
    peek: (c) => ref.current?.peek(c) ?? null,
    openSheet: () => { if (!playback.busy) setSheet(true); }, closeSheet: () => setSheet(false), confirm,
    clearResults: () => setResults(null) };
}

/* 추적 확인 — 이미 밝혀진 출발점이면 어디로 가는지 알고 누른다. 그 차이가 이 회차다. */
export function WireConfirmSheet({ snap, start, known, onCancel, onConfirm }) {
  if (!snap || start === null) return null;
  return (
    <PresentationDialog className={s.overlay} label="추적 확인" onClose={onCancel}>
      <div className={`${s.overlayBox} ${s.bxSheet}`}>
        <b className={s.bxSheetTitle}>{start + 1}번 출발점</b>
        <p className={s.bxSheetNote}>
          {known === null ? "어디로 이어지는지는 따라가 봐야 압니다."
            : `이미 밝혀진 배선 — ${known + 1}열로 이어집니다.`}
          {snap.untilRewire === 1 && " 이번이 이 배선의 마지막입니다."}
        </p>
        <dl className={s.bxSheetRows}>
          <div className={s.bxSum}><dt>예시 결제 금액</dt><dd>{won(snap.price)}</dd></div>
        </dl>
        <p className={s.bxSheetNote}>
          남은 칸 {snap.left} / {snap.total} · 밝혀진 길 {snap.knownCount} / {snap.cols} · 다음 배선까지 {snap.untilRewire}회
        </p>
        <div className={s.bxSheetBtns}>
          <button type="button" className={s.ghostBtn} onClick={onCancel}>취소</button>
          <button type="button" className={s.primaryBtn} disabled={snap.left <= 0 || snap.today >= snap.dailyLimit} onClick={onConfirm}>{won(snap.price)} 결제 체험</button>
        </div>
        <p className={s.bxDemo}>시연 화면 — 실제로 결제되지 않습니다</p>
      </div>
    </PresentationDialog>
  );
}

/* 소등 회차 — 어둠 속에서 비추고, 개수만 듣고, 고른다. 열면 정보가 사라진다. */
export function useDarkRound({ seed, rivals = 3, enabled, roundId = "k4", initialDrawState, onDrawCommitted }) {
  const ref = useRef(null);
  const [snap, setSnap] = useState(null);
  const [mode, setMode] = useState("scan");   // scan | open
  const [target, setTarget] = useState(null); // 열려고 고른 칸
  const [beam, setBeam] = useState([]);       // 지금 비추는 범위(미리보기)
  const [results, setResults] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [playback] = useState(createRoundPlayback);
  const { restore, commit } = useRoundPersistence(roundId, initialDrawState, onDrawCommitted);

  /* eslint-disable react-hooks/set-state-in-effect -- Publish the new external session and discard the previous round's transient reveal. */
  useEffect(() => {
    playback.cancel(); setMode("scan"); setTarget(null); setBeam([]); setResults(null); setSheet(false);
    if (!enabled) return undefined;
    const session = createDarkSession({ seed, rivals, ...restore() });
    ref.current = session;
    const initial = session.snapshot();
    setSnap(initial);
    let previousLeft = initial.left;
    const id = setInterval(() => {
      const evts = session.tick();
      if (evts.some((e) => e.type === "rivalTook")) playSfx("sfx-ui-tick");
      const next = session.snapshot();
      if (previousLeft > 0 && next.left === 0) playSfx("sfx-round-empty");
      previousLeft = next.left;
      setSnap(next);
    }, 900);
    return () => { clearInterval(id); playback.cancel(); ref.current = null; stopAudio(); };
  }, [roundId, seed, rivals, enabled, playback, restore]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const hover = useCallback((n) => {
    if (playback.busy) return;
    setBeam(n === null || mode !== "scan" ? [] : (ref.current?.beamCells(n) ?? []));
  }, [mode, playback]);

  const tap = useCallback((n) => {
    if (playback.busy || !ref.current) return;
    unlockAudio(); ambience(true);
    if (mode === "scan") {
      const r = ref.current.scan(n);
      if (r) { playSfx("sfx-dark-scan"); setSnap(ref.current.snapshot()); }
      return;
    }
    setTarget((prev) => (prev === n ? null : n));
    playSfx(target === n ? "sfx-cell-release" : "sfx-cell-pick");
  }, [mode, target, playback]);

  const confirm = useCallback(async () => {
    const session = ref.current;
    if (!session || target === null) return;
    const run = playback.begin();
    if (!run) return;
    try {
      setSheet(false);
      const out = commit(() => session.open(target));
      if (!out) { setSnap(session.snapshot()); return; }
      playSfx("sfx-dark-open");
      if (!await playback.wait(run, 900)) return;
      setSnap(session.snapshot()); playSfx("sfx-ui-tick");
      if (!await playback.wait(run, 200)) return;
      playSfx(["A", "B", "C", "LAST"].includes(out.grade) ? "sfx-reveal-long" : "sfx-reveal-short");
      setTarget(null); setBeam([]); setMode("scan");
      setResults([{ cell: out.cell + 1, prizeIndex: out.prizeIndex, grade: out.grade, name: out.name, value: out.value }]);
    } finally { playback.finish(run); }
  }, [target, playback, commit]);

  return { snap, mode, setMode: (value) => { if (!playback.busy) setMode(value); }, target, beam, results, sheet, tap, hover,
    limitReached: !!snap && snap.today >= snap.dailyLimit,
    openSheet: () => { if (!playback.busy) setSheet(true); }, closeSheet: () => setSheet(false), confirm,
    clearResults: () => setResults(null) };
}

/* 열기 확인 — 개수만 듣고 고른 것이므로, 무엇이 나올지는 여전히 모른다 */
export function DarkConfirmSheet({ snap, target, onCancel, onConfirm }) {
  if (!snap || target === null) return null;
  return (
    <PresentationDialog className={s.overlay} label="열기 확인" onClose={onCancel}>
      <div className={`${s.overlayBox} ${s.bxSheet}`}>
        <b className={s.bxSheetTitle}>{target + 1}번 칸</b>
        <p className={s.bxSheetNote}>
          {snap.log.length
            ? `비춘 기록 ${snap.log.length}건으로 좁힌 자리입니다. 무엇이 있는지는 열어야 압니다.`
            : "비추지 않고 엽니다."}
        </p>
        <dl className={s.bxSheetRows}>
          <div className={s.bxSum}><dt>예시 결제 금액</dt><dd>{won(snap.price)}</dd></div>
        </dl>
        <p className={s.bxSheetNote}>
          남은 칸 {snap.left} / {snap.total} · 오늘 {snap.today + 1} / {snap.dailyLimit}회
          <br />열면 <b>손전등이 다시 {snap.scansPerDraw}회로 초기화</b>되고 비춘 기록은 사라집니다.
        </p>
        <div className={s.bxSheetBtns}>
          <button type="button" className={s.ghostBtn} onClick={onCancel}>취소</button>
          <button type="button" className={s.primaryBtn} disabled={snap.left <= 0 || snap.today >= snap.dailyLimit} onClick={onConfirm}>{won(snap.price)} 결제 체험</button>
        </div>
        <p className={s.bxDemo}>시연 화면 — 실제로 결제되지 않습니다</p>
      </div>
    </PresentationDialog>
  );
}

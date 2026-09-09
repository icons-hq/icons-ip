"use client";

/* 게임 관문 — 모든 게임 공통(PM 2026-09-09):
   ① 게임은 「시작」을 눌러야 돈다(오프닝 화면). ② 끝나면(죽으면) 「다시 시작」이 있는 오프닝 화면이 다시 뜬다.
   ③ 재참여 타이머 5분 — 끝난 순간부터 5분간 「다시 시작」이 잠기고 남은 시간이 보인다. 잠금은 브라우저에 남아 존을 나갔다 와도 유지된다.
   관문은 무대 **위에** 얹히는 층이다 — 게임 엔진·씬은 모른다. 급식실 시연은 관문 뒤에서 계속 돈다(오락실 샘플 게임 문법 유지). */

import { useCallback, useEffect, useState } from "react";
import s from "./GameGate.module.css";
import { GAME_LOCK_RESET_EVENT, LOCK_MS, gameLockKey, gameLockStorage, readGameLock } from "../../lib/stage/game-lock";

export { LOCK_MS, resetGameLocks } from "../../lib/stage/game-lock";

export function useGameLock(game) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const sync = () => {
      const at = Date.now();
      setUntil(readGameLock(game, at)); setNow(at);
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(GAME_LOCK_RESET_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(GAME_LOCK_RESET_EVENT, sync);
    };
  }, [game]);
  useEffect(() => {
    if (until <= Date.now()) return undefined;
    const t = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= until) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [until]);
  const lock = useCallback(() => {
    const u = Date.now() + LOCK_MS;
    setUntil(u); setNow(Date.now());
    try { gameLockStorage()?.setItem(gameLockKey(game), String(u)); } catch { /* Storage may be unavailable. */ }
  }, [game]);
  const left = Math.max(0, until - now);
  return { left, locked: left > 0, lock };
}

export const fmtLeft = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/* state: idle(시작 전) · queued(다음 회차 대기 — 급식실) · playing(관문 숨김) · over(끝남 — 다시 시작/잠금) */
export default function GameGate({ state, title, result, left, onStart }) {
  if (state === "playing") return null;
  const locked = left > 0;
  return (
    <div className={s.gate} data-state={state} role="group" aria-label={title}>
      <div className={s.card}>
        <b className={s.title}>{title}</b>
        {state === "over" && result ? <span className={s.result}>{result}</span> : null}
        {state === "queued"
          ? <span className={s.result}>다음 회차에 시작한다</span>
          : (
            <button type="button" className={s.btn} disabled={locked} onClick={onStart} data-locked={locked ? "1" : undefined}>
              {locked ? `재참여까지 ${fmtLeft(left)}` : state === "over" ? "다시 시작" : "시작"}
            </button>
          )}
      </div>
    </div>
  );
}

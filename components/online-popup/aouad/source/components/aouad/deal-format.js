"use client";

/* ── 딜 화면 공용 셈·표기·시계 ──
   존의 매대와 허브의 얼굴이 **같은 숫자를 같은 모양으로** 말해야 한다.
   각자 자기 파일에서 포맷을 다시 짜면 남은 수량이 한 화면에서 「48」, 다른 화면에서 「48개」가 된다. */

import { useEffect, useState, useSyncExternalStore } from "react";
import { MD } from "./aouad-data";

export const pad2 = (n) => String(n).padStart(2, "0");

export function fmtLeft(ms) {
  if (ms <= 0) return "00:00:00";
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hms = `${pad2(Math.floor((sec % 86400) / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`;
  return days > 0 ? `${days}일 ${hms}` : hms;
}

export const won = (n) => `${n.toLocaleString()}원`;
export const mdById = (id) => MD.find((m) => m.id === id);

export function useNow(tick = 1000) {
  const [now, setNow] = useState(Date.now);
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return undefined;
    const id = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(id);
  }, [tick, visible]);
  return now;
}

/* 화면 안에 있을 때만 참 — 얼굴 하나 때문에 14화면짜리 무대가 계속 계산될 이유가 없다.
   IntersectionObserver 가 없는 환경에서는 늘 참으로 둔다(안 도는 것보다 도는 편이 덜 나쁘다). */
export function useFaceVisible(ref, threshold = 0.25) {
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return seen;
}

/* 브라우저 설정과 페이지 상태는 외부 저장소로 읽는다. 첫 페인트부터 모션 설정을 적용하고 변경도 반영한다. */
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const serverReducedMotion = () => true;
const serverPageVisible = () => false;
function reducedMotionSnapshot() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(MOTION_QUERY).matches
    : true;
}
function subscribeReducedMotion(notify) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(MOTION_QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, serverReducedMotion);
}
function pageVisibleSnapshot() {
  return typeof document !== "undefined" && document.visibilityState !== "hidden";
}
function subscribePageVisible(notify) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}
export function usePageVisible() {
  return useSyncExternalStore(subscribePageVisible, pageVisibleSnapshot, serverPageVisible);
}

/* 화면을 떠나거나 탭이 가려지면 순환을 멈춘다. 항목 수가 바뀌면 같은 클로저와 타이머도 갱신한다. */
export function useRotator(count, ms, active) {
  const [i, setI] = useState(0);
  const visible = usePageVisible();
  useEffect(() => {
    if (!active || !visible || count < 2) return undefined;
    const id = setInterval(() => setI((x) => (x + 1) % count), ms);
    return () => clearInterval(id);
  }, [active, count, ms, visible]);
  return i < count ? i : 0;
}

"use client";

/* 공통 매장 안내도 렌더러 (평면도 4단계 공통 승격 · 계약 v2.5) — IP 무지.
   팝업은 데이터만 주입한다:
     booths[]  { id, name, x, y, w, h, state?: "locked"|"done", stateLabel?, flag? {title}, glyph? }
               // glyph = 12×12 기준 SVG 노드(팝업이 그림 · stroke/fill=currentColor)
     path      SVG path d — 추천 동선(viewBox 좌표계)
     entry     { x, y } — 입구 태그 위치(viewBox 좌표계)
     current   id — 현 위치 부스
     onJump    (id) => void
     bg?       url — 바탕 이미지(paper 스킨 전용 옵션 · 스펙 #604)
     skin?     "minimap"(기본 · 게임 미니맵 — 어두운 레이더 판·색 예산 내) | "paper"(손그림 종이 지도 — 실물 소품)
     title?    제목 띠 — 옵션(지우학은 비주입 · PM 2026-09-02 「텍스트 영역 다 빼」)
   v3.6 스트레치 레이아웃(PM 「박힌 섹션 꽉 차게」) — 부스는 좌표를 %로 환산한 HTML 층:
   판이 컨테이너 양축을 100% 채우고(레터박스 없음), 글자는 왜곡 없이 고정 타이포 토큰을 쓴다.
   동선·입구만 SVG(preserveAspectRatio="none" + non-scaling-stroke — 선은 늘어도 굵기는 유지). */
import { useState } from "react";
import s from "./PopupFloorplan.module.css";
import Image from "next/image";

export default function PopupFloorplan({ booths = [], path, entry, current, onJump, bg, skin = "minimap", viewBox = "0 0 260 132", title }) {
  const [, , VW, VH] = viewBox.split(" ").map(Number);
  const [bgOk, setBgOk] = useState(true);
  const mini = skin === "minimap";
  const useBg = !mini && bg && bgOk;
  const pct = (v, base) => `${(v / base) * 100}%`;
  return (
    <div className={`${s.frame} ${mini ? s.fMini : s.fPaper}`} role="group" aria-label="학교 안내도 · 구역을 선택해 이동">
      {title && (
        <div className={s.head} aria-hidden="true"><i /><b>{title}</b></div>
      )}
      <div className={s.plane}>
        {useBg && (
          <Image unoptimized fill sizes="(max-width: 640px) 90vw, 420px" className={s.bgImg} src={bg} alt="" onError={() => setBgOk(false)} />
        )}
        {path && (
          <svg className={s.deco} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
            <path d={path} fill="none" className={s.route} vectorEffect="non-scaling-stroke"
              strokeDasharray={mini ? "3 4" : "6 5"} strokeLinecap="round" />
          </svg>
        )}
        {booths.map((b) => {
          const here = b.id === current;
          const locked = b.state === "locked";
          return (
            <button key={b.id} type="button"
              className={`${s.booth} ${here ? s.here : ""} ${locked ? s.locked : ""} ${b.state === "done" ? s.done : ""}`}
              style={{ left: pct(b.x, VW), top: pct(b.y, VH), width: pct(b.w, VW), height: pct(b.h, VH) }}
              aria-current={here ? "location" : undefined}
              aria-label={`${b.name}${here ? " · 현 위치" : ""}${locked ? " · 잠김" : ""}${b.stateLabel ? ` · ${b.stateLabel}` : ""}${b.flag?.title ? ` · ${b.flag.title}` : ""}`}
              title={`${b.name}${b.stateLabel ? ` · ${b.stateLabel}` : ""}`}
              onKeyDown={(event) => {
                const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
                if (!direction) return;
                const cx = b.x + b.w / 2; const cy = b.y + b.h / 2;
                const options = booths.filter((candidate) => candidate.id !== b.id).map((candidate) => {
                  const dx = candidate.x + candidate.w / 2 - cx; const dy = candidate.y + candidate.h / 2 - cy;
                  const along = dx * direction[0] + dy * direction[1];
                  const across = Math.abs(dx * direction[1] - dy * direction[0]);
                  return { candidate, along, score: along + across * 2 };
                }).filter((candidate) => candidate.along > 0).sort((a, b) => a.score - b.score);
                if (options.length) {
                  const index = booths.indexOf(options[0].candidate);
                  event.currentTarget.parentElement.querySelectorAll('button')[index]?.focus();
                }
                event.preventDefault(); event.stopPropagation();
              }}
              onClick={() => onJump && onJump(b.id)}>
              {b.glyph && (
                <svg className={s.glyph} viewBox="0 0 12 12" aria-hidden="true">{b.glyph}</svg>
              )}
              <b>{b.name}</b>
              {b.stateLabel && <span>{b.stateLabel}</span>}
              {b.flag && <i className={s.flag} title={b.flag.title} />}
              {here && (
                <em className={s.hereDot} aria-hidden="true"><i className={s.pulse} /></em>
              )}
            </button>
          );
        })}
        {entry && (
          <span className={s.entry} style={{ left: pct(entry.x + 11, VW), top: pct(entry.y, VH) }} aria-hidden="true">
            입구
          </span>
        )}
      </div>
    </div>
  );
}

"use client";

/* ── 매대 화면의 얼굴 — 스틸이 아니라 매대다 ──
   PM 2026-08-31: 「래플·사전예약·선착순도 얼굴 바꿔줘」(럭키드로우 실판 교체의 연장).

   게임의 얼굴이 판이었다면, 매대의 얼굴은 **지금 팔고 있는 것과 남은 시간**이다.
   드라마 스틸은 어느 매대에 걸어도 말이 되기 때문에 아무것도 말하지 않는다 —
   래플 스틸을 선착순에 걸어도 티가 안 난다면 그 그림은 그 화면의 얼굴이 아니다.

   그래서 존이 쓰는 **같은 데이터**(`RAFFLES`·`PREORDER`·`FCFS`)를 같은 셈(`deal-format`)으로 그린다.
   상품이 바뀌면 얼굴도 바뀌고, 마감이 다가오면 얼굴의 시계도 같이 줄어든다. */

import { useMemo, useRef } from "react";
import s from "./AouadSample.module.css";
import { ASSET, FCFS, PREORDER, POPUP_PERIOD, RAFFLES } from "./aouad-data";
import { fmtLeft, mdById, useFaceVisible, useNow, usePrefersReducedMotion, useRotator, won } from "./deal-format";
import { presentationDealSummary } from "./presentation-deals";

/* 무대 시계의 기준점 — 존과 같은 문법(useDealZone 의 base)이라 두 화면의 남은 시간이 어긋나지 않는다 */
function useDealClock(active, clockStartedAt) {
  const now = useNow(active ? 1000 : 60000);
  return { base: clockStartedAt ?? now, now };
}

/* ── 래플 — 매물 셋이 차례로 선다. 응모는 마감이 전부라 시계가 가장 크다 ── */
export function RaffleFace({ state }) {
  const ref = useRef(null);
  const seen = useFaceVisible(ref);
  const reduced = usePrefersReducedMotion();
  const { base, now } = useDealClock(seen, state.clockStartedAt);
  const i = useRotator(RAFFLES.length, 5200, seen && !reduced);
  const r = RAFFLES[i];
  const md = mdById(r.mdId);
  const { entrants } = presentationDealSummary(state, { kind: "raffle", referenceId: r.id });

  return (
    <div className={`${s.dealFace} ${s.dfRaffle}`} ref={ref} role="img"
      aria-label={`래플 — ${md.name} · ${r.edition} · ${entrants.toLocaleString()}명 응모`}>
      <div className={s.dfPhoto} style={{ backgroundImage: `url(${ASSET(md.src)})` }}>
        <span className={s.dfClock}>
          <b>{fmtLeft(base + r.closeIn - now)}</b>
          <em>응모 마감까지</em>
        </span>
        <div className={s.dfCaption}>
          <span className={s.dfSrc}>지금 우리 학교는</span>
          <b>{md.name}</b>
          <em>{r.edition}</em>
        </div>
      </div>
      {/* 매물 레일 — 지금 선 것이 셋 중 하나라는 사실 자체가 정보다 */}
      <div className={s.dfRail}>
        {RAFFLES.map((x, k) => {
          const m = mdById(x.mdId);
          return (
            <span key={x.id} className={`${s.dfRailItem} ${k === i ? s.on : ""}`}>
              <i style={{ backgroundImage: `url(${ASSET(m.src)})` }} />
              {/* 칩은 「무엇」을 말한다 — 응모 수가 아니라 상품명(PM 2026-09-08 「파사드 칩에 상품명이 아니라 명수가 들어간 오류」). 수는 얼굴 aria-label 이 갖는다 */}
              <b>{m.name}</b>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ── 사전예약 — 매물 하나. 움직이는 건 마감과 팝업 기간 안에서의 지금 자리다 ── */
export function PreorderFace({ state }) {
  const ref = useRef(null);
  const seen = useFaceVisible(ref);
  const { base, now } = useDealClock(seen, state.clockStartedAt);
  const md = mdById(PREORDER.mdId);
  const { reservations } = presentationDealSummary(state, { kind: "preorder", productId: md.id });

  /* 팝업 기간 위의 지금 — 사전예약은 「언제까지」가 상품 설명의 절반이다 */
  const pct = useMemo(() => {
    const open = new Date(`${POPUP_PERIOD.open}T00:00:00`).getTime();
    const close = new Date(`${POPUP_PERIOD.close}T23:59:59`).getTime();
    return Math.max(0, Math.min(100, ((now - open) / (close - open)) * 100));
  }, [now]);

  return (
    <div className={`${s.dealFace} ${s.dfPre}`} ref={ref} role="img"
      aria-label={`사전예약 — ${md.name} · ${reservations.toLocaleString()}명 예약`}>
      <div className={s.dfPhoto} style={{ backgroundImage: `url(${ASSET(md.src)})` }}>
        <span className={s.dfClock}>
          <b>{fmtLeft(base + PREORDER.closeIn - now)}</b>
          <em>예약 마감까지</em>
        </span>
        <div className={s.dfCaption}>
          <span className={s.dfSrc}>PRE-ORDER · {won(md.price)}</span>
          <b>{md.name}</b>
          <em>특전 · {PREORDER.perk}</em>
        </div>
      </div>
      <div className={s.dfMeter}>
        <span className={s.dfMeterHead}><b>{reservations.toLocaleString()}</b>명 예약</span>
        <span className={s.dfMeterTrack}><i style={{ width: `${pct}%` }} /></span>
        <span className={s.dfMeterFoot}>{POPUP_PERIOD.label}</span>
      </div>
    </div>
  );
}

/* ── 선착순 — 매대가 여덟. 남은 수량과 시계가 매대마다 따로 돈다 ── */
export function FcfsFace({ state }) {
  const ref = useRef(null);
  const seen = useFaceVisible(ref);
  const { base, now } = useDealClock(seen, state.clockStartedAt);

  /* 가장 먼저 끝나는 매대 — 선착순에서 「어디부터 봐야 하나」는 이 하나로 결정된다 */
  const urgent = useMemo(() => {
    const live = FCFS.filter((f) => f.state === "open");
    return (live.length ? live : FCFS).reduce((a, b) => (a.at <= b.at ? a : b));
  }, []);

  return (
    <div className={`${s.dealFace} ${s.dfFcfs}`} ref={ref} role="img"
      aria-label={`선착순 매대 ${FCFS.length}개 — 가장 먼저 마감하는 것은 ${mdById(urgent.mdId).name}`}>
      <div className={s.dfGrid}>
        {FCFS.map((f) => {
          const m = mdById(f.mdId);
          const soon = f.state === "soon";
          const { stock } = presentationDealSummary(state, { kind: "fcfs", productId: f.mdId });
          const pct = Math.round((stock / f.total) * 100);
          return (
            <div key={f.mdId} className={`${s.dfCell} ${soon ? s.soon : ""} ${f === urgent ? s.on : ""}`}>
              <span className={s.dfCellPh} style={{ backgroundImage: `url(${ASSET(m.src)})` }}>
                {/* 「43%」는 무엇의 43%인지 안 말한다 — 선착순에서 읽어야 하는 수는 남은 개수다 */}
                <i className={s.dfCellTag}>{soon ? "오픈 예정" : `잔여 ${stock}`}</i>
              </span>
              {/* 막대는 비율을 맡는다 — 숫자만으로는 「잔여 37」이 많은지 적은지 알 수 없다 */}
              <span className={s.dfCellBar}><i style={{ width: soon ? "100%" : `${pct}%` }} /></span>
            </div>
          );
        })}
      </div>
      <div className={s.dfMeter}>
        <span className={s.dfMeterHead}>다음 마감 · {mdById(urgent.mdId).name}</span>
        <b className={s.dfMeterClock}>{fmtLeft(base + urgent.at - now)}</b>
      </div>
    </div>
  );
}

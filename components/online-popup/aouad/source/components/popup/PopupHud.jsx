"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import s from "./PopupHud.module.css";
import Image from "next/image";

/* ── 팝업 HUD 공통 컴포넌트 ──
   계약 정본: 40_dev/snapshots/ICONS-팝업-HUD-공통계약-v1-2026-08-28.md
   HUD 는 IP 를 모른다 — 전부 props 로 주입받는다(§3 데이터 주입 인터페이스).
   개별 팝업은 어댑터에서 자기 데이터를 이 모양으로 빚어 넘긴다.

   한계값(계약 §4): 탭 ≤7 · 장 ≤8(격자 2×4) · 2차 화면 레일은 스크롤 지원.
   초과가 필요해지면 코드를 늘리지 말고 계약부터 고친다. */
export default function PopupHud({
  identity,        // { name, photo, seal?: { label, on }, onClick, title, stamps?: { label, on, total } } — seal 미제공이면 요소를 안 그린다(v4.3 · 인장 폐지 대비)
                   // stamps = 카드가 소유한 도장 진행의 모바일 요약(카드 폴백 버튼에 미니 점 렌더 — P3)
  identityCard,    // ReactNode — 실물 신분 카드 디자인(있으면 요약 버튼 대신 카드가 선다). 계약 §3
  gauges = [],     // [{ label, value, max, tone? }]
  stats = [],      // [{ label, value, accent? }]
  me = [],         // v6.0 「나」 패널 탭 — [{ key, label, kind?, rows?|spend?, empty?, segments?, gain? }] (구 fixed[]). 상시 정보(퀘스트·보유·장바구니)는
                   //   컨텍스트가 아니라 **나 패널(게임 메뉴 모달)** 에 산다. 모달 자체는 팝업이 그린다(HudBody 를 가져다 쓴다) —
                   //   HUD 공통은 이 배열을 **배지·맥동(계약 §2-4)에만** 쓴다. 컨텍스트 본문으로는 오지 않는다(계약 §1-3 · §3)
                   // kind "brief"(v3.8·v4.4) = brief{ title, period, dday?, phases[{label,on,done}], go? } 블록(go 있으면 블록 전체가 문) + rows
                   // kind "cart"(v4.0) = rows[{id,name,sub,thumb,qty,max,onQty,right?,go}] + cart{ count, total, cta, onCheckout } 하단 고정 바
                   // scroll: true (v4.9) — 이 본문은 장 넘김 대신 **내부 스크롤**. 커머스 목록(장바구니·찜)의 문법:
                   //   수량을 바꾸는 자리에서 장이 넘어가면 안 되고, 담은 것을 죽 훑는 게 일반 커머스에서 몸에 익은 동작이다
                   // v3.1 패널 3법: 모든 행은 문(go 있으면 행 전체 클릭) · 이미지 우선(thumb) · 성격 분화는 세그먼트
                   // intro (v5.0) = { text, go?: {label, act} } — 지금 화면이 무엇인지 말하는 소개글 + 상세로 가는 문 하나.
                   //   메인페이지 섹션의 가변 컨텍스트는 전부 이 모양이다(§2-9). 상세가 없으면 go 를 안 주면 되고, 그러면 버튼도 없다.
                   //   kind 와 무관하게 붙는다 — 교문은 개요 블록(brief) 아래에 소개글이 함께 선다
  alert,           // v5.7 상시 알림 — { count, label, act }. **새 것이 있을 때만** 레일에 선다.
                   // 고정 버튼(내 소유물)도 가변(지금 화면)도 아닌 세 번째 축 = 「팝업이 나에게 알리는 것」.
                   // 상시 자리를 주지 않고 알림만 둔다 — 새 것이 없으면 아예 없다(계약 §2-10)
  context,         // v4.5 가변형 컨텍스트 — 지금 화면(장·페이지·존·모달)이 정하는 본문. 자동만 있고 사람이 고를 수 없다
                   // { key, label, kind, rows|spend|brief|intro, segments?, empty, open?, seg? } — v6.0 PR ③부터 fixed 지정 없음
                   // open: true — 사람이 무대에서 고른 컨텍스트(교문 타임라인 항목 등). 모바일은 시트를 자동으로 열어 그 내용을 보인다(v5.14)
                   // key = 화면 식별자(바뀌면 장·세그 상태 리셋 · 알약 회전) · label = 「화면 · 내용」 칩 문구
  nav,             // { chapters: [..], sceneCountOf: [..], subScenes: [{ gi, t }], section, scene }
  onSection, onSceneJump, onReset,
  floorplan,       // ReactNode — 있으면 지도가 존 열의 유일 표면(v2.8 A안 · 데스크톱, 밴드 내 상시 고정판 — v3.6 호버 확대 폐지). 없으면 격자 폴백
  floorplanSheet,  // ReactNode? — 모바일 이동 팝오버 판(세로형 · v5.14 부활: 이동 원 바로 위에 뜨는 미니맵). 데스크톱은 상시판(floorplan) 하나뿐이다
  active = true,   // 허브 밖(존·상세)에서는 키보드 개입 금지
  immersive = false, // v5.18 몰입 화면 선언(§1-2 부활) — 모바일 시트를 내려 무대에 전부 준다. 알약은 남아 누르면 올릴 수 있고, 나가면 시트가 돌아온다
}) {
  // ── 컨텍스트 = 지금 화면의 것만(v6.0 · PM 2026-09-09 「상시적으로 봐야 하는 정보는 나 패널로」).
  //    v4.5 의 「한 패널, 두 개념」(가변 + 고정 3)은 폐지 — 고정형은 나 패널(게임 메뉴 모달)로 갔다.
  //    `ctx.fixed` 폴백도 PR ③에서 사라졌다 — 컨텍스트는 언제나 화면이 만든 본문이다 ──
  const ctx = context || { key: "none", label: "", kind: "list", rows: [], empty: "" };
  const [flashId] = useState(null);   // 컨텍스트 본문의 새 행 플래시 — v6.0 이후 나 패널 몫(HudBody prop 은 유지)
  const hudId = useId();
  const zoneButtonRef = useRef(null);
  const mapDialogRef = useRef(null);

  // ── 세그먼트(v3.1) — 본문 안의 축 전환 ──
  const [segSel, setSegSel] = useState(() => ctx.seg ? { [ctx.key]: ctx.seg } : {});
  /* ctx.seg = 컨텍스트가 **처음 고를 세그먼트**(2026-09-09 · 도서관 존이 게임 위 버튼으로 「하는 법·구매권·미션」 중 하나를
     고른 채 패널을 연다). 문법 추가만 — 없으면 예전대로 첫 세그먼트. 사람이 칩을 누르면 그 뒤로는 사람 선택이 이긴다 */
  const [segmentContext, setSegmentContext] = useState({ key: ctx.key, seg: ctx.seg });
  if (segmentContext.key !== ctx.key || segmentContext.seg !== ctx.seg) {
    setSegmentContext({ key: ctx.key, seg: ctx.seg });
    setSegSel(ctx.seg ? { [ctx.key]: ctx.seg } : {});
  }

  // ── 모바일 원형 HUD(v4.6 원 3 → v5.11 알약 → v5.14 위성 폐지 · PM 「서브 버블 위치 — 이동은 미니맵이 이동 버블 바로 위 · 컨텍스트는 모달」) —
  //    알약을 누르면 **시트(모달)가 바로** 열리고 고정 항목은 시트 머리의 칩 줄(데스크톱 레일과 같은 것)로 고른다.
  //    이동 원을 누르면 **미니맵 팝오버**가 원 바로 위에 뜬다(데스크톱 지도판과 같은 표면). 위성 원은 없다.
  //    한 번에 하나만 열림 · 화면(장·페이지·존)이 바뀌면 닫힘 — 단 사람이 무대에서 고른 컨텍스트(ctx.open)는 시트를 연다. 데스크톱에선 CSS로 소멸 ──
  const [orb, setOrb] = useState(null);     // 펼친 팝오버: "zone"
  // 모바일 안내는 접힌 상태로 시작하고 알약을 누르면 펼친다. 상품과 체험이 첫 화면을 소유한다.
  // 화면이 바뀌어도 사람이 둔 상태를 지킨다. 무대에서 고른 컨텍스트(ctx.open)만 닫혀 있어도 연다. 스크림은 없다 — 시트가 떠 있어도 무대는 그대로 눌린다.
  const [sheet, setSheet] = useState(null);
  // 이동 팝오버는 화면이 바뀌면 닫힌다 — 단 **부스를 눌러 2차 화면이 있는 장으로 갔을 때는 남는다**(v6.1 · PM 「체험존을 열고 급식실·도서관을 열려면
  // 이동을 두 번 눌러야 해」). 그 장의 칩 줄이 팝오버 안 지도 아래에 뜨고, 칩을 누르면 그때 닫힌다. 2차 화면이 없는 장(교문·옥상)은 바로 닫힌다.
  // 부스 탭 → 목적지 장의 칩을 **탭 직후 첫 장 변화에서 스냅**해 둔다(popChips). 이동 중 무대 스크롤 동기가 HUD 를 경유 장으로 되돌리는
  // 결함(장면 트랙 FIX-STAGE-HUD-JUMP-SYNC-FLICKER)이 있어 nav.subScenes 를 그대로 그리면 칩이 교문→굿즈존→체험존으로 흔들리고 팝오버가 닫힌다.
  // 스냅은 점프 창(2.5s) 동안 유지 · 칩 탭·팝오버 여닫음에 지운다
  const prevSection = useRef(nav && nav.section);
  const popTap = useRef({ at: 0, done: true });
  const [popChips, setPopChips] = useState(null);   // { section, subs }
  const section = nav && nav.section;
  const subScenes = nav && nav.subScenes;
  const syncNavigation = useEffectEvent(() => {
    const sectionChanged = prevSection.current !== section;
    prevSection.current = section;
    const jumping = Date.now() - popTap.current.at < 2500;
    if (sectionChanged && jumping && !popTap.current.done) {
      popTap.current.done = true;
      if (subScenes && subScenes.length > 1) setPopChips({ section, subs: subScenes });
      else { setPopChips(null); setOrb(null); }
    } else if (!(jumping && popTap.current.done && popTap.current.at)) {
      setOrb(null);
    }
  });
  // A committed scroll/navigation change completes the earlier map click. Read the latest scene list
  // without subscribing to its array identity, which changes while scene timers tick.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the external scroll adapter's committed destination with its open map popover
  useEffect(() => { syncNavigation(); }, [section, ctx.key, ctx.open]);
  const openZone = (on, restoreFocus = false) => {
    setOrb(on ? "zone" : null); setPopChips(null); popTap.current = { at: 0, done: true };
    if (!on && restoreFocus) zoneButtonRef.current?.focus();
  };
  const sheetOn = sheet === "ctx" && orb !== "zone";   // 미니맵이 뜬 동안만 잠시 내린다(상태는 유지)
  const [openedContext, setOpenedContext] = useState({ key: ctx.key, open: ctx.open });
  if (openedContext.key !== ctx.key || openedContext.open !== ctx.open) {
    setOpenedContext({ key: ctx.key, open: ctx.open });
    if (ctx.open) setSheet("ctx");
  }
  // 몰입 화면 전환 시 안내를 접는다. 사용자가 안내 버튼을 누르면 언제든 열 수 있다.
  const [wasImmersive, setWasImmersive] = useState(immersive);
  if (wasImmersive !== immersive) {
    setWasImmersive(immersive);
    setSheet(null);
    setOrb(null);
  }
  const gainCount = me.reduce((n, f) => {
    const bodies = f.segments || [f];
    return n + bodies.reduce((m, g) => m + ((g.gain || f.gain) && g.rows ? g.rows.length : 0), 0);
  }, 0);

  // ── 모바일 알약(v5.11 「알약 형태로 · 이동 시 회전하면서 제목이 나오게」 → v5.12 「가방·새 획득·퀘스트·지금 다 빼」 → v5.13 「아이콘도 빼」) ──
  //    알약 = **화면 제목 한 줄**(가변 컨텍스트 라벨 「교문」 · 자에서 고른 항목이면 「교문 · 럭키드로우 ②」) + 획득 배지. 그뿐이다 — 수는 배지와 위성이 이미 말한다.
  //    화면이 바뀌면(ctx.label) 알약이 가로축으로 한 번 구르며 새 제목이 나온다 — 앞면이 사라지는 90° 에서 글자를 바꾼다.
  // The label is current immediately. A keyed text reveal avoids timer races during rapid navigation.
  const pillTitle = ctx.label;
  // 위성 배치 — 클러스터 중심(가운데 원) 기준 위쪽 호. 반지름·각도는 실측 교정 대상

  // ── 카드 자동 맞춤(v2.2 카드 온리): 슬롯 크기에 맞는 최대 축척 — dvh 가 바뀌어도 카드는 항상 온전하다 ──
  const slotRef = useRef(null);
  useEffect(() => {
    const el = slotRef.current;
    if (!el || !identityCard) return;
    const child = el.firstElementChild;
    if (!child) return;
    const fit = () => {
      const sc = Math.min(el.clientHeight / child.offsetHeight, el.clientWidth / child.offsetWidth, 1);
      if (sc > 0) el.style.setProperty("--cardScale", String(sc));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el); ro.observe(child);
    return () => ro.disconnect();
  }, [identityCard]);



  // ── 획득·담기 순간(계약 §2-4 · v6.0): gain 본문의 행 수(수량 합)가 늘면 **나 원/카드 배지 + 맥동 1회**. 패널을 열지 않는다(모달 강제 없음).
  //    새 행 플래시는 나 패널이 열려 있을 때 그 탭에서(어댑터 몫) — 컨텍스트에는 탭 본문이 오지 않는다(PR ③) ──
  const [mePulse, setMePulse] = useState(false);
  const prevGainCounts = useRef({});
  useEffect(() => {
    me.forEach((f) => {
      const bodies = f.segments ? f.segments.map((g) => ({ g, seg: g.key })) : [{ g: f, seg: null }];
      bodies.forEach(({ g, seg }) => {
        if (!(g.gain || f.gain) || !g.rows) return;
        const key = `${f.key}:${seg || ""}`;
        const ids = g.rows.map((r) => r.id);
        const prev = prevGainCounts.current[key];
        const qty = g.rows.reduce((n, r) => n + (r.qty || 1), 0);
        if (prev && qty > prev.qty) {
          setMePulse(true); setTimeout(() => setMePulse(false), 1000);
        }
        prevGainCounts.current[key] = { ids, qty };
      });
    });
  }, [me]);

  // ── 값 변화 칩 튐 ──
  const [bumped, setBumped] = useState(null);
  const prevStats = useRef(null);
  useEffect(() => {
    const vals = stats.map((x) => String(x.value));
    if (prevStats.current) {
      const i = vals.findIndex((v, k) => v !== prevStats.current[k]);
      if (i >= 0) { setBumped(i); const t = setTimeout(() => setBumped(null), 350); prevStats.current = vals; return () => clearTimeout(t); }
    }
    prevStats.current = vals;
  }, [stats]);

  // ── 키보드(계약 §2-5 · v6.0): ←→ 화면. 고정 버튼 숫자 토글·Esc 가변 복귀는 고정형과 함께 폐지 ──
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (t?.closest?.('input, textarea, select, button, a, [role="dialog"], [role="button"], [role="tab"], [contenteditable="true"]')) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); onSceneJump(Math.max(0, nav.scene - 1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); onSceneJump(Math.min((nav.sceneCount ?? 1) - 1, nav.scene + 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, nav, onSceneJump]);

  const cur = ctx;
  const seg = cur.segments ? (cur.segments.find((g) => g.key === segSel[cur.key]) || cur.segments[0]) : null;
  const body = seg || cur;

  // ── 페이지 문법(v3.2) — 고정 밴드 안에서 목록은 스크롤이 아니라 장을 넘긴다.
  //    한 장 수량은 하드코딩이 아니라 실측: 뷰포트와 첫 행 크기로 열×행을 계산한다(dvh·폭·행 종류 자동 추종) ──
  const scrolled = !!body.scroll && !!body.rows && body.rows.length > 0;   // v4.9 커머스 목록 = 내부 스크롤
  const paged = !scrolled && (body.kind === "list" || body.kind === "quest" || body.kind === "brief" || body.kind === "cart") && body.rows && body.rows.length > 0;
  // 장 넘김 상태(page·perPage)는 HudBody 안으로 갔다(v6.0) — 부모는 시트 높이 판정에 쓰는 paged 만 안다
  const bodyKey = `${ctx.key}:${seg ? seg.key : ""}`;   // 본문 정체 — 장 상태 리셋·시트 높이 전환 키

  // ── 모바일 시트 높이 = 유동(v5.15 · PM 「유동으로 바꿔 상한 50%」) — 내용만큼, 화면 세로의 50% 까지.
  //    장 넘김 본문(pgView)은 자기 높이로 행 수를 재므로 내용 높이가 없다 → 상한을 그대로 준다(그 안에서 장을 나눈다).
  //    항목이 바뀌면(타임라인 ②→③ · 퀘스트→장바구니) 이전 높이에서 새 높이로 0.25s 전환. 데스크톱은 인라인 높이를 지운다 ──
  const midRef = useRef(null);
  const [narrow, setNarrow] = useState(false);       // 640px 경계를 넘나들면 인라인 높이를 다시 판정(데스크톱은 지운다)
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mql = matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mql.matches);
    on(); mql.addEventListener("change", on); window.addEventListener("resize", on);   // resize 도 듣는다 — 에뮬레이션·회전에서 change 가 안 오는 경우
    return () => { mql.removeEventListener("change", on); window.removeEventListener("resize", on); };
  }, []);
  useEffect(() => {
    if (!narrow || orb !== "zone") return;
    const frame = requestAnimationFrame(() => {
      const dialog = mapDialogRef.current;
      (dialog?.querySelector('[aria-current="location"]') || dialog?.querySelector('button'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [narrow, orb]);
  const onMapKeyDown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); openZone(false, true); return; }
    if (event.key !== "Tab") return;
    const buttons = [...event.currentTarget.querySelectorAll('button:not([disabled]), [href], [tabindex="0"]')];
    const first = buttons[0]; const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const rowCount = body.rows?.length;
  useLayoutEffect(() => {
    const el = midRef.current;
    if (!el) return;
    const scope = el.closest("[data-aouad-experience]") || el.parentElement;
    if (!narrow) { el.style.height = ""; el.style.transitionProperty = ""; scope.style.setProperty("--hud-sheet", "0px"); return; }
    const prev = el.style.height;
    el.style.height = "auto";
    const auto = el.offsetHeight;
    const cap = Math.round(window.innerHeight * 0.5);
    // 무대에 시트 몫을 알린다 — 모바일 .stage 가 --hud 로 받아 하단 여백·토스트가 시트 위로 올라온다(v5.17). 닫히면 0
    const tell = (h) => scope.style.setProperty("--hud-sheet", sheetOn ? `${h}px` : "0px");
    if (paged) {
      // 장 넘김 본문은 자기 높이로 행 수를 재므로 전환 중간값에 재면 장이 잘게 쪼개진다 → 상한으로 **즉시** 간다
      el.style.transitionProperty = "transform";
      el.style.height = `${cap}px`;
      void el.offsetHeight;
      el.style.transitionProperty = "";
      tell(cap);
      return;
    }
    const target = Math.min(auto, cap);
    el.style.height = prev || `${target}px`;
    void el.offsetHeight;                              // 이전 값으로 한 번 그린 뒤 전환이 걸린다
    el.style.height = `${target}px`;
    tell(target);
  }, [narrow, bodyKey, paged, sheetOn, rowCount]);

  return (
    <nav className={`${s.hud} ${sheetOn ? s.sheetCtx : ""}`} aria-label="효산고 탐험 안내">
      {/* 0 — 모바일 원형 HUD(v4.6): 하단 중앙 원 3(나=학생증 · 컨텍스트 · 존) → 위성 원(항목) → 시트(세부). 스크림 */}
      <div className={s.caps}>
        {orb && <button type="button" className={s.scrim} tabIndex={-1} aria-label="학교 안내도 닫기" onClick={() => openZone(false, true)} />}   {/* 스크림은 미니맵에만 — 시트는 무대를 막지 않는다(v5.17) */}
        <div className={s.orbs}>
          <div className={s.orbRow}>
            {orb === "zone" && (floorplanSheet || floorplan) && (
              /* 이동 팝오버(v5.14) — 미니맵이 이동 원 바로 위에 뜬다. 원 줄 안에 두어 오른쪽 끝 = 이동 원 오른쪽 끝(컨테이너 사정과 무관).
                 부스 = 장 · 누르면 이동한다. 그 장에 2차 화면이 있으면 팝오버가 남아 칩 줄이 바뀌고(v6.1), 없으면 닫힌다 */
              <div ref={mapDialogRef} id={`${hudId}-map`} className={s.navPop} role="dialog" aria-modal="true" aria-label="학교 안내도" onKeyDown={onMapKeyDown}>
                <div className={s.navPopHead}><b>학교 안내도</b><button type="button" onClick={() => openZone(false, true)} aria-label="학교 안내도 닫기">×</button></div>
                <div className={s.popMap} onClickCapture={() => { popTap.current = { at: Date.now(), done: false }; }}>{floorplanSheet || floorplan}</div>
                {(popChips ? popChips.subs : nav.subScenes).length > 1 && (
                  /* 지금 장의 2차 화면 칩 한 줄 — 지도 아래(데스크톱 2차 칩과 동일 위계 · v6.1: 부스를 눌러 장이 바뀌면 그 장의 칩으로 바뀐다) */
                  <div className={s.navSub} role="group" aria-label="이 장의 화면">
                    {(popChips ? popChips.subs : nav.subScenes).map((x) => {
                      const on = x.gi === nav.scene && (!popChips || popChips.section === nav.section);
                      return (
                        <button key={x.gi} type="button" aria-pressed={on}
                          className={`${s.subBtn} ${on ? s.subOn : ""}`}
                          onClick={() => { onSceneJump(x.gi); openZone(false); }}>{x.t}</button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {/* 학생증 원 = 나 패널(게임 메뉴)의 문(v6.0). 새 획득 배지·맥동이 여기 선다 — 알약은 화면 제목만 */}
            <button type="button" className={`${s.orb} ${mePulse ? s.orbPulse : ""}`} onClick={identity.onClick} title={identity.title} aria-haspopup="dialog" aria-label={`학생증 · ${identity.name || "내 기록"}${gainCount > 0 ? ` · 보유 ${gainCount}건` : ""}`}>
              <span className={s.idPhoto} style={identity.photo ? { backgroundImage: `url(${identity.photo})` } : undefined} />
              {gainCount > 0 ? <em>{gainCount}</em> : identity.stamps && <em>{identity.stamps.on}/{identity.stamps.total}</em>}
            </button>
            {/* 알약(v5.11~v5.13) — 화면 제목 한 줄. 열린 항목의 이름은 여기 오지 않는다(시트 머리가 말한다) */}
            <button type="button"
              className={`${s.orb} ${s.pill} ${sheetOn ? s.orbOn : ""}`}
              onClick={() => { setOrb(null); setSheet(sheetOn ? null : "ctx"); }} aria-expanded={sheetOn} aria-controls={`${hudId}-context`} aria-label={`${ctx.label} 안내 ${sheetOn ? "접기" : "펼치기"}`}>
              <span className={s.pillNow}><span key={pillTitle} className={s.pillL1}>{pillTitle}</span></span>
            </button>
            {/* 이동 원(v5.13 → v5.20 · PM 「'이동'이라는 텍스트만 잘 보이게」) — 글자 「이동」 하나. 현 위치는 미니맵이 말한다 */}
            <button ref={zoneButtonRef} type="button" className={`${s.orb} ${orb === "zone" ? s.orbOn : ""}`}
              onClick={() => openZone(orb !== "zone")} aria-expanded={orb === "zone"} aria-haspopup="dialog" aria-controls={`${hudId}-map`} aria-label={`학교 안내도 ${orb === "zone" ? "닫기" : "열기"} · 현 위치 ${nav.chapters[nav.section] || ""}`}>
              <b>이동</b>
            </button>
          </div>
        </div>
      </div>

      {/* 1 — 나. 실물 카드가 주입되면 카드가 얼굴이 된다(옥상에서 이사 — PM 2026-08-28) */}
      <div className={s.me}>
        {identityCard ? (
          <>
            {/* 데스크톱 = 실물 카드 · 모바일 = 요약 버튼(CSS 전환) — 40dvh 에서 실물 카드는 목록 행을 잡아먹는다 */}
            <div ref={slotRef} className={`${s.cardSlot} ${mePulse ? s.mePulse : ""}`} role="button" tabIndex={0} title={identity.title} aria-label={`학생증 · ${identity.name || "내 기록"} 열기`} aria-haspopup="dialog"
              onClick={identity.onClick}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); identity.onClick(); } }}>
              {identityCard}
              {gainCount > 0 && <em className={s.meBadge} aria-label={`새 획득 ${gainCount}`}>{gainCount}</em>}
            </div>
            <button type="button" className={s.identityLabel} onClick={identity.onClick} aria-haspopup="dialog">
              <b>{identity.name || "내 학생증"}</b><span>학생증 · 내 기록</span><em aria-hidden="true">열어보기 ↗</em>
            </button>
            <button type="button" className={`${s.id} ${s.idFallback}`} onClick={identity.onClick} title={identity.title}>
              <span className={s.idPhoto} style={identity.photo ? { backgroundImage: `url(${identity.photo})` } : undefined} />
              <b>{identity.name}</b>
              {identity.seal && (
                <em className={`${s.seal} ${identity.seal.on ? s.sealOn : ""}`}>{identity.seal.label}</em>
              )}
              {identity.stamps && (
                <span className={s.fbStamps} aria-label={`${identity.stamps.label} ${identity.stamps.on} / ${identity.stamps.total}`}>
                  {Array.from({ length: identity.stamps.total }, (_, i) => (
                    <i key={i} className={i < identity.stamps.on ? s.fbDotOn : s.fbDot} />
                  ))}
                </span>
              )}
            </button>
          </>
        ) : (
        <button type="button" className={s.id} onClick={identity.onClick} title={identity.title}>
          <span className={s.idPhoto} style={identity.photo ? { backgroundImage: `url(${identity.photo})` } : undefined} />
          <b>{identity.name}</b>
          {identity.seal && (
            <em className={`${s.seal} ${identity.seal.on ? s.sealOn : ""}`}>{identity.seal.label}</em>
          )}
        </button>
        )}
        {(gauges.length > 0 || stats.length > 0) && (
        <div className={s.statsCol}>
          {gauges.map((g) => (
            <span key={g.label} className={s.gauge} aria-label={`${g.label} ${g.value} / ${g.max}`}>
              <i>{g.label}</i>
              <span className={`${s.pips} ${g.tone === "alt" ? s.pipsAlt : ""}`}>
                {Array.from({ length: g.max }, (_, i) => <i key={i} className={i < g.value ? s.on : ""} />)}
              </span>
              <b>{g.value}/{g.max}</b>
            </span>
          ))}
          <span className={s.statLine}>
            {stats.map((x, i) => (
              <span key={x.label} className={`${s.stat} ${bumped === i ? s.bump : ""}`}>
                <i>{x.label}</i><b className={x.accent ? s.accent : ""}>{x.value}</b>
              </span>
            ))}
          </span>
        </div>
        )}
      </div>

      {/* 2 — 내 기록 */}
      <div className={s.mid} ref={midRef} id={`${hudId}-context`} inert={narrow && !sheetOn ? true : undefined} aria-hidden={narrow && !sheetOn ? true : undefined}>
        {/* 레일(v6.0) — 지금 화면 칩 + 알림 + 되돌리기. 고정 버튼은 나 패널로 갔다 */}
        <div className={s.tabs} role="group" aria-label="현재 화면 안내">
          <span className={`${s.ctxChip} ${s.ctxOn}`} title="지금 화면의 컨텍스트">
            <i aria-hidden="true" /><b className={s.chipCtx}>{ctx.label}</b>
          </span>
          {alert && alert.count > 0 && (
            <button type="button" className={s.alertBtn} onClick={alert.act}
              aria-label={`${alert.label} ${alert.count}건 — 보러 가기`} title={`${alert.label} ${alert.count}건`}>
              <i aria-hidden="true" /><em>{alert.count}</em>
            </button>
          )}
          <button type="button" className={s.reset} onClick={onReset} title="처음부터 다시 시작" aria-label="시연 진행 초기화">↺</button>
        </div>

        <HudBody cur={cur} seg={seg} onSeg={(k) => setSegSel((v) => ({ ...v, [cur.key]: k }))} bodyKey={bodyKey} flashId={flashId} />
      </div>

      {/* 4 — 존(v3.7 개명 · 구 「이동」): 지도가 유일 표면(데스크톱 · A안) — 격자는 지도 미주입 팝업의 폴백과 모바일 레일.
          텍스트 크롬 없음(PM 2026-09-02 「라벨·제목·범례 다 빼」) — 지도 판 하나가 열 전부다.
          2차(이 장의 화면) 칩은 지도 아래 상시 1줄 */}
      <div className={s.navCol}>
        {floorplan && <div className={s.navMap}>{floorplan}</div>}
        <div className={`${s.gridWrap} ${floorplan ? s.gridOff : ""}`}>
          <div className={s.grid} role="group" aria-label="학교 구역">
            {nav.chapters.map((name, i) => (
              <button key={name} type="button" aria-pressed={i === nav.section}
                className={`${s.navBtn} ${i === nav.section ? s.navOn : ""}`} onClick={() => onSection(i)}>
                {name}{nav.sceneCountOf[i] > 1 && <em>{nav.sceneCountOf[i]}</em>}
              </button>
            ))}
          </div>
        </div>
        {nav.subScenes.length > 1 && (
          <div className={s.sub} role="group" aria-label="이 장의 화면">
            {nav.subScenes.map((x) => (
              <button key={x.gi} type="button" aria-pressed={x.gi === nav.scene}
                className={`${s.subBtn} ${x.gi === nav.scene ? s.subOn : ""}`}
                onClick={() => onSceneJump(x.gi)}>{x.t}</button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

/* ── 본문 렌더러(v6.0) — 컨텍스트 열과 팝업의 「나」 패널(게임 메뉴 모달)이 같은 것을 쓴다.
   cur = 탭/컨텍스트 객체 · seg = 고른 세그먼트(없으면 null) · onSeg = 세그먼트 고름 · bodyKey = 장 상태 리셋 키 · flashId = 새 행 플래시.
   세그 줄·장 넘김·소개·개요·스크롤 목록·누적 단계·장바구니 바 전부 여기 ── */
export function HudBody({ cur, seg, onSeg, bodyKey, flashId }) {
  const body = seg || cur;
  const scrolled = !!body.scroll && !!body.rows && body.rows.length > 0;   // v4.9 커머스 목록 = 내부 스크롤
  const paged = !scrolled && (body.kind === "list" || body.kind === "quest" || body.kind === "brief" || body.kind === "cart") && body.rows && body.rows.length > 0;
  const pgViewRef = useRef(null);
  const [pageState, setPageState] = useState({ key: bodyKey, value: 0 });
  const page = pageState.key === bodyKey ? pageState.value : 0;
  const setPage = (value) => setPageState({ key: bodyKey, value });
  const [perPage, setPerPage] = useState(8);
  useEffect(() => {
    const el = pgViewRef.current;
    if (!el) return undefined;
    const measure = () => {
      const first = el.querySelector("[data-pgitem]");
      if (!first) return;
      const grid = el.querySelector(`.${s.pgPage}`);
      const gap = grid ? parseFloat(getComputedStyle(grid).rowGap) || 0 : 0;
      const columnGap = grid ? parseFloat(getComputedStyle(grid).columnGap) || 0 : 0;
      const cols = Math.max(1, Math.round((el.clientWidth + columnGap) / (first.offsetWidth + columnGap)));
      const rows = Math.max(1, Math.floor((el.clientHeight + gap) / (first.offsetHeight + gap)));
      setPerPage((v) => (v === cols * rows ? v : cols * rows));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bodyKey, paged]);
  const pageCount = paged ? Math.max(1, Math.ceil(body.rows.length / perPage)) : 1;
  const pageCur = Math.min(page, pageCount - 1);
  const pageRows = paged
    ? Array.from({ length: pageCount }, (_, i) => body.rows.slice(i * perPage, (i + 1) * perPage))
    : [];
  // 달성 플래시 행은 화면 밖에 있으면 안 보인다 — 그 행이 실린 장으로 자동 점프(§2-4 연장)
  const [lastFlash, setLastFlash] = useState(null);
  if (lastFlash !== flashId) {
    setLastFlash(flashId);
    const i = flashId && paged ? body.rows.findIndex((r) => r.id === flashId) : -1;
    if (i >= 0) setPageState({ key: bodyKey, value: Math.floor(i / perPage) });
  }
  const swipeX = useRef(null);
  const pageBy = (d) => setPage(Math.max(0, Math.min(pageCount - 1, pageCur + d)));
  return (
    <>
        {(cur.segments || pageCount > 1) && (
          <div className={s.segs} role={cur.segments ? "group" : undefined} aria-label={cur.segments ? `${cur.label} 구분` : undefined}>
            {cur.segments && cur.segments.map((g) => (
              <button key={g.key} type="button" aria-pressed={g === seg}
                className={`${s.seg} ${g === seg ? s.segOn : ""}`}
                onClick={() => onSeg(g.key)}>{g.label}</button>
            ))}
            {pageCount > 1 && (
              <span className={s.pager}>
                <button type="button" className={s.pgBtn} disabled={pageCur === 0} onClick={() => pageBy(-1)} aria-label="목록 이전 페이지">이전</button>
                <b aria-live="polite" aria-atomic="true" aria-label={`${pageCount}쪽 중 ${pageCur + 1}쪽`}>{pageCur + 1}<i>/{pageCount}</i></b>
                <button type="button" className={s.pgBtn} disabled={pageCur === pageCount - 1} onClick={() => pageBy(1)} aria-label="목록 다음 페이지">다음</button>
              </span>
            )}
          </div>
        )}

        {body.intro && (
          /* v5.0 섹션 소개 — 지금 화면이 무엇인지 한 문단으로 말하고, 상세가 있으면 문 하나를 연다(없으면 버튼 없음) */
          <div className={s.intro}>
            <p>{body.intro.text}</p>
            {body.intro.go && (
              <button type="button" className={s.introGo} onClick={body.intro.go.act}>{body.intro.go.label}</button>
            )}
          </div>
        )}

        {body.brief && (
          /* v3.8 개요 블록 — 팝업 이름·기간·D-day 한 줄 + 페이즈 타임라인(현 단계 점등). 아래 행은 주요 이벤트 문 */
          <div className={`${s.brief} ${body.brief.go ? s.door : ""}`}
            role={body.brief.go ? "button" : undefined} tabIndex={body.brief.go ? 0 : undefined}
            onClick={body.brief.go ? body.brief.go.act : undefined}
            onKeyDown={body.brief.go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); body.brief.go.act(); } } : undefined}>
            <div className={s.briefTop}>
              <b>{body.brief.title}</b><span>{body.brief.period}</span>
              {body.brief.phases && <i className={s.briefPhase}>{body.brief.phases.find((x) => x.on)?.label}</i>}
              {body.brief.dday && <em>{body.brief.dday}</em>}
              {body.brief.go && <em className={s.goText}>{body.brief.go.label}</em>}
            </div>
            {body.brief.phases && (
              <div className={s.phases} role="img" aria-label={`진행 단계 — ${body.brief.phases.find((x) => x.on)?.label || ""}`}>
                {body.brief.phases.map((ph) => (
                  <span key={ph.label} className={`${s.phase} ${ph.on ? s.phaseOn : ""} ${ph.done ? s.phaseDone : ""}`}><i />{ph.label}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {body.kind === "intro" ? null : scrolled ? (
          /* v4.9 커머스 목록 — 장 넘김 대신 내부 스크롤. 장바구니 행은 한 줄 커머스 문법(썸네일·이름·수량·줄 합계·삭제) */
          <div className={s.scrollList}>
            {body.rows.map((r) => (body.kind === "cart" && r.onQty ? (
              <div key={r.id} className={`${s.cartRow} ${flashId === r.id ? s.flash : ""}`}>
                <i className={s.thumb} style={r.thumb ? { backgroundImage: `url(${r.thumb})` } : undefined} />
                <b className={r.go ? s.door : undefined}
                  role={r.go ? "button" : undefined} tabIndex={r.go ? 0 : undefined}
                  onClick={r.go ? r.go.act : undefined}
                  onKeyDown={r.go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.go.act(); } } : undefined}>{r.name}</b>
                <span className={s.qty}>
                  <button type="button" aria-label={`${r.name} 수량 줄이기`} disabled={r.qty <= 1} onClick={() => r.onQty(r.qty - 1)}>−</button>
                  <b>{r.qty}</b>
                  <button type="button" aria-label={`${r.name} 수량 늘리기`} disabled={r.max != null && r.qty >= r.max} onClick={() => r.onQty(r.qty + 1)}>+</button>
                </span>
                <em className={s.lineTotal}>{r.right || r.sub}</em>
                <button type="button" className={s.del} aria-label={`${r.name} 삭제`} onClick={() => r.onQty(0)}>✕</button>
              </div>
            ) : (
              <div key={r.id} className={`${s.row} ${r.on ? s.rowOn : ""} ${flashId === r.id ? s.flash : ""} ${r.go ? s.door : ""}`}
                role={r.go ? "button" : undefined} tabIndex={r.go ? 0 : undefined}
                onClick={r.go ? r.go.act : undefined}
                onKeyDown={r.go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.go.act(); } } : undefined}>
                {r.thumb ? <i className={s.thumb} style={{ backgroundImage: `url(${r.thumb})` }} /> : <i className={s.dot} />}
                <b>{r.name}</b>
                <span>{r.sub}</span>
                {r.go && <em className={s.goText}>{r.go.label}</em>}
              </div>
            )))}
          </div>
        ) : paged ? (
          /* v3.2 페이지 문법 — 뷰포트에 실측으로 들어가는 만큼이 한 장. 스와이프로도 넘긴다 */
          <div className={s.pgView} ref={pgViewRef}
            onTouchStart={(e) => { swipeX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (swipeX.current == null) return;
              const dx = e.changedTouches[0].clientX - swipeX.current;
              swipeX.current = null;
              if (Math.abs(dx) > 44) pageBy(dx < 0 ? 1 : -1);
            }}>
            <div className={s.pgTrack} style={{ transform: `translateX(-${pageCur * 100}%)` }}>
              {pageRows.map((pg, pi) => (
                <div key={pi} className={s.pgPage} aria-hidden={pi !== pageCur} inert={pi !== pageCur ? true : undefined}>
                  {(body.kind === "list" || body.kind === "brief" || body.kind === "cart") && pg.map((r) => (
                    /* v3.1 「모든 행은 문」 — go 가 있으면 행 전체가 누르는 문이다 */
                    <div key={r.id} data-pgitem className={`${s.row} ${r.on ? s.rowOn : ""} ${flashId === r.id ? s.flash : ""} ${r.go ? s.door : ""}`}
                      role={r.go ? "button" : undefined} tabIndex={r.go && pi === pageCur ? 0 : undefined}
                      onClick={r.go ? r.go.act : undefined}
                      onKeyDown={r.go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.go.act(); } } : undefined}>
                      {r.thumb
                        ? <i className={s.thumb} style={{ backgroundImage: `url(${r.thumb})` }} />
                        : <i className={s.dot} />}
                      <b>{r.name}</b>
                      <span>{r.sub}</span>
                      {r.onQty ? (
                        /* 장바구니 행 — 행 전체는 상세 문, 안의 수량 조절은 전파를 끊는다(누적 단계 행과 같은 예외) */
                        <span className={s.qty} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <button type="button" aria-label={`${r.name} 수량 줄이기`} onClick={() => r.onQty(r.qty - 1)}>{r.qty <= 1 ? "✕" : "−"}</button>
                          <b>{r.qty}</b>
                          <button type="button" aria-label={`${r.name} 수량 늘리기`} disabled={r.max != null && r.qty >= r.max} onClick={() => r.onQty(r.qty + 1)}>+</button>
                        </span>
                      ) : r.go && <em className={s.goText}>{r.go.label}</em>}
                    </div>))}
                  {body.kind === "quest" && pg.map((r) => (
                    <div key={r.id} data-pgitem className={`${s.questRowItem} ${flashId === r.id ? s.flash : ""} ${r.go ? s.door : ""}`}
                      role={r.go ? "button" : undefined} tabIndex={r.go && pi === pageCur ? 0 : undefined}
                      onClick={r.go ? r.go.act : undefined}
                      onKeyDown={r.go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.go.act(); } } : undefined}>
                      <div className={s.questRowHead}>
                        {r.thumb && <i className={s.thumb} style={{ backgroundImage: `url(${r.thumb})` }} />}
                        <b title={r.goal}>{r.name}</b>
                        <span>{r.progress}</span>
                        {r.go && <em className={s.goText}>{r.go.label}</em>}
                      </div>
                      {r.journey && (
                        <div className={s.journey} role="img" aria-label={`${r.goal || r.name} — 진행 ${Math.round(r.journey.pct * 100)}%`} title={r.goal}>
                          <i className={s.jFill} style={{ width: `${Math.min(100, r.journey.pct * 100)}%` }} />
                          {r.journey.marks.map((m) => (
                            <b key={m.label} className={`${s.jMark} ${m.done ? s.jDone : ""}`}
                              style={{ left: `${Math.min(100, m.pct * 100)}%` }} title={m.label} />
                          ))}
                        </div>
                      )}
                    </div>))}
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div className={s.list}>
          {(body.kind === "list" || body.kind === "quest" || body.kind === "brief" || body.kind === "cart") && (!body.rows || !body.rows.length) && (
            <p className={s.empty}>{body.empty}</p>)}

          {body.kind === "spend" && body.spend && (
            <div className={s.spend}>
              <div className={s.spendTop}>
                <b>{body.spend.total}</b><span>{body.spend.label}</span>
                {body.spend.next && <em className={s.spendNext}>{body.spend.next}</em>}
              </div>
              <div className={s.track}><i style={{ width: `${body.spend.pct}%` }} /></div>
              <div className={s.tierRows}>
                {body.spend.tiers.map((t) => (
                  <div key={t.label} className={`${s.tierRow} ${t.done ? s.tierRowOn : ""} ${t.go ? s.door : ""}`}
                    role={t.go ? "button" : undefined} tabIndex={t.go ? 0 : undefined}
                    onClick={t.go ? t.go.act : undefined}
                    onKeyDown={t.go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); t.go.act(); } } : undefined}>
                    {t.thumb ? <Image unoptimized width={26} height={26} className={s.tierThumb} src={t.thumb} alt="" />
                      : <i className={s.tierThumb} aria-hidden="true" />}
                    <span className={s.tierBody}><b>{t.name}</b>{t.sub && <span>{t.sub}</span>}</span>
                    <em className={s.tierState}>{t.state || (t.done ? `${t.label} ✓` : t.label)}</em>
                  </div>))}
              </div>
              {body.spend.note && <p className={s.spendNote}>{body.spend.note}</p>}
            </div>
          )}
        </div>
        )}
        {body.kind === "cart" && body.cart && body.rows && body.rows.length > 0 && (
          <div className={s.cartBar}>
            <span>{body.cart.count}건 · <b>{body.cart.total}</b></span>
            <button type="button" className={s.cartCta} onClick={body.cart.onCheckout}>{body.cart.cta || "주문하기"}</button>
          </div>
        )}
    </>
  );
}

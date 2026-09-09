"use client";

// 지우학 기획 시연판 — 설계서 v0.1(존·계약) + 체험여정 설계서 v0(감정 여정·오프닝·보상 회로)의 실동작 구현.
// 시연 경계: 굿즈·게임 정식판 = 개발 트랙 / 이미지 = 웹 수집 내부 시안 / 서사 카피 = 감수 전 가안 / 수치 = 시연 데이터.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import s from "./AouadSample.module.css";
import c from "./CafeteriaCrash.module.css";   // 보상 진열은 급식실 모양 그대로 — 전 존 공통(PM 2026-09-09)
import { SECTION_LEAD, ZONE_CALL } from "./aouad-copy";
import { FcfsFace, PreorderFace, RaffleFace } from "./DealFaces";
import { fmtLeft, mdById, useNow, usePrefersReducedMotion, won } from "./deal-format";
import KujiFace from "./KujiFace";
import { parsePopupQuery, buildPopupQuery, historyKey } from "../../lib/stage/url-state";
import CafeteriaCrash from "./CafeteriaCrash";
import SceneHero from "./SceneHero";
import { snapTargetFor } from "../../lib/stage/snap-assist";
import LibraryRun from "./LibraryRun";
import HoseDescent from "./HoseDescent";
import GameGate, { resetGameLocks, useGameLock } from "./GameGate";
import PresentationDialog from "./PresentationDialog";
import PresentationDealDialog from "./PresentationDealDialog";
import { completePresentationDeal, presentationDealSummary } from "./presentation-deals";
import { addToCart, cartLimit, cartRows, cartTotal, getProductPresentationStatus, setCartQty, spentOf } from "./presentation-commerce";
import { EMPTY_PRESENTATION_STATE as EMPTY, usePresentationState } from "./presentation-state";
import { claimPresentationWin, presentationDrawState, recordPresentationDraw } from "./presentation-draws";
import { LEVEL as LIB_LEVEL } from "../../lib/zones/engine-library";
import { CONFIG as HOSE } from "../../lib/zones/engine-hose";
import { KUJI_STAGE } from "./kuji-stage";
import { BoxConfirmSheet, BoxResult, DarkConfirmSheet, DropConfirmSheet, WireConfirmSheet, useBoxRound, useDarkRound, useDropRound, useWireRound } from "./BoxLive";
import OfflineMap from "../OfflineMap";
import PopupHud, { HudBody } from "../popup/PopupHud";
import PopupFloorplan from "../popup/PopupFloorplan";
import { scaledPhotoSize } from "./photo-utils";
import {
  ASSET, OPENING, ZONES,
  MD, LANE_LABEL, RAFFLES, FCFS, KUJI, PREORDER, RIGHTS, RIGHT_GOALS, ZONE_RIGHT,
  THEME,
  POPUP_PERIOD, ZONE_GOODS, ZONE_GAME_NAME,
  NOTICES, WALL_TAG, WALL_POSTS, PURCHASE_TIERS, OFFLINE, BOX_ITEMS, SCHEDULE,
  MD_DETAIL, SUPPLY_NOTE, SHIPPING, WITHDRAWAL, WITHDRAWAL_STATE,
} from "./aouad-data";

// tickets[zone] = 참여권 장수 — 사는 건 거래, 쓰는 건 체험(PM 2026-09-02). HUD 컨텍스트 패널 보유 세그가 읽는다
// cart[{id, qty}] = 사기로 한 것(찜과 다른 상태) · orders[] = 주문 확정 기록 · spent = 주문 합계 누적(누적 구매 = 기준값 + spent)

/* ── 장바구니(v4.0 · PM 「체험을 즐기다가 한꺼번에 구매」) — 상시 매대의 바구니. 딜 레인은 각 매대 규칙 우선 ── */
/* ── 보관함(v4.2) — 상자 당첨 상품(st.wins · 게임 트랙 #675 기록). mdId(판매 SKU) 또는 boxId(상자 전용) 중 하나 ── */
const winItem = (w) => (w.mdId ? mdById(w.mdId) : BOX_ITEMS[w.boxId]) || null;
const WIN_SOURCE = { "kuji-cafeteria": "급식실", cafeteria: "급식실" }; // 급식실 = 체험(PM 2026-09-02) · "kuji-cafeteria" 는 옛 저장값 호환용 — 새 기록은 "cafeteria"
const winSub = (w) => `${w.grade}상 · ${WIN_SOURCE[w.source] || w.source}${w.fellFrom ? ` · ${w.fellFrom}상 소진` : ""}${w.claimedAt ? " · 배송 신청됨" : ""}`;
const claimWin = (update, idx) => update((p) => claimPresentationWin(p, idx));



// 집단 마일스톤 — 불씨 총량에서 도달 단계를 파생한다(잔액이 아니라 도달: 소모·환산 없음, ADR-0025)
// 다음 단계(없으면 null = 최종 단계까지 도달)


/* 옥상 문 = 체험 3곳에 「참여」해야 열린다(PM 2026-09-03). 참여 = 한 번이라도 해 본 것 — 달성이 아니다.
   급식실 = 완주권(cafePass, 점수 하한) · 방송실 = 하강 1판(hoseTry) · 도서관 = 탈출 시도 1회(libRuns). 스탬프·인장은 없다 — 기록에서 바로 읽는다.
   체험 장의 리드 목록도 이 배열을 돈다 — 존을 넣고 빼는 자리는 여기 하나다. */
const LIB_BOOKMARKS = LIB_LEVEL.bookmarks.length;   // 책갈피 목표는 규칙이 쥔다 — 화면에서 숫자를 만들지 않는다
const HOSE_PEOPLE = HOSE.people;                   // 방송실 한 판의 사람 수도 규칙이 쥔다
const PLAY_ZONES = ["cafeteria", "broadcast", "library"];
// 급식실만 「참여」가 아니라 **완주권**(점수 ≥ RIGHT_GOALS.cafePass, 무료·유상 공통)이다 — PM 2026-09-03 「무료 참여시 옥상 완주권은 특정 점수 이상만」
const playedOf = (st) => ({ cafeteria: !!st.rec.cafePass, broadcast: (st.rec.hoseTry || 0) > 0, library: (st.rec.libRuns || 0) > 0 });
const playedCount = (st) => PLAY_ZONES.filter((z) => playedOf(st)[z]).length;
const rooftopLocked = (st) => playedCount(st) < PLAY_ZONES.length;

// 구매권 = 목표 달성에서 파생 (PM 2026-08-21: 게임의 보상은 실제 구매 자격 — 도장·인장은 증표)
function rightsOf(st) {
  return {
    // 급식실 4단 — 점수(최고 기록)별 차등, 누적. 문턱은 RIGHTS[].score (PM 2026-09-03 「차등 구매권 · 무료 참여」)
    ...Object.fromEntries(RIGHTS.filter((r) => r.game === "cafeteria").map((r) => [r.id, (st.rec.cafeBest || 0) >= r.score])),
    // 방송실 소화전 호스 하강 — 한 판(8명)에 들여보낸 최고 인원. **클수록 좋다**(PM 2026-09-04 문턱 6명)
    radioPair: (st.rec.hoseSaved || 0) >= RIGHT_GOALS.hoseSaved,
    // 도서관 서가 탈출 — 탈출 하나 + 미션 셋(2026-09-04 판정 통과). 점수가 아니라 **해냈는가**다
    libPhoto: !!st.rec.libEscaped,
    libBookmarkSet: (st.rec.libBookmarks || 0) >= LIB_BOOKMARKS,
    libDeskmat: !!st.rec.libNoHit,
    libJournal: !!st.rec.libSecret,
    // 옥상 2종 = 옥상 완주(PM 2026-09-02 「구매권은 체험존에서」). 게임 확정 전 임시 완주 = 모닥불 앞에 앉기
    idEngraved: !!st.clears.rooftop,
    bonfireOrgel: !!st.clears.rooftop,
  };
}
const rightCount = (st) => Object.values(rightsOf(st)).filter(Boolean).length;
const rightDef = (id) => RIGHTS.find((r) => r.id === id);
/* 구매권 획득의 문 — 잠금 오버레이가 데려가는 곳 = 그 구매권을 여는 존(정산소 없음, PM 2026-09-02) */
const rightZoneOf = (id) => {
  const r = rightDef(id);
  return r && r.game ? r.game : null;
};
/* 상품→존 역인덱스(PM 2026-08-28 「굿즈샵에도 어울리는 존으로 가는 문」):
   장면 큐레이션(ZONE_GOODS)이 1순위, 구매권의 획득 존이 2순위 — 어느 쪽에도 없으면 문 없음 */
const PRODUCT_ZONE = Object.entries(ZONE_GOODS).reduce((acc, [z, ids]) => {
  ids.forEach((id) => { if (!acc[id]) acc[id] = z; });
  return acc;
}, {});
const zoneOfProduct = (m) => PRODUCT_ZONE[m.id] || (m.right ? rightZoneOf(m.right) : null);
/* 벽 피드 = 내 글(작성 오버레이, PM 2026-08-31) + 커뮤니티 최신 글. 글은 커뮤니티에 쓰이고 팝업은 가져올 뿐 — 의 경계는
   유지하되, 시연에서는 작성이 곧 반영되는 것을 보여준다(내 글이 맨 앞). */
const wallFeedOf = (st) => [
  ...(st.posts || []).map((p) => ({
    id: p.id, handle: `@${st.callsign || "survivor_me"}`, user: st.callsign || "나",
    initial: (st.callsign || "나")[0], avatar: "linear-gradient(135deg, #ff8a3d, #b45309)",
    at: "방금 전", like: 0, reply: 0, tag: "효산고생존자", text: p.text, img: null,
  })),
  ...WALL_POSTS,
];

// 목표 달성 순간 포착 — 해당 존에 머무는 동안 구매권이 false→true로 바뀌면 잠깐 획득 배너
function useRightGained(st, id) {
  const has = !!rightsOf(st)[id];
  const prev = useRef(has);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = has;
    if (has && !was) {
      setFlash(true);
      const tm = setTimeout(() => setFlash(false), 5000);
      return () => clearTimeout(tm);
    }
    return undefined;
  }, [has]);
  return flash;
}

// 현재 진행값 문구 (계약 카드의 "지금" 줄)
function rightProgress(st, id) {
  switch (id) {
    case "radioPair": return st.rec.hoseTry ? `최고 ${st.rec.hoseSaved || 0}명 / ${HOSE_PEOPLE}명 · ${st.rec.hoseTry}판` : "기록 없음";
    case "libPhoto": return st.rec.libRuns ? (st.rec.libEscaped ? `탈출 · 최고 ${((st.rec.libBestMs || 0) / 1000).toFixed(1)}초` : `${st.rec.libRuns}번 시도 · 아직 못 나옴`) : "기록 없음";
    case "libBookmarkSet": return `책갈피 ${st.rec.libBookmarks || 0} / ${LIB_BOOKMARKS}`;
    case "libDeskmat": return st.rec.libNoHit ? "무피격 탈출" : "아직";
    case "libJournal": return st.rec.libSecret ? "비밀 서고 통과" : "아직";
    case "idEngraved": case "bonfireOrgel": return st.clears.rooftop ? "완주" : "미완주";
    default: return rightDef(id)?.game === "cafeteria" ? (st.rec.cafeBest != null ? `최고 ${st.rec.cafeBest.toLocaleString()}p` : "기록 없음") : "";
  }
}

/* HUD 요약 버튼용 — photo 원시값(캐릭터 id·dataURL·http)을 URL 로 해석 (Portrait 와 동일 규칙) */
function photoUrl(photo) {
  if (!photo) return null;
  if (photo.startsWith("data:") || photo.startsWith("http")) return photo;
  const char = CHARACTERS.find((c) => c.id === photo);
  return char ? ASSET(char.src) : null;
}

/* P1 — 구매권 여정을 세그먼트 바 데이터로 (pct 0~1 + 마일스톤 점). 기록형은 구간 마크, 개수형은 단위·짝수 마크 */
function rightJourney(st, id) {
  const unit = (v, max, step = 1) => ({
    pct: Math.min(1, v / max),
    marks: Array.from({ length: Math.ceil(max / step) }, (_, i) => {
      const at = Math.min(max, (i + 1) * step);
      return { pct: at / max, label: `${at}/${max}`, done: v >= at };
    }),
  });
  switch (id) {
    case "radioPair": {
      const b = st.rec.hoseSaved || 0; const g = RIGHT_GOALS.hoseSaved;
      return { pct: Math.min(1, b / HOSE_PEOPLE), marks: [2, 4, g, HOSE_PEOPLE].map((at) => (
        { pct: at / HOSE_PEOPLE, label: at === g ? `${at}명 목표` : `${at}명`, done: b >= at })) };
    }
    case "libPhoto": return unit(st.rec.libEscaped ? 1 : 0, 1);
    case "libBookmarkSet": return unit(Math.min(LIB_BOOKMARKS, st.rec.libBookmarks || 0), LIB_BOOKMARKS);
    case "libDeskmat": return unit(st.rec.libNoHit ? 1 : 0, 1);
    case "libJournal": return unit(st.rec.libSecret ? 1 : 0, 1);
    case "idEngraved": case "bonfireOrgel": return unit(st.clears.rooftop ? 1 : 0, 1);
    default: {
      const r = rightDef(id);
      if (!r || r.game !== "cafeteria") return null;
      const b = st.rec.cafeBest || 0; const g = r.score;
      const marks = RIGHTS.filter((x) => x.game === "cafeteria" && x.score <= g).map((x) => x.score);
      return { pct: Math.min(1, b / g), marks: marks.map((at) => ({ pct: at / g, label: at === g ? `${at.toLocaleString()}p 목표` : at.toLocaleString(), done: b >= at })) };
    }
  }
}

/* ── 보상 진열 — 급식실과 같은 문법(PM 2026-09-09 「체험 기반 구매 상품 디자인을 급식실 기준으로」) ──
   구매권 한 단 = 타일 하나(썸네일 · 조건 · 상품 · 진행 바 · 값·에디션). 딴 것에는 도장이 찍히고, 하나라도 가지면 아래에 굿즈샵 문.
   급식실은 점수 4단(`CafeteriaCrash` 안 `Shelf`)을, 다른 존은 그 존의 구매권 목록(`RIGHTS.game`)을 같은 타일로 세운다.
   무대 옆이 아니라 **무대 아래 한 줄**(PM 2026-09-09 「게임은 반드시 한 행」). */
function RewardTile({ st, r, has, next }) {
  const gained = useRightGained(st, r.id);
  const m = r.mdId ? MD.find((x) => x.id === r.mdId) : null;
  const jr = rightJourney(st, r.id);
  const pct = has ? 1 : jr ? jr.pct : 0;
  const state = gained ? "won" : has ? "have" : next ? "next" : "";
  const kind = /선구매권$/.test(r.name) ? "선구매권" : "구매권";
  return (
    <div className={c.card} data-state={state}>
      <span className={c.thumbBox}>
        <i className={c.thumb} style={m ? { backgroundImage: `url(${ASSET(m.src)})` } : undefined} aria-hidden="true" />
        {(state === "won" || state === "have") && (
          <span className={c.stamp} data-kind={state} role="img" aria-label={state === "won" ? "구매권 획득" : "구매권 보유"}>
            <b>구매권</b><em>획득</em>
          </span>
        )}
      </span>
      <span className={c.cardText}>
        <b className={c.gradeName}>{r.short || r.goal}<em>{kind}</em></b>
        <span className={c.itemName} title={m ? m.name : r.name}>{m ? m.name : r.name}</span>
        <span className={c.prog}><i style={{ width: `${pct * 100}%` }} /></span>
        <span className={c.left}>{m ? `${won(m.price)} · ${r.edition}` : r.grant || ""}</span>
      </span>
    </div>
  );
}

function RewardShelf({ st, ids, go }) {
  const rights = rightsOf(st);
  const tiers = ids.map((id) => rightDef(id)).filter(Boolean);
  const nextOf = tiers.find((r) => !rights[r.id]);   // 다음 단 = 아직 못 딴 첫 타일 — 같은 조건(옥상 「완주」 둘)은 함께 켠다
  return (
    <div className={c.rewards} aria-label="보상">
      <div className={c.shelf} aria-label="구매권">
        {tiers.map((r) => <RewardTile key={r.id} st={st} r={r} has={!!rights[r.id]} next={!!nextOf && !rights[r.id] && (r.short || r.goal) === (nextOf.short || nextOf.goal)} />)}
      </div>
      {go && tiers.some((r) => rights[r.id]) && (
        <button type="button" className={c.storeGo} onClick={() => go("store")}>보유 구매권으로 굿즈샵 가기</button>
      )}
    </div>
  );
}

/* ── 오프닝 「깨어남」 — 유저 = 효산고에 남은 절비 (PM 확정 2026-08-25, 체험여정 v1.0) ──
   비트: A1 깨어남(어디인지 모름·배고픔=리빌 첫 복선) → A2 부름(남라의 목소리가 머릿속에 닿는다)
        → A3 응답 → A4 「내가 누구지」(교복에서 학생증을 찾아 이름을 읽어 알려준다)
        → A5 약속(「옥상으로 갈게」) → 학생증 안착·허브
   ⚠️ 감수 항목: 절비 간 정신 교신은 원작 확장이다(원작 능력 = 초강화 청각·후각).
      대안 = 남라가 초청각으로 내 소리를 듣고 말을 거는 형태. 감수 결과에 따라 택일. */
// A1~A2 — 깨어남과 부름 (감수 전 가안)
const OPEN_LINES = [
  "…여기가, 어디지.",
  "배가 고파. 견딜 수 없을 만큼.",
  "…들려? 거기 누구 있어?",
];
// 화자: 0·1 = 나(속마음) / 2 = 남라의 부름 (PM 화자 구분 지시 2026-08-25)
const OPEN_CALLER_FROM = 2;
const ANSWER_LABEL = "…누구야. 나한테 말한 거야?";
// A4 — 남라의 대답 → 이름을 묻는다 → 나: 교복에서 학생증을 찾아 읽는다
const REPLY_LINE = "너처럼 남은 애들을 찾고 있어, 네 이름을 알려줘.";
const DLG_ME_FOUND = "교복 주머니에 학생증이 있다";
const DLG_ME_PREFIX = "내 이름은";
// 학생증은 발급이 아니라 「원래 내 것」(v0.6 유지) — 잃어버린 정체성을 교복에서 찾아내는 행위
const SPEAK_PREFIX = "내 이름은";
// A5 — 이름을 말한 뒤: 남라가 모닥불을 알리고 부른다 → 나는 올라가겠다며 그날을 회상한다 (감수 전 가안)
const BONFIRE_MSG = "옥상에 모닥불 피워놨어. 올라와서 만나자.";
const RECALL_LINE = "그래, 다시 가보자 그 지옥이었던 곳으로";
/* 남라는 오프닝에서 「네 이름을 알려줘」라 묻고도 자기 이름은 말하지 않는다 — 그 비대칭을 옥상 리빌에서 갚는다.
   이름을 여기 두는 이유: 원작 정본에서 남라는 옥상에 남은 절비다. 오프닝에서 이름을 밝히면
   원작을 아는 관객에게 「나 = 절비」 리빌이 즉시 선스포된다. 이름은 리빌의 나머지 절반으로 쓴다. */

/* 캐릭터 프로필 사진 목록 — 남온조, 이청산, 최남라, 이수혁, 장하리, 윤귀남 (+ 내 사진 직접 업로드) */
const CHARACTERS = [
  { id: "onjo", name: "남온조", role: "2-5반", src: "characters/onjo.jpg" },
  { id: "cheongsan", name: "이청산", role: "2-5반", src: "characters/cheongsan.jpg" },
  { id: "namra", name: "최남라", role: "반장", src: "characters/namra.jpg" },
  { id: "suhyeok", name: "이수혁", role: "2-5반", src: "characters/suhyeok.jpg" },
  { id: "hari", name: "장하리", role: "양궁부", src: "characters/hari.jpg" },
  { id: "gwinam", name: "윤귀남", role: "생존자", src: "characters/gwinam.jpg" },
];

function Portrait({ photo, size = 34, w, h }) {
  const style = { width: w || size, height: h || size };
  if (photo) {
    if (photo.startsWith("data:") || photo.startsWith("http")) {
      // eslint-disable-next-line @next/next/no-img-element -- Local uploaded portraits use each card's explicit crop, without an image service request.
      return <img className={s.portrait} style={{ ...style, objectFit: "cover" }} src={photo} alt="" />;
    }
    const char = CHARACTERS.find((c) => c.id === photo);
    if (char) {
      // eslint-disable-next-line @next/next/no-img-element -- These small portrait files share the same independently sized card frames as uploaded portraits.
      return <img className={s.portrait} style={{ ...style, objectFit: "cover" }} src={ASSET(char.src)} alt={char.name} />;
    }
  }
  return (
    <svg className={s.portrait} style={style} viewBox="0 0 64 64" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="64" height="64" fill="#1c2430" />
      <circle cx="32" cy="25" r="11" fill="#7a8ba0" />
      <path d="M10 58c2-13 11-19 22-19s20 6 22 19v6H10z" fill="#7a8ba0" />
    </svg>
  );
}

/* 학생증 — 한국 학생증 실물 문법·세로형(목걸이 카드) (PM 2026-08-21): 학교명 밴드 · 3:4 증명사진 · 성명 · 재학 증명 문구 · 학교장 직인.
   sealed = (폐지 — 인장 제도 없음, PM 2026-09-02) · extra = 성명 아래 삽입 구획 */
function StudentIdCard({ name, photo, sealed, className, extra, cardRef, writing }) {
  return (
    <div ref={cardRef} className={`${s.stuCard} ${className || ""}`}>
      <div className={s.stuHead}><b>효산고등학교</b><span>학생증</span></div>
      <div className={s.stuPhotoWrap}><div className={s.stuPhoto}><Portrait photo={photo} w={88} h={116} /></div></div>
      <div className={s.stuName}>
        <span className={s.stuNameTag}>성명</span>
        <b className={name || writing ? "" : s.stuUnnamed}>{name || (writing ? "" : "미기재")}{writing && <span className={s.penCaret} />}</b>
      </div>
      {extra}
      <p className={s.stuCert}>위 학생은 본교 학생임을 증명함.</p>
      <div className={s.stuFoot}><span className={s.stuPrincipal}>효산고등학교장</span><i className={s.stuSeal}>직인</i></div>
      {sealed && <i className={s.stuBadge}>생존자 인장</i>}
    </div>
  );
}

const PHOTO_ERROR_MESSAGE = "사진을 불러오지 못했어요. JPG, PNG 또는 WebP 이미지 파일을 선택해 주세요.";

function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = URL.createObjectURL(file);
    } catch (error) {
      reject(error);
      return;
    }
    const release = () => URL.revokeObjectURL(url);
    let img;
    try {
      img = new window.Image();
    } catch (error) {
      release();
      reject(error);
      return;
    }
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) throw new Error("image");
        const size = scaledPhotoSize(width, height);
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas");
        context.drawImage(img, 0, 0, size.width, size.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (error) {
        reject(error);
      } finally {
        release();
      }
    };
    img.onerror = () => { release(); reject(new Error("image")); };
    try {
      img.src = url;
    } catch (error) {
      release();
      reject(error);
    }
  });
}

function PhotoPicker({ photo, onPick, onSelectName }) {
  const fileRef = useRef(null);
  const errorId = useId();
  const [photoError, setPhotoError] = useState(null);
  const uploaded = photo && (photo.startsWith("data:") || photo.startsWith("http"));
  const onFile = (e) => {
    const input = e.currentTarget;
    const f = input.files && input.files[0];
    input.value = "";
    if (!f) return;
    setPhotoError(null);
    if (f.type && !f.type.startsWith("image/")) {
      setPhotoError(PHOTO_ERROR_MESSAGE);
      return;
    }
    shrinkPhoto(f)
      .then((next) => {
        setPhotoError(null);
        onPick(next);
      })
      .catch(() => setPhotoError(PHOTO_ERROR_MESSAGE));
  };
  return (
    <div className={s.portraitRow} role="group" aria-label="학생증 증명사진 선택">
      {CHARACTERS.map((char) => (
        <button
          key={char.id}
          type="button"
          className={`${s.portraitBtn} ${photo === char.id ? s.picked : ""}`}
          onClick={() => {
            setPhotoError(null);
            const next = photo === char.id ? null : char.id;
            onPick(next);
            if (onSelectName && next) onSelectName(char.name);
          }}
          aria-label={char.name}
          title={`${char.name} (${char.role})`}
        >
          <NextImage width={96} height={128} unoptimized className={s.charPhoto} src={ASSET(char.src)} alt={char.name} />
          <span className={s.charNameMini}>{char.name}</span>
        </button>
      ))}
      <button
        type="button"
        className={`${s.portraitBtn} ${s.uploadBtn} ${uploaded ? s.picked : ""}`}
        onClick={() => fileRef.current && fileRef.current.click()}
        aria-label="내 사진 직접 올리기"
        title="내 사진 직접 올리기"
      >
        {uploaded ? (
          <>
            <NextImage width={96} height={128} unoptimized className={s.charPhoto} src={photo} alt="내 사진" />
            <span className={s.charNameMini}>내 사진</span>
          </>
        ) : (
          <span className={s.uploadLabel}>📷<br />내 사진</span>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        aria-invalid={photoError ? "true" : undefined}
        aria-describedby={photoError ? errorId : undefined}
        onChange={onFile}
      />
      {photoError && <span id={errorId} className={s.photoError} role="alert">{photoError}</span>}
    </div>
  );
}

function Opening({ short, reduced, hasId, onDone, onReset }) {
  // beat 0 = 타이틀 모션 오마주(입자 수렴→불씨 리빌). 재방문(short)·모션축소(reduced)는 건너뛴다.
  const [beat, setBeat] = useState(short ? 4 : 0);
  const [typed, setTyped] = useState([]); // 완성된 줄들 + 진행 중인 줄
  const [callsign, setCallsign] = useState("");
  const [photo, setPhoto] = useState(null);
  const [reply, setReply] = useState(""); // B7 — 상대의 대답 타이핑
  const [recall, setRecall] = useState(""); // A5 — 회상 1줄 타이핑
  const [written, setWritten] = useState(null); // B8 — 학생증에 기입 중인 이름(null = 무명)
  const replyDone = reply.length >= REPLY_LINE.length;
  const cardRef = useRef(null);
  const latest = useRef({ callsign: "", photo: null, onDone });
  useLayoutEffect(() => { latest.current = { callsign, photo, onDone }; }, [callsign, photo, onDone]);
  const answer = () => (hasId ? onDone(undefined) : setBeat(7));
  // 등교 = 학생증에 이름이 기입되는 연출(B8) → 카드의 화면 좌표를 들고 허브로(카드가 벤토 모듈 자리로 날아가 안착)
  const issue = (name) => {
    setCallsign(name || "");
    setWritten(name ? "" : null);
    setBeat(8);
  };
  const leave = () => {
    const { callsign: name, photo: ph, onDone: done } = latest.current;
    const r = cardRef.current ? cardRef.current.getBoundingClientRect() : null;
    done({ name: name || null, photo: ph, fromRect: r && !reduced ? { left: r.left, top: r.top, width: r.width, height: r.height } : null });
  };
  const leaveRef = useRef(leave);
  useLayoutEffect(() => { leaveRef.current = leave; });

  useEffect(() => {
    if (reduced) return undefined;
    // beat 0(타이틀 오마주 ~2.2s) → 이후 무전 시퀀스. 재방문은 beat 4부터.
    const plan = short
      ? [[5, 900], [6, 1500]]
      : [[1, 10900], [2, 12900], [3, 15300], [4, 18500], [5, 20500], [6, 21700]]; // beat0 = 공식 타이틀 영상(~10.9s)
    const timers = plan.map(([b, t]) => setTimeout(() => setBeat(b), t));
    return () => timers.forEach(clearTimeout);
  }, [short, reduced]);

  // 3줄 순차 타이핑 — 줄 사이 짧은 호흡 (재귀 setTimeout 체인)
  useEffect(() => {
    if (reduced || short || beat !== 3) return undefined;
    let line = 0;
    let ch = 0;
    let id = null;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      ch += 1;
      setTyped([...OPEN_LINES.slice(0, line), OPEN_LINES[line].slice(0, ch)]);
      if (ch >= OPEN_LINES[line].length) {
        line += 1;
        ch = 0;
        if (line >= OPEN_LINES.length) return;
        id = setTimeout(step, 420);
      } else {
        id = setTimeout(step, 38);
      }
    };
    id = setTimeout(step, 0);
    return () => { cancelled = true; clearTimeout(id); };
  }, [beat, short, reduced]);

  // B7 — 내 응답 뒤, 상대의 대답이 타이핑된다 (끝나야 이름 칸이 열린다)
  useEffect(() => {
    if (beat !== 7) return undefined;
    if (reduced) return undefined;
    let i = 0;
    let id = null;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      i += 1;
      setReply(REPLY_LINE.slice(0, i));
      if (i < REPLY_LINE.length) id = setTimeout(step, 34);
    };
    id = setTimeout(step, 520);
    return () => { cancelled = true; clearTimeout(id); };
  }, [beat, reduced]);

  // A5/B8 — 모닥불 부름 + 학생증 기입 + 회상 4줄이 끝난 뒤 카드가 「내 기록」 모듈로 합쳐진다 (무명도 동일 체류)
  useEffect(() => {
    if (beat !== 8) return undefined;
    if (reduced) { leaveRef.current(); return undefined; }
    const name = latest.current.callsign;
    if (!name) {
      let r = 0; let t = null; let stop = false;
      const tick = () => {
        if (stop) return;
        r += 1;
        setRecall(RECALL_LINE.slice(0, r));
        t = setTimeout(() => (r >= RECALL_LINE.length ? leaveRef.current() : tick()), r >= RECALL_LINE.length ? 1200 : 45);
      };
      t = setTimeout(tick, 800);
      return () => { stop = true; clearTimeout(t); };
    }
    let i = 0;
    let id = null;
    let cancelled = false;
    // 이름이 다 적히면 회상 1줄을 타이핑하고, 끝난 뒤 잠시 머물다 학생증이 「내 기록」 모듈로 합쳐진다
    const recallStep = () => {
      if (cancelled) return;
      let r = 0;
      const tick = () => {
        if (cancelled) return;
        r += 1;
        setRecall(RECALL_LINE.slice(0, r));
        id = setTimeout(() => (r >= RECALL_LINE.length ? leaveRef.current() : tick()), r >= RECALL_LINE.length ? 1200 : 45);
      };
      tick();
    };
    const step = () => {
      if (cancelled) return;
      i += 1;
      setWritten(name.slice(0, i));
      id = setTimeout(() => (i >= name.length ? recallStep() : step()), i >= name.length ? 700 : 95);
    };
    id = setTimeout(step, 650);
    return () => { cancelled = true; clearTimeout(id); };
  }, [beat, reduced]);

  if (reduced) {
    return (
      <div className={s.opening} role="dialog" aria-label="생존 무전">
        {onReset && <button type="button" className={s.openingReset} onClick={onReset} title="처음부터 다시 보기">↺ 첫 방문 상태로</button>}
        <div className={s.notice}>
          <span className={s.noticeTag}>{OPENING.noticeTitle}</span>
          <p>{OPENING.noticeBody}</p>
          {hasId ? (
            <button type="button" className={s.primaryBtn} onClick={() => onDone(undefined)}>{ANSWER_LABEL}</button>
          ) : (
            <>
              <p className={s.dlgRadio}>{REPLY_LINE}</p>
              <p className={s.foundLine}>{DLG_ME_FOUND}</p>
              <div className={s.speakRow}>
                <span className={s.speakPrefix}>{DLG_ME_PREFIX}</span>
                <input className={`${s.issueInput} ${s.speakInput}`} value={callsign} maxLength={12} placeholder="…" onChange={(e) => setCallsign(e.target.value)} aria-label="이름" />
              </div>
              <PhotoPicker photo={photo} onPick={setPhoto} onSelectName={(n) => { if (!callsign.trim()) setCallsign(n); }} />
              <div className={s.welcomeActs}>
                <button type="button" className={s.primaryBtn} disabled={!callsign.trim()} onClick={() => onDone({ name: callsign.trim(), photo })}>그래, 옥상으로 갈게, 만나</button>
                <button type="button" className={s.ghostBtn} onClick={() => onDone({ name: null, photo })}>이름은 나중에, 일단 갈게</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={s.opening} role="dialog" aria-label="무전 수신">
      {onReset && <button type="button" className={s.openingReset} onClick={onReset} title="처음부터 다시 보기">↺ 첫 방문 상태로</button>}
      <i className={s.bar} aria-hidden="true" />
      <i className={`${s.bar} ${s.barBottom}`} aria-hidden="true" />

      {beat === 0 && (
        <>
          {/* 공식 타이틀 영상 실장면(좀비 떼 리빌 포함) — 저작권 컨펌·정식 샘플 의뢰(PM 2026-08-25, ADR-0024) */}
          <video
            className={s.titleVideo}
            src={ASSET("opening-title.mp4")}
            poster={ASSET("opening-title-poster.jpg")}
            autoPlay muted playsInline preload="auto"
            onEnded={() => setBeat(1)}
            aria-hidden="true"
          />
          <p className={s.revivalCap}>{OPENING.revivalCaption}</p>
        </>
      )}

      {beat >= 1 && beat <= 2 && <div className={s.noise} />}
      {beat === 1 && <p className={s.eraCaption}>효산시, 사태 이후.</p>}

      {beat === 2 && (
        /* 가청 영역 밖 소리 — 무전 튜너(파형·다이얼) 폐기. 원작 정본(좀비의 소리 반응 + 남라의 초강화 청각)의
           확장으로, 일반인은 못 듣는 소리를 「내가」 듣는다는 것 자체가 리빌 복선이다. 수치(㎑)는 표기하지 않는다. */
        <div className={s.hear} aria-hidden="true">
          <div className={s.hearRipple}>{Array.from({ length: 4 }).map((_, i) => <i key={i} />)}</div>
          <span className={s.hearLabel}>이게 무슨 소리지…?</span>
        </div>
      )}

      {beat >= 3 && (
        <p className={`${s.radioText} ${beat >= 4 ? s.radioDim : ""}`}>
          {(beat === 3 ? typed : OPEN_LINES).map((line, i, arr) => (
            <span key={i} className={`${s.radioLine} ${i >= OPEN_CALLER_FROM ? s.callerLine : s.selfLine}`}>
              {line}
              {beat === 3 && i === arr.length - 1 && <span className={s.caret} />}
            </span>
          ))}
        </p>
      )}

      {beat >= 4 && (
        <>
          <div className={s.schoolLayer} style={{ backgroundImage: `url(${ASSET("still-zombie-rush.jpg")})` }} aria-hidden="true" />
          <div className={s.embers} aria-hidden="true">{Array.from({ length: 12 }).map((_, i) => <i key={i} />)}</div>
        </>
      )}
      {beat >= 3 && <div className={s.glow} aria-hidden="true" />}

      {beat === 5 || beat === 6 ? (
        <div className={s.noticeWrap}>
          <div className={`${s.notice} ${s.noticeRise}`}>
            <span className={s.noticeTag}>{OPENING.noticeTitle}</span>
            <p>{OPENING.noticeBody}</p>
            {beat >= 6 && (
              <button type="button" className={`${s.primaryBtn} ${s.answerBtn}`} onClick={answer}>{ANSWER_LABEL}</button>
            )}
          </div>
        </div>
      ) : null}

      {beat === 7 && (
        <div className={s.noticeWrap}>
          <div className={`${s.notice} ${s.noticeRise} ${s.dialog}`}>
            <p className={`${s.dlgLine} ${s.dlgMe}`}>{ANSWER_LABEL}</p>
            <p className={`${s.dlgLine} ${s.dlgRadio}`}>{reduced ? REPLY_LINE : reply}{!reduced && !replyDone && <span className={s.caret} />}</p>
            {(replyDone || reduced) && (
              <div className={s.dlgForm}>
                <p className={s.foundLine}>{DLG_ME_FOUND}</p>
                <div className={s.speakRow}>
                  <span className={s.speakPrefix}>{DLG_ME_PREFIX}</span>
                  <input
                    className={`${s.issueInput} ${s.speakInput}`} value={callsign} maxLength={12} autoFocus
                    placeholder="…" aria-label="이름"
                    onChange={(e) => setCallsign(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && callsign.trim()) issue(callsign.trim()); }}
                  />
                </div>
                <PhotoPicker photo={photo} onPick={setPhoto} onSelectName={(n) => { if (!callsign.trim()) setCallsign(n); }} />
                <div className={s.welcomeActs}>
                  <button type="button" className={s.primaryBtn} disabled={!callsign.trim()} onClick={() => issue(callsign.trim())}>그래, 옥상으로 갈게, 만나</button>
                  <button type="button" className={s.ghostBtn} onClick={() => issue("")}>이름은 나중에, 일단 갈게</button>
                </div>
                <span className={s.issueHint}>이름·사진은 내 학생증에 표시 · 사진은 이 기기에만 저장 · 나중에 정해도 된다</span>
              </div>
            )}
          </div>
        </div>
      )}

      {beat === 8 && (
        <div className={s.noticeWrap}>
          {/* A5 — 모닥불 부름 → 내 회상 → 학생증이 「내 기록」 모듈로 합쳐진다 (v1.0) */}
          <p className={`${s.dlgLine} ${s.dlgRadio} ${s.bonfireMsg}`}>{BONFIRE_MSG}</p>
          <StudentIdCard
            cardRef={cardRef} className={s.cardReveal} photo={photo}
            name={written === null ? null : written}
            writing={written !== null && written.length < callsign.length}
          />
          <div className={s.recallCol}>
            <span className={s.recallLine}>{recall}{recall.length < RECALL_LINE.length && <span className={s.caret} />}</span>
          </div>
        </div>
      )}

    </div>
  );
}

/* ── 스티키 HUD — 온라인 RPG 의 고정 인터페이스 역할(PM 2026-08-27).
   상시 확인 데이터(기록·진행·보유)와 이동을 한 곳에 모은다. 밀도 상한은 PM 판정으로 열어 두었다.
   이전의 상단 상태바 + 하단 내비 두 조각이 여기로 합쳐졌다. ── */
/* ── HUD 어댑터 — 지우학 데이터를 공통 HUD 계약(§3 주입 인터페이스)으로 빚는다.
   구조·동작은 전부 PopupHud(공통)의 것이고, 여기는 데이터 조립만 한다.
   계약: 40_dev/snapshots/ICONS-팝업-HUD-공통계약-v1-2026-08-28.md ── */
/* ── 섹션 소개(v5.0 · PM 2026-09-04 「메인페이지 섹션에서는 각 섹션 소개글과 상세페이지 버튼으로 통일 · 상세가 없으면 버튼 없음」) ──
   text = 그 섹션이 무엇인지 말하는 소개글(사실만 · 소비자 카피).
   detail = 그 섹션이 소개하는 것의 **본 화면**(존 id). 본 화면이 없는 섹션은 비운다 — 버튼도 서지 않는다.
   modal = 존이 아니라 모달이 본 화면인 경우(교문). */
/* 문 라벨은 화살표 없이 동사로 끝난다(PM 2026-09-07 「화살표 다 빼고 옥상으로 가기·현장 예약하기 식으로 풀어써」).
   이름이 곧 행동인 곳(예약)은 「~하기」, 장소는 받침을 따져 「~(으)로 가기」. */
const ACTION_ZONE_LABEL = { reserve: "현장 예약하기", preorder: "사전예약하기" };
const goLabel = (id) => {
  if (ACTION_ZONE_LABEL[id]) return ACTION_ZONE_LABEL[id];
  const nm = (ZONES.find((z) => z.id === id) || {}).name || id;
  const c = nm.charCodeAt(nm.length - 1) - 0xAC00;
  const jong = c >= 0 && c <= 11171 ? c % 28 : 0;
  return `${nm}${jong && jong !== 8 ? "으로" : "로"} 가기`;   // ㄹ 받침(8)은 「로」
};

/* 첫 문장은 초대문(aouad-copy.js SECTION_LEAD) · 뒤는 설명문 — 문체 규약 SOP_popup-copy-voice */
const SECTION_INTRO = {
  arrive: { text: `${SECTION_LEAD.arrive} 교문에서 시작해 굿즈·체험·한정판·커뮤니티를 지나 옥상에서 끝나는 하나의 여정입니다. 체험에서 목표를 달성하면 구매권이 열리고, 그 구매권으로 한정 상품을 삽니다.`, modal: "intro", modalLabel: "소개 보기" },
  shelf: { text: `${SECTION_LEAD.shelf} 전체 37종 가운데 20종을 이 화면에 진열했고, 나머지와 구매는 굿즈샵에서 이어집니다. 마음에 드는 상품은 찜해 두었다가 한 번에 담을 수 있습니다.`, detail: "store" },
  rights: { text: `${SECTION_LEAD.rights} 급식실·방송실·도서관·옥상에서 목표를 달성하면 그 상품의 구매권이 열리고, 열린 뒤에 굿즈샵에서 구매합니다. 지금 무엇이 열렸는지는 「보유」에서 볼 수 있습니다.`, detail: "store", lane: "right" },   /* 굿즈샵 전체가 아니라 **구매권 레인이 걸린 채로** 연다 — 방금 본 상품을 다시 찾게 하지 않는다 */
  kuji: { text: `${SECTION_LEAD.kuji} 어떤 상품이 몇 개 남았는지 실시간으로 공시하고, 한 회차가 끝나면 다음 구성으로 넘어갑니다. 자격 없이 누구나 바로 참여할 수 있습니다.`, detail: "kuji" },
  cafeteria: { text: `${SECTION_LEAD.cafeteria} 참여는 무료고, 오래 버틸수록 점수가 올라갑니다. 1,400p·2,200p·3,000p·3,600p 네 구간을 넘을 때마다 구매권이 하나씩 열립니다.`, detail: "cafeteria" },
  broadcast: { text: `${SECTION_LEAD.broadcast} 누르고 있으면 잡고 놓으면 미끄러집니다. 열린 창에서는 좀비가 튀어나오니 창과 창 사이에서 멈춰 기다립니다. 여덟 명 가운데 여섯 명 이상을 들여보내면 「다방」 무전기 키링 구매권이 열립니다.`, detail: "broadcast" },
  library: { text: `${SECTION_LEAD.library} 탈출에 성공하면 생존자 포토카드 팩 구매권이 열리고, 책갈피를 다 줍거나 한 번도 안 잡히는 등 조건을 더 채우면 열리는 상품이 늘어납니다.`, detail: "library" },
  raffle: { text: `${SECTION_LEAD.raffle} 회차마다 걸린 상품이 다르고 응모에는 돈이 들지 않습니다. 발표 시각은 화면에 표시됩니다.`, detail: "raffle" },
  preorder: { text: `${SECTION_LEAD.preorder} 예약자에게는 이름 각인과 선배송 특전이 붙고, 정식 판매 전에 수량을 확보할 수 있습니다.`, detail: "preorder" },
  fcfs: { text: `${SECTION_LEAD.fcfs} 매대마다 수량이 따로 잡혀 있어 한 곳이 마감돼도 다른 곳은 남아 있을 수 있습니다. 오픈 시각은 화면에서 확인합니다.`, detail: "fcfs" },
  wall: { text: `${SECTION_LEAD.wall} 다른 사람이 무엇을 샀고 어떤 체험을 했는지 볼 수 있고, 직접 글을 남길 수도 있습니다.` },
  notice: { text: `${SECTION_LEAD.notice} 존이 새로 열리거나 마감될 때, 추첨 결과가 나올 때 여기에 먼저 올라옵니다.` },
  offline: { text: `${SECTION_LEAD.offline} 방문 시간대는 30분 단위로 예약하고, 온라인에서 받은 생존자 인증으로 입장합니다.`, detail: "reserve" },
  rooftop: { text: `${SECTION_LEAD.rooftop} 옥상까지 완주하면 학생증 각인판과 모닥불 오르골 구매권이 함께 열립니다.`, detail: "rooftop" },
};

function AouadHud({ st, section, scene, zone, product, modal, onSection, onSceneJump, onReset, go, openProduct, update, onCheckout, onClaimWin, onOpenInfo, flyRef, tlPick, libPane = null, libLive = {}, band = "hero", onBand, storeLane = null, onStoreLane, meOpen, onMeOpenChange, productOption }) {
  const now = useNow();
  const rights = rightsOf(st);
  const held = RIGHTS.filter((r) => rights[r.id]);
  const left = RIGHTS.filter((r) => !rights[r.id]);
  const wishes = st.wishes.map((id) => mdById(id)).filter(Boolean);
  const spent = spentOf(st);
  const cart = cartRows(st);
  const cartCount = cart.reduce((n, c) => n + c.qty, 0);
  const zoneOf = (r) => (ZONES.some((z) => z.id === r.game) ? r.game : null);
  const nextTier = PURCHASE_TIERS.find((t) => spent < t.at);
  // 화면 스코프 다음 목표 — 체험 화면에서는 그 존의 구매권이 전역 목표보다 먼저
  const sceneKey = scene >= 0 && SCENES[scene] ? SCENES[scene].k : null;
  const sceneRight = sceneKey ? left.find((r) => r.game === sceneKey) : null;
  const nextRight = sceneRight || left[0];


  /* ── 나 패널 탭 본문(v6.0 · PM 2026-09-09 「상시 정보는 나 패널로」) = 내 소유물(게임의 퀘스트 로그·인벤토리·가방):
       퀘스트(남은 여정) · 보유(구매권·참여권·보관함 = 인벤토리) · 장바구니(세그: 장바구니·찜)
     컨텍스트 = 지금 화면이 정하는 본문(자동만 · 아래 contextOf). v4.5 의 fixed 점등(한 본문 공유)은 PR ③에서 사라졌다 */
  const questBody = { kind: "quest",
      rows: left.map((r) => ({ id: r.id, name: r.name, goal: r.goal,
        thumb: r.mdId ? ASSET(mdById(r.mdId)?.src) : undefined,
        progress: rightProgress(st, r.id), journey: rightJourney(st, r.id),
        go: zoneOf(r) && go ? { label: "도전하러 가기", act: () => go(zoneOf(r)) } : undefined })),
    empty: "남은 퀘스트 0" };
  const heldBody = { kind: "list", gain: true,
      /* 보유권 = 죽은 정보가 아니라 구매 동선 — 굿즈샵 사용처로 가는 문(v3.1) */
      /* 획득한 자리에서 바로 바구니에(v4.0) — 상품이 있는 구매권은 「담기」, 혜택형은 「쓰러 가기」 */
      rows: held.map((r) => ({ id: r.id, name: r.name, sub: r.grant || r.edition || "", on: true,
        thumb: r.mdId ? ASSET(mdById(r.mdId)?.src) : undefined,
        go: r.mdId && update ? { label: MD_DETAIL[r.mdId]?.options ? "옵션 선택하기" : "장바구니에 담기", act: () => MD_DETAIL[r.mdId]?.options ? openProduct(r.mdId, "hud") : addToCart(update, r.mdId) }
          : go ? { label: "쓰러 가기", act: () => go("store") } : undefined }))
        /* 참여권(v4.3 · PM 「참여권은 인벤토리에 저장 — HUD 컨텍스트 패널」) — st.tickets[존] 장수. 0장이면 행 없음.
           구매는 존 안 시트에서(한 판 = 한 장 소모) · 여기는 보유 표시 + 존 진입 문. 급식실은 체험 — 「회차」 어휘 금지 */
        .concat(Object.entries(st.tickets || {}).filter(([, n]) => n > 0).map(([zid, n]) => {
          const z = ZONES.find((x) => x.id === zid);
          return { id: `ticket-${zid}`, name: `${z ? z.name : zid} 참여권`, sub: `${n}장`, on: true,
            thumb: z && z.img ? ASSET(z.img) : undefined,
            go: go ? { label: goLabel(zid), act: () => go(zid) } : undefined };
        }))
        /* 보관함(v4.2) — 상자 당첨 상품. 행 = 배송 신청 문(0원 주문으로 기록) · 신청 후엔 상태만 */
        .concat((st.wins || []).map((w, i) => {
          const it = winItem(w);
          return { id: `win-${i}`, name: it ? it.name : `${w.grade}상`, sub: winSub(w), on: true,
            thumb: it ? ASSET(it.src) : undefined,
            go: !w.claimedAt && onClaimWin ? { label: "배송 신청하기", act: () => onClaimWin(i) } : undefined };
        })),
    empty: "보유 구매권 0" };
  const wishBody = { kind: "list", scroll: true,
      rows: wishes.map((m) => ({ id: m.id, name: m.name, sub: won(m.price), thumb: ASSET(m.src),
        go: openProduct ? { label: "보러 가기", act: () => openProduct(m.id, "hud") } : undefined })),
    empty: "찜 0" };
  /* 장바구니(v4.0) — 사기로 한 것. 행 = 상세로 가는 문 + 수량 조절 · 하단 고정 「주문하기」 · 담기 순간 버튼 점등 */
  const cartBody = { kind: "cart", gain: true, scroll: true,   /* 커머스 목록 = 내부 스크롤(v4.9 · PM 「일반 커머셜 사이트에 맞게 · 내부 스크롤 적극」) */
      rows: cart.map((c) => ({ id: c.key, name: `${c.md.name}${c.option ? ` · ${c.option}` : ""}`, sub: `${won(c.md.price)} × ${c.qty}`,
        right: won(c.md.price * c.qty), thumb: ASSET(c.md.src),
        qty: c.qty, max: c.qty + cartLimit(c.id) - cart.filter((row) => row.id === c.id).reduce((sum, row) => sum + row.qty, 0), onQty: update ? (q) => setCartQty(update, c.id, q, c.option) : undefined,
        go: openProduct ? { label: "상세 보기", act: () => openProduct(c.id, "hud") } : undefined })),
      cart: { count: cartCount, total: won(cartTotal(st)), cta: "주문하기", onCheckout },
    empty: "장바구니 0" };
  const spendBody = { kind: "spend",
      spend: { total: won(spent), label: "누적 구매 시연",
        pct: Math.min(100, (spent / PURCHASE_TIERS[PURCHASE_TIERS.length - 1].at) * 100),
        next: nextTier ? `다음 지점까지 ${won(nextTier.at - spent)}` : null,
        tiers: PURCHASE_TIERS.map((t) => {
          const md = t.mdId ? mdById(t.mdId) : null;
          const done = spent >= t.at;
          return { label: `${t.at / 10000}만`, name: t.name, done,
            thumb: md ? ASSET(md.src) : undefined,
            sub: `${md ? `${won(md.price)} · ` : ""}${t.line}`,
            state: done ? "해당 구간" : `${(t.at / 10000).toLocaleString()}만원 구간`,
            go: md && openProduct ? { act: () => openProduct(t.mdId, "hud") } : go ? { act: () => go("store") } : undefined };
        }),
        note: "구매 혜택 구성안 · 실제 구매권이나 우선 입장을 발급하지 않습니다" } };
  /* 개요(v4.4 · PM 「교문 컨텍스트 = 테마 소개(오프라인 팝업 소개글처럼) + 타임라인이면 족하다 · 상세는 모달」)
     — 바로가기 행 없음. 문 2 = 테마 소개 행 → 소개 모달 · 타임라인 블록 → 일정 모달 */
  /* 가변형 — 화면(존·모달·장면)별 본문. 표는 계약 v4.5 §2-1 */
  /* 도서관 컨텍스트(PM 2026-09-09) — 하는 법·구매권·미션이 **HUD 컨텍스트 패널의 세그먼트 셋**으로 선다.
     게임 위 버튼(폰)이 `libPane` 을 바꾸면 key 가 바뀌어 패널이 그 칩을 고른 채 열린다(`seg` + `open`).
     같은 버튼을 다시 눌러도 열리도록 누른 횟수(n)를 key 에 섞는다. 미션 진행은 게임이 `libLive` 로 올린다 */
  const libraryContext = () => {
    const r = rightDef("libPhoto");
    const has = !!rightsOf(st).libPhoto;
    const md = r.mdId ? mdById(r.mdId) : null;
    return {
      key: `zone:library${libPane ? `:${libPane.kind}:${libPane.n}` : ""}`,
      label: "도서관",
      seg: libPane ? libPane.kind : undefined,
      open: !!libPane,
      empty: "",
      segments: [
        { key: "guide", label: "하는 법", kind: "intro", intro: { text: LIB_GUIDE } },
        { key: "reward", label: has ? "구매권 보유" : "구매권", kind: "list", empty: "",
          rows: [{ id: "libPhoto", name: r.name, on: has, thumb: md ? ASSET(md.src) : undefined,
            sub: `${r.goal} · ${has ? "달성" : rightProgress(st, "libPhoto")} — ${md ? `${md.name} · ${r.edition}` : r.grant}`,
            go: has && go ? { label: "굿즈샵에서 구매권 쓰기", act: () => go("store") } : undefined }] },
        { key: "missions", label: `미션 ${LIB_MISSIONS.filter((m) => libLive[m.key]).length}/${LIB_MISSIONS.length}`, kind: "list", empty: "",
          rows: LIB_MISSIONS.map((m) => ({ id: m.key, name: m.label, sub: m.prize, on: !!libLive[m.key] })) },
      ],
    };
  };
  /* 체험 존 컨텍스트 = 밴드 셋(v6.0 PR ② · PM 「각 체험마다 각 섹션마다 다른 내용」 · 기획서 §5).
     이미지 = 소개 + 「체험 시작」 문 · 체험 = 하는 법 / 이 존 구매권 진행(기록 포함) · 매대 = 이 장면 굿즈 + 구매권 상품 열림/잠김.
     도서관 체험 밴드는 장면 트랙이 만든 세 세그(하는 법·구매권·미션)를 그대로 쓴다. 옥상은 결말 — 완주 조건과 구매권 2 */
  const GUIDE = { cafeteria: CAFE_GUIDE_LINES, broadcast: HOSE_GUIDE_LINES, library: LIB_GUIDE_LINES, rooftop: ROOF_GUIDE_LINES };
  const zoneContext = (z) => {
    const name = (ZONES.find((x) => x.id === z) || {}).name || z;
    const def = SECTION_INTRO[z];
    const zr = RIGHTS.filter((r) => r.game === z);
    if (band === "shelf") {
      const goods = (ZONE_GOODS[z] || []).map(mdById).filter(Boolean).map((m) => ({
        id: m.id, name: m.name, sub: won(m.price), thumb: ASSET(m.src),
        go: openProduct ? { label: "상세 보기", act: () => openProduct(m.id, "hud") } : undefined }));
      const gated = zr.filter((r) => r.mdId && mdById(r.mdId)).map((r) => { const m = mdById(r.mdId); const has = !!rights[r.id];
        return { id: `right:${r.id}`, name: m.name, on: has, thumb: ASSET(m.src),
          sub: has ? `구매권 열림 · ${won(m.price)}` : `잠김 — ${(r.goal.split(" — ")[1] || r.goal)}`,
          go: openProduct ? { label: has ? "상세 보기" : "조건 보기", act: () => openProduct(m.id, "hud") } : undefined }; });
      return { key: `zone:${z}:shelf`, label: `${name} · 매대`, kind: "list", empty: "이 장면의 굿즈가 아직 없다", rows: [...gated, ...goods] };
    }
    if (band === "play") {
      if (z === "library") return { ...libraryContext(), label: "도서관 · 체험" };   /* 장면 트랙의 세 세그 그대로 · 밴드 표기만 맞춘다 */
      const have = zr.filter((r) => rights[r.id]).length;
      return { key: `zone:${z}:play`, label: `${name} · 체험`, empty: "", segments: [
        { key: "guide", label: "하는 법", kind: "intro", intro: { text: <GuideLines items={GUIDE[z] || []} /> } },
        { key: "reward", label: `구매권 ${have}/${zr.length}`, kind: "quest", empty: "이 존의 구매권이 없다",
          rows: zr.map((r) => ({ id: r.id, name: r.name, goal: r.goal, thumb: r.mdId && mdById(r.mdId) ? ASSET(mdById(r.mdId).src) : undefined,
            progress: rights[r.id] ? "달성" : rightProgress(st, r.id), journey: rightJourney(st, r.id),
            go: rights[r.id] && go ? { label: "굿즈샵에서 구매권 쓰기", act: () => go("store", { lane: "right" }) } : undefined })) },
      ] };
    }
    return { key: `zone:${z}:hero`, label: name, kind: "intro", empty: "",
      intro: { text: def ? def.text : "", go: onBand ? { label: "체험 시작", act: () => onBand("play") } : undefined } };
  };
  /* ── 커머스·상세·예약 컨텍스트(v6.0 PR ③ · 기획서 §4) — 남아 있던 `ctx.fixed` 폴백(장바구니·보유·퀘스트) 셋을 화면 것으로 교체.
     장바구니·보유·퀘스트는 나 패널이 갖고, 컨텍스트는 **이 화면에서 지금 할 수 있는 것**만 말한다 ── */
  /* 상품 상세 = 이 상품의 값·판매 방식·재고·옵션·구매권 조건 한 줄씩 + 문 하나(담기 / 도전하러 가기). 담으면 나 원 배지(장바구니 gain) */
  const productContext = (id) => {
    const m = mdById(id);
    if (!m) return { key: `product:${id}`, label: "상품 상세", kind: "intro", empty: "", intro: { text: "" } };
    const d = MD_DETAIL[id] || {};
    const gated = !!m.right;
    const r = gated ? rightDef(m.right) : null;
    const unlocked = !gated || !!rights[m.right];
    const soldout = d.stock === 0;
    const inCart = cart.filter((c) => c.id === m.id).reduce((total, c) => total + c.qty, 0);
    const lim = cartLimit(m.id);
    const lines = [
      `${won(m.price)} · ${m.lanes.map((l) => LANE_LABEL[l]).join(" · ")}`,
      `재고 ${soldout ? "없음" : typeof d.stock === "number" ? `${d.stock.toLocaleString()}개` : "상시"}${d.limit ? ` · ${d.limit}` : ""}`,
    ];
    const booth = presentationDealSummary(st, { kind: "fcfs", productId: id });
    if (typeof booth.stock === "number") lines.push(`선착순 매대 잔여 ${booth.stock.toLocaleString()}개${booth.count ? ` · 내 주문 ${booth.count}개` : ""}`);
    if (d.options) lines.push(`${d.options.name} ${d.options.values.join(" · ")}`);
    if (gated && r) lines.push(unlocked ? `구매권 보유 — ${r.name}` : `구매권 필요 — ${r.goal.split(" — ").join(" ")} · ${rightProgress(st, m.right)}`);
    if (inCart) lines.push(`장바구니 ${inCart}/${lim}`);
    const status = getProductPresentationStatus(m, d, rights, st.cart);
    let door;
    if (d.options) lines.push(productOption ? `선택 ${productOption}` : "상세에서 사이즈를 선택해 주세요.");
    if (status.target && go) door = { label: status.text, act: () => go(status.target, { productId: id }) };
    else if (status.action === "add" && update && (!d.options || productOption)) door = { label: "장바구니에 담기", act: () => addToCart(update, m.id, productOption) };
    return { key: `product:${id}:${inCart}:${productOption || ""}`, label: "상품 상세", kind: "intro", empty: "",
      intro: { text: <GuideLines items={lines} />, go: door } };
  };
  /* 굿즈샵 = 진열 레인 안내(행 = 레인으로 가는 문 · 현재 레인 점등) + 찜(판정 ① — 장바구니는 나 패널로 갔다) */
  const storeContext = () => {
    const laneCount = LANE_ORDER.reduce((a, l) => { a[l] = MD.filter((m) => m.lanes.includes(l)).length; return a; }, {});
    const openRights = MD.filter((m) => m.right && rights[m.right]).length;
    const laneRow = (l) => ({ id: `lane:${l || "all"}`, name: l ? LANE_LABEL[l] : "전체", on: l ? storeLane === l : !storeLane,
      sub: l ? `${laneCount[l]}종${l === "right" ? ` · 열림 ${openRights}` : ""}` : `${MD.length}종`,
      go: onStoreLane ? { label: "보기", act: () => onStoreLane(l) } : undefined });
    return { key: `zone:store${storeLane ? `:${storeLane}` : ""}`, label: storeLane ? `굿즈샵 · ${LANE_LABEL[storeLane]}` : "굿즈샵", empty: "",
      segments: [
        { key: "lanes", label: "진열", kind: "list", empty: "", rows: [laneRow(null), ...LANE_ORDER.filter((l) => laneCount[l] > 0).map(laneRow)] },
        { key: "wish", label: `찜 ${wishes.length}`, ...wishBody },
      ] };
  };
  /* 현장 예약 = 안내(기간·시간·입장) + 내 예약(있으면 한 행 · 「예약 변경」은 예약을 풀고 존이 다시 고르게 한다) */
  const reserveContext = () => {
    const rsvNo = st.reserve ? `HS-${String(1000 + st.reserve.day * 17 + st.reserve.slot)}` : null;
    const md = (iso) => { const [, mo, d] = iso.split("-"); return `${Number(mo)}.${d}`; };
    return { key: `zone:reserve${st.reserve ? ":done" : ""}`, label: st.reserve ? "현장 예약 · 예약됨" : "현장 예약", empty: "",
      segments: [
        { key: "guide", label: "안내", kind: "intro", intro: { text: <GuideLines items={[
          `${md(OFFLINE.openAt)} – ${md(OFFLINE.closeAt)} · ${OFFLINE.hours}`, OFFLINE.entry, "입장은 생존자 인증 — 내 학생증이 입장권이다."]} /> } },
        { key: "mine", label: "내 예약", kind: "list", empty: "예약 없음 — 날짜와 시간대를 고른다",
          rows: st.reserve ? [{ id: "rsv", name: st.reserve.label, sub: `예약 번호 ${rsvNo}`, on: true,
            go: update ? { label: "예약 변경", act: () => update({ reserve: null }) } : undefined }] : [] },
      ] };
  };
  const contextOf = () => {
    const zName = (id) => (ZONES.find((z) => z.id === id) || {}).name || id;
    if (zone && !product && (PLAY_ZONES.includes(zone) || zone === "rooftop")) return zoneContext(zone);
    if (product) return productContext(product);
    if (zone === "store") return storeContext();
    if (zone === "kuji") return { key: `zone:${zone}`, label: `${zName(zone)} · 누적 구매`, ...spendBody };
    if (["raffle", "preorder", "fcfs"].includes(zone)) {
      const entries = zone === "raffle" ? RAFFLES : zone === "fcfs" ? FCFS : MD.filter((item) => item.lanes.includes("pre"));
      const rows = entries.map((entry) => {
        const id = entry.mdId || entry.id;
        const md = mdById(id);
        const summary = presentationDealSummary(st, { kind: zone, referenceId: entry.id, productId: id });
        const sub = zone === "raffle" ? `${summary.entrants.toLocaleString()}명 응모${summary.count ? " · 내 응모 완료" : ""}`
          : zone === "preorder" ? `${summary.reservations.toLocaleString()}명 예약${summary.count ? ` · 내 예약 ${summary.count}개` : ""}`
          : entry.state === "soon" ? "오픈 예정" : `잔여 ${summary.stock.toLocaleString()}개${summary.count ? ` · 내 주문 ${summary.count}개` : ""}`;
        return { id, name: md.name, sub, thumb: ASSET(md.src), go: openProduct ? { label: "상세 보기", act: () => openProduct(id, "hud") } : undefined };
      });
      return { key: `zone:${zone}`, label: zName(zone), empty: "", segments: [
        { key: "deals", label: "매대 현황", kind: "list", rows, empty: "" },
        { key: "spend", label: "누적 구매", ...spendBody },
      ] };
    }
    if (zone === "reserve") return reserveContext();
    if (zone) return { key: `zone:${zone}`, label: zName(zone), kind: "intro", empty: "", intro: { text: (SECTION_INTRO[ZONE_SCENE_KEY[zone] || zone] || {}).text || "" } };
    /* 메인페이지 섹션 = 전부 같은 모양(v5.0): 이 섹션이 무엇인지 소개글 + 상세로 가는 문 하나.
       상세가 없는 섹션(구매권 상품 밖의 커뮤니티·소식)은 버튼이 서지 않는다.
       퀘스트·보유·장바구니는 고정 버튼으로 어디서나 열 수 있으므로 섹션마다 다른 목록을 세울 이유가 없다. */
    const sc = scene >= 0 ? SCENES[scene] : null;
    if (!sc) return { key: "none", label: "", kind: "intro", empty: "", intro: { text: "" } };
    const k = `scene:${sc.k}`;
    const def = SECTION_INTRO[sc.k];
    /* 라벨 = 화면 이름만(v5.16 · PM 「뒤에 소개라고 붙은 건 별로야」) — 「교문 · 소개」→「교문」. 자에서 고른 항목·존만 「· 항목」이 붙는다 */
    if (!def) return { key: k, label: sc.t, kind: "intro", empty: "", intro: { text: "" } };
    const intro = { text: def.text,
      go: def.modal && onOpenInfo ? { label: def.modalLabel || "소개 보기", act: () => onOpenInfo(def.modal) }
        : def.detail && go ? { label: goLabel(def.detail), act: () => go(def.detail, def.lane ? { lane: def.lane } : undefined) }
        : undefined };
    /* 교문 = 팝업 일정의 **글자 자리**(PM 2026-09-07 「필요한 텍스트는 컨텍스트패널로」 ·
       「버튼을 클릭하면 컨텍스트 패널에서 해당 기간에 대한 소개와 바로가기 버튼이 나오면 돼」).
       무대의 자에서 일정을 고르면 이 패널이 **그 기간의 소개 + 바로가기**가 된다. 안 고르면 교문 소개글(v5.0) 그대로다.
       목록을 함께 세우지 않는 이유 = HUD 본문은 한 자리다(`.intro`가 `flex:1`) — 12행을 같이 세우면
       소개글에 3px 만 남아 실제로 안 읽힌다(실측). 자의 표시 11개가 곧 색인이므로 목록이 또 필요하지 않다. */
    if (sc.k === "arrive") {
      const at = (d, end) => new Date(`${d}T${end ? "23:59:59" : "00:00:00"}`).getTime();
      const md = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}.${d.getDate()}`; };
      const sel = tlPick && SCHEDULE.find((e) => e.id === tlPick);
      if (!sel) return { key: k, label: sc.t, kind: "intro", intro, empty: "" };
      const from = at(sel.from);
      const to = sel.to ? at(sel.to, true) : at(sel.from, true);
      const when = sel.to ? `${md(from)} – ${md(to)}` : md(from);
      const state = now < from ? `D-${Math.ceil((from - now) / 86400000)}` : now > to ? "종료" : "진행 중";
      /* 이름은 칩(「교문 · 래플 ②」)과 무대 한 줄이 이미 갖는다 — 여기서 또 쓰면 한 화면에 같은 이름이 셋이다 */
      /* open: 사람이 자에서 고른 항목이다 — 모바일은 이 컨텍스트가 서면 시트를 자동으로 열어 보여준다(v5.14 · PM 「타임라인 클릭 시 모달창이 등장」) */
      return { key: `${k}:${sel.id}`, label: `${sc.t} · ${sel.name}`, kind: "intro", empty: "", open: true,
        intro: { text: `${when} · ${state} — ${sel.about}`,
          go: go ? { label: goLabel(sel.go), act: () => go(sel.go) } : undefined } };
    }
    return { key: k, label: sc.t, kind: "intro", intro, empty: "" };
  };

  /* 「나」 패널(v6.0 · PM 2026-09-09 「상시적으로 봐야 하는 정보는 나 패널로」) — 게임 메뉴 모달. 탭 = 학생증 · 퀘스트 · 보유 · 장바구니.
     학생증 카드(데스크톱)·학생증 원(모바일)이 문이다. 컨텍스트 패널에서 고정 3 은 사라졌다 */
  const setMeOpen = onMeOpenChange;
  const [meTab, setMeTab] = useState("id");
  const meTabs = [
    { key: "quest", label: `퀘스트 ${left.length}`, ...questBody },
    { key: "held", label: `보유 ${held.length + (st.wins || []).length + Object.values(st.tickets || {}).filter((n) => n > 0).length}`, ...heldBody },
    { key: "cart", label: `장바구니 ${cartCount}`, segments: [
      { key: "cart", label: `장바구니 ${cartCount}`, ...cartBody },
      { key: "wish", label: `찜 ${wishes.length}`, ...wishBody },
    ] },
  ];
  const openMe = (tab = "id") => { setMeTab(tab); setMeOpen(true); };
  return (
    <>
    {meOpen && <MePanel st={st} update={update} tabs={meTabs} tab={meTab} onTab={setMeTab} onClose={() => setMeOpen(false)} />}
    <PopupHud
      identity={{ name: st.callsign || "미기재", photo: photoUrl(st.photo), title: "나 — 학생증·퀘스트·보유·장바구니", onClick: () => openMe("id") }}
      /* 수색 도장은 앞면이 아니라 뒷면 기록란 소유(PM 2026-09-01 「앞면의 수색 내용 다 뒷면으로」) —
         앞면 = 신분(사진·성명·인장)만, 진행 기록 = IdCardBack·퀘스트 탭 */
      identityCard={<StudentIdCard cardRef={flyRef} name={st.callsign} photo={st.photo} />}
      /* 나 열 = 학생증 한 장 + 나 패널의 문(v6.0). 탭 본문(퀘스트·보유·장바구니)은 me 로도 넘긴다 —
         HUD 는 배지·맥동과 ctx.fixed 폴백(존 페이지 등 옛 컨텍스트)에만 쓴다 */
      me={meTabs}
      context={contextOf()}
      alert={(() => {
        /* 소식은 「내 소유물」도 「지금 화면」도 아니다 — 상시 자리를 주지 않고, 안 읽은 게 있을 때만 알린다.
           읽음 처리는 공식 소식 화면에 서면 셸이 한다(v5.7) */
        const unread = NOTICES.filter((n) => !(st.readNews || []).includes(n.id)).length;
        const si = SCENES.findIndex((x) => x.k === "notice");
        return unread > 0 && onSceneJump && si >= 0
          ? { count: unread, label: "새 소식", act: () => onSceneJump(si) }
          : undefined;
      })()}
      nextGoals={{
        /* 몰입 요약 바(부칙 6) 한 줄 전용 — 퀘스트 본체는 탭(v2.7c) */
        primary: nextRight ? { name: nextRight.name, progress: rightProgress(st, nextRight.id) } : null,
      }}
      nav={{
        chapters: SECTIONS,
        sceneCountOf: SECTIONS.map((_, i) => SCENES.filter((x) => x.ch === i).length),
        sceneCount: SCENES.length,
        subScenes: SCENES.map((x, gi) => ({ gi, t: x.t, ch: x.ch })).filter((x) => x.ch === section),
        section, scene,
      }}
      immersive={!!zone && PLAY_ZONES.includes(zone)}   /* 몰입 존(급식실·방송실·도서관 — 손이 조작에 묶이는 실시간 게임) = 모바일 시트를 내린다(v5.18 · 계약 §1-2) */
      onSection={onSection} onSceneJump={onSceneJump} onReset={onReset}
      floorplan={<FloorplanMini st={st} section={section} onJump={onSection} variant="wide" />}
      floorplanSheet={<FloorplanMini st={st} section={section} onJump={onSection} />}
      active={section >= 0 && !modal && !meOpen} /* 모달·나 패널이 떠 있으면 ←→ 화면 이동 키 개입 금지(v4.1·v6.0) */
    />
    </>
  );
}

/* ── 딜 벤토 — 메인페이지 룩 목업 v0 문법 이식 (래플 중앙 스택 · 사전예약 참여 카드 · 럭키드로우 이치방쿠지 · 선착순 굿즈샵 4열)
   수치·타이머 = 시연 목업(블록마다 라벨). 정식 거래 = 개발 트랙 — ADR-0018(랜덤 판매 확률·잔여 공시) · ADR-0021 부칙1(게임 보상→구매권 허용, 구매→게임 유리 금지: 어떤 딜도 체험의 조건이 아니다) ── */
/* 셈·표기·시계는 `deal-format` 이 갖는다 — 존과 얼굴이 같은 숫자를 같은 모양으로 말해야 한다 */

function RaffleStage({ base, now, onDemo, openProduct, dealState }) {
  const [i, setI] = useState(0);
  const r = RAFFLES[i];
  const md = mdById(r.mdId);
  const request = { kind: "raffle", referenceId: r.id };
  const summary = presentationDealSummary(dealState, request);
  const entered = summary.count > 0;
  return (
    <div className={`${s.dealBox} ${s.sp8}`} data-mtype="event">
      <div className={s.rfStage}>
        <span className={s.rfSrc}>지금 우리 학교는</span>
        <b className={s.rfName}>{md.name}</b>
        <span className={s.rfEdition}>{r.edition}</span>
        {/* 사진 = 상품 상세로 가는 문. 딜에서 본 상품을 사러 굿즈 장까지 되돌아가지 않는다 */}
        <div className={s.rfPhoto} role="link" tabIndex={0} aria-label={`${md.name} 상세`}
          style={{ backgroundImage: `url(${ASSET(md.src)})` }}
          onClick={() => openProduct?.(md.id, "hub")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduct?.(md.id, "hub"); } }}
        ></div>
        <div className={s.rfTimer}>{fmtLeft(base + r.closeIn - now)}</div>
        <span className={s.rfClose}>응모 마감까지</span>
        <span className={s.rfCount}><b>{summary.entrants.toLocaleString()}</b>명 응모</span>
        <button type="button" className={s.primaryBtn} onClick={() => onDemo({ ...request, viewRecord: entered })}>{entered ? "내 응모 기록 보기" : "응모하러 가기"}</button>
        <div className={s.rfRail}>
          {RAFFLES.map((x, k) => {
            const m = mdById(x.mdId);
            return (
              <button key={x.id} type="button" className={`${s.rfChip} ${k === i ? s.sel : ""}`} onClick={() => setI(k)}>
                <i style={{ backgroundImage: `url(${ASSET(m.src)})` }} /><b>{m.name}</b>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PreorderCard({ base, now, onDemo, openProduct, dealState, initialProductId }) {
  const choices = MD.filter((item) => item.lanes.includes("pre"));
  const [selected, setSelected] = useState(() => choices.some((item) => item.id === initialProductId) ? initialProductId : PREORDER.mdId);
  const md = mdById(selected);
  const request = { kind: "preorder", productId: md.id };
  const progress = presentationDealSummary(dealState, request);
  return (
    <div className={`${s.dealBox} ${s.preCard}`} data-mtype="event">
      <div className={s.preThumb} role="link" tabIndex={0} aria-label={`${md.name} 상세`}
        style={{ backgroundImage: `url(${ASSET(md.src)})` }}
        onClick={() => openProduct?.(md.id, "hub")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduct?.(md.id, "hub"); } }}
      ></div>
      <div className={s.preBody}>
        <span className={s.preK}>Pre-order</span>
        <label className={s.preSub}>예약 굿즈
          <select aria-label="예약 굿즈 선택" value={selected} onChange={(event) => setSelected(event.target.value)}
            style={{ display: "block", width: "100%", maxWidth: "100%", padding: "10px 12px", marginTop: 8, border: "1px solid var(--line)", borderRadius: 8, background: "#151b22", color: "var(--ink)", font: "inherit" }}>
            {choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <b className={s.preName}>{md.name}</b>
        <span className={s.preSub}>{md.id === PREORDER.mdId ? `특전 · ${PREORDER.perk}` : "상품과 옵션을 확인하는 사전예약 체험"}</span>
        <span className={s.preSub}>{won(md.price)}</span>
        <div className={s.preTimer}>{fmtLeft(base + PREORDER.closeIn - now)}<small>마감까지</small></div>
        <span className={s.preSub}>{md.id === PREORDER.mdId ? <><b>{progress.reservations.toLocaleString()}</b>명 예약</> : progress.count ? `내 예약 ${progress.count}개` : "희망하는 옵션을 선택해 주세요."}</span>
        <button type="button" className={`${s.primaryBtn} ${s.dealCta}`} onClick={() => onDemo({ ...request, viewRecord: progress.count > 0 })}>{progress.count ? "내 예약 기록 보기" : "예약하기"}</button>
      </div>
    </div>
  );
}

// 회차 무대 — 네 회차를 나눈 근거가 「뽑는 동작이 다르다」인데 화면이 넷 다 같은 격자면 그 차이가 사라진다.
// 그래서 무대 에셋이 준비된 회차는 전용 렌더를 쓴다(PM 2026-08-28). 준비 안 된 회차는 공용 티켓 격자 그대로 —
// 여기 항목을 추가하는 것이 곧 그 회차의 무대를 켜는 일이다.

// 배선 가로줄 — 실제 회차에서는 씨앗이 정한다. 시연판은 뽑기가 돌지 않으므로
// 회차 id 로 고정된 배치를 만들어 무대 장식으로만 쓴다(같은 회차면 늘 같은 그림).
function ladderRungs(seedText, cols, rows, density) {
  let h = 2166136261;
  for (const ch of seedText) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
  const out = [];
  for (let r = 0; r < rows; r++) {
    let last = -2;
    for (let c = 0; c < cols - 1; c++) {
      if (c - last < 2 && last >= 0) continue;   // 같은 단에 가로줄을 붙여 놓지 않는다
      if (rnd() < density) { out.push({ r, c }); last = c; }
    }
  }
  return out;
}

/* ── 하는 법 = 밴드 안의 한 모듈(PM 2026-09-07 「가이드라인 글은 하나의 모듈 안에 넣어서 시인성이 더 좋도록」).
   바탕에 그냥 얹힌 --dim 문단은 바로 아래 무대에 묻혀 읽히지 않는다. 면·테두리·불씨 레일을 줘서 한 덩어리로 세운다.
   머리표는 매대의 「이 장면의 굿즈」와 같은 글씨 — 밴드마다 무엇이 담겼는지 같은 자리에서 말한다. ── */
/* ── 섹션 머리 = 히어로 리드와 같은 문법(영문 눈썹 + 이름)을 한 단 작게. 섹션 이름이 눈에 띄어야 한다(PM 2026-09-08).
   오른쪽 자리는 문(굿즈샵으로 가기)이 쓴다. ── */
function ZoneSecHead({ eyebrow, title, right }) {
  return (
    <div className={s.secHead}>
      <div>
        <span className={s.leadEyebrow}>{eyebrow}</span>
        <h4 className={s.secTitle}>{title}</h4>
      </div>
      {right}
    </div>
  );
}

/* 하는 법 문장 규약(PM 2026-09-09 · 전 체험존 공통): 줄표(—)로 이어 붙여 설명하지 않는다.
   짧은 평문을 한 줄에 하나씩, 불릿으로 세운다. 한 줄은 한 가지만 말한다.
   `<span>` 블록으로 그리는 이유 — HUD 소개 칸이 `<p>` 안에 넣으므로 `<ul>` 은 못 쓴다(문단 안의 목록은 문단을 깨뜨린다). */
function GuideLines({ items }) {
  return items.map((t, i) => <span key={i} className={s.guideLine}>{t}</span>);
}

function ZoneGuide({ items, children, deskOnly = false }) {
  return (
    <div className={`${s.zoneGuide} ${deskOnly ? s.libDesk : ""}`}>
      <span className={s.zgLabel}>하는 법</span>
      <p>{items ? <GuideLines items={items} /> : children}</p>
    </div>
  );
}

/* ── 이 장면의 굿즈(PM 2026-08-28): 존마다 명장면에 어울리는 상품을 진열 —
   **몇 종을 걸지는 `ZONE_GOODS` 가 정한다**(지금은 존마다 3종). 칸 수는 폭이 정하므로 4종·5종을 넣어도 그대로 선다(PM 2026-09-08).
   **상시 판매만 건다**(PM 2026-09-08) — 체험으로 구매권을 따야 사는 상품은 게임 안 선반 소관이다. —
   체험 입구에서부터 구매 대상이 보인다(설계서 §5-2 「게임 안 상품 스트립」). 무크롬·잠금 오버레이 문법 공유. ── */
const ZG_MAX = 6;   // 한 장면에 걸 최대 종수(PM 2026-09-08) — 그 너머는 굿즈샵이 받는다

function ZoneGoodsStrip({ ids, openProduct, go }) {
  /* **상시 판매만 건다**(PM 2026-09-08) — 구매권이 있어야 사는 체험 기반 상품은 게임 안 선반이 맡는다.
     데이터에서 이미 골라 넣지만 여기서 한 번 더 거른다: 매대 규칙은 큐레이션 실수보다 오래 간다. */
  const open = ids.map(mdById).filter((m) => m && !m.right).slice(0, ZG_MAX);
  if (!open.length) return null;
  return (
    <section className={`${s.zoneSec} ${s.zgWrap}`}>
      {/* 굿즈샵 문은 한 화면에 **둘이다** — 구매권 선반의 「보유 구매권으로 굿즈샵 가기」와 여기. 가는 곳은 같고 문맥이 다르다
          (구매권 vs 상시 판매). PM 판정 「둘 다 둬」(2026-09-08) — 중복으로 보고 하나를 지우지 말 것. */}
      <ZoneSecHead eyebrow="GOODS" title="이 장면의 굿즈"
        right={go && <button type="button" className={s.ghostBtn} onClick={() => go("store")}>{goLabel("store")}</button>} />
      {/* 진열 = 세로 사진 위에 이름·값이 얹힌 편집숍 선반. 짝수 칸이 살짝 내려앉아 선반이 물결친다(PM 2026-09-08 「유려하게」) */}
      <div className={s.zgRow}>
        {open.map((m) => (
          <div key={m.id} role="link" tabIndex={0} className={s.zgCard}
            onClick={() => openProduct?.(m.id, "hub")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduct?.(m.id, "hub"); } }}>
            <div className={s.zgPh} style={{ backgroundImage: `url(${ASSET(m.src)})` }} />
            <span className={s.zgCap}>
              <span className={s.zgName}>{m.name}</span>
              <b className={s.zgPrice}>{won(m.price)}</b>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 딜 소개(무대) — 게임·매대는 자기 화면으로(존 문법, PM 2026-08-28 「메인에서는 소개하는 깔끔한 섹션」).
   존 문 화면과 같은 구성: 액자 스틸 + 리드 + 들어가기. 규칙은 ? 툴팁, 상태 요약 한 줄. ── */
/* mtype 은 매대의 자격 구조가 정한다(ADR-0032): 응모·마감이면 이벤트, 돈만 내면 사면 커머스.
   럭키드로우는 자격 없이 사는 상품이라 커머스다 — 화면 문법은 같아도 유형은 다르다. */
function DealIntro({ en, title, hint, img, meta, id, go, mtype = "event", face }) {
  // 페이즈 상태(§2-2 시연 반영): 편성 창 밖이면 문이 쉰다 — 화면은 남는다(아카이브 원칙)
  const now = useNow();
  const ps = dealStatusOf(id, now);
  // 상태 라벨은 상태가 혼재할 때만(UI 품질 계약 ④ — PM 2026-08-31 재정): 전 딜이 같은 상태면 라벨은 군더더기다
  const mixed = new Set(Object.keys(DEAL_PHASE).map((k) => dealStatusOf(k, now).t)).size > 1;
  return (
    <div className={s.zoneScene} data-mtype={mtype}>
      {/* 액자에 무엇이 걸리는가 — 매대는 스틸로 분위기를 말하고, 게임은 자기 판으로 말한다(PM 2026-08-31) */}
      {face || <span className={s.zoneStill} style={{ backgroundImage: `url(${ASSET(img)})` }} aria-hidden="true" />}
      <div className={s.lead}>
        <span className={s.leadEyebrow}>{en} {hint && <Hint text={hint} />}</span>
        <h3 className={s.leadTitle}>{title}</h3>
        {ZONE_CALL[id] && <p className={s.leadCall}>{ZONE_CALL[id]}</p>}   {/* 커머스 문 한 줄 — 구매 동사(aouad-copy.js) */}
        <div className={s.leadActs}>
          {ps.t === "on" ? (
            <button type="button" className={s.leadBtnOn} onClick={() => go(id)}>들어가기</button>
          ) : (
            <span className={s.dealClosed}>{ps.t === "before" ? `${ps.at} 오픈 · D-${ps.d}` : "이번 팝업 종료"}</span>
          )}
          {ps.t === "on" && DEAL_PHASE[id] && mixed && <span className={s.dealLive}><i aria-hidden="true" />진행 중</span>}
          {meta && ps.t !== "closed" && <span className={s.leadStamp}>{meta}</span>}
        </div>
      </div>
    </div>
  );
}

/* 딜 존 공통 — 딜 시계·시연 토스트를 자체 소유한다(무대 밖에서도 돈다) */
function useDealZone() {
  const now = useNow();
  const [dealState, update] = usePresentationState();
  const base = dealState.clockStartedAt ?? now;
  const [request, setRequest] = useState(null);
  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);
  const demo = (what) => {
    if (what && typeof what === "object") { setRequest(what); return; }
    setToast(`${what} 체험은 이 화면의 회차에서 진행합니다.`);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 1800);
  };
  useEffect(() => () => clearTimeout(toastRef.current), []);
  const confirm = (selection) => {
    let result;
    update((previous) => {
      result = completePresentationDeal(previous, request, selection, rightsOf(previous));
      return result.next;
    });
    return result;
  };
  return { base, now, demo, toast, dealState, request, confirm, close: () => setRequest(null) };
}
function RaffleZone({ openProduct }) {
  const { base, now, demo, toast, dealState, request, confirm, close } = useDealZone();
  return (<div><RaffleStage base={base} now={now} onDemo={demo} openProduct={openProduct} dealState={dealState} />{toast && <div className={s.toast} role="status">{toast}</div>}
    {request && <PresentationDealDialog request={request} state={dealState} rights={rightsOf(dealState)} onConfirm={confirm} onClose={close} onProduct={openProduct} />}</div>);
}
function PreorderZone({ openProduct, initialProductId }) {
  const { base, now, demo, toast, dealState, request, confirm, close } = useDealZone();
  return (<div><PreorderCard base={base} now={now} onDemo={demo} openProduct={openProduct} dealState={dealState} initialProductId={initialProductId} />{toast && <div className={s.toast} role="status">{toast}</div>}
    {request && <PresentationDealDialog request={request} state={dealState} rights={rightsOf(dealState)} onConfirm={confirm} onClose={close} onProduct={openProduct} />}</div>);
}
function FcfsZone({ openProduct }) {
  const { base, now, demo, toast, dealState, request, confirm, close } = useDealZone();
  return (<div><FcfsRow base={base} now={now} onDemo={demo} openProduct={openProduct} dealState={dealState} />{toast && <div className={s.toast} role="status">{toast}</div>}
    {request && <PresentationDealDialog request={request} state={dealState} rights={rightsOf(dealState)} onConfirm={confirm} onClose={close} onProduct={openProduct} />}</div>);
}
function KujiZone({ openProduct }) {
  const { base, now, demo, toast } = useDealZone();
  return (<div><KujiBoard base={base} now={now} onDemo={demo} openProduct={openProduct} />{toast && <div className={s.toast} role="status">{toast}</div>}</div>);
}

function KujiBoard({ base, now, onDemo, openProduct }) {
  const [round, setRound] = useState(0);
  const k = KUJI[round];
  const [drawState, updateDrawState, drawReady] = usePresentationState();
  const savedDraw = presentationDrawState(drawState, k.id, now);
  const onDrawCommitted = useCallback((commit) => updateDrawState((p) => recordPresentationDraw(p, commit)), [updateDrawState]);
  const persistence = { roundId: k.id, initialDrawState: savedDraw, onDrawCommitted };
  const soon = k.state === "soon";
  const stage = KUJI_STAGE[k.id];
  const wallLive = stage?.live && stage.kind === "wall" && !stage.dark;
  const shaftLive = stage?.live && stage.kind === "shaft";
  const isWire = stage?.field?.type === "wires";
  // A presenter explores their own local lot; invented competing shoppers never consume it.
  const box = useBoxRound({ seed: stage?.seed ?? 0, rivals: 0, enabled: drawReady && !!wallLive, ...persistence });
  const dropBox = useDropRound({ seed: stage?.seed ?? 0, rivals: 0, enabled: drawReady && !!(shaftLive && !isWire), ...persistence });
  const wireBox = useWireRound({ seed: stage?.seed ?? 0, rivals: 0, enabled: drawReady && !!(shaftLive && isWire), ...persistence });
  const darkBox = useDarkRound({ seed: stage?.seed ?? 0, rivals: 0, enabled: drawReady && !!(stage?.live && stage.dark), ...persistence });
  const dark = stage?.live && stage.dark && darkBox.snap ? darkBox : null;
  const live = wallLive && !stage?.dark && box.snap ? box : null;
  const drop = shaftLive && !isWire && dropBox.snap ? dropBox : null;
  const wire = shaftLive && isWire && wireBox.snap ? wireBox : null;
  const snapshot = (dark || live || drop || wire)?.snap;
  const limitReached = !!snapshot && snapshot.today >= snapshot.dailyLimit;
  const drawUnavailable = limitReached || snapshot?.left === 0;
  const drawUnavailableLabel = limitReached ? `오늘 체험 완료 (${snapshot.dailyLimit} / ${snapshot.dailyLimit}회)` : "이 회차의 모든 칸을 열었습니다";
  const total = snapshot?.total ?? k.total;
  const left = snapshot?.left ?? (stage?.live ? k.total : k.total - k.drawn.length);
  const prizes = k.prizes.map((prize, index) => {
    // The original drop catalog lists pouch/whistle in the reverse order to its engine.
    const prizeIndex = k.id === "k2" && (index === 5 || index === 6) ? 11 - index : index;
    if (prize.grade === "LAST") return { ...prize, left: null };
    return { ...prize,
      count: snapshot?.prizes[prizeIndex]?.count ?? prize.count,
      left: snapshot?.remaining[prizeIndex] ?? (stage?.live ? prize.count : prize.left),
    };
  });
  const cellState = (n) => (dark ? dark.snap.cell[n]
    : live ? live.snap.cell[n]
    : drop ? drop.snap.cell[n]
    : wire ? wire.snap.cell[n]
    : (stage?.live || !k.drawn.includes(n + 1) ? "open" : "taken"));
  return (
    <div className={`${s.dealBox} ${s.sp12}`} data-mtype="commerce">
      <div className={s.kjTabs} role="group" aria-label="럭키드로우 회차">
        {KUJI.map((x, i) => (
          <button key={x.id} type="button" aria-pressed={i === round} className={`${s.kjTab} ${i === round ? s.on : ""}`} onClick={() => setRound(i)}>
            {x.name}<small>잔여 {i === round ? left : x.total - presentationDrawState(drawState, x.id, now).taken.length}</small>
          </button>
        ))}
      </div>
      <div className={s.kuji}>
        <div className={s.kjTickets}>
          <span className={s.kjLeft}>잔여 <b>{left}</b> / {total}{stage ? stage.unit : "장"}</span>
          {stage ? (
            <>
              <div className={s.lkHero} style={{ backgroundImage: `url(${ASSET(stage.hero)})` }}>
                <span>{stage.theme}</span>
              </div>
              {/* 열린 칸이 곧 잔여 표시다 — 무엇이 빠졌는지 보이는 것이 이 회차의 전부다(G1 P2 명세) */}
              {/* 소등 후 회차는 「안 보이는 것」이 규칙이다 — 벽에 표식을 달아 칸을 어둠에 묻는다.
                  빛이 닿은 칸만 드러난다(엔진의 정보 계약과 화면이 같은 말을 해야 한다). */}
              <div className={s.lkWall} data-dark={stage.dark ? "" : undefined}
                style={{ backgroundImage: stage.bgDim
                  ? `linear-gradient(rgba(24,28,22,${stage.bgDim}),rgba(24,28,22,${stage.bgDim})),url(${ASSET(stage.bg)})`
                  : `url(${ASSET(stage.bg)})` }}>
                {stage.kind === "shaft" && (
                  <>
                    <div className={s.lkEntry} aria-hidden={!drop && !wire}>
                      {Array.from({ length: 10 }).map((_, c) => (
                        drop ? (
                          <button key={c} type="button" disabled={drawUnavailable || !!drop.fall}
                            className={`${s.lkEntryBtn} ${drop.entry === c ? s.lkMine : ""}`}
                            style={{ backgroundImage: `url(${ASSET(stage.entry)})` }}
                            aria-label={`${c + 1}번 투입구${drop.snap.aCol === c ? " — 이 열에 A상이 남아 있다" : ""}`}
                            onClick={() => drop.pick(c)}>
                            <b>{c + 1}</b>
                          </button>
                        ) : wire ? (
                          <button key={c} type="button" disabled={drawUnavailable || !!wire.trace}
                            className={`${s.lkEntryBtn} ${wire.start === c ? s.lkMine : ""} ${c in wire.snap.known ? s.lkKnown : ""}`}
                            style={{ backgroundImage: `url(${ASSET(stage.entry)})` }}
                            aria-label={`${c + 1}번 출발점 — ${c in wire.snap.known ? `${wire.snap.known[c] + 1}열로 이어진다` : "어디로 가는지 아직 모른다"}`}
                            onClick={() => wire.pick(c)}>
                            <b>{c in wire.snap.known ? `${c + 1}-${wire.snap.known[c] + 1}` : c + 1}</b>
                          </button>
                        ) : (
                          <i key={c} style={{ backgroundImage: `url(${ASSET(stage.entry)})` }}><b>{c + 1}</b></i>
                        )
                      ))}
                    </div>
                    {/* 핀·배선은 통짜 그림이 아니라 조각을 계산된 자리에 찍는다 —
                        판을 그림으로 받으면 회차가 바뀔 때 그림이 거짓말이 된다(P4 사양) */}
                    <div className={s.lkField} aria-hidden="true">
                      {stage.field.type === "pegs"
                        ? Array.from({ length: stage.field.rows }).flatMap((_, r) =>
                            Array.from({ length: 10 }).map((_, c) => {
                              const x = (c + 0.5 + (r % 2 ? 0.5 : 0)) * 10;
                              if (x > 99) return null;
                              return <i key={`${r}-${c}`} className={s.lkPeg}
                                style={{ backgroundImage: `url(${ASSET(stage.field.sprite)})`,
                                  left: `${x}%`, top: `${((r + 0.5) / stage.field.rows) * 100}%` }} />;
                            }))
                        : (
                          <>
                            {Array.from({ length: 10 }).map((_, c) => (
                              <i key={`v${c}`} className={s.lkWireV}
                                style={{ backgroundImage: `url(${ASSET(stage.field.v)})`, left: `${(c + 0.5) * 10}%` }} />
                            ))}
                            {(wire
                              ? wire.snap.rungs.flatMap((row, r) => row.map((c) => ({ r, c })))
                              : ladderRungs(k.id, 10, stage.field.rows, stage.field.density)
                            ).map((g, i) => (
                              <i key={`h${i}`} className={s.lkWireH}
                                style={{ backgroundImage: `url(${ASSET(stage.field.h)})`,
                                  left: `${(g.c + 0.5) * 10}%`, top: `${((g.r + 0.5) / stage.field.rows) * 100}%` }} />
                            ))}
                          </>
                        )}
                      {/* 떨어지는 보급품 — 경로는 이미 정해져 있고 여기서는 그 길을 보여 줄 뿐이다 */}
                      {wire?.trace && (
                        <i className={s.lkTracer} aria-hidden="true"
                          style={{ left: `${(wire.trace.path[wire.trace.step].c + 0.5) * 10}%`,
                            top: `${(wire.trace.step / wire.trace.path.length) * 100}%` }} />
                      )}
                      {drop?.fall && stage.payload && (
                        <i className={s.lkPayload} aria-hidden="true"
                          style={{ backgroundImage: `url(${ASSET(stage.payload)})`,
                            left: `${(drop.fall.path[drop.fall.step] / 2 + 0.5) * 10}%`,
                            top: `${(drop.fall.step / drop.fall.path.length) * 100}%` }} />
                      )}
                    </div>
                  </>
                )}
                <div className={s.lkGrid} aria-label={`남은 ${stage.unit} ${left} / ${total}`}>
                  {Array.from({ length: total }).map((_, n) => {
                    const cs = cellState(n);
                    const taken = cs === "taken";
                    const cls = [s.lkCell, taken ? s.lkOpen : "", cs === "mine" ? s.lkMine : "",
                      cs === "rival" ? s.lkRival : "", live && live.opening === n ? s.lkOpening : ""].join(" ");
                    const label = { open: "남음", mine: "내가 고름", rival: "다른 사람이 선택 중", taken: "뽑힘" }[cs];
                    if (dark) {
                      const litNow = dark.beam.includes(n);
                      const litBefore = dark.snap.lit.includes(n);
                      return (
                        <button key={n} type="button" disabled={taken || drawUnavailable}
                          className={`${s.lkCell} ${taken ? s.lkOpen : ""} ${dark.target === n ? s.lkMine : ""} ${litNow || litBefore ? s.lkLit : ""}`}
                          /* 빛이 닿은 칸은 밝기를 올리는 게 아니라 밝은 사진으로 갈아 끼운다 */
                          style={{ backgroundImage: `url(${ASSET(taken ? stage.open : (litNow || litBefore) && stage.lit ? stage.lit : stage.closed)})` }}
                          aria-label={`${n + 1}번 ${stage.unit} — ${taken ? "열림" : dark.mode === "scan" ? "비추기" : "열기"}`}
                          onMouseEnter={() => dark.hover(n)} onMouseLeave={() => dark.hover(null)}
                          onFocus={() => dark.hover(n)} onBlur={() => dark.hover(null)}
                          onClick={() => dark.tap(n)}>
                          <b>{n + 1}</b>
                          {litNow && stage.beam && (
                            <span className={s.lkBeam} aria-hidden="true"
                              style={{ backgroundImage: `url(${ASSET(stage.beam)})` }} />
                          )}
                        </button>
                      );
                    }
                    return live ? (
                      <button key={n} type="button" className={cls} disabled={taken || cs === "rival" || drawUnavailable}
                        style={{ backgroundImage: `url(${ASSET(taken ? stage.open : stage.closed)})` }}
                        aria-label={`${n + 1}번 ${stage.unit} — ${label}`} onClick={() => live.toggle(n)}>
                        <b>{n + 1}</b>
                        {/* 개봉 순간 — 문이 열리며 먼지가 인다. 소리와 같은 1.2초를 산다. */}
                        {live.opening === n && stage.fx && (
                          <span className={s.lkFx} aria-hidden="true"
                            style={{ backgroundImage: `url(${ASSET(stage.fx)})` }} />
                        )}
                      </button>
                    ) : (
                      <i key={n} className={cls}
                        style={{ backgroundImage: `url(${ASSET(taken ? stage.open : stage.closed)})` }}
                        aria-label={`${n + 1}번 ${stage.unit} ${label}`}>
                        <b>{n + 1}</b>
                      </i>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className={s.tGrid} aria-label={`티켓 ${left} / ${k.total}`}>
              {Array.from({ length: k.total }).map((_, n) => (
                <i key={n} className={`${s.tk} ${k.drawn.includes(n + 1) ? s.used : ""}`}>{n + 1}</i>
              ))}
            </div>
          )}
        </div>
        <div className={s.kjInfo}>
          <span className={s.rfSrc}>지금 우리 학교는</span>
          <b className={s.kjName}>{k.name}</b>
          <span className={s.kjPrice}>{won(k.price)} / 1회</span>
          <div className={s.kjTimer}>{stage?.live ? "체험용 구성 · 실제 결제·배송 없음" : <>{soon ? "오픈까지" : "회차 종료까지"} {fmtLeft(base + k.endIn - now)}</>}</div>
          {/* 구성표 — 등급·품목·잔여. 상자 전용 소품(BOX_ITEMS)은 실물 에셋이 별도 제작 중이라
              이미지 없이 등급 글자로 자리를 표시한다. 이 표에서 중요한 건 사진이 아니라 잔여다. */}
          <ul className={s.kjPrizes}>
            {prizes.map((pz, i) => {
              const m = pz.mdId ? mdById(pz.mdId) : null;
              const b = pz.boxId ? BOX_ITEMS[pz.boxId] : null;
              const name = m ? m.name : b ? b.name : pz.name;
              return (
                <li key={`${pz.grade}-${pz.mdId || pz.boxId || i}`}
                  className={`${pz.left === 0 ? s.kjOut : ""} ${m ? s.toProduct : ""}`}
                  {...(m ? {
                    role: "link", tabIndex: 0, "aria-label": `${m.name} 상세`,
                    onClick: () => openProduct?.(m.id, "hub"),
                    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduct?.(m.id, "hub"); } },
                  } : {})}>
                  <b className={s.grade}>{pz.grade}</b>
                  {m ? (
                    <i style={{ backgroundImage: `url(${ASSET(m.src)})` }} />
                  ) : b && b.src ? (
                    <i style={{ backgroundImage: `url(${ASSET(b.src)})` }} />
                  ) : pz.src ? (
                    <i style={{ backgroundImage: `url(${ASSET(pz.src)})` }} />
                  ) : (
                    <i className={s.kjNoArt} aria-hidden="true">{b ? b.tier : "L"}</i>
                  )}
                  <span>{name}</span>
                  <em>{pz.grade === "LAST" ? "별도 구성안" : `${pz.left} / ${pz.count}`}</em>
                </li>
              );
            })}
          </ul>
          {dark ? (
            <>
              <div className={s.dkBar}>
                <div className={s.dkModes}>
                  <button type="button" className={`${s.kjTab} ${dark.mode === "scan" ? s.on : ""}`}
                    onClick={() => dark.setMode("scan")}>비추기<small>{dark.snap.scans} / {dark.snap.scansPerDraw}</small></button>
                  <button type="button" className={`${s.kjTab} ${dark.mode === "open" ? s.on : ""}`}
                    onClick={() => dark.setMode("open")}>열기<small>{won(dark.snap.price)}</small></button>
                </div>
                <ul className={s.dkLog}>
                  {dark.snap.log.length === 0
                    ? <li className={s.dkLogEmpty}>비추면 그 안에 상위상이 몇 개인지 알려줍니다. 어느 칸인지는 알 수 없습니다.</li>
                    : dark.snap.log.map((g, i) => (
                        <li key={i}>{g.center + 1}번 둘레 — 남은 {g.open}칸 중 상위상 <b>{g.high}</b></li>
                      ))}
                </ul>
              </div>
              <button type="button" className={`${s.primaryBtn} ${s.dealCta}`}
                disabled={drawUnavailable || dark.mode !== "open" || dark.target === null} onClick={dark.openSheet}>
                {drawUnavailable ? drawUnavailableLabel : dark.mode === "scan"
                  ? (dark.snap.scans > 0 ? `비출 곳을 고르세요 (${dark.snap.scans}회 남음)` : "손전등을 다 썼습니다 — 열기로")
                  : dark.target === null ? "열 칸을 고르세요"
                  : `${dark.target + 1}번 열기 · ${won(dark.snap.price)}`}
              </button>
              {dark.sheet && <DarkConfirmSheet snap={dark.snap} target={dark.target}
                onCancel={dark.closeSheet} onConfirm={dark.confirm} />}
              <BoxResult results={dark.results} onClose={dark.clearResults} />
            </>
          ) : wire ? (
            <>
              <button type="button" className={`${s.primaryBtn} ${s.dealCta}`}
                disabled={drawUnavailable || wire.start === null || !!wire.trace} onClick={wire.openSheet}>
                {drawUnavailable ? drawUnavailableLabel : wire.trace ? "따라가는 중…"
                  : wire.start === null ? `출발점을 고르세요 (밝혀진 길 ${wire.snap.knownCount} / ${wire.snap.cols} · 다음 배선까지 ${wire.snap.untilRewire}회)`
                  : `${wire.start + 1}번 따라가기 · ${won(wire.snap.price)}`}
              </button>
              {/* 밝혀 둔 길이 말없이 사라지면 화면이 고장 난 것으로 읽힌다 — 사라지는 순간을 말한다 */}
              {wire.rewired && <span className={s.wireRewired} role="status">배선이 다시 꽂혔다 — 밝혀진 길이 사라졌다</span>}
              {wire.sheet && <WireConfirmSheet snap={wire.snap} start={wire.start}
                known={wire.peek(wire.start)} onCancel={wire.closeSheet} onConfirm={wire.confirm} />}
              <BoxResult results={wire.results} onClose={wire.clearResults} />
            </>
          ) : drop ? (
            <>
              <button type="button" className={`${s.primaryBtn} ${s.dealCta}`}
                disabled={drawUnavailable || drop.entry === null || !!drop.fall} onClick={drop.openSheet}>
                {drawUnavailable ? drawUnavailableLabel : drop.fall ? "떨어지는 중…"
                  : drop.entry === null ? "투입구를 고르세요"
                  : `${drop.entry + 1}번에 넣기 · ${won(drop.snap.price)}`}
              </button>
              {drop.sheet && <DropConfirmSheet snap={drop.snap} entry={drop.entry}
                onCancel={drop.closeSheet} onConfirm={drop.confirm} />}
              <BoxResult results={drop.results} onClose={drop.clearResults} />
            </>
          ) : live ? (
            <>
              <button type="button" className={`${s.primaryBtn} ${s.dealCta}`}
                disabled={drawUnavailable || live.snap.picks.length === 0} onClick={live.openSheet}>
                {drawUnavailable ? drawUnavailableLabel : live.snap.picks.length === 0
                  ? `칸을 고르세요 (최대 ${live.snap.maxPick})`
                  : `${live.snap.picks.length}칸 뽑기 · ${won(live.snap.price * live.snap.picks.length)}`}
              </button>
              {live.sheet && <BoxConfirmSheet snap={live.snap} onCancel={live.closeSheet} onConfirm={live.confirm} />}
              <BoxResult results={live.results} onClose={live.clearResults} />
            </>
          ) : (
            <button type="button" className={`${s.primaryBtn} ${s.dealCta}`} disabled={soon} onClick={() => onDemo("럭키드로우")}>{soon ? "오픈 예정" : "뽑으러 가기"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// 선오픈권(fcfsEarly)은 폐기했다(PM 2026-09-02 「지금 단계에서는 없애자」) —
// 급식실이 유상 회차로 가면서 무상 참여로 얻는 자격의 자리가 사라졌다.
// 되살리려면 `early` 를 다시 받아 「선오픈권 보유」 배지와 EARLY_MS 를 복원한다.
function FcfsRow({ base, now, onDemo, openProduct, dealState }) {
  return (
    <div className={`${s.dealBox} ${s.sp12}`} data-mtype="event">
      <ZoneSecHead eyebrow="LIMITED QUANTITY" title="선착순 매대" />
      <div className={s.fcfsGrid}>
        {FCFS.map((f) => {
          const m = mdById(f.mdId);
          const soon = f.state === "soon";
          const left = fmtLeft(base + f.at - now);
          const request = { kind: "fcfs", productId: f.mdId };
          const progress = presentationDealSummary(dealState, request);
          const remainingStock = progress.stock;
          return (
            <div key={f.mdId} className={`${s.gcard} ${s.toProduct}`} role="link" tabIndex={0} aria-label={`${m.name} 상세`}
              onClick={() => openProduct?.(f.mdId, "hub")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduct?.(f.mdId, "hub"); } }}>
              <div className={s.gPh} style={{ backgroundImage: `url(${ASSET(m.src)})` }}>
                <span className={`${s.gBadge} ${soon ? s.soon : ""}`}>{soon ? "오픈 예정" : "선착순"}</span>
              </div>
              <div className={s.gInfo}>
                <span className={s.gCat}>{m.cat}</span>
                <b>{m.name}</b>
                <span className={s.gPrice}>{won(m.price)}</span>
                {soon ? (
                  <span className={s.gStock}>오픈까지 <i>{left}</i> · 수량 {f.total} · 이 매대 1인 {f.per}개</span>
                ) : (
                  <>
                    <span className={s.gStock}>잔여 <i>{remainingStock}</i> / {f.total} · 이 매대 1인 {f.per}개</span>
                    <span className={s.gBar}><b style={{ width: `${Math.round((remainingStock / f.total) * 100)}%` }} /></span>
                    <span className={s.gTimer}>마감까지 {left}</span>
                  </>
                )}
                <button type="button" className={`${soon ? s.ghostBtn : s.primaryBtn} ${s.dealCta}`}
                  disabled={soon || (remainingStock === 0 && !progress.last)}
                  onClick={(e) => { e.stopPropagation(); onDemo({ ...request, viewRecord: progress.count > 0 }); }}>{soon ? "오픈 예정" : progress.count ? "내 주문 기록 보기" : "구매하기"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* 허브 잔류 내 학생증 박스 — 이름 미확인 상태(이전 버전의 건너뛰기 잔존 데이터)를 위한 이름 기재 경로.
   건너뛰기가 사라진 현행 흐름에서는 오프닝이 항상 temp를 확정하므로 평시에는 뜨지 않는다. 입력하는 대로 카드에 라이브 반영 */
function MyIdBox({ update }) {
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState(null);
  const done = (v) => update({ temp: true, callsign: v ? v.trim() : null, photo });
  return (
    <div className={s.welcome}>
      <span className={s.myIdLabel}>내 학생증</span>
      <StudentIdCard name={name.trim() || null} photo={photo} />
      <PhotoPicker photo={photo} onPick={setPhoto} onSelectName={(n) => { if (!name.trim()) setName(n); }} />
      <div className={s.speakRow}>
        <span className={s.speakPrefix}>{SPEAK_PREFIX}</span>
        <input className={`${s.issueInput} ${s.speakInput}`} value={name} maxLength={12} placeholder="…" aria-label="이름" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) done(name); }} />
      </div>
      <div className={s.welcomeActs}>
        <button type="button" className={s.primaryBtn} disabled={!name.trim()} onClick={() => done(name)}>완료</button>
        <button type="button" className={s.ghostBtn} onClick={() => done("")}>이름 없이</button>
      </div>
    </div>
  );
}

/* ── 굿즈 진열 — 팝업의 주인공. 4열 × 5행 = 20종 진열(PM 2026-08-28), 중첩 스크롤 없이 한 화면.
   나머지 품목의 출구는 머리행의 「굿즈샵 전체」다 — 진열은 큐레이션, 전량은 굿즈샵. */
const SHELF_COUNT = 20;
/* 잠금 오버레이 — 해금 전 상품의 썸네일 표면. 카드 클릭(상세)과 별개로, 오버레이의 문은 획득 존으로 직행 */
function LockOverlay({ right, go }) {
  const zone = rightZoneOf(right);
  const r = rightDef(right);
  return (
    <button
      type="button" className={s.lockOverlay}
      onClick={(e) => {
        // 획득 존이 정의된 구매권만 직행 문 — 전 구매권 계약 정의 완료(2026-08-31), 미정의는 카드로 흘리는 폴백만 유지
        if (zone && go) { e.stopPropagation(); go(zone); }
      }}
      onKeyDown={(e) => { if (zone && go) e.stopPropagation(); }}
      aria-label={r ? `${r.name} — 획득하러 가기` : "구매권 획득하러 가기"}
    >
      <i>구매권 필요</i>
      <b>획득하러 가기</b>
    </button>
  );
}

function useShelfThumbVisible(thumbRef, railRef) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const thumb = thumbRef.current;
    const rail = railRef.current;
    if (!thumb) return undefined;
    if (typeof IntersectionObserver === "undefined" || !rail) {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.unobserve(entry.target);
    // A viewport root also clips against the nested stage and rail. A rail root alone
    // would report its cards visible even while the whole shelf is below the cover.
    }, { root: null, rootMargin: "160px", threshold: 0 });
    observer.observe(thumb);
    return () => observer.disconnect();
  }, [railRef, thumbRef]);
  return visible;
}

function ShelfThumb({ m, locked, railRef, children }) {
  const thumbRef = useRef(null);
  const visible = useShelfThumbVisible(thumbRef, railRef);
  return (
    <div ref={thumbRef} className={`${s.shelfThumb} ${locked ? s.thumbLocked : ""}`}>
      {visible && (
        <NextImage
          fill
          unoptimized
          loading="lazy"
          sizes="(max-width: 640px) 44vw, (max-width: 1280px) 22vw, 280px"
          className={s.shelfImage}
          src={ASSET(m.src)}
          alt=""
        />
      )}
      {children}
    </div>
  );
}

function ShelfPanel({ st, go, openProduct }) {
  const rights = rightsOf(st);
  // 그랩 스크롤(QA #614 — 데스크톱 마우스의 유일한 조작 공백): 마우스 포인터만, 터치는 네이티브 스와이프.
  // 드래그 후 첫 클릭은 삼킨다(끌었는데 상세가 열리는 오발 방지). 화살표는 호버에만(파인 포인터 전용 CSS).
  const railRef = useRef(null);
  const drag = useRef({ on: false, moved: false, x: 0, left: 0 });
  const onPointerDown = (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { on: true, moved: false, x: e.clientX, left: railRef.current.scrollLeft };
    railRef.current.classList.add(s.railDragging);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d.on) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    railRef.current.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    drag.current.on = false;
    if (railRef.current) railRef.current.classList.remove(s.railDragging);
  };
  const onClickCapture = (e) => {
    if (drag.current.moved) { e.stopPropagation(); e.preventDefault(); drag.current.moved = false; }
  };
  const page = (dir) => railRef.current && railRef.current.scrollBy({ left: dir * railRef.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div className={s.shelfCard} data-mtype="commerce">
      {/* 자체 머리 해체(②) — 종수·출구는 화면 머리(en·copy·act)가 말한다 */}
      <div className={s.shelfRailWrap}>
        <button type="button" className={`${s.railArrow} ${s.railPrev}`} onClick={() => page(-1)}>이전</button>
        <button type="button" className={`${s.railArrow} ${s.railNext}`} onClick={() => page(1)}>다음</button>
        <div ref={railRef} className={s.shelfGrid} aria-label={`한정 굿즈 진열 ${SHELF_COUNT}종`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={endDrag} onPointerLeave={endDrag} onClickCapture={onClickCapture}>
          {MD.slice(0, SHELF_COUNT).map((m) => {
            const locked = m.right && !rights[m.right];
            return (
              <div
                key={m.id} role="link" tabIndex={0} className={s.shelfItem}
                onClick={() => openProduct?.(m.id, "hub")}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduct?.(m.id, "hub"); } }}
              >
                <ShelfThumb m={m} locked={locked} railRef={railRef}>
                  {/* 잠금 오버레이(PM 2026-08-28): 아직 못 사는 상품은 썸네일이 말한다 — 획득의 문까지 겸한다 */}
                  {locked ? (
                    <LockOverlay right={m.right} go={go} />
                  ) : (
                    <span className={`${s.shelfBadge} ${m.right ? s.shelfBadgeLock : ""}`}>
                      {/* 선구매(first)는 매대를 막지 않는다 — 가진 사람에게만 「선구매」로 바뀐다(PM 판정 C 2026-09-04) */}
                      {m.right ? "구매권" : m.first && rights[m.first] ? "선구매" : LANE_LABEL[m.lanes[0]]}
                    </span>
                  )}
                </ShelfThumb>
                <div className={s.shelfMeta}>
                  <span className={s.shelfName}>{m.name}</span>
                  <b className={s.shelfPrice}>{won(m.price)}</b>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Hub({ st, update, go, openProduct, onCompose, onSection, onScene, onSceneJump, pendingSection, onPendingDone, flipFrom, onFlipDone, flyRef, tlPick, onTlPick }) {
  // 오프닝의 학생증이 벤토 「내 기록」 자리로 날아와 안착 (FLIP — 시작 좌표 = 오프닝 카드 실측, 도착 = 모듈 실측)
  useLayoutEffect(() => {
    const el = flyRef.current;
    if (!flipFrom || !el) return undefined;
    // 도착 좌표는 transform을 중립화한 상태에서 실측 — 이펙트가 재실행돼도(StrictMode 이중 호출 등) 이미 이동한 자세를 재측정하지 않는다
    el.style.transition = "none";
    el.style.transform = "none";
    const to = el.getBoundingClientRect();
    // 탭이 숨겨져 있으면(rAF 정지) 연출 없이 제자리 — 전환 중 탭 이탈로 출발 transform이 남는 사고 방지
    if (!to.width || !to.height || document.hidden) { el.style.transform = ""; el.style.transition = ""; onFlipDone(); return undefined; }
    el.style.transformOrigin = "top left";
    el.style.transform = `translate(${flipFrom.left - to.left}px, ${flipFrom.top - to.top}px) scale(${flipFrom.width / to.width}, ${flipFrom.height / to.height})`;
    el.style.zIndex = "40";
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      el.style.transition = "";
      el.style.transform = ""; // 어떤 경로로 끝나든 도착 자세로 — 안전 타이머 종료 포함
      el.style.zIndex = "";
      el.style.transformOrigin = "";
      onFlipDone();
    };
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = "transform 0.85s cubic-bezier(0.2, 0.8, 0.2, 1)";
        el.style.transform = "";
      });
    });
    el.addEventListener("transitionend", end, { once: true });
    const safety = setTimeout(end, 1300);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(safety);
      el.removeEventListener("transitionend", end);
      if (!finished) { el.style.transition = ""; el.style.transform = ""; el.style.zIndex = ""; el.style.transformOrigin = ""; }
    };
  }, [flipFrom, onFlipDone, flyRef]);
  return (
    <div className={`${s.hub} ${flipFrom ? s.hubArrive : ""}`}>
      {st.temp === null && <MyIdBox update={update} />}

      {/* ── 세로 = 이야기 순서. 한 화면에 하나만 둔다(PM 2026-08-27: 「게임 화면을 디자인한다」) ──
          화면은 카드가 아니라 장면이다 — 배경 스틸이 화면 전체를 쓰고 내용은 그 위에 최소한만 얹힌다.
          가로 레일은 폐기했다. 나란히 두던 것을 전부 자기 화면으로 승격시켰다(7 → 16). */}
      <SectionStage scenes={SCENES} onSection={onSection} onScene={onScene} pending={pendingSection} onPendingDone={onPendingDone}
        acts={{ shelf: { label: "굿즈샵 전체 보기", run: () => go("store") } }}>

        {/* 01 교문 — 표지. 얼굴(영상) + 3줄 + 시즌 게이지(기간, PM 2026-08-28).
            지금 벌어지는 일은 HUD 컨텍스트(다음 목표·소식)가, 이동은 HUD 이동이 갖고 있다. */}
        <div className={s.arriveScene}>
          <div className={s.coverLead}>
            <p className={s.leadEyebrow}>ALL OF US ARE DEAD · THE NEXT CHAPTER</p>
            <h1 className={s.coverTitle}>지금<br />우리 학교는<span>1.5</span></h1>
            <p className={s.coverLine}>살아 있다면, 옥상으로.</p>
            <div className={s.coverActions}>
              <button type="button" className={s.primaryBtn} onClick={() => onSceneJump(FIRST_SCENE_OF[2])}>학교로 들어가기</button>
              <button type="button" className={s.ghostBtn} onClick={() => go("store")}>굿즈 둘러보기</button>
            </div>
          </div>
          <SeasonTimeline pick={tlPick} onPick={onTlPick} />
        </div>

        {/* 02~04 굿즈 — 사는 방법 셋. 진열(바로) · 구매권(열어야) · 럭키드로우(운).
            공식 의류 화면은 삭제(PM 2026-08-28): 의류도 진열·굿즈샵이 판다 */}
        <ShelfPanel st={st} go={go} openProduct={openProduct} />
        <RightsPanel st={st} go={go} openProduct={openProduct} />
        <DealIntro en="LUCKY DRAW" title="럭키드로우" hint="회차별 80칸 · 회차별 하루 10회 체험" img="still-barricade.jpg" meta={`회차 ${KUJI.length} · 잔여 ${KUJI.reduce((sum, round) => sum + round.total - presentationDrawState(st, round.id).taken.length, 0)}칸`} id="kuji" go={go} mtype="commerce" face={<KujiFace />} />

        {/* 05~07 체험존 — 급식실·방송실·도서관(옥상은 장 6 결말). 문과 방이 1:1이다 */}
        {PLAY_ZONES.map((zid) => <ZoneScene key={zid} st={st} id={zid} go={go} />)}

        {/* 08~10 한정판존 — 응모·마감 구조의 매대만 남는다(ADR-0032: 자격 없이 사면 커머스) */}
        <DealIntro en="RAFFLE" title="래플" hint="무상 응모 · 정시 발표 · 1인 1회" img="still-zombie-rush.jpg" meta={`진행 ${RAFFLES.length}건`} id="raffle" go={go} face={<RaffleFace state={st} />} />
        <DealIntro en="PRE-ORDER" title="사전예약" hint="시즌2 연계 사전예약" img="still-armed-group-walk.jpg" meta={`누적 ${presentationDealSummary(st, { kind: "preorder", productId: PREORDER.mdId }).reservations.toLocaleString()}명`} id="preorder" go={go} face={<PreorderFace state={st} />} />
        <DealIntro en="FIRST COME" title="선착순" hint="정시 오픈 · 수량 한정 · 매대별 구매 한도" img="still-infirmary.jpg" meta={`오늘 매대 ${FCFS.length}개`} id="fcfs" go={go} face={<FcfsFace state={st} />} />

        {/* 11~12 커뮤니티존 */}
        <CommunityModule st={st} onCompose={onCompose} />
        <NoticeModule />

        {/* 13 오프라인팝업존 */}
        <OfflineModule pst={st} go={go} />

        {/* 14 옥상 — 결말이자 체험의 마지막 문(합류). 학생증 원본은 HUD 좌열로 이사했다(PM 2026-08-28) —
            나의 카드는 이제 어느 화면에서든 발밑에 있고, 이 화면은 옥상으로 들어가는 문이다. */}
        <ZoneScene st={st} id="rooftop" go={go} />

      </SectionStage>
    </div>
  );
}

/* 스크롤 컨테이너 기준 좌표 — offsetTop/offsetLeft 는 offsetParent 기준이라 컨테이너와 어긋난다(실측 22px).
   경계 계산은 항상 컨테이너와의 상대 위치로 한다. */
const offsetIn = (box, child, axis) => {
  const b = box.getBoundingClientRect();
  const c = child.getBoundingClientRect();
  return axis === "x" ? c.left - b.left + box.scrollLeft : c.top - b.top + box.scrollTop;
};
/* ── 화면 목록 — 한 화면에 하나만 둔다(게임 장면 문법, PM 2026-08-27) ──
   장(chapter)은 HUD 이동의 단위, 화면(scene)은 스크롤의 단위다.
   장 7개는 그대로 두고 그 안을 화면으로 쪼갰다 — 이동 격자는 바뀌지 않는다.
   체험은 존 하나가 문 하나(여정 묶음 해체, PM 2026-09-02) — 급식실·방송실·도서관 + 옥상(결말, 장 6).
   커머스에 「구매권 상품」 한 자리를 세워 상품이 자기 무대를 셋 갖는다 — 체험의 보상이 상품인데 상품 자리가 하나뿐이면 위계가 뒤집힌다. */
/* 장 이름 = 「~존」(PM 2026-09-02) — 교문·옥상만 예외(들어오는 곳·끝나는 곳이라 존이 아니다).
   HUD 이동·안내도는 이 배열에서 이름을 파생한다(chapters · 부스 name) — 여기만 바꾸면 따라온다. */
export const SECTIONS = ["교문", "굿즈존", "체험존", "한정판존", "커뮤니티존", "오프라인팝업존", "옥상"];

/* 머리 2줄 규격(2026-08-28 PM ②, 설명 제거 재확정): en(영문 라벨) + t(화면 이름)가 화면 머리의 전부다.
   설명형 문장은 쓰지 않는다(PM 「이런 설명같은거 다 빼」 — 규칙·수량은 화면 몸이 이미 보여준다).
   lead 화면(표지·존·옥상)은 자체 리드가 머리다 — 머리는 화면당 한 벌만. */
/* budget = 화면의 스크롤 예산(화면 높이 배수 · 스크롤 연출 계약 v1 §4-4). 1.0 = 스크럽 없음(착지만).
   화면 안쪽 핀 층(.secPin)이 한 화면을 붙잡고, 남는 (budget−1) 화면만큼이 스크럽 구간이 된다. 합 ≤ 24. */
export const SCENES = [
  { k: "arrive", budget: 1.0,    ch: 0, t: "교문",           bg: "key-armed-group.jpg",         tab: 4, lead: true },  /* 교문 사진 입고 2026-09-02 — 이음매가 정확히 중앙(x688/1376)이라 반 분할이 그대로 맞는다 */  /* ADR-0024 영상 — 오프닝→표지 재사용은 PM 지시(2026-08-28) */
  { k: "shelf", budget: 1.2,     ch: 1, t: "진열",           bg: "still-gym-group.jpg", tab: 2, en: "GOODS SHOP", hint: "이 팝업 한정 37종 · 진열 20종 · 전체는 굿즈샵", noTitle: true },  /* PM 2026-09-03 「굿즈샵에 한정 굿즈라는 텍스트는 빼」 — 화면 제목은 숨기고(noTitle), t 는 HUD 라벨·이동 목록이 쓰므로 중립어로. 굿즈존 3화면 = 진열(바로) · 구매권 상품(열어야) · 럭키드로우(운) */
  { k: "rights", budget: 1.2,    ch: 1, t: "구매권 상품",       bg: "still-library.jpg", tab: 2, en: "UNLOCKED GOODS", hint: "체험을 끝내면 열리는 상품 6종", noTitle: true },  /* 화면 제목 숨김(PM 2026-09-04) — t 는 HUD 라벨이 쓴다 */
  { k: "kuji", budget: 1.2,      ch: 1, t: "럭키드로우",      bg: "still-barricade.jpg", tab: 3, en: "LUCKY DRAW", lead: true },  /* 자격 없이 돈만 내면 사는 상품 = 커머스(ADR-0032) · 예산 1.0 이면 이동 0 → 글자 퇴장(50~100%)이 끝값(opacity 0)에 서서 글이 안 보였다(PM 2026-09-08) → 형제 딜 화면과 같은 1.2 */
  /* 체험존 3 + 옥상(결말 = 체험존 4번째, 장 6 유지) — PM 2026-09-02. 그날의 교실은 존에서 뺐다(#675). 순서 = 원작 장면 순 */
  { k: "cafeteria", budget: 1.6, ch: 2, t: "급식실",          bg: "still-corridor-run.jpg", tab: 1, en: "CAFETERIA", lead: true },
  { k: "broadcast", budget: 1.6, ch: 2, t: "방송실",          bg: "still-broadcast-room.jpg", tab: 1, en: "BROADCAST ROOM", lead: true },
  { k: "library", budget: 1.6,   ch: 2, t: "도서관",          bg: "still-library.jpg", tab: 1, en: "LIBRARY", lead: true },  /* 여정 단계로는 「만약」이지만 문 뒤에 방이 하나뿐이라 방 이름을 그대로 쓴다 — 문과 방이 다른 이름이면 같은 곳인지 알 수 없다 */
  { k: "raffle", budget: 1.2,    ch: 3, t: "래플",            bg: "still-zombie-rush.jpg", tab: 3, en: "RAFFLE", lead: true },
  { k: "preorder", budget: 1.2,  ch: 3, t: "사전예약",        bg: "still-armed-group-walk.jpg", tab: 3, en: "PRE-ORDER", lead: true },
  { k: "fcfs", budget: 1.2,      ch: 3, t: "선착순",          bg: "still-infirmary.jpg", tab: 3, en: "FIRST COME", lead: true },
  { k: "wall", budget: 1.0,      ch: 4, t: "커뮤니티",         bg: "still-bonfire.jpg", tab: 4, en: "COMMUNITY", hint: "구매 인증과 후기가 올라오는 곳" },  /* 「생존자의 벽」 개념 폐기(PM 2026-09-04) — 커뮤니티존으로 통일 */
  { k: "notice", budget: 1.0,    ch: 4, t: "공식 소식",       bg: "still-jeolbi-closeup.jpg", tab: 4, en: "OFFICIAL NOTICE", hint: "방송실 발신 공식 소식" },
  { k: "offline", budget: 1.0,   ch: 5, t: "오프라인 팝업",    bg: "key-yearbook-blood.jpg", tab: 0, en: "OFFLINE POP-UP", hint: "현장 팝업 일정과 입장 안내" },  /* 현장에 들고 가는 건 내 자격 — 소식 3연속을 끊는다 */
  { k: "rooftop", budget: 2.0,   ch: 6, t: "옥상",            bg: "still-bonfire.jpg", tab: 0, en: "ROOFTOP", lead: true },
];
export const FIRST_SCENE_OF = SECTIONS.map((_, i) => SCENES.findIndex((x) => x.ch === i));

/* ── 무대 — 자식 하나 = 한 화면. 화면은 카드가 아니라 장면이다(배경이 화면 전체를 쓴다) ── */
function SectionStage({ scenes, onSection, onScene, pending, onPendingDone, acts, children }) {
  const ref = useRef(null);
  const kids = (Array.isArray(children) ? children : [children]).flat();
  const [active, setActive] = useState(0);   // 현재 화면 — 등장 연출의 트리거(연출 계약 v0)
  const [loadedScenes, setLoadedScenes] = useState(() => new Set([0]));
  const activeRef = useRef(0);
  // Keep each scene's scroll footprint, but load its artwork only as it approaches the viewport.
  // Once visited, preserve the mounted controls and their local state when scrolling away.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      const incoming = entries.filter((entry) => entry.isIntersecting);
      if (!incoming.length) return;
      setLoadedScenes((previous) => {
        const next = new Set(previous);
        incoming.forEach((entry) => next.add(Number(entry.target.dataset.sceneIndex)));
        return next.size === previous.size ? previous : next;
      });
      incoming.forEach((entry) => observer.unobserve(entry.target));
    }, { root: el, rootMargin: "300px 0px", threshold: 0 });
    [...el.children].forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  // HUD 이동은 장 단위 — 그 장의 첫 화면으로 보낸다
  useEffect(() => {
    const el = ref.current;
    if (!el || !pending) return;
    const target = el.children[pending.s];
    if (target) el.scrollTo({ top: offsetIn(el, target, "y"), behavior: pending.smooth ? "smooth" : "instant" });
    onPendingDone();
  }, [pending, onPendingDone]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const sync = () => {
      const secs = [...el.children];
      /* 「시작점을 지난 마지막 화면」 — 예산이 1 이 아니면 「가장 가까운 시작점」은 긴 화면 중간에서
         다음으로 먼저 넘어간다(회색 상자 검증 ③). 핀이 잡혀 있는 동안은 그 화면이 현재다. */
      let i = 0;
      secs.forEach((sec, k) => { if (offsetIn(el, sec, "y") <= el.scrollTop + 2) i = k; });
      /* 되돌림 히스테리시스(PM 2026-09-07 「깜빡임이 오류처럼」): 스냅이 화면 시작점에 착지할 때 경계를 몇 번 넘나들면
         등장 연출이 그만큼 다시 재생돼 깜빡인다. 앞 화면으로는 시작점보다 12% 화면 위로 올라가야 돌아간다. */
      const cur = activeRef.current;
      if (i < cur && secs[cur] && el.scrollTop > offsetIn(el, secs[cur], "y") - el.clientHeight * 0.12) i = cur;
      activeRef.current = i;
      onSection(scenes[i] ? scenes[i].ch : 0);
      onScene(i);
      setActive(i);
    };
    /* 전환 구간 스냅 보조(계약 v1 §3 정정): CSS 스냅은 껐다 — 스크럽 초반을 시작점으로 되당긴다(실측 0.2 화면).
       손이 멈춘 뒤(scrollend · 없으면 180ms 정지) 전환 구간에 있으면 가까운 쪽(스크럽 끝 / 다음 화면 시작)으로 보낸다. */
    const assist = () => {
      const secs = [...el.children];
      const t = snapTargetFor(el.scrollTop, secs.map((sec) => offsetIn(el, sec, "y")), secs.map((sec) => sec.offsetHeight), el.clientHeight);
      if (t != null && Math.abs(t - el.scrollTop) > 1) el.scrollTo({ top: t, behavior: "smooth" });
    };
    let settle;
    const hasEnd = "onscrollend" in el;
    const onScroll = () => { sync(); if (!hasEnd) { clearTimeout(settle); settle = setTimeout(assist, 180); } };
    el.addEventListener("scroll", onScroll, { passive: true });
    if (hasEnd) el.addEventListener("scrollend", assist);
    sync();
    return () => { el.removeEventListener("scroll", onScroll); if (hasEnd) el.removeEventListener("scrollend", assist); clearTimeout(settle); };
  }, [onSection, onScene, scenes]);
  return (
    <div className={s.secStage} ref={ref} data-stage>
      {kids.map((child, i) => {
        const sc = scenes[i] || { t: "", ch: 0, bg: null, k: `x${i}` };
        return (
          <section key={sc.k} className={`${s.secBox} ${i === active ? s.secOn : ""}`} data-name={sc.t} data-scene={sc.k} data-scene-index={i}
            style={{ "--budget": sc.budget || 1 }}
            /* 장 경계의 검정 판(암전 셔터·손전등)은 폐기(PM 2026-09-08 「그건 없애」) — 남은 전환은 카메라 시차(CSS)뿐 */
            >
            {/* 핀 층(스크롤 연출 계약 v1 · C안): 화면 상자는 예산만큼 길고, 이 층이 한 화면을 sticky 로 붙잡는다.
                영상·문·머리·본문 전부 이 안 — 절대 위치 층(영상·교문·셔터)의 기준도 이 층이다. */}
            <div className={s.secPin}>
            {sc.k === "arrive" && <div className={s.sceneBg} style={{ backgroundImage: `url(${ASSET(sc.bg)})` }} aria-hidden="true" />}
            {/* 머리 2줄 규격(②): 영문 라벨 + 화면 이름. 설명형 문장 금지(PM). 장 표기(n/m)는 HUD 이동이 안다.
                lead 화면(표지·존)은 자체 리드가 머리다. act 는 화면의 유일한 출구(예: 굿즈샵 전체). */}
            {!sc.lead && (
              <div className={s.sectionHead}>
                <span className={s.sectionNo}>
                  {sc.en}
                  {sc.hint && <Hint text={sc.hint} />}
                  {acts && acts[sc.k] && (
                    <button type="button" className={s.sectionAct} onClick={acts[sc.k].run}>{acts[sc.k].label}</button>
                  )}
                </span>
                {/* noTitle 화면은 제목을 찍지 않는다 — 진열이 곧 이름인 화면(PM 2026-09-03 「굿즈샵에 한정 굿즈라는 텍스트는 빼」) */}
                {!sc.noTitle && <h2 className={s.sectionTitle}>{sc.t}</h2>}
              </div>
            )}
            <div className={s.sectionBody}>{(i === active || i === pending?.s || loadedScenes.has(i) || typeof IntersectionObserver === "undefined") && child}</div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ── 장면 리드 — 배경이 주인공. 글자 몇 줄과 행동 둘만 얹는다 ── */
/* ── 장면 영상 — 표지의 얼굴. 게임 타이틀 화면의 루프 배경 문법.
   reduced-motion 이면 포스터 스틸로, 화면을 벗어나면 멈춘다(16화면 중 1화면만 영상이어도
   스크롤 아래에서 디코딩이 돌면 모바일 배터리를 먹는다). ── */
/* ── 교문 열림(PM 2026-09-02) — 미닫이 철문 두 짝이 좌우로 밀리며 표지가 드러난다.
   한국 학교 정문은 옆으로 미는 철문이라 회전이 아니라 이동이 실제 물리다.
   **세션 1회** — 표지는 재방문자가 가장 자주 보는 화면이라 매번 열면 피로하다(PM 선택).
   사진이 아직 없어도 어두운 문짝으로 동작한다 — 입고되면 SCENES.gate 를 파일명으로 바꾸면 그대로 사진이 된다. */
/* ── 라이브 스트립 — 시간이 걸린 사건만. 표지가 「지금」을 말한다.
   각 칸은 그 화면으로 가는 문이다(라벨·시각만, 문장 없음). ── */

/* ── ? 툴팁(PM 2026-08-28 「설명은 ? 같은 툴팁 안에」): 규칙·수량 설명은 화면에 상주하지 않는다.
   호버·클릭으로만 소환 — 화면은 이름과 물건만 남는다. */
function Hint({ text, items }) {
  const [on, setOn] = useState(false);
  return (
    <span className={s.hintWrap}
      onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)}>
      <button type="button" className={s.hintBtn} aria-label="설명 보기" aria-expanded={on}
        onClick={() => setOn((v) => !v)} onBlur={() => setOn(false)}>?</button>
      {on && <span className={s.hintTip} role="tooltip">{items ? <GuideLines items={items} /> : text}</span>}
    </span>
  );
}

/* ── 페이즈(설계서 §2-2 준용, PM 2026-08-28 시연 반영): 예고 → 본편 1 → 본편 2 → 결산.
   경계는 POPUP_PERIOD 가 소유, 판정은 실시간. 딜의 편성 창은 §5-2 매대 편성표를 따른다. ── */
const PHASES = [
  { id: "teaser", name: "예고" },
  { id: "main1", name: "본편 1" },
  { id: "main2", name: "본편 2" },
  { id: "finale", name: "결산" },
];
const phaseBounds = () => {
  const t = (d, end) => new Date(`${d}T${end ? "23:59:59" : "00:00:00"}`).getTime();
  return [t(POPUP_PERIOD.open), t(POPUP_PERIOD.main2From), t(POPUP_PERIOD.finaleFrom), t(POPUP_PERIOD.close, true)];
};
/* 딜 편성 창(§5-2): [시작 페이즈, 끝 페이즈] — 사전예약 예고~본편 · 래플/선착순 본편 1 · 럭키드로우 본편 1~2 */
const DEAL_PHASE = { preorder: [0, 2], raffle: [1, 1], fcfs: [1, 1], kuji: [1, 2] };
const dealStatusOf = (k, now) => {
  const win = DEAL_PHASE[k];
  if (!win) return { t: "on" };
  const b = phaseBounds();
  const start = win[0] === 0 ? -Infinity : b[win[0] - 1];
  const end = b[win[1]];
  if (now < start) return { t: "before", d: Math.ceil((start - now) / 86400000), at: PHASES[win[0]].name };
  if (now > end) return { t: "closed" };
  return { t: "on" };
};

/* ── 팝업 타임라인(PM 2026-09-07 「본편을 기준으로 나누지 말고 그냥 이 팝업의 타임라인」 ·
   「더 간단하고 시각적으로 시인성 있게 · 화면은 인포그래픽과 간단한 텍스트만 · 필요한 텍스트는 컨텍스트 패널로」) ──
   무대가 갖는 것 = **기간 자 하나**(8.18–9.28) 위에 일정이 제 날짜에 찍힌 그림. 그 위의 글자는 셋뿐이다 —
   기간 · 종료 D-N · 달 눈금. 고른 일정의 「날짜 + 이름」 한 줄이 자 아래에 붙는다.
   ① **페이즈 구분을 트랙에서 걷어냈다.** 이건 팝업 하나의 타임라인이지 본편의 타임라인이 아니다.
      PHASES 자체는 남는다 — 딜 편성 창(DEAL_PHASE)이 「래플은 본편 1」 같은 편성을 계속 이 축으로 쓴다.
      페이즈만 보여 주던 일정 모달(TimelineOverlay)과 지금 페이즈를 세던 phaseIndexAt 은 함께 폐기했다 —
      부르는 곳이 없어졌고, 남겨 두면 페이즈로 나눈 타임라인이 다시 살아난다.
   ② 이름·설명·가는 문은 **HUD 컨텍스트 패널**이 갖는다(contextOf 의 arrive 분기). 무대에서 알약 11개·정보 상자·
      다음 일정 버튼을 걷어낸 자리가 그것이다 — 같은 글자를 두 곳이 갖지 않는다.
   ③ 고른 것이 없으면 **지금 진행 중인 일정**(없으면 다음 것)이 저절로 서 있다. 「눌러 보세요」 같은 안내문을
      쓰지 않으려는 것 — 빈 줄 대신 늘 진짜 정보가 서 있게 한다.
   ④ 오프라인 팝업(11.06~11.22)은 온라인 기간 밖이라 자 위에 얹지 않는다. 패널의 마지막 행이 그 자리다.
   색 예산: 자·표시는 잉크, 오늘 선과 고른 표시만 fire. ── */

function SeasonTimeline({ pick, onPick }) {
  const [openMs, , , closeMs] = phaseBounds();
  const t = useNow();
  const span = closeMs - openMs;
  const pct = (x) => Math.max(0, Math.min(100, ((x - openMs) / span) * 100));
  const dday = Math.max(0, Math.ceil((closeMs - t) / 86400000));
  const day = (d, end) => new Date(`${d}T${end ? "23:59:59" : "00:00:00"}`).getTime();
  const md = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}.${d.getDate()}`; };

  /* 하루짜리는 점, 기간이 있는 것은 띠. 그 둘이면 그림이 다 설명된다 — 범례를 두지 않는 이유다 */
  const items = SCHEDULE.map((e) => {
    const from = day(e.from);
    const to = e.to ? day(e.to, true) : day(e.from, true);
    return { id: e.id, name: e.name, from, to, bar: !!e.to, done: t > to };
  });
  /* 달이 바뀌는 자리에만 눈금 — 자에 눈금이 하나도 없으면 가운데가 언제인지 읽을 수 없다 */
  const ticks = [];
  for (let d = new Date(openMs); ; ) {
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    if (d.getTime() >= closeMs) break;
    ticks.push({ at: d.getTime(), label: `${d.getMonth() + 1}월` });
  }
  /* 고른 것이 없으면 진행 중 → 다음 → 마지막 순으로 저절로 선다(안내문 대신 늘 진짜 정보) */
  const auto = items.find((e) => t >= e.from && t <= e.to) || items.find((e) => e.from > t) || items[items.length - 1];
  const shown = items.find((e) => e.id === pick) || auto;

  return (
    <div className={s.seasonTl} aria-label={`팝업 기간 ${POPUP_PERIOD.label} · 종료까지 ${dday}일 · 일정 ${items.length}건`}>
      <div className={s.tlHead}>
        <span>{POPUP_PERIOD.label}</span>
        <span className={s.tlDday}>종료 D-{dday}</span>
      </div>

      <div className={s.tlTrack}>
        <i className={s.tlRule} aria-hidden="true" />
        {ticks.map((k) => (
          <i key={k.at} className={s.tlTick} style={{ left: `${pct(k.at)}%` }} aria-hidden="true"><b>{k.label}</b></i>
        ))}
        {items.map((e) => (
          <button
            key={e.id} type="button"
            className={`${s.tlMark} ${e.bar ? s.tlMarkBar : s.tlMarkDot} ${e.done ? s.tlMarkOff : ""} ${shown && shown.id === e.id ? s.tlMarkOn : ""}`}
            style={e.bar
              ? { left: `${pct(e.from)}%`, width: `${Math.max(2, pct(e.to) - pct(e.from))}%` }
              : { left: `${pct(e.from)}%` }}
            aria-pressed={shown && shown.id === e.id}
            aria-label={`${md(e.from)}${e.bar ? ` – ${md(e.to)}` : ""} ${e.name}`}
            onClick={() => onPick(pick === e.id ? null : e.id)}
          />
        ))}
        <i className={s.tlToday} style={{ left: `${pct(t)}%` }} aria-hidden="true" />
      </div>

      {/* 무대에 남는 유일한 문장 — 날짜와 이름뿐이다. 설명·가는 문은 컨텍스트 패널이 갖는다 */}
      {shown && (
        <p className={s.tlPick} aria-live="polite">
          <em>{md(shown.from)}{shown.bar ? ` – ${md(shown.to)}` : ""}</em>{shown.name}
        </p>
      )}
    </div>
  );
}

/* 표지 3줄 규율(⑤ — skin184 히어로 문법): 영상 위 텍스트는 라벨 1 + 타이틀 2, 최대 3줄.
   meta·버튼은 이 계약에 없다 — 지금과 행동은 HUD 가 갖고 있다. */
/* 존 히어로 눈썹 = 메인 장면의 영문 라벨(머리 2줄 규격 ② — 존은 리드가 머리다). 장면 키와 존 id 가 다른 곳은 별칭으로 잇는다.
   내부 코드(Z5)는 절대 화면에 내지 않는다 — 없으면 이름을 다시 쓴다(직관 용어 원칙). */
const ZONE_SCENE_KEY = { store: "shelf", reserve: "offline" };
/* URL 계약 사전 — 쿼리에 실을 수 있는 값의 전부. 여기 없으면 링크가 틀린 것이고 허브로 간다 */
const URL_DICT = { zones: ZONES.map((z) => z.id), lanes: Object.keys(LANE_LABEL), products: MD.map((m) => m.id), scenes: SCENES.map((x) => x.k) };
const zoneEyebrow = (id, zone) => (SCENES.find((x) => x.k === (ZONE_SCENE_KEY[id] || id)) || {}).en || zone.name;

/* ── 구매권 상품 (커머스) — 체험의 보상은 상품이다(ADR-0021 부칙 2).
   진열이 「바로 살 수 있는 것」이라면 여기는 「열어야 살 수 있는 것」이다.
   상품이 걸린 구매권을 상품 얼굴로 세워 둔다 — 잠긴 것도 무엇을 잠갔는지 보여야 열고 싶어진다. */

/* 상품이 걸린 구매권만 세운다 — 선착순 선오픈권은 상품이 아니라 입장 순서라 선착순 매대가 갖는다 */
const RIGHT_GOODS = RIGHTS.filter((r) => r.mdId);

function RightsPanel({ st, go, openProduct }) {
  const owned = rightsOf(st);
  return (
    <div className={s.rgWrap} data-mtype="commerce">
      <div className={s.rgGrid} aria-label={`구매권으로 열리는 상품 ${RIGHT_GOODS.length}종`}>
        {RIGHT_GOODS.map((r) => {
          const m = MD.find((x) => x.id === r.mdId);
          const has = !!owned[r.id];
          const dest = rightZoneOf(r.id);
          return (
            <div key={r.id} className={`${s.rgItem} ${has ? s.rgOn : ""}`}>
              <div className={s.rgThumb} style={m ? { backgroundImage: `url(${ASSET(m.src)})` } : undefined}>
                <span className={s.rgBadge}>{has ? "구매 가능" : "잠김"}</span>
              </div>
              <b className={s.rgName}>{m ? m.name : r.name}</b>
              <span className={s.rgGoal}>{r.goal}</span>
              {has && m ? (
                <button type="button" className={s.rgBtnOn} onClick={() => openProduct?.(m.id, "hub")}>구매하러 가기</button>
              ) : dest ? (
                <button type="button" className={s.rgBtn} onClick={() => go(dest)}>여는 곳으로 가기</button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ZoneScene({ st, id, go }) {
  const z = ZONES.find((x) => x.id === id);
  const rid = ZONE_RIGHT[id];
  const r = rid ? rightDef(rid) : null;
  const first = r ? MD.find((m) => m.id === (r.items || [])[0]) : null;
  const has = rid ? !!rightsOf(st)[rid] : false;
  // 한 존이 여러 구매권을 열 수 있다(도서관 2종) — 문에는 합산해서 말한다
  const zItems = RIGHTS.filter((x) => rightZoneOf(x.id) === id).flatMap((x) => x.items || []);
  return (
    <div className={s.zoneScene} data-mtype="experience">
      {/* 배경이던 스틸을 액자로 — 게임 미션 선택 화면 문법. 배경은 조용하고 얼굴은 액자 안에 있다 */}
      <span className={s.zoneStill} style={{ backgroundImage: `url(${ASSET(z.img)})` }} aria-hidden="true" />
      <div className={s.lead}>
      {/* 라벨은 영문(머리 2줄 규격 ② — 존은 리드가 머리다), 이름은 한국어 */}
      <span className={s.leadEyebrow}>{(SCENES.find((x) => x.k === id) || {}).en || z.role}</span>
      <h3 className={s.leadTitle}>{z.name}</h3>
      {/* 문 한 줄 = 초대문의 권유 한 문장(aouad-copy.js ZONE_CALL · PM 2026-09-09) — 히어로의 두 줄과 겹치지 않게 짧게 */}
      {z.call && <p className={s.leadCall}>{z.call}</p>}
      {/* 유상 존 — 참여권 가격표. 카드(ZoneModule)와 리드 둘 다 z.ticket 하나로 그린다(PM 2026-09-03) */}
      {z.ticket && <span className={s.zoneTicket}>참여권 {won(z.ticket)}</span>}
      {first && (
        <div className={`${s.leadGoods} ${has ? s.leadGoodsOn : ""}`}>
          <i style={{ backgroundImage: `url(${ASSET(first.src)})` }} />
          <span>
            <b>{has ? "구매 가능" : "달성 시 구매권"}</b>
            <em>{zItems.length > 1 ? `${first.name} 외 ${zItems.length - 1}종` : first.name}</em>
          </span>
        </div>
      )}
      <div className={s.leadActs}>
        {id === "rooftop" && rooftopLocked(st) ? (
          <>
            <button type="button" className={s.leadBtn} disabled>문이 잠겨 있다</button>
            <span className={s.leadStamp}>체험 {playedCount(st)} / {PLAY_ZONES.length} 참여 시 열림</span>
          </>
        ) : (
          <button type="button" className={s.leadBtnOn} onClick={() => go(id)}>들어가기</button>
        )}
        </div>
      </div>
    </div>
  );
}

/* ── 굿즈샵 (커머스) ──
   선착순 모듈과 **같은 굿즈 카드 문법**을 쓴다(사진·뱃지·카테고리·이름·가격·상태).
   진열이 진열처럼 보여야 커머스 모듈이다 — 썸네일 나열로는 살 것이 안 보인다.
   「더보기」로 굿즈샵 페이지(전 진열 · 구매권 잠금 상태 · 찜)로 나간다. */
/* ── 현장 예약(PM 2026-08-31): 날짜 → 30분 시간대 → 확정. 목업 플로우 — 실결제·실예약 없음(시연 경계).
   매진 칸은 결정적 의사난수(날짜·칸 인덱스)로 — 표시용 고정 수치 금지 원칙과 충돌하지 않게 「시연 데이터」다. */
function ReserveZone({ st, update }) {
  const open = new Date(`${OFFLINE.openAt}T00:00:00`);
  // 날짜는 기간 데이터에서 전량 파생(확장성 — 기간이 늘어도 이 배치는 유지된다). 월요일 휴관.
  const dayCount = Math.round((new Date(`${OFFLINE.closeAt}T00:00:00`) - open) / 86400000) + 1;
  const days = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(open.getTime() + i * 86400000);
    const wd = "일월화수목금토"[d.getDay()];
    return { i, label: `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")} (${wd})`, closed: d.getDay() === 1 };
  });
  const slots = Array.from({ length: 17 }, (_, i) => {
    const h = 11 + Math.floor(i / 2), m = i % 2 ? "30" : "00";
    return `${h}:${m}`;
  });
  const [day, setDay] = useState(null);
  const [slot, setSlot] = useState(null);
  const soldOut = (di, si) => (di * 7 + si * 3) % 11 === 4;
  const confirm = () => {
    const label = `${days[day].label} ${slots[slot]}`;
    update({ reserve: { day, slot, label } });
    setDay(null); setSlot(null);
  };
  const cancel = () => update({ reserve: null });
  if (st.reserve) {
    return (
      <div className={s.rsvWrap}>
        <div className={s.rsvDone}>
          <span className={s.rsvDoneTag}>예약 체험 완료</span>
          <b className={s.rsvDoneLabel}>{st.reserve.label}</b>
          <span className={s.rsvDoneNo}>예약 번호 HS-{String(1000 + st.reserve.day * 17 + st.reserve.slot)}</span>
          <p className={s.rsvDoneNote}>선택한 일정이 시연 학생증에 기록되었습니다. 실제 현장 예약이나 입장권 발급은 진행되지 않습니다.</p>
          <button type="button" className={s.ghostBtn} onClick={cancel}>예약 변경</button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.rsvWrap}>
      <div className={s.rsvHead}><span>OFFLINE POP-UP</span><h4>입장 일시를 선택하세요</h4><p>효산고의 하루를 만나는 30분. 월요일은 쉬어갑니다.</p></div>
      <span className={s.rsvLabel}>날짜</span>
      <div className={s.rsvDays}>
        {days.map((d) => (
          <button key={d.i} type="button" disabled={d.closed}
            className={`${s.rsvDay} ${day === d.i ? s.rsvOn : ""}`}
            onClick={() => { setDay(d.i); setSlot(null); }}>
            {d.label}{d.closed ? " 휴관" : ""}
          </button>
        ))}
      </div>
      <span className={s.rsvLabel}>시간대</span>
      <div className={s.rsvSlots}>
        {slots.map((t, si) => {
          const out = day !== null && soldOut(day, si);
          return (
            <button key={t} type="button" disabled={day === null || out}
              className={`${s.rsvSlot} ${slot === si ? s.rsvOn : ""}`}
              onClick={() => setSlot(si)}>
              {t}{out ? " 마감" : ""}
            </button>
          );
        })}
      </div>
      <div className={s.rsvBar}>
        <button type="button" className={s.primaryBtn} disabled={day === null || slot === null} onClick={confirm}>
          {day !== null && slot !== null ? `예약 확정 — ${days[day].label} ${slots[slot]}` : "날짜와 시간대를 고르세요"}
        </button>
      </div>
    </div>
  );
}

function OfflineModule({ pst, go }) {
  const o = OFFLINE;
  const [noticed, setNoticed] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  const st = useMemo(() => {
    if (o.status === "soon" || !o.openAt) return { key: "soon", label: "공개 예정", dday: null };
    const now = new Date();
    const open = new Date(`${o.openAt}T00:00:00`);
    const close = new Date(`${o.closeAt}T23:59:59`);
    if (now > close) return { key: "closed", label: "종료", dday: null };
    if (now >= open) return { key: "live", label: "진행 중", dday: null };
    return { key: "open", label: "개막 예정", dday: Math.ceil((open - now) / 86400000) };
  }, [o]);

  const soon = st.key === "soon";
  const closed = st.key === "closed";
  // 예약 열림은 상태와 별개 축 — 계약 §상태×행동
  const canReserve = !soon && !closed && (o.reserveOpen || st.key === "live");
  const tbd = "공개 예정";

  return (
    <div className={`${s.offWrap} ${s.sp12}`} data-mtype="info">
      <div className={s.offGrid}>
        {/* 필드1 — 포스터가 모듈의 얼굴. 행 전체 높이를 쓴다 */}
        <div className={s.offPoster} style={{ backgroundImage: `url(${ASSET(o.poster)})` }} role="img" aria-label="오프라인 팝업 포스터">
          <span className={`${s.offBadge} ${st.key === "live" ? s.offBadgeLive : ""}`}>{st.label}</span>
        </div>

        <div className={s.offMain}>
          {/* 자체 머리 해체(②) — 이름은 화면 머리가 말한다. 상태(D-day)만 남긴다 */}
          {st.dday > 0 && (
            <div className={s.offTitleRow}>
              <span className={s.offDday}>D-{st.dday}</span>
            </div>
          )}

          {/* 필드3 — 행사 소개글(PM 2026-08-28, 팝업 안내 포스팅 문법): 타이틀 → 훅 → 할 수 있는 것 → 클로징.
              장소·날짜·이벤트 목록은 아래 구조 필드가 갖고 있다(중복 표기 금지). */}
          {!soon && (
            <div className={s.offIntro}>
              <b>{o.introTitle}</b>
              <span>{o.introSub}</span>
              {o.intro.map((p) => <p key={p.slice(0, 12)}>{p}</p>)}
            </div>
          )}

          {/* 필드4 — 기본 정보 5(장소·기간·운영·체험·입장) */}
          <dl className={s.offFacts}>
            <div><dt>장소</dt><dd>{soon ? `${o.city} · 권역 ${tbd}` : `${o.city} ${o.area} · ${o.venue}`}</dd></div>
            <div><dt>기간</dt><dd>{soon ? tbd : o.period}</dd></div>
            <div><dt>운영</dt><dd>{soon ? tbd : `${o.hours} · ${o.lastEntry}`}</dd></div>
            <div><dt>체험</dt><dd>{soon ? tbd : o.run}</dd></div>
            <div><dt>입장</dt><dd>{o.entry}</dd></div>
          </dl>

          {/* 필드7 — 행동 2, 상태에 따라 주/보조가 바뀐다 */}
          <div className={s.offActions}>
            {canReserve ? (
              <>
                {/* 예약 존으로(PM 2026-08-31 — alert 막다른 문 해소). 예약돼 있으면 상태가 버튼이 된다 */}
                {pst && pst.reserve ? (
                  <button type="button" className={s.offGhost} onClick={() => go?.("reserve")}>예약됨 · {pst.reserve.label}</button>
                ) : (
                  <button type="button" className={s.offPrimary} onClick={() => go?.("reserve")}>예약하기</button>
                )}
                <button type="button" className={s.offGhost} onClick={() => setNoticed(true)}>{noticed ? "알림 신청됨" : "알림 받기"}</button>
              </>
            ) : closed ? (
              <button type="button" className={s.offGhost} onClick={() => go?.("reserve")}>내 예약 보기</button>
            ) : (
              <button type="button" className={s.offPrimary} onClick={() => setNoticed(true)}>
                {noticed ? "알림 신청됨" : soon ? "공개되면 알림 받기" : "예약 열리면 알림 받기"}
              </button>
            )}
          </div>
        </div>

        {/* 필드5 — 오시는 길: 일러스트 약도(계약 §3.0-2). 확정 전에는 권역만 */}
        <div className={s.offWay}>
          <span className={s.offWayHead}>오시는 길</span>
          <div className={s.offMap}>
            {soon ? (
              <span className={s.offMapMeta}>위치 {tbd}</span>
            ) : (
              <>
                <OfflineMap
                  station={o.station} line={o.line} lineColor={o.lineColor}
                  exit={o.exit} streets={o.streets} venue={o.venue} walk={o.walk}
                />
                <button type="button" className={s.offMapCta} onClick={() => setMapOpen(true)}>
                  위치 안내
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 필드6 — 프로그램(선택). 없으면 구획째 뺀다 */}
      {!soon && o.programs?.length > 0 && (
        <div className={s.offProgram}>
          <div className={s.offProgHead}>
            <span className={s.offProgDay}>낮 · {o.daytime}</span>
            <span className={s.offProgNight}>밤 · 호러 체험과 치맥</span>
          </div>
          <ul className={s.offProgList}>
            {o.programs.map((p) => (
              <li key={p.id}>
                <span className={s.offProgTop}>
                  <span className={s.offProgKind}>{p.kind}</span>
                  <b>{p.name}</b>
                </span>
                <span className={s.offProgDesc}>{p.desc}</span>
                <span className={s.offProgMeta}>{p.meta}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 필드8 — 유의사항. 제한 고지는 체험형 행사 안내의 표준 항목이다 */}
      {mapOpen && <PresentationDialog className={s.overlay} label="오프라인 팝업 위치 안내" onClose={() => setMapOpen(false)}>
        <div className={`${s.overlayBox} ${s.coBox}`}>
          <b>성수에서 만나는 효산고</b>
          <OfflineMap station={o.station} line={o.line} lineColor={o.lineColor} exit={o.exit} streets={o.streets} venue={o.venue} walk={o.walk} />
          <p className={s.infoBody}>{o.station} {o.exit} · {o.walk}<br />{o.streets.join(" · ")}</p>
          <p className={s.coNote}>행사 장소와 동선은 제안 시안입니다. 최종 주소와 입장 안내는 장소 확정 후 공개합니다.</p>
          <button type="button" className={s.ghostBtn} onClick={() => setMapOpen(false)}>닫기</button>
        </div>
      </PresentationDialog>}
      <p className={s.offFoot}>
        {!soon && o.caution && <span className={s.offCaution}>{o.caution}</span>}
        <span className={s.offBridge}>{o.bridge}</span>
      </p>
    </div>
  );
}

/* ── 굿즈 상품 상세 (커머스) ──
   계약 = `ICONS-굿즈-상품상세-화면기획-v0-2026-08-27`.
   한 문장: 이 물건을 살지 말지 결정하는 데 필요한 것만 담는다.
   1단(대표 컷·이름·값·살 수 있는가·행동)은 스크롤 없이 보이고,
   2단(구성·규격·원작 근거)과 3단(수령·재공급·확률·청약철회·인증)이 아래로 붙는다.
   바깥으로 나가는 이동은 「도전하러」 하나뿐이다 — 구매권 상품을 살 유일한 경로이므로 계약 안이다. */
function ProductDetail({ id, st, update, go, onBack, backLabel, size, onOptionChange }) {
  const m = mdById(id);
  const d = MD_DETAIL[id] || {};
  const rights = rightsOf(st);
  const [zoom, setZoom] = useState(0);      // 0 = 상품 컷 · 1 = 원작 근거 컷
  const setSize = onOptionChange;
  const [open, setOpen] = useState(null);   // 펼침 고지 키
  const [note, setNote] = useState(null);
  const noteRef = useRef(null);
  const toast = (msg) => {
    setNote(msg);
    clearTimeout(noteRef.current);
    noteRef.current = setTimeout(() => setNote(null), 1800);
  };
  useEffect(() => () => clearTimeout(noteRef.current), []);

  if (!m) return null;

  const gated = !!m.right;
  const r = gated ? rightDef(m.right) : null;
  const unlocked = !gated || !!rights[m.right];
  const soldout = d.stock === 0;
  const wished = st.wishes.includes(m.id);
  const wish = () => update((p) => ({ ...p, wishes: p.wishes.includes(m.id) ? p.wishes.filter((x) => x !== m.id) : [...p.wishes, m.id] }));

  // 상태 × 행동 — 계약 §3. 주 버튼 하나 + 찜.
  const state = getProductPresentationStatus(m, d, rights, st.cart);
  const booth = presentationDealSummary(st, { kind: "fcfs", productId: id });
  const needsOption = state.action === "add" && d.options && !size;
  const onPrimaryAction = () => {
    if (state.target) { go(state.target); return; }
    if (state.action === "add") {
      if (needsOption) return;
      addToCart(update, m.id, size);
      toast(`장바구니에 담았습니다${size ? ` · ${size}` : ""}`);
    } else if (state.action === "notify") toast("프레젠테이션에서는 알림 신청을 전송하지 않습니다.");
  };

  const shots = [{ src: m.src, kind: "상품" }].concat(d.origin ? [{ src: d.origin.still, kind: "원작" }] : []);
  const shot = shots[Math.min(zoom, shots.length - 1)];

  return (
    <div className={s.pdWrap}>
      <div className={s.pdBar}>
        <button type="button" className={s.backBtn} onClick={onBack}>{backLabel}</button>
      </div>

      {/* 1단 얼굴 — 스크롤 없이 다 보인다 */}
      <div className={s.pdTop}>
        <div className={s.pdGallery}>
          {shots.length > 1 && (
            <div className={s.pdThumbs}>
              {shots.map((x, i) => (
                <button
                  key={x.src} type="button"
                  className={`${s.pdThumb} ${i === zoom ? s.pdThumbOn : ""}`}
                  style={{ backgroundImage: `url(${ASSET(x.src)})` }}
                  onClick={() => setZoom(i)} aria-label={`${x.kind} 사진`}
                />
              ))}
            </div>
          )}
          <div className={s.pdShot} style={{ backgroundImage: `url(${ASSET(shot.src)})` }} role="img" aria-label={`${m.name} ${shot.kind} 사진`} />
        </div>

        <div className={s.pdInfo}>
          <span className={s.pdCat}>{m.cat}{d.edition ? ` · ${d.edition}` : ""}</span>
          <h4 className={s.pdName}>{m.name}</h4>
          <div className={s.pdPriceRow}>
            <b className={s.pdPrice}>{won(m.price)}</b>
            <span className={`${s.pdState} ${s[`pdState_${state.tone}`]}`}>{state.label}</span>
          </div>

          <dl className={s.pdFacts}>
            <div><dt>판매</dt><dd>{m.lanes.map((l) => LANE_LABEL[l]).join(" · ")}</dd></div>
            <div><dt>재고</dt><dd>{soldout ? "없음" : typeof d.stock === "number" ? `${d.stock.toLocaleString()}개` : "상시"}</dd></div>
            {typeof booth.stock === "number" && <div><dt>선착순 매대</dt><dd>잔여 {booth.stock.toLocaleString()}개{booth.count ? ` · 내 주문 ${booth.count}개` : ""}</dd></div>}
            {d.limit && <div><dt>한도</dt><dd>{d.limit}</dd></div>}
            {d.card && <div><dt>동봉</dt><dd>생존자 카드</dd></div>}
          </dl>

          {/* 선구매·에디션 — 잠금이 아니다. 누구나 사되 가진 사람이 먼저 사고 각인을 받는다 */}
          {m.first && (() => {
            const fr = rightDef(m.first); const hasFirst = !!rights[m.first];
            return (
              <div className={`${s.pdGate} ${hasFirst ? s.pdGateOn : ""}`}>
                <div className={s.pdGateHead}>
                  <b>{fr ? fr.name : "선구매권"}</b>
                  <span>{hasFirst ? "보유 — 먼저 산다" : rightProgress(st, m.first)}</span>
                </div>
                <span className={s.pdGateGoal}>{fr ? fr.goal : ""}</span>
                {fr && fr.edition && <span className={s.pdGateEdition}>{fr.edition}</span>}
              </div>
            );
          })()}

          {/* 구매 자격 — 구매권 상품에만. 일반 상품엔 구획째 없다(정책 P11 적용 범위) */}
          {gated && (
            <div className={`${s.pdGate} ${unlocked ? s.pdGateOn : ""}`}>
              <div className={s.pdGateHead}>
                <b>{r ? r.name : "구매권"}</b>
                <span>{unlocked ? "보유" : rightProgress(st, m.right)}</span>
              </div>
              <span className={s.pdGateGoal}>{r ? r.goal : "조건 준비 중"}</span>
              {r && r.edition && <span className={s.pdGateEdition}>{r.edition}</span>}
            </div>
          )}

          {d.options && (
            <div className={s.pdOpt}>
              <span className={s.pdOptName}>{d.options.name}</span>
              <div className={s.pdOptRow}>
                {d.options.values.map((v) => (
                  <button key={v} type="button" className={`${s.pdChip} ${size === v ? s.pdChipOn : ""}`} aria-pressed={size === v} onClick={() => setSize(v)}>{v}</button>
                ))}
              </div>
            </div>
          )}

          <div className={s.pdActions}>
            <button type="button" className={s.pdPrimary} disabled={!!needsOption || state.action === "full" || (state.action === "stock" && !state.target)} onClick={onPrimaryAction}>{needsOption ? `${d.options.name}를 선택해 주세요` : state.text}</button>
            <button type="button" className={`${s.pdWish} ${wished ? s.on : ""}`} onClick={wish}>{wished ? "♥ 찜함" : "♡ 찜"}</button>
          </div>

          {/* 재공급 표기 — 비워둘 수 없다(정책 P13) */}
          <p className={`${s.pdSupply} ${d.supply === "없음" ? s.pdSupplyEnd : ""}`}>
            <b>{d.supply}</b>{SUPPLY_NOTE[d.supply] ? ` — ${SUPPLY_NOTE[d.supply]}` : ""}
          </p>
        </div>
      </div>

      {/* 2단 본체 */}
      <div className={s.pdBody}>
        <section className={s.pdSec}>
          <h5>구성</h5>
          <ul className={s.pdParts}>
            {(d.parts || []).map((x) => <li key={x}>{x}</li>)}
          </ul>
        </section>

        <section className={s.pdSec}>
          <h5>규격</h5>
          <dl className={s.pdSpec}>
            {(d.spec || []).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </section>

        {d.origin && (
          <section className={`${s.pdSec} ${s.pdOrigin}`}>
            <h5>원작</h5>
            <button
              type="button" className={s.pdOriginShot}
              style={{ backgroundImage: `url(${ASSET(d.origin.still)})` }}
              onClick={() => setZoom(shots.length - 1)} aria-label="원작 장면 보기"
            />
            <p className={s.pdOriginLine}>{d.origin.line}</p>
          </section>
        )}
      </div>

      {/* 3단 보조 — 고지와 인증 */}
      <div className={s.pdNotice}>
        <div className={s.pdNoticeRow}>
          <span className={s.pdNoticeKey}>수령</span>
          <span className={s.pdNoticeVal}>{SHIPPING}</span>
        </div>

        {d.odds && (
          <button type="button" className={s.pdFold} onClick={() => setOpen(open === "odds" ? null : "odds")} aria-expanded={open === "odds"}>
            <span className={s.pdNoticeKey}>확률 공시</span>
            <span className={s.pdNoticeVal}>{d.odds.length}구간</span>
            <i aria-hidden="true">{open === "odds" ? "−" : "+"}</i>
          </button>
        )}
        {open === "odds" && (
          <table className={s.pdOdds}>
            <thead><tr><th>구간</th><th>확률</th><th>잔여</th></tr></thead>
            <tbody>
              {d.odds.map(([g, rate, left]) => <tr key={g}><td>{g}</td><td>{rate}</td><td>{left}</td></tr>)}
            </tbody>
          </table>
        )}

        <button type="button" className={s.pdFold} onClick={() => setOpen(open === "wd" ? null : "wd")} aria-expanded={open === "wd"}>
          <span className={s.pdNoticeKey}>청약철회</span>
          <span className={s.pdNoticeVal}>{WITHDRAWAL_STATE}</span>
          <i aria-hidden="true">{open === "wd" ? "−" : "+"}</i>
        </button>
        {open === "wd" && <p className={s.pdWithdrawal}>{WITHDRAWAL}</p>}

        {typeof d.proofs === "number" && d.proofs > 0 && (
          <button type="button" className={s.pdProof} onClick={() => toast("인증 목록은 커뮤니티에서 열립니다")}>
            <span>이 굿즈의 인증</span>
            <b>{d.proofs.toLocaleString()}건</b>
          </button>
        )}
      </div>

      {note && <div className={s.toast} role="status">{note}</div>}
    </div>
  );
}

/* ── 공식 소식 (정보성) ──
   소식은 여기서 전부 읽는다 — 카드는 이동하지 않는다. 예전에는 카드가 방송실 존으로 갔지만(「방송실 = 발신처」 설정),
   방송실이 호스 하강 게임이 되면서 그 도착지는 뜻을 잃었다(PM 2026-09-09 「그거 빼」). 읽음 처리는 이 화면에 서면 셸이 한다(v5.7). */
function NoticeModule() {
  /* 장면 문법 — 벤토 시절의 「모듈 전체가 버튼」을 해체했다. 소식 4건이 이미지 카드로 화면을 채운다. */
  return (
    <div className={s.noticeScene} data-mtype="info">
      {/* 자체 머리 해체(②) — OFFICIAL NOTICE·발신처는 화면 머리가 말한다 */}
      {/* 열 수는 건수에서 파생(확장성) — 4건=2열·6건=3열. 2행 한 화면 원칙은 유지 */}
      <div className={s.noticeGrid} style={{ gridTemplateColumns: `repeat(${Math.max(2, Math.ceil(NOTICES.length / 2))}, minmax(0, 1fr))` }}>
        {NOTICES.map((n) => (
          <div key={n.id} className={s.noticeCard}>
            <span className={s.noticeArt} style={{ backgroundImage: `url(${ASSET(n.img)})` }} aria-hidden="true" />
            <span className={s.noticeMeta}><em>{n.tag}</em>{n.at}</span>
            <b>{n.title}</b>
            <span className={s.noticeBodyText}>{n.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 커뮤니티 — 실제 icons-ip 피드 디자인 적용 & 최신 3건 스크롤 ──
   방명록이 아니다(PM 2026-08-26). 커뮤니티에서 #효산고생존자 태그로 쓰인 최신 3건을 가져와
   실제 커뮤니티 포스트 카드 형태(아바타·핸들·본문·5:7 포토카드·리액션 바)로 스크롤 열람 제공.
   「생존자의 벽」이라는 별칭은 폐기했다(PM 2026-09-04) — 이 팝업의 커뮤니티 표면은 커뮤니티존 하나다. */
function CommunityModule({ st, onCompose }) {
  const [likes, setLikes] = useState({ p1: 214, p2: 460, p3: 132 });
  const [liked, setLiked] = useState({});
  const scrollRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const toggleLike = (e, id) => {
    e.stopPropagation();
    const isLiked = Boolean(liked[id]);
    setLiked((prev) => ({ ...prev, [id]: !isLiked }));
    setLikes((prev) => ({ ...prev, [id]: isLiked ? (prev[id] || 0) - 1 : (prev[id] || 0) + 1 }));
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, clientWidth } = scrollRef.current;
    const idx = Math.round(scrollLeft / (clientWidth || 1));
    setActiveIdx(Math.min(WALL_POSTS.length - 1, Math.max(0, idx)));
  };

  const scrollTo = (dir) => {
    if (!scrollRef.current) return;
    const cardWidth = scrollRef.current.clientWidth;
    scrollRef.current.scrollBy({ left: dir * (cardWidth + 12), behavior: "smooth" });
  };

  return (
    <div className={`${s.wallModule} ${s.sp6}`} data-mtype="community">
      {/* 자체 머리 해체(②) — 이름·문장은 화면 머리가 말한다. 태그·내비만 남긴다 */}
      <div className={s.wallHead}>
        <span className={s.wallTag}>{WALL_TAG}</span>
        <div className={s.wallNavButtons}>
          <span className={s.wallPageIndicator}>{activeIdx + 1} / {WALL_POSTS.length}</span>
          <button type="button" onClick={() => scrollTo(-1)} className={s.wallNavBtn}>이전</button>
          <button type="button" onClick={() => scrollTo(1)} className={s.wallNavBtn}>다음</button>
        </div>
      </div>

      <div className={s.wallFeedTrack} ref={scrollRef} onScroll={handleScroll}>
        {wallFeedOf(st).slice(0, 3).map((p) => {
          const isLiked = Boolean(liked[p.id]);
          const likeCount = likes[p.id] !== undefined ? likes[p.id] : p.like;
          // X 피드 포스트 해부(PM 2026-08-31): 아바타 좌열 + [한 줄 메타 → 본문 → 라운드 미디어 → 고스트 액션 행]
          return (
            <article key={p.id} className={s.communityCard}>
              <span className={s.commAvatar} style={{ background: p.avatar }}>
                {p.initial || p.user[0]?.toUpperCase()}
              </span>
              <div className={s.commBody}>
                <div className={s.commMetaLine}>
                  <b>{p.user}</b>
                  <span>{p.handle} · {p.at}</span>
                </div>
                <p className={s.commText}>{p.text}</p>
                {p.img && (
                  <div className={s.commMedia} style={{ backgroundImage: `url(${ASSET(p.img)})` }} aria-hidden="true" />
                )}
                <div className={s.commReactions}>
                  {/* 옥상이 피드를 갖고 있던 시절의 잔재 — 커뮤니티 통일(2026-09-04)로 글쓰기가 받는다 */}
                  <button type="button" onClick={onCompose} className={s.commAct} aria-label="댓글">
                    💬 <em>{p.reply}</em>
                  </button>
                  <button
                    type="button" onClick={(e) => toggleLike(e, p.id)}
                    className={`${s.commAct} ${isLiked ? s.commActOn : ""}`} aria-label="좋아요"
                  >
                    {isLiked ? "♥" : "♡"} <em>{likeCount}</em>
                  </button>
                  <span className={s.commTag}>#{p.tag}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <button type="button" className={s.wallCta} onClick={onCompose}>
        <span>나의 생존 기록 남기기</span>
      </button>
    </div>
  );
}

/* 하는 법 줄 — 존 모듈의 힌트와 HUD 컨텍스트 「하는 법」 칸이 같은 줄을 쓴다(도서관 LIB_GUIDE_LINES 와 같은 처리 · v6.0 PR ②) */
const CAFE_GUIDE_LINES = [
  "한 판은 5회차. 점수는 가장 좋은 3회차의 합.",
  "회차마다 머무는 만큼 포인트가 오른다.",
  "유리문이 뚫리기 전에 탈출하면 그 회차 포인트를 얻는다. 뚫리면 0.",
  `무료. 점수에 따라 구매권이 차등으로 열린다. ${RIGHT_GOALS.cafePass.toLocaleString()}p 이상이면 옥상 완주권.`,
];
const HOSE_GUIDE_LINES = [
  "누르고 있으면 잡는다. 놓으면 미끄러진다.",
  "열린 창에서 좀비가 튀어나온다. 창과 창 사이에서 멈춰 기다렸다가 지나간다.",
  "마지막 창에서 멈추면 방송실이다.",
];
const ROOF_GUIDE_LINES = [
  "급식실 · 방송실 · 도서관 세 체험을 한 번씩 마치면 옥상이 열린다.",
  "옥상까지 완주하면 학생증 각인판과 모닥불 오르골 구매권이 함께 열린다.",
];

/* ── Z2 급식실 — 크래시 (2026-09-03 · 무료 참여 · 점수별 차등 구매권) ──
   규칙은 `lib/zones/engine-cafeteria.js`(뚫림·포인트·최고 3회차 합) · 화면은 `CafeteriaCrash.jsx`.
   이 함수는 **존을 붙이는 자리**일 뿐이다 — 수치가 여기 들어오면 관문이 못 잡는다.
   존에 들어오면 무인 시연이 돈다(오락실 데모). 한 판 = 5회차 · 점수 = 최고 3회차 합.
   보상 = 구매권 4단(RIGHTS game:"cafeteria", 최고 기록 기준·누적) + 옥상 완주권(cafePass). 참여권·상품 구성은 없다(PM). */
function Cafeteria({ st, update, go, paused }) {
  const rights = rightsOf(st);
  const join = () => update((p) => ({ ...p, rec: { ...p.rec, cafeTry: (p.rec.cafeTry || 0) + 1 } }));
  const result = ({ score }) => {
    const pass = score >= RIGHT_GOALS.cafePass;
    const best = Math.max(st.rec.cafeBest || 0, score);
    update((p) => ({
      ...p,
      clears: { ...p.clears, cafeteria: p.clears.cafeteria || pass },
      rec: { ...p.rec, cafeBest: Math.max(p.rec.cafeBest || 0, score), cafePass: p.rec.cafePass || pass },
    }));
    return { pass, reached: RIGHTS.filter((r) => r.game === "cafeteria" && score >= r.score).map((r) => r.id), newly: RIGHTS.filter((r) => r.game === "cafeteria" && score >= r.score && (st.rec.cafeBest || 0) < r.score).map((r) => r.id), best };
  };

  return (
    <section className={s.zoneSec}>
      <ZoneSecHead eyebrow="PLAY" title={ZONE_GAME_NAME.cafeteria} right={<Hint items={CAFE_GUIDE_LINES} />} />
      <div className={s.gameStage} style={{ alignItems: "stretch" }}>
        <CafeteriaCrash paused={paused} rights={rights} best={st.rec.cafeBest || 0} passAt={RIGHT_GOALS.cafePass} hasPass={!!st.rec.cafePass} onJoin={join} onResult={result} go={go} />
        {(st.rec.cafeBest || st.rec.cafeTry) ? (
          <p className={`${s.zoneMeta} ${s.metaTop}`}>최고 {(st.rec.cafeBest || 0).toLocaleString()}p · {st.rec.cafeTry || 0}판{st.rec.cafePass ? " · 옥상 완주권" : ""}</p>
        ) : null}
      </div>
    </section>
  );
}

/* ── Z3 방송실 — 소화전 호스 하강 (P5 · 2026-09-04 재미 판정 통과 판) ──
   규칙은 `lib/zones/engine-hose.js` 한 곳에만 있고 화면은 `HoseDescent` 가 갖는다. 이 존은 결과만 받아 기록 키를 쓴다.
   앞선 두 판(커튼 줄 하강 · 주파수 정렬)은 폐기됐다 — 기록 키 `castClean`·`castDone`·`castTry` 도 함께. */
function Broadcast({ st, update, go, paused }) {
  /* 게임 관문(PM 2026-09-09): 시작 버튼 → 게임, 끝나면 다시 시작 화면 + 재참여 5분. 다시 시작은 호스 게임을 새로 단다(key) */
  const { left: lockLeft, lock } = useGameLock("broadcast");
  const [gate, setGate] = useState("idle");
  const [run, setRun] = useState(0);
  const [last, setLast] = useState("");
  const onFinish = useCallback((r) => {
    lock(); setLast(`${r.saved}명 들여보냄`); setGate("over");
    update((p) => ({
      ...p,
      clears: { ...p.clears, broadcast: p.clears.broadcast || r.saved >= RIGHT_GOALS.hoseSaved },
      rec: {
        ...p.rec,
        hoseTry: (p.rec.hoseTry || 0) + 1,
        // 클수록 좋다 — 한 판에 들여보낸 최고 인원
        hoseSaved: Math.max(p.rec.hoseSaved || 0, r.saved),
      },
    }));
  }, [update, lock]);
  /* 화면에 글자를 안 둔다(PM 2026-09-09 「게임 플레이 창이 엄청 작고 쓸데없는 텍스트가 엄청 많아」) —
     하는 법은 ? 한 개, 결과·기록은 무대 위 한 줄과 보상 계약의 진행 줄이 말한다.
     공식 소식은 여기 없다(PM 2026-09-09 「그거 빼」) — 「방송실 = 발신처」는 농성 방송 장면의 잔재였고, 소식은 허브 소식 모듈이 전부 보여 준다. */
  return (
    <section className={s.zoneSec}>
      <ZoneSecHead eyebrow="PLAY" title={ZONE_GAME_NAME.broadcast}
        right={<Hint items={HOSE_GUIDE_LINES} />} />
      {/* 게임은 한 행, 보상은 그 아래 — 급식실 문법(PM 2026-09-09) */}
      <div className={s.playGrid}>
      <div className={s.gameStage}>
        <div className={s.gameGateWrap}>
          <HoseDescent key={run} enabled={gate === "playing"} paused={paused} onFinish={onFinish} />
          {/* 잠긴 채로 들어오면 시작 전이라도 「끝남」 관문 — 타이머가 뚫리지 않는다 */}
          <GameGate state={gate === "idle" && lockLeft > 0 ? "over" : gate} title={ZONE_GAME_NAME.broadcast} result={last} left={lockLeft}
            onStart={() => { if (gate === "over" || lockLeft > 0) setRun((n) => n + 1); setGate("playing"); }} />
        </div>
      </div>
      <div className={s.contractWrap}><RewardShelf st={st} ids={["radioPair"]} go={go} /></div>
      </div>
    </section>
  );
}

/* ── Z5 굿즈샵 ── */
/* ── 굿즈샵 목록 — 무신사 목록 문법으로 맞춤(PM 2026-09-04, 레퍼런스 = musinsa 랭킹 목록) ──
   ① 2단 필터: 판매 방식(알약) → 분류(텍스트 밑줄). 2차 수는 1차 결과를 따라 준다.
   ② 옵션 행: 지금 살 수 있는 것만 · 정렬 4.
   ③ 카드: 사진(배지 좌하단 · 찜 우하단) → 분류 → 이름 2줄 → 가격 → 회색 증거 칩.
   무신사의 「할인율 빨강」 자리는 비운다 — 우리에겐 할인 정책이 없고 만들어 낼 값이 아니다.
   그 자리를 받는 것은 희소성(재입고 없음)이다.
   ④ 순위 번호는 **인기순으로 정렬했을 때만** 붙는다(PM 2026-09-04) — 순위는 정렬이 만든 사실이지
      상품이 늘 갖고 있는 속성이 아니다. 추천·가격순에서 번호를 달면 없는 랭킹을 있는 것처럼 말하게 된다. */
const LANE_ORDER = ["shop", "pre", "fcfs", "kuji", "raffle", "right"];
const STORE_SORTS = [["rec", "추천순"], ["proof", "인기순"], ["low", "낮은 가격"], ["high", "높은 가격"]];

function Store({ st, update, openProduct, go, lane = null, onLane }) {
  const toggle = (id) => update((p) => ({ ...p, wishes: p.wishes.includes(id) ? p.wishes.filter((x) => x !== id) : [...p.wishes, id] }));
  const rights = rightsOf(st);
  const [note, setNote] = useState(null);
  const setLane = (l) => onLane && onLane(l);   // 1차 — 판매 방식(null = 전체). 셸이 소유한다 — 들어온 문·HUD 진열 행이 같은 레인을 만진다(v6.0 PR ③)
  const [cat, setCat] = useState(null);     // 2차 — 분류
  const [sort, setSort] = useState("rec");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const noteRef = useRef(null);
  const toast = (msg) => {
    setNote(msg);
    clearTimeout(noteRef.current);
    noteRef.current = setTimeout(() => setNote(null), 1800);
  };
  const detOf = (m) => MD_DETAIL[m.id] || {};
  const isOpen = (m) => ["add", "full"].includes(getProductPresentationStatus(m, detOf(m), rights, st.cart).action);

  // 1차 수는 언제나 전체 기준 — 고르는 축이 흔들리지 않는다
  const laneCount = LANE_ORDER.reduce((a, l) => { a[l] = MD.filter((m) => m.lanes.includes(l)).length; return a; }, {});
  const laneList = LANE_ORDER.filter((l) => laneCount[l] > 0);
  const byLane = lane ? MD.filter((m) => m.lanes.includes(lane)) : MD;
  // 2차는 데이터에서 나온다 — 분류가 늘어도 레일이 감당한다(고정 목록 금지)
  const cats = byLane.reduce((a, m) => { a[m.cat] = (a[m.cat] || 0) + 1; return a; }, {});
  const catList = Object.keys(cats).sort((a, b) => cats[b] - cats[a] || a.localeCompare(b, "ko"));
  const catOn = cats[cat] ? cat : null;   // 1차가 바뀌어 사라진 분류는 스스로 풀린다
  let shown = catOn ? byLane.filter((m) => m.cat === catOn) : byLane;
  if (onlyOpen) shown = shown.filter(isOpen);
  if (sort !== "rec") {
    const key = { proof: (m) => -(detOf(m).proofs || 0), low: (m) => m.price, high: (m) => -m.price }[sort];
    shown = [...shown].sort((a, b) => key(a) - key(b));
  }
  return (
    <div>
      {/* 이 화면은 굿즈샵의 팝업 필터 뷰다(ADR-0026) — 활성 필터가 보이고, 푸는 행동이 있어야 한다. */}
      <div className={s.filterBar}>
        <span className={s.filterChip}>이 팝업 <i aria-hidden="true">✕</i></span>
        <span className={s.filterCount}>{MD.length}종</span>
        {st.wishes.length > 0 && <span className={s.filterWish}>♥ {st.wishes.length}</span>}
        <button type="button" className={s.filterClear} onClick={() => toast("전체 상품 목록은 정식판에서 열립니다")}>
          전체 상품 보기
        </button>
      </div>

      <div className={s.catRail} role="tablist" aria-label="판매 방식">
        <button type="button" role="tab" aria-selected={!lane} className={`${s.catChip} ${!lane ? s.catOn : ""}`} onClick={() => setLane(null)}>
          전체 <em>{MD.length}</em>
        </button>
        {laneList.map((l) => (
          <button key={l} type="button" role="tab" aria-selected={lane === l} className={`${s.catChip} ${lane === l ? s.catOn : ""}`} onClick={() => setLane(lane === l ? null : l)}>
            {LANE_LABEL[l]} <em>{laneCount[l]}</em>
          </button>
        ))}
      </div>

      <div className={s.subRail} role="tablist" aria-label="분류">
        <button type="button" role="tab" aria-selected={!catOn} className={`${s.subItem} ${!catOn ? s.subOn : ""}`} onClick={() => setCat(null)}>전체</button>
        {catList.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={catOn === c} className={`${s.subItem} ${catOn === c ? s.subOn : ""}`} onClick={() => setCat(catOn === c ? null : c)}>
            {c} <em>{cats[c]}</em>
          </button>
        ))}
      </div>

      <div className={s.optRow}>
        <label className={s.optCheck}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          지금 살 수 있는 것만
        </label>
        <div className={s.sortRow} role="tablist" aria-label="정렬">
          {STORE_SORTS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={sort === k} className={`${s.sortBtn} ${sort === k ? s.sortOn : ""}`} onClick={() => setSort(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className={`${s.shopShelf} ${s.shelfPad}`}>
        {shown.map((m, i) => {
          const gated = !!m.right;
          const open = isOpen(m);
          const d = detOf(m);
          const wished = st.wishes.includes(m.id);
          const zid = zoneOfProduct(m);
          const zn = zid && ZONES.find((x) => x.id === zid);
          return (
            /* 카드 전체가 상세로 가는 이동이다(계약 §6). 카드 안에서 사지 않는다 — 구매는 상세에서 시작한다. */
            <div
              key={m.id} role="link" tabIndex={0}
              className={`${s.gcard} ${s.gLink} ${gated && !open ? s.gLocked : ""}`}
              onClick={() => openProduct?.(m.id, "store")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduct?.(m.id, "store"); } }}
            >
              <div className={s.gPh} style={{ backgroundImage: `url(${ASSET(m.src)})` }}>
                {sort === "proof" && <span className={s.gRank} aria-label={`인기 ${i + 1}위`}>{i + 1}</span>}
                {gated && !open ? (
                  <LockOverlay right={m.right} go={go} />
                ) : (
                  <span className={`${s.gTag} ${gated ? s.gTagOn : ""}`}>{gated ? "구매 가능 · 구매권" : LANE_LABEL[m.lanes[0]]}</span>
                )}
                <button
                  type="button" className={`${s.gHeart} ${wished ? s.on : ""}`}
                  aria-label={wished ? "찜 해제" : "찜"} aria-pressed={wished}
                  onClick={(e) => { e.stopPropagation(); toggle(m.id); }}
                >{wished ? "♥" : "♡"}</button>
              </div>
              {/* 목록은 고르는 곳이다 — 구성·규격·구매 자격의 정밀한 값은 상세가 받는다(중복 표기 금지). */}
              <div className={s.gInfo}>
                <span className={s.gCat}>{m.cat}</span>
                <b className={s.gName}>{m.name}</b>
                {/* 희소성은 가격 왼쪽 — 레퍼런스가 할인율을 두는 자리다(우리에겐 할인이 없다) */}
                <span className={s.gPrice}>
                  {d.supply === "없음" && <em className={s.gScarce}>재입고 없음</em>}
                  {won(m.price)}
                </span>
                <div className={s.gProof}>
                  {d.proofs ? <span>인증 {d.proofs.toLocaleString()}</span> : null}
                  {d.stock ? <span>잔여 {d.stock.toLocaleString()}</span> : null}
                </div>
                {/* 어울리는 존으로 가는 문(PM) — 이 상품의 장면으로 */}
                {zn && (
                  <button type="button" className={s.gZone} onClick={(e) => { e.stopPropagation(); go?.(zid); }}>
                    {zn.name.split(" — ")[0]} 보기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {shown.length === 0 && <p className={s.gEmpty}>고른 조건에 맞는 상품이 없습니다.</p>}
      {/* 구매권 현황은 학생증(내 기록)이, 누적 구매는 HUD 「구매 내역」 탭이 소유한다(컨텍스트 추종). */}
      {note && <div className={s.toast} role="status">{note}</div>}
    </div>
  );
}

/* ── Z6 옥상 — 결말 · 모닥불 · 시즌2 관문 ── */
/* ── 옥상 문 — 체험 3곳 참여 전에는 안으로 들어가지 않는다. 남은 존으로 가는 문만 세운다 ── */
function RooftopLocked({ st, go }) {
  const played = playedOf(st);
  return (
    <section className={s.zoneSec}>
      <ZoneSecHead eyebrow="PLAY" title={ZONE_GAME_NAME.rooftop} />
      <div className={s.season2} data-mtype="experience">
        <b>문이 잠겨 있다</b>
        <span className={s.zoneMeta}>체험 {playedCount(st)} / {PLAY_ZONES.length} 참여 시 열림</span>
        <div className={s.leadActs}>
          {PLAY_ZONES.filter((z) => !played[z]).map((z) => (
            <button key={z} type="button" className={s.leadBtn} onClick={() => go(z)}>{goLabel(z)}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 옥상 — 결말이자 시즌2로 가는 문(PM 2026-09-02 A안). 체험존 4번째, 장 6 유지(HUD 부스 매핑 보존).
   ADR-0033 세 모듈: 게임(체험 — 동사는 P2 3안 비교 후, 그전까지 「모닥불 앞에 앉기」가 임시 완주) ·
   상품(커머스 — 각인판·오르골 구매권 + 시즌2 사전예약 문) · 감상(정보성 — ⑩ 재회 클립 확보 전엔 머리 스틸이 대체).
   스탬프·인장·합류 게이트·컬렉션 카드는 폐지(PM 2026-09-02). ── */
function Rooftop({ st, update, go }) {
  const finish = () => update((p) => (p.clears.rooftop ? p : { ...p, clears: { ...p.clears, rooftop: true } }));
  return (
    <section className={s.zoneSec}>
      <ZoneSecHead eyebrow="PLAY" title={ZONE_GAME_NAME.rooftop} />
      <div className={s.bonfireWrap} data-mtype="experience">
        <div className={s.flame} aria-hidden="true"><i /><i /><i /></div>
        <div className={s.fireInfo}>
          <b>옥상의 모닥불</b>
          <span className={s.zoneMeta}>{st.clears.rooftop ? "완주" : "불이 켜져 있다."}</span>
          {!st.clears.rooftop && <button type="button" className={s.ghostBtn} onClick={finish}>모닥불 앞에 앉기</button>}
        </div>
      </div>
      {/* 게임 규칙(PM 2026-09-09): 체험이 한 행, 보상은 그 아래 */}
      <div className={s.contractWrap}><RewardShelf st={st} ids={["idEngraved", "bonfireOrgel"]} go={go} /></div>
      {/* 시즌2 관문 — 결말은 다음 시즌으로 이어진다. 사전예약(시즌2 기다림 에디션)이 그 문이다 */}
      <div className={s.season2} data-mtype="commerce">
        <b>시즌2로</b>
        <span className={s.zoneMeta}>시즌2 기다림 에디션 · 사전예약 {presentationDealSummary(st, { kind: "preorder", productId: PREORDER.mdId }).reservations.toLocaleString()}명</span>
        <button type="button" className={s.primaryBtn} onClick={() => go("preorder")}>사전예약하기</button>
      </div>

    </section>
  );
}

/* 도서관 — 서가 탈출(플랫포머). 2026-09-04 PM 재미 판정 통과 판.
   규칙은 `lib/zones/engine-library.js` · 씬은 `library-run-scene.js`(Phaser 4, ADR-0027) · 화면은 `LibraryRun.jsx`.
   이 함수는 존을 붙이고 **기록을 남기는** 자리다. 무상 존이다.
   기록 = libRuns(횟수) · libEscaped(탈출) · libBookmarks(최고, **클수록 좋다**) · libNoHit · libSecret
        · libBestMs(최고 기록 시간, **작을수록 좋다 — Math.min**).
   보상 = 탈출 → 포토카드 선구매권 + 미션 셋 → 선구매·에디션 3종(PM 판정 C 2026-09-04). */
/* 도서관 하는 법 — 한 벌을 넓은 화면 판(ZoneGuide)과 HUD 컨텍스트(하는 법 칩) 두 자리에 쓴다 */
const LIB_GUIDE_LINES = [
  "저절로 달린다.",
  "탭하면 뛴다. 연속 두 번이면 멀리 뛴다. 아래로 쓸면 미끄러진다.",
  "뒤에서 무리가 밀려온다. 멈추면 잡힌다.",
  "튀어나오는 놈이 낮으면 뛰고, 덮치면 미끄러진다.",
  "잡히면 구간 처음부터. 비상계단 끝 창까지 가면 탈출이다.",
];
const LIB_GUIDE = <GuideLines items={LIB_GUIDE_LINES} />;   /* HUD 「하는 법」 칸과 존 모듈이 같은 줄을 쓴다 */
/* 미션 4 — 게임(`LibraryRun.MISSION_ROWS`)과 같은 순서·같은 말. 진행은 게임이 `onMissions` 로 올려 준다 */
const LIB_MISSIONS = [
  { key: "escaped", label: "탈출", prize: "포토카드 구매권" },
  { key: "bookmarks", label: `책갈피 ${LIB_BOOKMARKS}개`, prize: "화살 북마크 선구매권" },
  { key: "noHit", label: "무피격 탈출", prize: "데스크 장패드 선구매권" },
  { key: "secret", label: "비밀 서고 통과", prize: "실험노트 선구매권" },
];

function Library({ st, update, go, onPane, onMissions, paused }) {
  const [msg, setMsg] = useState("");
  /* 게임 관문(PM 2026-09-09): 도서관은 제 오프닝(시작 버튼)이 있으므로 관문은 **끝난 뒤**만 맡는다 — 다시 시작 + 재참여 5분. 다시 시작은 씬을 새로 달고(key) 바로 달린다(autoStart) */
  const { left: lockLeft, lock } = useGameLock("library");
  const [gate, setGate] = useState("playing");
  const [run, setRun] = useState(0);
  const [auto, setAuto] = useState(false);
  const [started, setStarted] = useState(false);
  const finish = ({ escaped, bookmarks, noHit, secret, ms }) => {
    lock(); setGate("over");
    update((p) => ({
      ...p,
      clears: { ...p.clears, library: p.clears.library || escaped },
      rec: {
        ...p.rec,
        libRuns: (p.rec.libRuns || 0) + 1,
        libEscaped: p.rec.libEscaped || escaped,
        libBookmarks: Math.max(p.rec.libBookmarks || 0, bookmarks),          // 클수록 좋다
        libNoHit: p.rec.libNoHit || noHit,
        libSecret: p.rec.libSecret || secret,
        libBestMs: Math.min(p.rec.libBestMs || Infinity, ms),                // **작을수록 좋다** — Math.max 를 옮겨 오지 않는다
      },
    }));
    /* 탈출은 잠금 구매권, 미션 셋은 선구매권 — 합쳐 부를 때는 「구매권」이 맞다(둘의 상위 개념) */
    const got = [escaped && "포토카드", bookmarks >= LIB_BOOKMARKS && "화살 북마크", noHit && "데스크 장패드", secret && "실험노트"].filter(Boolean);
    setMsg(`빠져나왔다 — ${(ms / 1000).toFixed(1)}초 · 구매권 ${got.length}종${got.length ? ` (${got.join(" · ")})` : ""}`);
  };
  return (
    <section className={s.zoneSec}>
      <ZoneSecHead eyebrow="PLAY" title={ZONE_GAME_NAME.library} />
      <ZoneGuide deskOnly>{LIB_GUIDE}</ZoneGuide>
      {/* 한 화면(PM 2026-09-08): 넓은 화면은 **게임 | 보상 계약** 두 기둥 — 급식실의 무대|보상 문법과 같다 */}
      <div className={s.playGrid}>
      <div className={s.gameStage}>
        <div className={s.gameGateWrap}>
          <LibraryRun key={run} paused={paused || gate === "over" || (!started && lockLeft > 0)} autoStart={auto} onFinish={finish} onPane={onPane} onMissions={onMissions} />
          {/* 잠긴 채로 들어오면 도서관 제 오프닝 위에 관문이 먼저 선다 — 타이머가 뚫리지 않는다 */}
          <GameGate state={gate === "over" ? "over" : (!started && lockLeft > 0 ? "over" : gate)} title={ZONE_GAME_NAME.library} result={msg} left={lockLeft}
            onStart={() => { if (lockLeft > 0 || paused) return; setRun((n) => n + 1); setAuto(true); setStarted(true); setGate("playing"); }} />
        </div>
        {msg && <p className={s.gameMsg}>{msg}</p>}
        {st.rec.libRuns > 0 && (
          <p className={s.zoneMeta}>
            {st.rec.libRuns}번 시도 · 책갈피 최고 {st.rec.libBookmarks || 0}/{LIB_BOOKMARKS}
            {st.rec.libBestMs ? ` · 최고 ${(st.rec.libBestMs / 1000).toFixed(1)}초` : ""}
            {st.rec.libNoHit ? " · 무피격" : ""}{st.rec.libSecret ? " · 비밀 서고" : ""}
          </p>
        )}
      </div>
      <div className={s.contractWrap}><RewardShelf st={st} ids={["libPhoto", "libBookmarkSet", "libDeskmat", "libJournal"]} go={go} /></div>
      </div>
    </section>
  );
}

/* ── 학생증 상세 — HUD 카드를 누르면 열린다(PM 2026-08-28: 컬렉션 대신 상세).
   카드 원본(실크기) + 학생증에 얹히는 나의 기록 전부. 컬렉션은 여기서 한 단계 더 들어간다. ── */
/* 열 내장 컴팩트 지도(v2.4 시험) — 이동 열 280px 고정폭 기준. 부스 = FP_MINI 좌표(2단 배치),
   상태(현 위치·잠금)만 남기고 게이지·인원·범례는 생략(오버레이판 어휘의 감산) */
/* 마감 점(flag) 비주입 — PM 2026-09-07 「A로 진행해」. 한정판존에 손으로 박아 둔 상시 점멸이었는데,
   ① 실제 마감을 보지 않아 래플이 끝나도 사전예약이 안 열려도 똑같이 깜빡였고
   ② 뜻을 읽을 범례가 v3.7 에서 사라져 툴팁 말고는 알 길이 없었다(PM 「저 주황 불은 왜 있는거야」).
   마감은 HUD 컨텍스트가 「종료 D-N」으로 이미 말한다. 공통 렌더러의 flag 슬롯은 남는다(glyph 와 같은 처리). */

/* 가로형(밴드 내 상시판 · v3.4 복원) — 2단 배치, 260×132. 상시 표면은 HUD 영역을 넘지 않는다(PM) */
const FP_WIDE = [
  { ch: 0, x: 4,   y: 74, w: 56, h: 50 },
  { ch: 1, x: 64,  y: 74, w: 56, h: 50 },
  { ch: 2, x: 124, y: 74, w: 62, h: 50 },
  { ch: 3, x: 190, y: 74, w: 66, h: 50 },
  { ch: 4, x: 190, y: 8,  w: 66, h: 50 },
  { ch: 5, x: 100, y: 8,  w: 86, h: 50 },
  { ch: 6, x: 4,   y: 8,  w: 92, h: 50, lock: true },
];

/* 세로형(호버 확대판·모바일 시트) 배치 — 2열 대형 부스·뱀길 동선(v3.0b 「꽉 채우는 느낌」) */
const FP_TALL = [
  { ch: 0, x: 10,  y: 206, w: 106, h: 52 },
  { ch: 1, x: 124, y: 206, w: 106, h: 52 },
  { ch: 2, x: 124, y: 146, w: 106, h: 52 },
  { ch: 3, x: 10,  y: 146, w: 106, h: 52 },
  { ch: 4, x: 10,  y: 86,  w: 106, h: 52 },
  { ch: 5, x: 124, y: 86,  w: 106, h: 52 },
  { ch: 6, x: 10,  y: 14,  w: 220, h: 60, lock: true },
];

function FloorplanMini({ st, section, onJump, variant = "tall" }) {
  /* 좌표 2벌(v3.4) — wide = 밴드 내 상시판(데스크톱) · tall = 호버 확대판+모바일 시트. 지도 스타일·데이터는 동일 */
  // 옥상 부스(lock) = 체험 3곳 참여 전 잠김(PM 2026-09-03) → 열림(결말) → 완주
  const mk = (b) => ({
    id: b.ch, name: SECTIONS[b.ch], x: b.x, y: b.y, w: b.w, h: b.h,
    state: b.lock ? (st.clears.rooftop ? "done" : rooftopLocked(st) ? "locked" : undefined) : undefined,
    stateLabel: b.lock ? (st.clears.rooftop ? "완주" : rooftopLocked(st) ? `체험 ${playedCount(st)}/${PLAY_ZONES.length}` : "결말") : undefined,
  });
  if (variant === "wide") {
    return (
      <PopupFloorplan booths={FP_WIDE.map(mk)} current={section} onJump={onJump} viewBox="0 0 260 132"
        path="M32 128 L32 124 C32 104 40 99 60 99 L200 99 C220 99 223 90 223 74 L223 62 C223 42 216 33 196 33 L60 33 M66 39 L58 33 L66 27"
        entry={{ x: 22, y: 123 }} />
    );
  }
  return (
    <PopupFloorplan booths={FP_TALL.map(mk)} current={section} onJump={onJump} viewBox="0 0 240 270"
      path="M63 258 C63 240 80 232 110 232 L170 232 C205 232 177 210 177 198 L177 178 C177 165 160 172 130 172 L110 172 C80 172 63 165 63 150 L63 138 C63 122 80 112 100 112 L150 112 C185 112 177 100 177 92 L177 86 C177 80 150 74 120 74 M126 80 L118 74 L126 68"
      entry={{ x: 30, y: 260 }} />
  );
}

/* ── 학생증 뒷면(PM 2026-08-31 「상세는 뒷면 디자인으로」) — 실물 카드 뒷면 문법:
   자기 띠 · 수색 기록란(도장) · 자격 소계 · 현장 예약 기입 · 기록 · 하단 미세문구+일련.
   앞면(stuCard)과 같은 소품 재질 — 색 예산 밖(소품). 데이터는 전부 실측(st). ── */
function IdCardBack({ st }) {
  const rsvNo = st.reserve ? `HS-${String(1000 + st.reserve.day * 17 + st.reserve.slot)}` : null;
  return (
    <div className={s.idBack} aria-label="학생증 뒷면">
      <i className={s.idBackStripe} aria-hidden="true" />
      <div className={s.idBackSec}>
        <b>자격</b>
        <span>구매권 {rightCount(st)}/{RIGHTS.length}</span>
      </div>
      {(st.wins || []).length > 0 && (
        <div className={s.idBackSec}>
          <b>보관함</b>
          <span>당첨 {st.wins.length} · 배송 신청 {st.wins.filter((w) => w.claimedAt).length}</span>
        </div>
      )}
      {(st.orders || []).length > 0 && (
        <div className={s.idBackSec}>
          <b>주문 내역</b>
          <span>{st.orders.length}건 · {won(st.orders.reduce((sum, o) => sum + o.total, 0))}</span>
        </div>
      )}
      <div className={s.idBackSec}>
        <b>현장 예약</b>
        {st.reserve
          ? <span>{st.reserve.label} · {rsvNo}</span>
          : <span className={s.idBackBlank}>미예약 — 오프라인 팝업에서 접수</span>}
      </div>
      {(st.rec.cafeBest || st.rec.hoseTry || st.rec.libRuns) && (
        <div className={s.idBackSec}>
          <b>기록</b>
          <span>
            {[
              st.rec.cafeBest ? `급식실 최고 ${st.rec.cafeBest.toLocaleString()}p · ${st.rec.cafeTry || 0}판${st.rec.cafePass ? " · 완주권" : ""}` : null,
              st.rec.hoseTry ? `방송실 최고 ${st.rec.hoseSaved || 0}명 / ${HOSE_PEOPLE}명 · ${st.rec.hoseTry}판` : null,
              /* 도서관은 점수가 아니라 해낸 것들이다 — 시간은 «작을수록 좋다» */
              st.rec.libRuns ? `도서관 ${st.rec.libEscaped ? `탈출 ${((st.rec.libBestMs || 0) / 1000).toFixed(1)}초` : `${st.rec.libRuns}판`}${st.rec.libNoHit ? " · 무피격" : ""}${st.rec.libSecret ? " · 비밀 서고" : ""}` : null,
            ].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
      <p className={s.idBackFine}>본 증은 효산고 온라인 팝업의 생존 기록부입니다. 습득 시 옥상의 모닥불 앞으로.</p>
      <div className={s.idBackCode} aria-hidden="true"><em>{rsvNo || "HYOSAN-1.5"}</em></div>
    </div>
  );
}

/* ── 무대 모달(v4.1 · PM 「전체적으로 모달을 적극 활용하는 구조」) — 무대(허브)는 살아 있는 배경으로 남고
   상세·거래 화면은 그 위에 뜬다. HUD 는 모달 *아래*에 계속 산다(정보는 HUD · 모달은 그 정보의 행동 화면) —
   그래서 모달은 HUD 밴드 위에서 끝난다(bottom = --hud). 닫기 = Esc · 배경 클릭 · 안의 ← 버튼.
   패널 모달(학생증·주문 등 대화상자, .overlay z70)과 구분되는 화면형 모달이다. ── */
const COMMERCE_ZONES = ["store", "kuji", "raffle", "preorder", "fcfs", "reserve"];
/* ── 주문 확정(v4.0) — 무대 오버레이. 결제·배송은 개발 트랙 자리(placeholder) — 여기서는 주문 기록과 누적 반영만 ── */
function CheckoutOverlay({ st, update, onClose }) {
  const rows = cartRows(st);
  const total = cartTotal(st);
  const [done, setDone] = useState(false);
  const confirm = () => {
    update((p) => {
      const items = cartRows(p).map(({ id, option, qty, key }) => ({ id, option, qty, key }));
      const sum = items.reduce((acc, c) => acc + ((mdById(c.id) || { price: 0 }).price * c.qty), 0);
      return { ...p, orders: [...(p.orders || []), { id: `od-${Date.now()}`, at: new Date().toISOString(), items, total: sum }],
        spent: (p.spent || 0) + sum, cart: [] };
    });
    setDone(true);
  };
  return (
    <PresentationDialog className={s.overlay} label="주문 시연" onClose={onClose}>
      <div className={`${s.overlayBox} ${s.coBox}`}>
        <b>{done ? "주문 체험 완료" : "주문 미리보기"}</b>
        {done ? (
          <p className={s.coDone}>주문 체험을 마쳤습니다. 이 기기의 시연 기록에만 저장되며 실제 결제는 발생하지 않습니다.</p>
        ) : (
          <>
            <ul className={s.coList}>
              {rows.map((c) => (
                <li key={c.key}>
                  <i style={{ backgroundImage: `url(${ASSET(c.md.src)})` }} />
                  <span>{c.md.name}{c.option && <small className={s.coOption}>{c.option}</small>}</span>
                  <em>{won(c.md.price)} × {c.qty}</em>
                </li>
              ))}
            </ul>
            <div className={s.coTotal}><span>합계</span><b>{won(total)}</b></div>
            <p className={s.coNote}>프레젠테이션용 주문 체험입니다. 실제 결제나 배송은 진행되지 않습니다.</p>
          </>
        )}
        <div className={s.idDetailActs}>
          {!done && rows.length > 0 && <button type="button" className={s.primaryBtn} onClick={confirm}>주문 체험 완료하기</button>}
          <button type="button" className={s.ghostBtn} onClick={onClose}>{done ? "닫기" : "취소"}</button>
        </div>
      </div>
    </PresentationDialog>
  );
}

/* ── 팝업 소개 모달(v4.4) — 오프라인 팝업 소개글 문법: 제목·부제·소개·기간·구성. 사실만(소비자 카피) ── */
function IntroOverlay({ onClose }) {
  return (
    <PresentationDialog className={s.overlay} label="팝업 소개" onClose={onClose}>
      <div className={`${s.overlayBox} ${s.coBox}`}>
        <b>{THEME.title}</b>
        <p className={s.infoLead}>SURVIVE THE NIGHT<br /><span>살아 있다면, 옥상으로.</span></p>
        <p className={s.coNote}>ICONS 프레젠테이션 · 굿즈 이미지와 가격, 일정은 제안 시안입니다. 주문·결제·리워드·현장 예약은 실제로 진행되지 않습니다.</p>
        <p className={s.infoBody}>「지금 우리 학교는」 시즌 1.5 온라인 팝업. 효산고를 무대로 굿즈·체험·한정판·커뮤니티가 한 캠퍼스에 모입니다. 체험존에서는 명장면을 게임으로 즐기고, 옥상은 결말이자 시즌 2로 가는 문입니다.</p>
        <dl className={s.infoList}>
          <dt>기간</dt><dd>{POPUP_PERIOD.label}</dd>
          <dt>구성</dt><dd>{SECTIONS.slice(1).join(" · ")}</dd>
          <dt>오프라인</dt><dd>{OFFLINE.introTitle || "오프라인 팝업"} — 존에서 일정·입장 안내</dd>
        </dl>
        <div className={s.idDetailActs}><button type="button" className={s.ghostBtn} onClick={onClose}>닫기</button></div>
      </div>
    </PresentationDialog>
  );
}

/* ── 당첨 상품 배송 신청(v4.2) — 패널 모달. 결제 없음(0원 주문으로 주문 내역에 기록) · 배송 정보 입력은 개발 트랙 자리 ── */
function WinClaimOverlay({ st, idx, update, onClose }) {
  const w = (st.wins || [])[idx];
  const it = w ? winItem(w) : null;
  const [done, setDone] = useState(false);
  if (!w) return null;
  return (
    <PresentationDialog className={s.overlay} label="배송 신청 시연" onClose={onClose}>
      <div className={`${s.overlayBox} ${s.coBox}`}>
        <b>{done ? "배송 신청 완료" : "당첨 상품 배송 신청"}</b>
        <ul className={s.coList}>
          <li>
            <i style={it ? { backgroundImage: `url(${ASSET(it.src)})` } : undefined} />
            <span>{it ? it.name : `${w.grade}상`}</span>
            <em>{w.grade}상 · 0원</em>
          </li>
        </ul>
        {done
          ? <p className={s.coDone}>배송 신청 체험을 마쳤습니다. 실제 배송 요청은 전송되지 않았습니다.</p>
          : <p className={s.coNote}>시연 보관함에서 배송 신청 흐름을 확인합니다. 실제 배송은 진행되지 않습니다.</p>}
        <div className={s.idDetailActs}>
          {!done && !w.claimedAt && <button type="button" className={s.primaryBtn} onClick={() => { claimWin(update, idx); setDone(true); }}>배송 신청</button>}
          <button type="button" className={s.ghostBtn} onClick={onClose}>{done ? "닫기" : "취소"}</button>
        </div>
      </div>
    </PresentationDialog>
  );
}

function MePanel({ st, update, tabs, tab, onTab, onClose }) {
  /* 「나」 패널 = 게임 메뉴 모달(v6.0). 학생증 탭은 옛 학생증 상세(앞뒤 한 장 · PM 2026-09-04 뒤집기)를 그대로 품고,
     퀘스트·보유·장바구니 탭은 HUD 의 본문 렌더러(HudBody)를 그대로 쓴다 — 컨텍스트 열에서 보이던 것과 같은 행·문·세그 */
  const [flipped, setFlipped] = useState(false);
  const flip = () => setFlipped((v) => !v);
  const [segSel, setSegSel] = useState({});
  const cur = tabs.find((t) => t.key === tab);
  const seg = cur && cur.segments ? (cur.segments.find((g) => g.key === segSel[cur.key]) || cur.segments[0]) : null;
  return (
    <PresentationDialog className={s.overlay} label="나 — 학생증·퀘스트·보유·장바구니" onClose={onClose}>
      <div className={`${s.overlayBox} ${s.meBox}`} data-tab={tab} onClick={(e) => e.stopPropagation()}>
        <div className={s.meTabs} role="tablist" aria-label="나 패널">
          <button type="button" role="tab" aria-selected={tab === "id"} className={tab === "id" ? s.meTabOn : undefined} onClick={() => onTab("id")}>학생증</button>
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? s.meTabOn : undefined} onClick={() => onTab(t.key)}>{t.label}</button>
          ))}
          <button type="button" className={s.meClose} onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {tab === "id" ? (
        <div className={s.idDetailBody}>
          <div className={s.idDetailCardCol}>
            <button type="button" className={`${s.idFlip} ${flipped ? s.idFlipped : ""}`}
              onClick={flip} aria-pressed={flipped}
              aria-label={flipped ? "학생증 앞면 보기" : "학생증 뒷면 보기"}>
              <span className={s.idFlipInner}>
                <span className={s.idFace}>
                  <StudentIdCard name={st.callsign} photo={st.photo} className={s.cardReveal} />
                </span>
                <span className={`${s.idFace} ${s.idFaceBack}`}>
                  <IdCardBack st={st} />
                </span>
              </span>
            </button>
            <span className={s.idFlipHint} aria-hidden="true">눌러서 {flipped ? "앞면" : "뒷면"} 보기</span>
          </div>
          <div className={s.idDetailInfo}>
            <b className={s.idDetailPickTitle}>증명사진 변경</b>
            <PhotoPicker photo={st.photo} onPick={(p) => update({ photo: p })} />
          </div>
        </div>
        ) : cur ? (
        <div className={s.meBody}>
          <HudBody cur={cur} seg={seg} onSeg={(k) => setSegSel((v) => ({ ...v, [cur.key]: k }))} bodyKey={`${cur.key}:${seg ? seg.key : ""}`} flashId={null} />
        </div>
        ) : null}
      </div>
    </PresentationDialog>
  );
}

/* ── 커뮤니티 글 남기기(PM 2026-08-31): 작성 → 커뮤니티 피드 맨 앞에 반영(wallFeedOf). 목업 — 서버 없음 ── */
function ComposeOverlay({ update, onClose }) {
  const [text, setText] = useState("");
  const post = () => {
    if (!text.trim()) return;
    update((p) => ({ ...p, posts: [{ id: `me-${(p.posts || []).length + 1}`, text: text.trim() }, ...(p.posts || [])] }));
    onClose();
  };
  return (
    <PresentationDialog className={s.overlay} label="커뮤니티 글 남기기" onClose={onClose}>
      <div className={`${s.overlayBox} ${s.cmpBox}`}>
        <b>나의 생존 기록</b><p className={s.coNote}>이 기기에만 남는 시연 기록입니다.</p>
        <textarea
          className={s.cmpInput} value={text} maxLength={140} rows={4} autoFocus
          placeholder="지금의 기록을 남기세요"
          onChange={(e) => setText(e.target.value)}
        />
        <div className={s.cmpFoot}>
          <span className={s.cmpTag}>#{WALL_TAG.replace(/^#/, "")}</span>
          <span className={s.cmpCount}>{text.length}/140</span>
          <button type="button" className={s.ghostBtn} onClick={onClose}>닫기</button>
          <button type="button" className={s.primaryBtn} disabled={!text.trim()} onClick={post}>남기기</button>
        </div>
      </div>
    </PresentationDialog>
  );
}



/* ── 루트 ── */
export default function AouadSample() {
  const [st, update, ready] = usePresentationState();
  const [view, setView] = useState("boot"); // boot|opening|hub|<zoneId>
  const [overlay, setOverlay] = useState(null); // local presentation dialogs
  const [meOpen, setMeOpen] = useState(false);
  const [resetNonce, setResetNonce] = useState(0); // 리셋 시 Opening 강제 리마운트
  const reduced = usePrefersReducedMotion();

  /* URL 계약(설계서 §6-5 · PM 2026-09-09) — 존·레인·상품·장면을 쿼리로 비춘다. 진입 URL 은 목적지가 된다.
     첫 방문은 오프닝을 반드시 거친 뒤(PM 2026-08-21 「건너뛰기는 없다」) 목적지로 간다. */
  const deepRef = useRef(null);       // 진입 쿼리 → 목적지(한 번만 읽는다)
  const popRef = useRef(false);       // popstate·진입으로 온 변경은 이력에 새 칸을 만들지 않는다
  const lastKeyRef = useRef(null);


  // res: {name, photo}=자기소개 후 등교(name null=무명) · undefined=재방문 응답(이미 이름 확인됨). 건너뛰기는 없다(PM 2026-08-21) — 첫 방문은 반드시 대화를 거친다
  const [product, setProduct] = useState(null); // {id, from} — 상품 상세
  // 장 점프 — HUD 이동 격자와 안내도 부스가 같은 관을 쓴다
  const goSection = (i) => {
    setMeOpen(false);
    const smooth = view === "hub" && !product;
    setSection(i); setScene(FIRST_SCENE_OF[i]);
    closeProduct(); setView("hub"); setPendingSection({ s: FIRST_SCENE_OF[i], smooth });
  };
  const openProduct = useCallback((id, from) => { setMeOpen(false); setProduct({ id, from }); if (typeof window !== "undefined") window.scrollTo(0, 0); }, []);
  const closeProduct = useCallback(() => setProduct(null), []);
  const [flipFrom, setFlipFrom] = useState(null); // 오프닝 학생증 → 벤토 모듈 안착 연출의 출발 좌표
  const onFlipDone = useCallback(() => setFlipFrom(null), [setFlipFrom]);
  // HUD 이동은 허브 밖(존·상세)에서도 눌린다 — 허브로 돌린 뒤 그 섹션으로 보낸다(2단계)
  const [section, setSection] = useState(0);
  /* 교문 자에서 고른 일정 — 무대(표시 강조·한 줄)와 HUD 컨텍스트 패널(소개·바로가기)이 같은 값을 본다.
     PM 2026-09-07 「버튼을 클릭하면 컨텍스트 패널에서 해당 기간에 대한 소개와 바로가기 버튼이 나오면 돼」 */
  const [tlPick, setTlPick] = useState(null);
  /* 도서관 — 게임 위 버튼이 고른 컨텍스트 칩(폰) · 게임이 올려 주는 미션 진행(PM 2026-09-09) */
  /* 존 밴드(v6.0 PR ② · PM 「체험존도 섹션이 3개 · 각 섹션마다 다른 내용」) — 존 페이지 스크롤러가 화면 절반을 넘긴 밴드(hero·play·shelf)를
     HUD 에 알린다. 문(「체험 시작」)으로 들어갈 때는 그 밴드로 **먼저 고정**하고 스크롤이 도착할 때까지 감지를 쉰다(경유 밴드로 안 흔들린다) */
  const zoneViewRef = useRef(null);
  const [zoneBand, setZoneBand] = useState("hero");
  const bandLock = useRef(null);   // { band, until }
  const [bandView, setBandView] = useState(view);
  if (bandView !== view) { setBandView(view); setZoneBand("hero"); }
  useEffect(() => { bandLock.current = null; }, [view]);
  useEffect(() => {
    const el = zoneViewRef.current;
    if (!el) return undefined;
    const bandOf = (sec) => (sec.hasAttribute("data-hero") ? "hero" : sec.classList.contains(s.zgWrap) ? "shelf" : "play");
    const sync = () => {
      const lock = bandLock.current;
      if (lock && Date.now() < lock.until) return;
      const secs = [...el.children].filter((c) => c.tagName === "SECTION" || c.tagName === "HEADER");
      const mid = el.scrollTop + el.clientHeight * 0.5;
      let cur = secs[0];
      secs.forEach((sec) => { if (sec.offsetTop <= mid) cur = sec; });
      if (cur) setZoneBand(bandOf(cur));
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    return () => el.removeEventListener("scroll", sync);
  }, [view]);
  const goBand = useCallback((band) => {
    const el = zoneViewRef.current;
    if (!el) return;
    const secs = [...el.children].filter((c) => c.tagName === "SECTION");
    const target = secs.find((sec) => (band === "hero" ? sec.hasAttribute("data-hero") : band === "shelf" ? sec.classList.contains(s.zgWrap) : !sec.hasAttribute("data-hero") && !sec.classList.contains(s.zgWrap)));
    if (!target) return;
    bandLock.current = { band, until: Date.now() + 1200 };
    setZoneBand(band);
    el.scrollTo({ top: target.offsetTop, behavior: reduced ? "instant" : "smooth" });
  }, [setZoneBand, reduced]);
  const [libPane, setLibPane] = useState(null);       // { kind: guide|reward|missions, n } — n 은 같은 칩을 다시 눌러도 열리게
  const [libLive, setLibLive] = useState({});
  const openLibPane = useCallback((kind) => setLibPane((p) => ({ kind, n: (p ? p.n : 0) + 1 })), []);
  const [scene, setScene] = useState(0);
  /* 교문을 떠나면 고른 일정을 놓는다 — 다른 화면에 남의 기간 소개가 서 있으면 안 된다 */

  /* 공식 소식 화면에 서면 읽음으로 친다 — 알림은 「새 것」에만 뜬다(v5.7) */
  useEffect(() => {
    if ((SCENES[scene] || {}).k !== "notice") return;
    if (NOTICES.some((x) => !(st.readNews || []).includes(x.id))) {
      update((p) => ({ ...p, readNews: NOTICES.map((x) => x.id) }));
    }
  }, [scene, st.readNews, update]);
  // 오프닝 학생증이 날아와 안착하는 목적지 — 이제 HUD 좌열의 실물 카드다
  const flyRef = useRef(null);
  const [pendingSection, setPendingSection] = useState(null);
  const onPendingDone = useCallback(() => setPendingSection(null), []);
  // 화면 단위 직행 — HUD 2차 이동과 도착 화면 라이브 스트립이 같은 관을 쓴다.
  // 점프 즉시 setScene — 스크롤 이벤트를 기다리면 컨텍스트가 이전 화면에 머문다(#498).
  /* 존·상품 상세가 페이지가 되면서 허브는 언마운트된다 — 돌아올 때 보던 자리를 되돌려 준다(v5.6).
     이전에는 커머스 존이 모달이라 허브가 배경에 살아 있었고, 게임 존은 돌아오면 맨 위로 튀었다. */
  /* 굿즈샵을 어떤 레인으로 열지 — 문이 지정하면 그 레인으로 열고, 굿즈샵을 떠나면 지운다(v5.7) */
  const [storeLane, setStoreLane] = useState(null);
  const [dealProductId, setDealProductId] = useState(null);
  const goZone = useCallback((v, opts) => { setMeOpen(false); setZoneBand("hero"); setStoreLane(opts && opts.lane ? opts.lane : null); setDealProductId(opts?.productId || null); setView(v); }, [setZoneBand]);

  const goFromHud = useCallback((v, opts) => { setProduct(null); goZone(v, opts); }, [goZone]);   // HUD 의 문은 상품 상세를 닫고 간다(v6.0 PR ③)
  const backToHub = useCallback(() => {
    setView("hub");
    setPendingSection({ s: scene, smooth: false });
  }, [scene]);
  const jumpScene = useCallback((si) => {
    setMeOpen(false);
    const smooth = view === "hub" && !product;
    setSection(SCENES[si].ch); setScene(si);
    closeProduct(); setView("hub"); setPendingSection({ s: si, smooth });
  }, [view, product, closeProduct]);
  /* 쿼리 → 상태. 존이 없으면 허브(장면 지정 시 그 장면으로), 상품은 어디서 열렸는지(굿즈샵/허브)를 함께 적는다 */
  const applyUrl = useCallback((q) => {
    popRef.current = true;
    const zone = q && q.zone ? q.zone : null;
    setStoreLane(zone === "store" && q.lane ? q.lane : null);
    setView(zone || "hub");
    setProduct(q && q.product ? { id: q.product, from: zone === "store" ? "store" : "hub" } : null);
    if (!zone && q && q.scene) {
      const si = SCENES.findIndex((x) => x.k === q.scene);
      if (si >= 0) { setSection(SCENES[si].ch); setScene(si); setPendingSection({ s: si, smooth: false }); }
    }
  }, []);
  /* Hydrate once from browser URL and the external presentation store. */
  useEffect(() => {
    if (!ready || view !== "boot") return;
    if (deepRef.current === null) deepRef.current = typeof window === "undefined" ? {} : parsePopupQuery(window.location.search, URL_DICT);
    // 오프닝은 첫 방문만(PM 2026-08-28) — 본 사람(st.op)은 곧장 목적지(없으면 허브). 다시 보려면 「첫 방문 상태로」.
    if (st.op) applyUrl(deepRef.current); else setView("opening");
  }, [ready, view, st.op, applyUrl]);
  /* 상태 → 쿼리. 존·상품이 바뀌면 이력에 새 칸(뒤로가기가 한 화면씩 되돌린다), 허브 안 장면 이동은 같은 칸을 고쳐 쓴다(스크롤마다 칸을 만들면 뒤로가기가 막힌다) */
  useEffect(() => {
    if (typeof window === "undefined" || view === "boot" || view === "opening") return;
    const url = window.location.pathname + buildPopupQuery({ view, lane: storeLane, product: product && product.id, scene: (SCENES[scene] || {}).k });
    const key = historyKey({ view, product: product && product.id });
    const push = !popRef.current && lastKeyRef.current !== null && key !== lastKeyRef.current;
    popRef.current = false; lastKeyRef.current = key;
    if (url === window.location.pathname + window.location.search) return;
    try { window.history[push ? "pushState" : "replaceState"](window.history.state, "", url); } catch {}
  }, [view, storeLane, product, scene]);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPop = () => { if (view !== "boot" && view !== "opening") applyUrl(parsePopupQuery(window.location.search, URL_DICT)); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [view, applyUrl]);
  const finishOpening = useCallback((res) => {
    update((p) => (res === undefined ? { ...p, op: true } : { ...p, op: true, temp: true, callsign: res.name || null, photo: res.photo || null }));
    setFlipFrom(res && res.fromRect ? res.fromRect : null);
    // 오프닝을 마치면 진입 URL 의 목적지로 — 링크로 온 첫 방문자도 대화는 거치고 자기 자리로 간다
    const q = deepRef.current; deepRef.current = {};
    if (q && (q.zone || q.product || q.scene)) applyUrl(q); else setView("hub");
  }, [update, applyUrl, setFlipFrom]);
  // 시연 편의: 진행 상태(localStorage)를 지우고 첫 방문 = 오프닝부터 다시 재생.
  // resetNonce는 Opening의 key로 쓰여, 오프닝 도중 눌러도 컴포넌트가 리마운트되어 처음부터 재생된다.
  const resetDemo = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm("처음부터 다시 시작할까요?")) return;
    resetGameLocks();
    setMeOpen(false);
    setProduct(null);
    setStoreLane(null);
    setSection(0); setScene(0); setPendingSection(null); setZoneBand("hero");
    deepRef.current = {}; lastKeyRef.current = null; popRef.current = false;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    update(() => ({ ...EMPTY, clockStartedAt: Date.now() }));
    setOverlay(null);
    setFlipFrom(null);
    setResetNonce((n) => n + 1);
    setView("opening");
  }, [update]);

  if (!ready || view === "boot") return <div className={s.stage}><div className={s.bootScreen} role="status"><span>HYOSAN HIGH</span><p>학교의 기록을 불러오고 있습니다.</p></div></div>;

  const zone = ZONES.find((z) => z.id === view);
  const gamePaused = !!overlay || meOpen || zoneBand !== "play";
  // 상품 상세는 어디서 들어왔는지 기억한다 — 굿즈샵에서 왔으면 굿즈샵으로, 허브에서 왔으면 허브로 돌아간다
  const backLabel = product && product.from === "store" ? "굿즈샵" : "학교 맵";
  return (
    <div className={s.stage} data-view={view} data-presentation="aouad">
      <div className={s.presentationUtility}><Link href="/ip" prefetch={false} aria-label="ICONS 온라인 팝업으로 돌아가기">ICONS<span> / </span>HYOSAN</Link><button type="button" onClick={() => { setMeOpen(false); setOverlay("intro"); }}>프레젠테이션</button></div>
      {view === "opening" && <Opening key={resetNonce} short={st.op} reduced={reduced} hasId={st.temp !== null} onDone={finishOpening} onReset={resetDemo} />}
      {view !== "opening" && (
        <>
          {/* v5.6 — 존과 상품 상세는 모달이 아니라 **상세페이지**다(PM 2026-09-07 「굿즈존·체험존이 다 모달인 게 불편하다」).
              허브를 덮지 않고 대체한다. 돌아올 때 보던 자리로 되돌리는 건 backToHub 가 맡는다 */}
          {view === "hub" && !product && <Hub st={st} update={update} go={setView} openProduct={openProduct} onCompose={() => setOverlay("compose")} onSection={setSection} onScene={setScene} onSceneJump={jumpScene} pendingSection={pendingSection} onPendingDone={onPendingDone} flipFrom={flipFrom} onFlipDone={onFlipDone} flyRef={flyRef} tlPick={tlPick} onTlPick={setTlPick} />}
          {flipFrom && <div className={s.veil} aria-hidden="true" />}
          {product && (
            <ProductDetail
              key={product.id} id={product.id} size={product.option || null} onOptionChange={(option) => setProduct((current) => ({ ...current, option }))} st={st} update={update} backLabel={backLabel}
              onBack={closeProduct}
              go={(v) => { const productId = product.id; closeProduct(); goZone(v, { productId }); }}
            />
          )}
          {zone && !product && (
            <div className={s.zoneView} ref={zoneViewRef} style={{ "--zone-img": `url(${ASSET(zone.img)})` }}>
              {/* 존 화면 = 화면 셋(히어로 · 체험 · 매대). **한 섹션이 한 화면을 다 쓴다** — 메인페이지와 같은 원칙(PM 2026-09-08 「모든 화면의 동일한 원칙」).
                  ① 히어로: 그 명장면(영상이 있으면 영상, 없으면 스틸 페이드) 위에 메인 표지와 같은 리드 — 영문 눈썹 1줄 + 이름 1줄(표지 3줄 규율 안).
                  역할 한 줄(`zone.role`)은 안 붙인다(PM 2026-09-07 「쓸데없는 이야기는 없애」). */}
              {view === "store" ? (
                /* 굿즈샵은 히어로 없음(PM 2026-09-08 「굿즈샵은 히어로 필요없어」) — 파는 곳은 진열이 얼굴이다.
                   돌아가는 문과 이름만 한 줄로 두고 바로 필터·진열이 시작된다. */
                <header className={s.zoneBar}>
                  <button type="button" className={s.backBtn} onClick={backToHub}>학교 맵</button>
                  <span className={s.leadEyebrow}>{zoneEyebrow(view, zone)}</span>
                  <h3 className={s.zoneBarTitle}>{zone.name}</h3>
                </header>
              ) : (
              <section className={`${s.zoneScreen} ${s.zoneHead}`} data-hero="1">
                <SceneHero id={view} fallback={zone.img} />
                <button type="button" className={s.backBtn} onClick={backToHub}>학교 맵</button>
                <div className={`${s.lead} ${s.zoneLead}`}>
                  <span className={s.leadEyebrow}>{zoneEyebrow(view, zone)}</span>
                  <h3 className={s.leadTitle}>{zone.name}</h3>
                  {/* 초대문(PM 2026-09-09) — 데이터에 hook 이 있는 존만. 규칙이 아니라 어트랙션 입구 안내 문체(장면 소개 → 행동 권유). 줄마다 한 블록 */}
                  {zone.hook && <p className={s.leadHook}>{zone.hook.map((t, i) => <span key={i}>{t}</span>)}</p>}
                  <div className={s.leadActs}><button type="button" className={s.primaryBtn} onClick={() => goBand("play")}>{PLAY_ZONES.includes(view) ? "체험 시작하기" : view === "rooftop" ? "옥상으로 올라가기" : "자세히 둘러보기"}</button></div>
                </div>
              </section>
              )}
              {/* ② 커머스 존 본문 = 한 화면(PM 2026-09-08 「다 밀어」 — 화면 원칙을 커머스 존까지). 상품이 먼저다 — 파는 곳이니 진열이 그 화면을 채운다.
                  굿즈샵 문은 또 세우지 않는다(`go` 미전달 — 이미 파는 곳). 굿즈샵 목록은 한 화면을 넘긴다(37종) — 「최소 한 화면」으로 읽고 넘치는 만큼 늘어난다. */}
              {/* 굿즈샵만 화면 원칙에서 뺀다(PM 2026-09-09 「굿즈샵만 제외야」) — 37종 목록은 흐르는 게 맞다. 스냅·최소 높이 없이 본문만 */}
              {COMMERCE_ZONES.includes(view) && (
                <section className={view === "store" ? s.zoneBody : `${s.zoneScreen} ${s.zoneBody}`}>
                  {ZONE_GOODS[view] && <ZoneGoodsStrip ids={ZONE_GOODS[view]} openProduct={openProduct} />}
                  {view === "store" && <Store st={st} update={update} openProduct={openProduct} go={setView} lane={storeLane} onLane={setStoreLane} />}
                  {view === "kuji" && <KujiZone openProduct={openProduct} />}
                  {view === "raffle" && <RaffleZone openProduct={openProduct} />}
                  {view === "preorder" && <PreorderZone initialProductId={dealProductId} st={st} update={update} openProduct={openProduct} />}
                  {view === "fcfs" && <FcfsZone st={st} openProduct={openProduct} />}
                  {view === "reserve" && <ReserveZone st={st} update={update} />}
                </section>
              )}
              {/* 순서 = 보는 것 → 하는 것 → 가져가는 것. 굿즈 스트립이 위에 있으면 상품 사진 3장이 첫 화면을 먹고
                  **게임이 화면 밖으로 밀린다**(실측 2026-09-07: 무대가 793px에서 시작, 모바일 965px). PM 판정 A. */}
              {view === "cafeteria" && <Cafeteria paused={gamePaused} st={st} update={update} go={setView} />}
              {view === "broadcast" && <Broadcast paused={gamePaused} st={st} update={update} go={setView} />}
              {view === "library" && <Library paused={gamePaused} st={st} update={update} go={setView} onPane={openLibPane} onMissions={setLibLive} />}
              {view === "rooftop" && (rooftopLocked(st)
                ? <RooftopLocked st={st} go={setView} />
                : <Rooftop st={st} update={update} go={setView} />)}
              {!COMMERCE_ZONES.includes(view) && ZONE_GOODS[view] && <ZoneGoodsStrip ids={ZONE_GOODS[view]} openProduct={openProduct} go={setView} />}
            </div>
          )}
        </>
      )}
      {overlay === "checkout" && <CheckoutOverlay st={st} update={update} onClose={() => setOverlay(null)} />}
      {overlay === "intro" && <IntroOverlay onClose={() => setOverlay(null)} />}
      {overlay && typeof overlay === "object" && overlay.win != null && <WinClaimOverlay st={st} idx={overlay.win} update={update} onClose={() => setOverlay(null)} />}
      {overlay === "compose" && <ComposeOverlay st={st} update={update} onClose={() => setOverlay(null)} />}
      {view !== "opening" && (
        <AouadHud
          meOpen={meOpen} onMeOpenChange={setMeOpen} productOption={product?.option || null}
          libPane={libPane} libLive={libLive}   /* 도서관 컨텍스트 칩·미션 진행(PM 2026-09-09) */
          band={zoneBand} onBand={goBand}          /* 존 밴드 추종(v6.0 PR ②) */
          storeLane={storeLane} onStoreLane={setStoreLane}   /* 굿즈샵 진열 레인(v6.0 PR ③) */
          st={st} section={view === "hub" && !product ? section : -1}
          modal={!!overlay}   /* 키 개입을 막는 것은 패널 모달뿐 — 존·상품 상세는 페이지다(v5.6) */
          zone={view !== "hub" && view !== "opening" && view !== "boot" ? view : null}
          scene={view === "hub" && !product ? scene : -1}
          onSection={goSection}
          onSceneJump={jumpScene}
          tlPick={tlPick}
          onReset={resetDemo} go={goFromHud} openProduct={openProduct}
          update={update} onCheckout={() => { setMeOpen(false); setOverlay("checkout"); }} onClaimWin={(i) => { setMeOpen(false); setOverlay({ win: i }); }} onOpenInfo={(k) => { setMeOpen(false); setOverlay(k); }} product={product ? product.id : null}
          flyRef={flyRef}
        />
      )}
    </div>
  );
}

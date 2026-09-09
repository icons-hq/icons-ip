/* 팝업 데모의 URL 상태 — 한 라우트(/sample/aouad) 위에 쿼리로 비춘다(지우학 설계서 §6-5 URL 계약 · PM 2026-09-09).
   실서비스는 라우트(/popup/aouad/[zone] …)로 쪼개지만 데모는 쿼리 하나로 같은 효과(공유 링크 · 뒤로가기 · 새로고침 복원)를 낸다.
   순수 함수만 — 화면은 이 결과를 상태에 붓고, 상태를 다시 이 문자열로 만든다. */

/** 쿼리 → 목적지. dict 에 없는 값은 버린다(잘못된 링크는 허브). */
export function parsePopupQuery(search, dict) {
  const q = new URLSearchParams(search || "");
  const pick = (key, list) => { const v = q.get(key); return v && list.includes(v) ? v : null; };
  const zone = pick("zone", dict.zones);
  return {
    zone,
    lane: zone === "store" ? pick("lane", dict.lanes) : null,   // 레인은 굿즈샵에서만 뜻이 있다
    product: pick("p", dict.products),
    scene: zone ? null : pick("s", dict.scenes),                 // 장면은 허브에서만
  };
}

/** 상태 → 쿼리 문자열("?…" 또는 ""). 허브 첫 화면(arrive)은 빈 URL — 공유 링크의 기본형. */
export function buildPopupQuery({ view, lane, product, scene }) {
  const q = new URLSearchParams();
  const inZone = view && view !== "hub";
  if (inZone) { q.set("zone", view); if (view === "store" && lane) q.set("lane", lane); }
  else if (scene && scene !== "arrive") q.set("s", scene);
  if (product) q.set("p", product);
  const str = q.toString();
  return str ? `?${str}` : "";
}

/** 이력에 새 칸을 만들지(push) 같은 칸을 고쳐 쓸지(replace) — 존·상품이 바뀌면 새 칸, 허브 안 장면 이동은 고쳐 쓰기. */
export function historyKey({ view, product }) {
  return `${view || "hub"}|${product || ""}`;
}

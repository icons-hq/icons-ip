import { MD, MD_DETAIL, PURCHASE_SPENT, RIGHTS } from "./aouad-data";

const GOODS = new Map(MD.map((item) => [item.id, item]));
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const nonnegativeMoney = (value) => Number.isSafeInteger(value) && value >= 0;

/** A line identifies the selected variant; a purchase cap still belongs to the product. */
export const cartKey = (id, option = null) => `${id}::${option === null ? "" : encodeURIComponent(option)}`;

export function cartLimit(id) {
  if (!GOODS.has(id)) return 0;
  const detail = MD_DETAIL[id] || {};
  if (positiveInteger(detail.per)) return detail.per;
  const stated = detail.limit?.match(/^1인 (\d+)개$/);
  return stated && positiveInteger(Number(stated[1])) ? Number(stated[1]) : 3;
}

function selectedOption(id, option) {
  if (!GOODS.has(id)) return undefined;
  const options = MD_DETAIL[id]?.options?.values;
  if (Array.isArray(options) && options.length) return options.includes(option) ? option : undefined;
  return option === null || option === undefined ? null : undefined;
}

function capacity(id) {
  const stock = MD_DETAIL[id]?.stock;
  return typeof stock === "number" && Number.isFinite(stock)
    ? Math.max(0, Math.min(cartLimit(id), Math.floor(stock)))
    : cartLimit(id);
}

/** Reject stale options and merge duplicate lines without exceeding a product's total cap. */
export function normalizeCart(value) {
  const rows = [];
  const indexes = new Map();
  const totals = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || !GOODS.has(item.id) || !positiveInteger(item.qty)) continue;
    const option = selectedOption(item.id, item.option);
    if (option === undefined) continue;
    const available = capacity(item.id) - (totals.get(item.id) || 0);
    const qty = Math.min(item.qty, available);
    if (qty <= 0) continue;
    const key = cartKey(item.id, option);
    const index = indexes.get(key);
    if (index === undefined) {
      indexes.set(key, rows.length);
      rows.push({ id: item.id, option, qty, key });
    } else rows[index] = { ...rows[index], qty: rows[index].qty + qty };
    totals.set(item.id, (totals.get(item.id) || 0) + qty);
  }
  return rows;
}

export const cartRows = (state) => normalizeCart(state?.cart).map((row) => ({ ...row, md: GOODS.get(row.id) }));
export const cartTotal = (state) => cartRows(state).reduce((sum, row) => sum + row.md.price * row.qty, 0);
export const spentOf = (state) => {
  const sum = PURCHASE_SPENT + (nonnegativeMoney(state?.spent) ? state.spent : 0);
  return Number.isSafeInteger(sum) ? sum : PURCHASE_SPENT;
};

export function addToCart(update, id, option = null) {
  return update((previous) => {
    const item = GOODS.get(id);
    const choice = item && selectedOption(id, option);
    if (!item || choice === undefined || (!item.lanes.includes("shop") && !item.right)) return previous;
    const cart = normalizeCart(previous?.cart);
    const used = cart.filter((row) => row.id === id).reduce((sum, row) => sum + row.qty, 0);
    if (used >= capacity(id)) return previous;
    const key = cartKey(id, choice);
    const existing = cart.find((row) => row.key === key);
    return { ...previous, cart: existing
      ? cart.map((row) => row.key === key ? { ...row, qty: row.qty + 1 } : row)
      : [...cart, { id, option: choice, qty: 1, key }] };
  });
}

export function setCartQty(update, id, qty, option = null) {
  return update((previous) => {
    const choice = selectedOption(id, option);
    if (!GOODS.has(id) || choice === undefined || !Number.isSafeInteger(qty)) return previous;
    const cart = normalizeCart(previous?.cart);
    const key = cartKey(id, choice);
    const current = cart.find((row) => row.key === key);
    if (!current) return previous;
    if (qty <= 0) return { ...previous, cart: cart.filter((row) => row.key !== key) };
    const other = cart.filter((row) => row.id === id && row.key !== key).reduce((sum, row) => sum + row.qty, 0);
    const next = Math.min(qty, capacity(id) - other);
    if (next === current.qty) return previous;
    return { ...previous, cart: cart.map((row) => row.key === key ? { ...row, qty: next } : row) };
  });
}

const status = (label, tone, line, action, text, target) => ({
  label, tone, line, action, text, ...(target ? { target } : {}),
});

/** Presentation routing only. Rewards, payment and inventory are never settled by this helper. */
export function getProductPresentationStatus(item, detail, rights = {}, cart = []) {
  if (!item || !GOODS.has(item.id)) return status("확인 불가", "locked", null, "notify", "굿즈샵 보기", "store");
  const d = detail || MD_DETAIL[item.id] || {};
  if (typeof d.stock === "number" && d.stock <= 0) return d.supply === "재입고 가능"
    ? status("품절", "soldout", null, "notify", "재입고 소식")
    : status("품절", "soldout", null, "stock", "품절");
  const gated = Boolean(item.right);
  const unlocked = gated && rights?.[item.right] === true;
  if (gated && !unlocked) {
    const right = RIGHTS.find((entry) => entry.id === item.right);
    return status("구매권 필요", "locked", right?.goal || "구매권 준비 중", right ? "challenge" : "notify",
      right ? "도전하러 가기" : "준비 중", right?.game);
  }
  if (item.lanes.includes("shop") || unlocked) {
    const count = normalizeCart(cart).filter((row) => row.id === item.id).reduce((sum, row) => sum + row.qty, 0);
    const limit = capacity(item.id);
    return status(gated ? "구매권 보유" : "판매 중", "on", null, count >= limit ? "full" : "add",
      count >= limit ? `한도 ${limit}개 · 장바구니에 있음` : count ? `담기 · 장바구니 ${count}` : "담기");
  }
  if (item.lanes.includes("pre")) return status("사전예약", "on", null, "preorder", "사전예약 보기", "preorder");
  if (item.lanes.includes("fcfs")) return status("선착순", "on", null, "fcfs", "선착순 매대 보기", "fcfs");
  if (item.lanes.includes("raffle")) return status("래플", "on", null, "raffle", "래플 보기", "raffle");
  if (item.lanes.includes("kuji")) return status("럭키드로우", "on", null, "stock", "럭키드로우 보기", "kuji");
  return status("판매 준비 중", "locked", null, "notify", "소식 기다리기");
}

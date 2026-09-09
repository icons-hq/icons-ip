import { FCFS, MD, MD_DETAIL, PREORDER, RAFFLES, RIGHTS } from "./aouad-data";
import { cartKey, cartLimit } from "./presentation-commerce";

const GOODS = new Map(MD.map((item) => [item.id, item]));
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const safeText = (value, max = 128) => typeof value === "string" ? value.trim().slice(0, max) : "";

export function presentationDeal(request) {
  if (!request || typeof request !== "object") return null;
  if (request.kind === "raffle") {
    const entry = RAFFLES.find((item) => item.id === request.referenceId);
    return entry ? { kind: "raffle", referenceId: entry.id, product: GOODS.get(entry.mdId), title: "래플 응모", edition: entry.edition, limit: 1 } : null;
  }
  const product = GOODS.get(request.productId);
  if (!product) return null;
  if (request.kind === "preorder" && product.lanes.includes("pre")) return {
    kind: "preorder", referenceId: `pre-${product.id}`, product, title: "사전예약", limit: cartLimit(product.id),
    edition: product.id === PREORDER.mdId ? PREORDER.perk : "한정 굿즈 사전예약",
  };
  if (request.kind === "fcfs") {
    const entry = FCFS.find((item) => item.mdId === product.id);
    return entry ? { kind: "fcfs", referenceId: `fcfs-${product.id}`, product, title: "선착순 주문", edition: `이 매대 1인 ${entry.per}개`, limit: entry.per, stock: entry.stock, state: entry.state } : null;
  }
  return null;
}

export function normalizeDealRecords(value) {
  const seen = new Set();
  const totals = new Map();
  return (Array.isArray(value) ? value : []).slice(-200).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const deal = presentationDeal(entry), id = safeText(entry.id), at = safeText(entry.at, 40);
    if (!deal || !id || seen.has(id) || !Number.isFinite(Date.parse(at)) || !integer(entry.qty) || entry.qty < 1 || entry.qty > deal.limit) return [];
    const values = MD_DETAIL[deal.product.id]?.options?.values;
    const option = deal.kind === "raffle" ? null : values?.length ? values.includes(entry.option) ? entry.option : undefined : null;
    if (option === undefined) return [];
    const key = `${deal.kind}:${deal.referenceId}`;
    const used = totals.get(key) || 0;
    if (used + entry.qty > deal.limit) return [];
    totals.set(key, used + entry.qty);
    seen.add(id);
    return [{ id, kind: deal.kind, referenceId: deal.referenceId, productId: deal.product.id, option, qty: deal.kind === "raffle" ? 1 : entry.qty,
      total: deal.kind === "raffle" ? 0 : deal.product.price * entry.qty, at }];
  });
}

export function presentationDealProgress(state, request) {
  const deal = presentationDeal(request);
  const records = deal ? normalizeDealRecords(state?.dealRecords).filter((entry) => entry.kind === deal.kind && entry.referenceId === deal.referenceId) : [];
  const count = records.reduce((sum, entry) => sum + entry.qty, 0);
  return { count, remaining: deal ? Math.max(0, Math.min(deal.limit - count, (deal.stock ?? deal.limit) - count)) : 0, last: records.at(-1) || null };
}

/** Shared display totals combine the demo baseline with this browser's valid receipts. */
export function presentationDealSummary(state, request) {
  const deal = presentationDeal(request);
  const progress = presentationDealProgress(state, request);
  if (!deal) return progress;
  const participated = progress.count > 0 ? 1 : 0;
  if (deal.kind === "raffle") return { ...progress, entrants: RAFFLES.find((entry) => entry.id === deal.referenceId).entrants + participated };
  if (deal.kind === "preorder") return { ...progress, reservations: (deal.product.id === PREORDER.mdId ? PREORDER.count : 0) + participated };
  return { ...progress, stock: Math.max(0, deal.stock - progress.count) };
}

export function presentationDealBlock(deal, rights = {}) {
  if (!deal) return "이 시연을 찾을 수 없습니다.";
  if (deal.kind === "fcfs" && deal.state !== "open") return "아직 열리지 않은 매대입니다.";
  if (deal.kind !== "raffle" && deal.product.right && rights[deal.product.right] !== true) {
    return RIGHTS.find((entry) => entry.id === deal.product.right)?.goal || "구매권이 필요한 굿즈입니다.";
  }
  if (deal.kind !== "raffle" && MD_DETAIL[deal.product.id]?.stock === 0) return "시연 재고가 소진되었습니다.";
  return null;
}

/** One local operation produces one receipt. No payment, reservation or message is sent. */
export function completePresentationDeal(state, request, selection, rights = {}) {
  const deal = presentationDeal(request);
  const blocked = presentationDealBlock(deal, rights);
  if (blocked) return { next: state, error: blocked, receipt: null };
  const records = normalizeDealRecords(state?.dealRecords);
  const id = safeText(selection?.operationId);
  const existing = records.find((entry) => entry.id === id);
  if (existing) return existing.kind === deal.kind && existing.referenceId === deal.referenceId
    ? { next: state, error: null, receipt: existing }
    : { next: state, error: "이미 사용한 시연 번호입니다.", receipt: null };
  const progress = presentationDealProgress(state, request);
  if (deal.kind === "raffle" && progress.last) return { next: state, error: null, receipt: progress.last };
  const qty = deal.kind === "raffle" ? 1 : selection?.qty;
  const values = MD_DETAIL[deal.product.id]?.options?.values;
  const option = deal.kind === "raffle" ? null : values?.length ? values.includes(selection?.option) ? selection.option : undefined : null;
  if (!id || (!integer(selection?.now) || selection.now > 8_640_000_000_000_000) || !integer(qty) || qty < 1 || qty > progress.remaining) return { next: state, error: "수량과 남은 참여 한도를 확인해 주세요.", receipt: null };
  if (option === undefined) return { next: state, error: "사이즈를 선택해 주세요.", receipt: null };
  const total = deal.kind === "raffle" ? 0 : deal.product.price * qty;
  const receipt = { id, kind: deal.kind, referenceId: deal.referenceId, productId: deal.product.id, option, qty, total, at: new Date(selection.now).toISOString() };
  const next = { ...state, dealRecords: [...records, receipt] };
  if (deal.kind === "fcfs") {
    next.orders = [...(Array.isArray(state.orders) ? state.orders : []), { id: `deal-${id}`, at: receipt.at, total,
      items: [{ id: deal.product.id, option, qty, key: cartKey(deal.product.id, option) }], note: "선착순 주문 체험" }];
    next.spent = (integer(state.spent) ? state.spent : 0) + total;
  }
  return { next, receipt, error: null };
}

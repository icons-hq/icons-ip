import { BOX_ITEMS, KUJI, MD } from "./aouad-data";
import { drawDayKey } from "../../lib/box/session";

const ROUNDS = new Map(KUJI.map((round) => [round.id, round]));
const GOODS = new Map(MD.map((item) => [item.id, item]));
const DAILY_LIMIT = 10;
const MAX_DRAW_RECORDS = KUJI.reduce((sum, round) => sum + round.total, 0);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const operationKey = (value) => typeof value === "string" && /^[a-z0-9:_-]{1,96}$/i.test(value) ? value : null;
const recordId = (roundId, operationId, cell) => `draw:${roundId}:${operationId}:${cell}`;
const timestamp = (value) => typeof value === "string" && value.length <= 40 && drawDayKey(Date.parse(value)) ? new Date(value).toISOString() : null;

/** An engine index identifies a SKU; grade alone cannot distinguish the three C prizes. */
export function presentationDrawPrize(roundId, prizeIndex) {
  const round = ROUNDS.get(roundId);
  if (!round || !integer(prizeIndex)) return null;
  // G2's engine places the whistle before the pouch, while its catalog reverses them.
  const catalogIndex = roundId === "k2" && (prizeIndex === 5 || prizeIndex === 6) ? 11 - prizeIndex : prizeIndex;
  const prize = round.prizes[catalogIndex];
  if (!prize || (!GOODS.has(prize.mdId) && !Object.hasOwn(BOX_ITEMS, prize.boxId ?? ""))) return null;
  return { ...(prize.mdId ? { mdId: prize.mdId } : { boxId: prize.boxId }), grade: prize.grade.replace(/상$/, "") };
}

/** A finite local lot has at most 320 receipts, independent of the locker display cap. */
export function normalizeDrawRecords(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(), cells = new Set(), daily = new Map(), operations = new Map();
  const records = [];
  for (const entry of value) {
    if (records.length >= MAX_DRAW_RECORDS) break;
    if (!entry || typeof entry !== "object") continue;
    const round = ROUNDS.get(entry.roundId), operationId = operationKey(entry.operationId), at = timestamp(entry.at);
    if (!round || !operationId || !at || !integer(entry.cell) || entry.cell < 1 || entry.cell > round.total
      || !presentationDrawPrize(round.id, entry.prizeIndex)) continue;
    const id = recordId(round.id, operationId, entry.cell), cellKey = `${round.id}:${entry.cell}`;
    const day = drawDayKey(Date.parse(at)), dayKey = `${round.id}:${day}`, used = daily.get(dayKey) || 0;
    const operation = operations.get(operationId), maxPick = round.id === "k1" ? 5 : 1;
    if (entry.id !== id || seen.has(id) || cells.has(cellKey) || used >= DAILY_LIMIT
      || (operation && (operation.roundId !== round.id || operation.at !== at || operation.count >= maxPick))) continue;
    seen.add(id); cells.add(cellKey); daily.set(dayKey, used + 1);
    operations.set(operationId, { roundId: round.id, at, count: (operation?.count || 0) + 1 });
    records.push({ id, operationId, roundId: round.id, cell: entry.cell, prizeIndex: entry.prizeIndex, at });
  }
  return records;
}

export function presentationDrawState(state, roundId, now = Date.now()) {
  const day = drawDayKey(now);
  const records = normalizeDrawRecords(state?.drawRecords).filter((entry) => entry.roundId === roundId);
  return { day, today: records.filter((entry) => drawDayKey(Date.parse(entry.at)) === day).length,
    taken: records.map((entry) => entry.cell - 1) };
}

/** Apply one local operation once. This creates demo receipts, never payment or fulfillment. */
export function recordPresentationDraw(state, commit) {
  const round = ROUNDS.get(commit?.roundId), operationId = operationKey(commit?.operationId);
  if (!round || !operationId || !drawDayKey(commit?.at) || !Array.isArray(commit.results)
    || !commit.results.length || commit.results.length > (round.id === "k1" ? 5 : 1)) return state;
  const records = normalizeDrawRecords(state?.drawRecords);
  // Retrying the same commit cannot add a second win or extend its original selection.
  if (records.some((entry) => entry.operationId === operationId)) return state;
  const at = new Date(commit.at).toISOString(), used = presentationDrawState({ drawRecords: records }, round.id, commit.at).today;
  if (used + commit.results.length > DAILY_LIMIT) return state;
  const occupied = new Set(records.filter((entry) => entry.roundId === round.id).map((entry) => entry.cell));
  const nextRecords = [], wins = [];
  for (const result of commit.results) {
    const prize = presentationDrawPrize(round.id, result?.prizeIndex);
    if (!prize || result.grade !== prize.grade || !integer(result.cell) || result.cell < 1 || result.cell > round.total
      || occupied.has(result.cell)) return state;
    occupied.add(result.cell);
    const id = recordId(round.id, operationId, result.cell);
    nextRecords.push({ id, operationId, roundId: round.id, cell: result.cell, prizeIndex: result.prizeIndex, at });
    wins.push({ ...prize, id, at, source: round.name });
  }
  return { ...state, drawRecords: [...records, ...nextRecords], wins: [...(Array.isArray(state?.wins) ? state.wins : []), ...wins] };
}

/** Call before beginning any reveal wait so navigation cannot lose a committed result. */
export function commitPresentationDraw({ roundId, draw, onDrawCommitted, now = Date.now, operationId }) {
  const out = draw();
  const results = Array.isArray(out) ? out : out ? [{ ...out, cell: out.cell + 1 }] : [];
  if (results.length) onDrawCommitted?.({ roundId,
    operationId: operationId ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    at: now(), results });
  return out;
}

/** Repeated clicks on the same locker entry produce just one simulated shipment order. */
export function claimPresentationWin(state, index, now = Date.now()) {
  if (!integer(index) || !drawDayKey(now) || !Array.isArray(state?.wins)) return state;
  const win = state.wins[index];
  if (!win || (typeof win.claimedAt === "number" && Number.isFinite(win.claimedAt) && win.claimedAt > 0)) return state;
  const item = GOODS.get(win.mdId) || (typeof win.boxId === "string" && Object.hasOwn(BOX_ITEMS, win.boxId) ? BOX_ITEMS[win.boxId] : null);
  if (!item) return state;
  const order = { id: `win-claim:${typeof win.id === "string" ? win.id : `${index}:${now}`}`,
    at: new Date(now).toISOString(), items: [{ id: win.mdId || win.boxId, qty: 1, win: true }], total: 0,
    note: `당첨 배송 체험 · ${item.name}` };
  return { ...state, wins: state.wins.map((entry, i) => i === index ? { ...entry, claimedAt: now } : entry),
    orders: [...(Array.isArray(state.orders) ? state.orders : []), order] };
}

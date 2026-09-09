import { useEffect, useSyncExternalStore } from "react";
import { BOX_ITEMS, MD, MD_DETAIL, NOTICES, OFFLINE, ZONES } from "./aouad-data";
import { normalizeCart, cartKey } from "./presentation-commerce";
import { normalizeDealRecords } from "./presentation-deals";

export const PRESENTATION_STORAGE_KEY = "icons:aouad-presentation:v1";
export const EMPTY_PRESENTATION_STATE = {
  op: false, temp: null, callsign: null, photo: null, clears: {}, quiz: null,
  wishes: [], rec: {}, reserve: null, posts: [], cart: [], orders: [], spent: 0,
  cafeRound: null, wins: [], tickets: {}, readNews: [], dealRecords: [], clockStartedAt: null,
};

const GOODS = new Set(MD.map((item) => item.id));
const NOTICE_IDS = new Set(NOTICES.map((item) => item.id));
const ZONE_IDS = new Set(ZONES.map((item) => item.id));
const GRADES = new Set(["A", "B", "C", "D", "E", "LAST"]);
const CLEAR_KEYS = new Set(["cafeteria", "broadcast", "library", "rooftop"]);
const BOOLEAN_RECORDS = new Set(["cafePass", "libEscaped", "libNoHit", "libSecret"]);
const NUMBER_RECORDS = new Set(["cafeTry", "cafeBest", "hoseTry", "hoseSaved", "libRuns", "libBookmarks", "libBestMs"]);
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => Array.isArray(value) ? value : [];
const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";

function normalizeRecords(value) {
  return Object.fromEntries(Object.entries(object(value)).filter(([key, entry]) =>
    BOOLEAN_RECORDS.has(key) ? typeof entry === "boolean" : NUMBER_RECORDS.has(key) && finite(entry) && (key === "libBestMs" || integer(entry))));
}

function normalizeReserve(value) {
  const input = object(value);
  const dayCount = Math.round((Date.parse(OFFLINE.closeAt) - Date.parse(OFFLINE.openAt)) / 86_400_000) + 1;
  // ReserveZone exposes 17 half-hour starts, 11:00 through 19:00.
  if (!integer(input.day) || input.day >= dayCount || !integer(input.slot) || input.slot >= 17) return null;
  const label = text(input.label, 80);
  return label ? { day: input.day, slot: input.slot, label } : null;
}

function normalizeOrderItem(value) {
  const input = object(value);
  const goods = GOODS.has(input.id);
  const prize = input.win === true && typeof input.id === "string" && Object.hasOwn(BOX_ITEMS, input.id);
  if ((!goods && !prize) || !integer(input.qty) || input.qty < 1 || input.qty > 99) return null;
  const options = goods ? MD_DETAIL[input.id]?.options?.values : null;
  const option = options?.length ? options.includes(input.option) ? input.option : input.win === true && input.option == null ? null : undefined : null;
  if (option === undefined) return null;
  return { id: input.id, option, qty: input.qty, key: cartKey(input.id, option), ...(input.win === true ? { win: true } : {}) };
}

function normalizeOrders(value) {
  return array(value).slice(-100).flatMap((entry) => {
    const input = object(entry);
    const id = text(input.id, 128);
    const at = text(input.at, 40);
    if (!id || !Number.isFinite(Date.parse(at)) || !integer(input.total)) return [];
    const items = array(input.items).slice(0, 200).map(normalizeOrderItem).filter(Boolean);
    if (!items.length) return [];
    const note = text(input.note, 140);
    return [{ id, at, items, total: input.total, ...(note ? { note } : {}) }];
  });
}

function normalizeWins(value) {
  return array(value).slice(-200).flatMap((entry) => {
    const input = object(entry);
    const item = GOODS.has(input.mdId) ? { mdId: input.mdId }
      : typeof input.boxId === "string" && Object.hasOwn(BOX_ITEMS, input.boxId) ? { boxId: input.boxId } : null;
    if (!item || !GRADES.has(input.grade)) return [];
    const source = text(input.source, 64) || "시연";
    return [{ ...item, grade: input.grade, source,
      ...(GRADES.has(input.fellFrom) ? { fellFrom: input.fellFrom } : {}),
      ...(finite(input.claimedAt) && input.claimedAt > 0 ? { claimedAt: input.claimedAt } : {}),
    }];
  });
}

/** Every field rendered by the demo is rebuilt from primitives; stored objects never reach JSX. */
export function normalizePresentationState(value) {
  const input = object(value);
  const photo = typeof input.photo === "string" && (
    ["onjo", "cheongsan", "namra", "suhyeok", "hari", "gwinam"].includes(input.photo) ||
    (input.photo.length < 750_000 && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(input.photo))
  ) ? input.photo : null;
  return {
    ...EMPTY_PRESENTATION_STATE,
    op: input.op === true,
    temp: input.temp === true ? true : null,
    callsign: text(input.callsign, 12) || null,
    photo,
    clears: Object.fromEntries(Object.entries(object(input.clears)).filter(([key, entry]) => CLEAR_KEYS.has(key) && entry === true)),
    wishes: [...new Set(array(input.wishes).filter((id) => GOODS.has(id)))],
    rec: normalizeRecords(input.rec),
    reserve: normalizeReserve(input.reserve),
    posts: array(input.posts).slice(0, 50).flatMap((entry) => {
      const post = object(entry), id = text(post.id, 128), body = text(post.text, 140);
      return id && body ? [{ id, text: body }] : [];
    }),
    cart: normalizeCart(input.cart),
    orders: normalizeOrders(input.orders),
    dealRecords: normalizeDealRecords(input.dealRecords),
    clockStartedAt: integer(input.clockStartedAt) && input.clockStartedAt > 0 && input.clockStartedAt <= 8_640_000_000_000_000 ? input.clockStartedAt : null,
    spent: integer(input.spent) ? input.spent : 0,
    wins: normalizeWins(input.wins),
    tickets: Object.fromEntries(Object.entries(object(input.tickets)).filter(([id, count]) => ZONE_IDS.has(id) && integer(count) && count <= 999)),
    readNews: [...new Set(array(input.readNews).filter((id) => NOTICE_IDS.has(id)))],
    // quiz and cafeRound belong to retired prototypes and have no current renderer.
  };
}

const browserStorage = () => globalThis.localStorage;
const browserEvents = () => typeof window === "undefined" ? null : window;
const serverSnapshot = () => EMPTY_PRESENTATION_STATE;

/** The factory exposes the storage failure boundary for tests and isolates every browser session. */
export function createPresentationStore(getStorage = browserStorage, getEvents = browserEvents, getNow = Date.now) {
  let cachedText;
  let cachedState = normalizePresentationState(null);
  let memoryOnly = false;
  let target = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  const getSnapshot = () => {
    if (memoryOnly) return cachedState;
    try {
      const storage = getStorage();
      if (!storage) return cachedState;
      const stored = storage.getItem(PRESENTATION_STORAGE_KEY);
      if (stored !== cachedText) {
        cachedText = stored;
        try { cachedState = normalizePresentationState(JSON.parse(stored || "{}")); }
        catch { cachedState = normalizePresentationState(null); }
      }
    } catch { memoryOnly = true; }
    return cachedState;
  };
  const onStorage = (event) => {
    if (event.key === PRESENTATION_STORAGE_KEY || event.key === null) { memoryOnly = false; emit(); }
  };
  const subscribe = (listener) => {
    if (!listeners.size) { target = getEvents(); target?.addEventListener("storage", onStorage); }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) { target?.removeEventListener("storage", onStorage); target = null; }
    };
  };
  const update = (patch) => {
    const previous = getSnapshot();
    cachedState = normalizePresentationState(typeof patch === "function" ? patch(previous) : { ...previous, ...object(patch) });
    cachedText = JSON.stringify(cachedState);
    try {
      const storage = getStorage();
      if (storage) { storage.setItem(PRESENTATION_STORAGE_KEY, cachedText); memoryOnly = false; }
      else memoryOnly = true;
    } catch { memoryOnly = true; }
    emit();
  };
  // Initialize once after hydration; revisiting a screen or refreshing preserves this timeline.
  const startClock = () => {
    if (getSnapshot().clockStartedAt === null) update({ clockStartedAt: getNow() });
  };
  return { getSnapshot, subscribe, update, startClock, getServerSnapshot: serverSnapshot };
}

const presentationStore = createPresentationStore();
const noSubscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function usePresentationState() {
  const state = useSyncExternalStore(presentationStore.subscribe, presentationStore.getSnapshot, serverSnapshot);
  const ready = useSyncExternalStore(noSubscribe, clientReady, serverReady);
  useEffect(() => {
    if (ready && state.clockStartedAt === null) presentationStore.startClock();
  }, [ready, state.clockStartedAt]);
  return [state, presentationStore.update, ready];
}

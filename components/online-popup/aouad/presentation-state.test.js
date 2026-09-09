import { describe, expect, it, vi } from "vitest";
import { MD_DETAIL, NOTICES, OFFLINE } from "./source/components/aouad/aouad-data";
import {
  createPresentationStore, EMPTY_PRESENTATION_STATE, normalizePresentationState, PRESENTATION_STORAGE_KEY,
} from "./source/components/aouad/presentation-state";

function storage(initial = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((key, next) => { value = next; }),
    replace: (next) => { value = next; },
  };
}

describe("presentation state normalization", () => {
  it.each([null, undefined, 7, "saved text", []])("recovers a malformed top-level value %s", (value) => {
    expect(normalizePresentationState(value)).toEqual(EMPTY_PRESENTATION_STATE);
  });

  it("preserves valid profile, game records, selected variants and completed purchases on reload", () => {
    const option = MD_DETAIL.hoodie_broadcast.options.values[0];
    const initial = {
      op: true, temp: true, callsign: "  생존자  ", photo: "onjo",
      rec: { cafeTry: 2, cafeBest: 3200, cafePass: true, hoseSaved: 6, hoseTry: 1, libBestMs: 12345.6, libEscaped: true, libBookmarks: 5 },
      clears: { cafeteria: true, broadcast: true, library: true, rooftop: true },
      wishes: ["ribbon_keyring"], cart: [{ id: "hoodie_broadcast", option, qty: 1 }],
      posts: [{ id: "me-1", text: "살아 있다면 옥상으로" }],
      reserve: { day: 0, slot: 0, label: "첫날 11:00" },
      orders: [{ id: "od-1", at: "2026-09-09T01:00:00.000Z", total: 12000, items: [{ id: "ribbon_keyring", qty: 1 }] }],
      spent: 12000, readNews: [NOTICES[0].id],
    };
    const disk = storage();
    const store = createPresentationStore(() => disk, () => null);
    store.update(initial);
    const current = store.getSnapshot();
    const reloaded = createPresentationStore(() => disk, () => null).getSnapshot();
    expect(reloaded).toEqual(current);
    expect(reloaded.callsign).toBe("생존자");
    expect(reloaded.cart[0]).toMatchObject({ id: "hoodie_broadcast", option, qty: 1 });
    expect(reloaded.rec.libBestMs).toBe(12345.6);
    expect(reloaded.orders[0].items[0]).toMatchObject({ id: "ribbon_keyring", qty: 1, option: null });
  });

  it("rejects nested values that would become invalid React children in the win modal", () => {
    const value = normalizePresentationState({ wins: [
      { mdId: "ribbon_keyring", grade: { x: 1 }, source: "locker" },
      { boxId: "unknown", grade: "A", source: "locker" },
      { mdId: "ribbon_keyring", grade: "A", source: { child: true }, claimedAt: { at: 1 }, fellFrom: ["B"] },
      { boxId: "lock_dial", grade: "C", source: "locker", claimedAt: 1788934534000, fellFrom: "A" },
    ] });
    expect(value.wins).toEqual([
      { mdId: "ribbon_keyring", grade: "A", source: "시연" },
      { boxId: "lock_dial", grade: "C", source: "locker", claimedAt: 1788934534000, fellFrom: "A" },
    ]);
  });

  it("removes malformed order lines and untrusted extra properties", () => {
    const result = normalizePresentationState({
      orders: [{ id: "od-1", at: "2026-09-09T00:00:00Z", total: 0, note: { bad: true }, items: [
        null, { id: "unknown", qty: 1 }, { id: "ribbon_keyring", qty: "1" },
        { id: { toString: null, valueOf: null }, win: true, qty: 1 },
        { id: "ribbon_keyring", qty: 1, option: { value: "M" }, price: { unsafe: true } },
      ] }],
      rec: { cafeBest: { value: 3000 }, cafeTry: 1.5, cafePass: true, libBestMs: Infinity, obsoleteScore: 500 },
      clears: { rooftop: true, unknown: true, cafeteria: { clear: true } },
      quiz: { secret: true }, cafeRound: { giant: [] }, arbitrary: { value: "not state" },
      tickets: { cafeteria: 2, unknown: 2, broadcast: -1 }, wishes: ["unknown", "ribbon_keyring", "ribbon_keyring"],
    });
    expect(result.orders[0]).toEqual({ id: "od-1", at: "2026-09-09T00:00:00Z", total: 0, items: [
      { id: "ribbon_keyring", option: null, qty: 1, key: "ribbon_keyring::" },
    ] });
    expect(result.rec).toEqual({ cafePass: true });
    expect(result.clears).toEqual({ rooftop: true });
    expect(result.tickets).toEqual({ cafeteria: 2 });
    expect(result.wishes).toEqual(["ribbon_keyring"]);
    expect(result).not.toHaveProperty("arbitrary");
    expect(result.quiz).toBeNull();
    expect(result.cafeRound).toBeNull();
  });

  it("bounds reservation indexes to the configured event and its available start times", () => {
    const days = Math.round((Date.parse(OFFLINE.closeAt) - Date.parse(OFFLINE.openAt)) / 86400000) + 1;
    for (const reserve of [
      { day: -1, slot: 0, label: "invalid" }, { day: days, slot: 0, label: "invalid" },
      { day: 0, slot: 17, label: "invalid" }, { day: 0, slot: -1, label: "invalid" },
      { day: 0.5, slot: 0, label: "invalid" }, { day: 0, slot: 0, label: {} },
    ]) expect(normalizePresentationState({ reserve }).reserve).toBeNull();
    expect(normalizePresentationState({ reserve: { day: days - 1, slot: 16, label: "마지막 회차", extra: {} } }).reserve)
      .toEqual({ day: days - 1, slot: 16, label: "마지막 회차" });
  });

  it("limits photo sources to selected portraits and compact local raster uploads", () => {
    expect(normalizePresentationState({ photo: "data:image/png;base64,YWJj" }).photo).toBe("data:image/png;base64,YWJj");
    for (const photo of ["https://example.test/face.jpg", "data:image/svg+xml;base64,YWJj", {}, "unknown", `data:image/png;base64,${"A".repeat(750000)}`]) {
      expect(normalizePresentationState({ photo }).photo).toBeNull();
    }
  });
});

describe("presentation storage failure boundary", () => {
  it.each(["{broken", "null", "[]"])("recovers persisted %s and keeps a stable snapshot between reads", (stored) => {
    const disk = storage(stored);
    const store = createPresentationStore(() => disk, () => null);
    expect(store.getSnapshot()).toEqual(EMPTY_PRESENTATION_STATE);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("continues in memory when localStorage access throws", () => {
    const store = createPresentationStore(() => { throw new Error("SecurityError"); }, () => null);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toEqual(EMPTY_PRESENTATION_STATE);
    store.update({ op: true, callsign: "온조" });
    expect(store.getSnapshot()).toMatchObject({ op: true, callsign: "온조" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not replace a fresh in-memory change with stale disk state after a quota error", () => {
    const disk = storage(JSON.stringify({ callsign: "이전" }));
    disk.setItem.mockImplementation(() => { throw new Error("QuotaExceededError"); });
    const store = createPresentationStore(() => disk, () => null);
    expect(store.getSnapshot().callsign).toBe("이전");
    store.update({ callsign: "지금", rec: { cafePass: true } });
    expect(store.getSnapshot()).toMatchObject({ callsign: "지금", rec: { cafePass: true } });
    store.update((previous) => ({ ...previous, op: true }));
    expect(store.getSnapshot()).toMatchObject({ callsign: "지금", op: true });
  });

  it("reflects another tab clearing storage and removes its event subscription", () => {
    const disk = storage(JSON.stringify({ op: true, callsign: "온조" }));
    const events = new EventTarget();
    const store = createPresentationStore(() => disk, () => events);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getSnapshot().op).toBe(true);
    disk.replace(null);
    events.dispatchEvent(Object.assign(new Event("storage"), { key: PRESENTATION_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual(EMPTY_PRESENTATION_STATE);
    unsubscribe();
    events.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("presentation countdown anchor", () => {
  it("migrates an existing session once and preserves the anchor and records across reload", () => {
    const start = Date.parse("2026-09-09T01:00:00Z");
    const disk = storage(JSON.stringify({ callsign: "생존자", spent: 24000, clears: { cafeteria: true } }));
    const store = createPresentationStore(() => disk, () => null, () => start);
    store.startClock();
    store.startClock();
    expect(disk.setItem).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({ clockStartedAt: start, callsign: "생존자", spent: 24000, clears: { cafeteria: true } });
    const later = start + 90_000;
    const reloaded = createPresentationStore(() => disk, () => null, () => later);
    reloaded.startClock();
    expect(reloaded.getSnapshot()).toEqual(store.getSnapshot());
    expect(later - reloaded.getSnapshot().clockStartedAt).toBe(90_000);
    expect(disk.setItem).toHaveBeenCalledOnce();
  });

  it("starts a fresh timeline together with an explicit progress reset", () => {
    const start = Date.parse("2026-09-09T01:00:00Z"), resetAt = start + 3600_000;
    const disk = storage(JSON.stringify({ clockStartedAt: start, spent: 24000, callsign: "생존자" }));
    const store = createPresentationStore(() => disk, () => null, () => resetAt);
    store.update(() => ({ ...EMPTY_PRESENTATION_STATE, clockStartedAt: resetAt }));
    store.startClock();
    expect(store.getSnapshot()).toEqual({ ...EMPTY_PRESENTATION_STATE, clockStartedAt: resetAt });
    const reloaded = createPresentationStore(() => disk, () => null, () => resetAt + 60_000);
    reloaded.startClock();
    expect(reloaded.getSnapshot().clockStartedAt).toBe(resetAt);
  });

  it("rejects malformed anchors and keeps a stable in-memory clock when storage is blocked", () => {
    for (const clockStartedAt of [-1, 0, 1.5, "1788915600000", Infinity, 8_640_000_000_000_001, {}]) {
      expect(normalizePresentationState({ clockStartedAt }).clockStartedAt).toBeNull();
    }
    const getNow = vi.fn(() => 1788915600000);
    const store = createPresentationStore(() => { throw new Error("SecurityError"); }, () => null, getNow);
    store.startClock();
    store.startClock();
    expect(store.getSnapshot().clockStartedAt).toBe(1788915600000);
    expect(getNow).toHaveBeenCalledOnce();
  });
});

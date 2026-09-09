import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoxSession, createDarkSession, createDropSession, createWireSession, drawDayKey } from "./source/lib/box/session";
import { createRoundPlayback } from "./source/lib/stage/round-playback";
import { createPresentationStore, EMPTY_PRESENTATION_STATE, normalizePresentationState } from "./source/components/aouad/presentation-state";
import { claimPresentationWin, commitPresentationDraw, normalizeDrawRecords, presentationDrawPrize, presentationDrawState, recordPresentationDraw } from "./source/components/aouad/presentation-draws";

const NOW = Date.parse("2026-09-09T01:00:00Z");
const MODES = [
  { id: "k1", create: createBoxSession, draw: (session, i) => { session.toggle(i); return session.draw(); } },
  { id: "k2", create: createDropSession, draw: (session, i) => session.drop(i % 10) },
  { id: "k3", create: createWireSession, draw: (session, i) => session.trace(i % 10) },
  { id: "k4", create: createDarkSession, draw: (session, i) => session.open(i) },
];
const firstResult = (out) => Array.isArray(out) ? out[0] ?? null : out;
const EXPECTED_SKUS = {
  k1: ["uniform_female", "binder_attendance", "deskmat_map", "cabinet_penholder", "lock_dial", "key_25", "slipper_charm", "locker_magnet", "notice_replica", "meal_ticket", "logo_sticker", "paper_nametag", "locker_label"],
  k2: ["archery_tracksuit", "firstaid_pouch", "tactical_flashlight", "kit", "carabiner_box", "whistle_cord", "mini_pouch", "radio_single", "reflect_strap", "bandage_tin", "ration_slip", "emergency_sticker", "rule_card"],
  k3: ["hoodie_broadcast", "earphone_namra", "virus_journal", "lenticular_block", "freq_dial", "mic_mini", "onair_magnet", "broadcast_badge", "cassette_case", "cable_tie", "freq_sticker", "script_replica", "still_postcard"],
  k4: ["zipup_namra", "blanket", "lighter_eunji", "candle", "flashlight_charm", "ember_charm", "sos_magnet", "mini_candle", "glow_sticker", "emergency_light", "glow_charm", "ember_sticker", "lightsout_card"],
};

function storage() {
  let value = null;
  return { getItem: () => value, setItem: vi.fn((key, next) => { value = next; }) };
}

function storedSession(mode, store, now = () => NOW) {
  const saved = presentationDrawState(store.getSnapshot(), mode.id, now());
  return mode.create({ seed: 675, rivals: 0, now, initialToday: saved.today, initialDay: saved.day, initialTaken: saved.taken,
    getDrawState: () => presentationDrawState(store.getSnapshot(), mode.id, now()) });
}

function commitRound(mode, session, index, store, at = NOW, operationId = `${mode.id}-${index}`) {
  return commitPresentationDraw({ roundId: mode.id, draw: () => mode.draw(session, index), operationId, now: () => at,
    onDrawCommitted: (commit) => store.update((previous) => recordPresentationDraw(previous, commit)) });
}

afterEach(() => vi.useRealTimers());

describe("presentation draw session commit boundary", () => {
  it.each(MODES)("$id rejects draw eleven without changing any session state", ({ create, draw }) => {
    const session = create({ seed: 675, rivals: 0, now: () => NOW });
    for (let i = 0; i < 10; i++) expect(firstResult(draw(session, i))).not.toBeNull();
    const before = session.snapshot();
    expect(firstResult(draw(session, 10))).toBeNull();
    expect(session.snapshot()).toEqual(before);
  });

  it.each(MODES)("$id exposes the exact prize index in every committed result", ({ create, draw }) => {
    const session = create({ seed: 675, rivals: 0, now: () => NOW });
    const result = firstResult(draw(session, 0));
    expect(result).toHaveProperty("prizeIndex");
    expect(session.snapshot().prizes[result.prizeIndex]).toMatchObject({ g: result.grade, name: result.name, value: result.value });
  });

  it("rechecks the wall limit after selection without consuming its held cells", () => {
    const saved = { day: drawDayKey(NOW), today: 9 };
    const session = createBoxSession({ seed: 675, rivals: 0, now: () => NOW, getDrawState: () => saved });
    expect(session.toggle(0)).toBe("picked");
    saved.today = 10;
    const before = session.snapshot();
    expect(session.draw()).toEqual([]);
    expect(session.snapshot()).toEqual(before);
    expect(before.picks).toEqual([0]);
  });

  it("rejects an expired wall hold before the next tick", () => {
    let now = NOW;
    const session = createBoxSession({ seed: 675, rivals: 0, now: () => now });
    session.toggle(0);
    now += session.snapshot().holdSec * 1000;
    const before = session.snapshot();
    expect(session.draw()).toEqual([]);
    expect(session.snapshot()).toEqual(before);
  });

  it.each(MODES)("$id rejects invalid selections without changing its lot", ({ id, create, draw }) => {
    const session = create({ seed: 675, rivals: 0, now: () => NOW });
    for (const value of [-1, 0.5, NaN, Infinity, "0"]) {
      const before = session.snapshot();
      const out = id === "k2" ? session.drop(value) : id === "k3" ? session.trace(value) : draw(session, value);
      expect(firstResult(out)).toBeNull();
      expect(session.snapshot()).toEqual(before);
    }
  });

  it("preserves the dark scan history when the eleventh open is rejected", () => {
    const session = createDarkSession({ seed: 675, rivals: 0, now: () => NOW });
    for (let i = 0; i < 10; i++) session.open(i);
    session.scan(20);
    const before = session.snapshot();
    expect(session.open(20)).toBeNull();
    expect(session.snapshot()).toEqual(before);
    expect(before.log).toHaveLength(1);
  });
});

describe("draw receipts and locker persistence", () => {
  it.each(MODES)("$id records the correct SKU for every engine prize", (mode) => {
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    let now = NOW;
    const session = storedSession(mode, store, () => now), seen = new Set();
    for (let i = 0; i < 80; i++) {
      if (i && i % 10 === 0) now += 86400_000;
      const result = firstResult(commitRound(mode, session, i, store, now));
      expect(result).not.toBeNull();
      const win = store.getSnapshot().wins.at(-1);
      expect(win.mdId || win.boxId).toBe(EXPECTED_SKUS[mode.id][result.prizeIndex]);
      expect(win.grade).toBe(result.grade);
      expect(win.at).toBe(new Date(now).toISOString());
      expect(win).not.toHaveProperty("claimedAt");
      seen.add(result.prizeIndex);
    }
    expect(seen.size).toBe(13);
    expect(store.getSnapshot().drawRecords).toHaveLength(80);
    expect(store.getSnapshot().wins).toHaveLength(80);
    expect(store.getSnapshot().orders).toEqual([]);
    expect(session.snapshot().left).toBe(0);
  });

  it("records a five-cell wall operation once and keeps distinct SKUs sharing a grade", () => {
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    const session = storedSession(MODES[0], store);
    for (let i = 0; i < 5; i++) session.toggle(i);
    let commit;
    const out = commitPresentationDraw({ roundId: "k1", draw: () => session.draw(), now: () => NOW, operationId: "wall-batch",
      onDrawCommitted: (value) => { commit = value; store.update((previous) => recordPresentationDraw(previous, value)); } });
    expect(out).toHaveLength(5);
    const before = store.getSnapshot();
    expect(before.wins).toHaveLength(5);
    expect(new Set(before.wins.map((win) => win.id)).size).toBe(5);
    expect(recordPresentationDraw(before, commit)).toBe(before);
    expect(recordPresentationDraw(before, { ...commit, at: NOW + 86400_000 })).toBe(before);
    const reloaded = createPresentationStore(() => disk, () => null).getSnapshot();
    expect(reloaded.wins).toEqual(before.wins);
    expect(presentationDrawState(reloaded, "k1", NOW)).toEqual({ day: "2026-09-09", today: 5, taken: [0, 1, 2, 3, 4] });
    expect(presentationDrawPrize("k2", 5)).toEqual({ boxId: "whistle_cord", grade: "C" });
    expect(presentationDrawPrize("k2", 6)).toEqual({ boxId: "mini_pouch", grade: "C" });
  });

  it.each(MODES)("$id preserves ten draws through mode changes and full reload, then rejects eleven", (mode) => {
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    const first = storedSession(mode, store);
    for (let i = 0; i < 10; i++) commitRound(mode, first, i, store);
    const saved = store.getSnapshot(), writes = disk.setItem.mock.calls.length;
    for (const activeStore of [store, createPresentationStore(() => disk, () => null)]) {
      const reentered = storedSession(mode, activeStore);
      const before = reentered.snapshot();
      expect(before).toMatchObject({ today: 10, left: 70 });
      expect(firstResult(commitRound(mode, reentered, 10, activeStore))).toBeNull();
      expect(reentered.snapshot()).toEqual(before);
      expect(activeStore.getSnapshot()).toEqual(saved);
    }
    expect(disk.setItem).toHaveBeenCalledTimes(writes);
  });

  it.each(MODES)("$id rolls over at KST midnight while keeping its opened cells", (mode) => {
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    let now = Date.parse("2026-09-09T14:59:59.999Z");
    const session = storedSession(mode, store, () => now);
    for (let i = 0; i < 10; i++) commitRound(mode, session, i, store, now);
    const opened = session.snapshot().cell;
    now += 1;
    expect(session.snapshot()).toMatchObject({ today: 0, left: 70, cell: opened });
    expect(firstResult(commitRound(mode, session, 10, store, now))).not.toBeNull();
    expect(presentationDrawState(store.getSnapshot(), mode.id, now)).toMatchObject({ day: "2026-09-10", today: 1 });
    const reloaded = createPresentationStore(() => disk, () => null);
    expect(storedSession(mode, reloaded, () => now).snapshot()).toMatchObject({ today: 1, left: 69 });
    expect(presentationDrawState(reloaded.getSnapshot(), mode.id, now - 1).today).toBe(10);
  });

  it.each(MODES)("$id merges another active session's receipts before its next draw", (mode) => {
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    const first = storedSession(mode, store), second = storedSession(mode, store);
    commitRound(mode, first, 0, store, NOW, "first-tab");
    const expected = storedSession(mode, store);
    expect(second.snapshot()).toMatchObject({ today: 1, left: 79, cell: expected.snapshot().cell });
    const expectedResult = firstResult(mode.draw(expected, 1));
    const next = firstResult(commitRound(mode, second, 1, store, NOW, "second-tab"));
    // A continuously open tab must use the same path/cell as a fresh read of the saved lot.
    expect(next).toEqual(expectedResult);
    expect(store.getSnapshot().drawRecords).toHaveLength(2);
    expect(store.getSnapshot().wins).toHaveLength(2);
    expect(second.snapshot()).toMatchObject({ today: 2, left: 78 });
  });

  it("invalidates a held wall cell when another session has already committed it", () => {
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    const first = storedSession(MODES[0], store), second = storedSession(MODES[0], store);
    second.toggle(0);
    commitRound(MODES[0], first, 0, store, NOW, "first-tab");
    const callback = vi.fn();
    expect(commitPresentationDraw({ roundId: "k1", draw: () => second.draw(), onDrawCommitted: callback })).toEqual([]);
    expect(callback).not.toHaveBeenCalled();
    expect(second.snapshot()).toMatchObject({ picks: [], today: 1, left: 79 });
    expect(second.snapshot().holdUntil[0]).toBe(0);
    expect(store.getSnapshot().wins).toHaveLength(1);
  });

  it("updates a wire session's ladder block when another tab completes the tenth draw", () => {
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    const first = storedSession(MODES[2], store);
    for (let i = 0; i < 9; i++) commitRound(MODES[2], first, i, store);
    const second = storedSession(MODES[2], store);
    expect(second.snapshot().block).toBe(0);
    commitRound(MODES[2], first, 9, store);
    const expected = storedSession(MODES[2], store).snapshot();
    expect(second.snapshot()).toMatchObject({ block: 1, untilRewire: 10, rungs: expected.rungs, today: 10, left: 70 });
  });

  it.each(MODES)("$id persists a committed win even when its reveal is cancelled immediately", async (mode) => {
    vi.useFakeTimers();
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    const session = storedSession(mode, store), playback = createRoundPlayback(), shown = [];
    const run = playback.begin();
    const pending = (async () => {
      try {
        const out = commitRound(mode, session, 0, store);
        if (!await playback.wait(run, 1200)) return;
        shown.push(out);
      } finally { playback.finish(run); }
    })();
    expect(store.getSnapshot().wins).toHaveLength(1);
    expect(store.getSnapshot().drawRecords).toHaveLength(1);
    playback.cancel();
    await pending;
    expect(shown).toEqual([]);
    expect(createPresentationStore(() => disk, () => null).getSnapshot()).toEqual(store.getSnapshot());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps all current-day counts even after the 200-win display cap is reached", () => {
    let state = EMPTY_PRESENTATION_STATE;
    for (let day = 0; day < 8; day++) for (const mode of MODES) for (let i = 0; i < 10; i++) {
      state = normalizePresentationState(recordPresentationDraw(state, { roundId: mode.id, operationId: `${mode.id}-${day}-${i}`,
        at: NOW + day * 86400_000, results: [{ cell: day * 10 + i + 1, prizeIndex: 0, grade: "A" }] }));
    }
    expect(state.wins).toHaveLength(200);
    expect(state.drawRecords).toHaveLength(320);
    for (const mode of MODES) expect(presentationDrawState(state, mode.id, NOW + 7 * 86400_000)).toMatchObject({ today: 10 });
  });

  it("rejects malformed and duplicate receipts without trusting nested stored values", () => {
    const good = { id: "draw:k1:test:1", operationId: "test", roundId: "k1", cell: 1, prizeIndex: 4, at: new Date(NOW).toISOString() };
    const invalid = [null, {}, { ...good, id: {} }, { ...good, operationId: {} }, { ...good, at: {} }, { ...good, cell: 0 },
      { ...good, cell: 81 }, { ...good, prizeIndex: 13 }, { ...good, prizeIndex: 1.5 }, { ...good, roundId: "unknown" }];
    expect(normalizeDrawRecords([...invalid, good, good])).toEqual([good]);
    const state = normalizePresentationState({ drawRecords: [good] });
    const retryCell = { roundId: "k1", operationId: "other", at: NOW, results: [{ cell: 1, grade: "C", prizeIndex: 4 }] };
    expect(recordPresentationDraw(state, retryCell)).toBe(state);
    expect(recordPresentationDraw(state, { ...retryCell, results: [{ cell: 2, grade: "A", prizeIndex: 4 }] })).toBe(state);
  });
});

describe("locker shipment simulation", () => {
  it("claims a win once and preserves cart quantities, draw counts and spend", () => {
    const disk = storage(), store = createPresentationStore(() => disk, () => null);
    const session = storedSession(MODES[0], store);
    commitRound(MODES[0], session, 0, store);
    store.update({ cart: [{ id: "ribbon_keyring", qty: 2 }], spent: 24000 });
    const before = store.getSnapshot();
    store.update((state) => claimPresentationWin(state, 0, NOW));
    const claimed = store.getSnapshot();
    expect(claimed.wins[0]).toMatchObject({ ...before.wins[0], claimedAt: NOW });
    expect(claimed.orders).toHaveLength(1);
    expect(claimed.orders[0]).toMatchObject({ total: 0, items: [{ qty: 1, win: true }] });
    expect(claimed.cart).toEqual(before.cart);
    expect(claimed.spent).toBe(before.spent);
    expect(claimed.drawRecords).toEqual(before.drawRecords);
    expect(claimPresentationWin(claimed, 0, NOW + 1)).toBe(claimed);
    const reloaded = createPresentationStore(() => disk, () => null).getSnapshot();
    expect(claimPresentationWin(reloaded, 0, NOW + 2)).toBe(reloaded);
    expect(reloaded.orders).toHaveLength(1);
  });

  it("rejects missing or invalid wins and timestamps without changing state", () => {
    const state = normalizePresentationState({ wins: [{ boxId: "lock_dial", grade: "C", source: "사물함 회차" }] });
    for (const index of [-1, 0.5, 1, Infinity, "0"]) expect(claimPresentationWin(state, index, NOW)).toBe(state);
    for (const at of [-1, 0, NaN, Infinity, "now"]) expect(claimPresentationWin(state, 0, at)).toBe(state);
    expect(claimPresentationWin({ wins: [] }, 0, NOW)).toEqual({ wins: [] });
    const unknown = { wins: [{ boxId: "unknown", grade: "C" }] };
    expect(claimPresentationWin(unknown, 0, NOW)).toBe(unknown);
  });
});

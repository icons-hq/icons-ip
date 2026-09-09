import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CafeteriaStage } from "./source/components/aouad/CafeteriaCrash";
import { createRoundPlayback } from "./source/lib/stage/round-playback";
import { LOCK_MS, gameLockKey, readGameLock, resetGameLocks } from "./source/lib/stage/game-lock";

afterEach(() => vi.useRealTimers());

it("renders the completed fifth cafeteria round with its earned reward", () => {
  const html = renderToStaticMarkup(createElement(CafeteriaStage, { g: {
    mode: "play", phase: "summary", round: 5, t: 8, got: [600, 600, 600, 600, 600],
    breaks: [8, 8, 8, 8, 8], out: true, outAt: 5, locked: 600, autoAt: 600,
    flash: 1, summary: { score: 1800, pass: false, newly: ["cafeCup"] },
  } }));
  expect(html).toContain("1,800p");
  expect(html).toContain("획득");
  expect(html).toContain("5 / 5");
});

describe("round reveal lifetime", () => {
  it("switching rounds cancels an old reveal without cancelling the replacement", async () => {
    vi.useFakeTimers();
    const playback = createRoundPlayback();
    const revealed = [];
    const reveal = async (label, ms) => {
      const run = playback.begin();
      try {
        if (await playback.wait(run, ms)) revealed.push(label);
      } finally { playback.finish(run); }
    };
    const old = reveal("previous round", 1200);
    playback.cancel();
    const next = reveal("current round", 900);
    await old;
    expect(playback.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1200);
    await next;
    expect(revealed).toEqual(["current round"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmounting settles all pending waits and prevents later audio/result work", async () => {
    vi.useFakeTimers();
    const playback = createRoundPlayback();
    const run = playback.begin();
    const pending = [playback.wait(run, 115), playback.wait(run, 1200)];
    playback.cancel();
    expect(await Promise.all(pending)).toEqual([false, false]);
    expect(vi.getTimerCount()).toBe(0);
    expect(await playback.wait(run, 220)).toBe(false);
  });

  it("only accepts one confirm until the current reveal finishes", () => {
    const playback = createRoundPlayback();
    const run = playback.begin();
    expect(playback.begin()).toBeNull();
    playback.finish(run);
    expect(playback.begin()).not.toBeNull();
    playback.cancel();
  });
});

describe("local demo game locks", () => {
  const now = 1_800_000_000_000;
  const storageWith = (value) => ({ getItem: () => value });

  it("restores a valid lock but rejects expired, corrupt and implausibly long values", () => {
    expect(readGameLock("library", now, storageWith(String(now + LOCK_MS)))).toBe(now + LOCK_MS);
    for (const invalid of ["NaN", "Infinity", "-1", "bad", String(now), String(now + LOCK_MS + 1)]) {
      expect(readGameLock("library", now, storageWith(invalid))).toBe(0);
    }
    expect(readGameLock("library", now, { getItem: () => { throw new Error("storage blocked"); } })).toBe(0);
  });

  it("a fresh-demo reset unlocks all three games and preserves unrelated storage", () => {
    const saved = new Map([
      [gameLockKey("cafeteria"), String(now + LOCK_MS)],
      [gameLockKey("broadcast"), String(now + LOCK_MS)],
      [gameLockKey("library"), String(now + LOCK_MS)],
      ["icons:user-preference", "keep"],
    ]);
    resetGameLocks({ removeItem: (key) => saved.delete(key) });
    expect([...saved]).toEqual([["icons:user-preference", "keep"]]);
  });
});

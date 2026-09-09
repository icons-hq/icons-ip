import { describe, expect, it, vi } from "vitest";
import { syncHeroPlayback } from "./source/lib/stage/hero-playback";

function video(play = vi.fn(() => Promise.resolve())) {
  return { muted: false, currentTime: 8, play, pause: vi.fn() };
}

describe("AOUAD hero playback lifecycle", () => {
  it("never starts a hidden page and rewinds an offscreen hero", () => {
    const hidden = video();
    syncHeroPlayback(hidden, true, () => true);
    expect(hidden.play).not.toHaveBeenCalled();
    expect(hidden.pause).toHaveBeenCalledOnce();
    expect(hidden.currentTime).toBe(0);

    const offscreen = video();
    syncHeroPlayback(offscreen, false, () => false);
    expect(offscreen.play).not.toHaveBeenCalled();
    expect(offscreen.currentTime).toBe(0);
  });

  it("stops a delayed autoplay completion after the component leaves", async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const media = video(vi.fn(() => pending));
    const dispose = syncHeroPlayback(media, true, () => false);
    expect(media.muted).toBe(true);
    dispose();
    media.pause.mockClear();
    complete();
    await pending;
    expect(media.pause).toHaveBeenCalledOnce();
  });

  it("stops autoplay if the tab is hidden while playback is starting", async () => {
    let hidden = false;
    const media = video();
    syncHeroPlayback(media, true, () => hidden);
    hidden = true;
    await Promise.resolve();
    expect(media.pause).toHaveBeenCalledOnce();
  });

  it("does not let an old play request stop a newly visible hero", async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const play = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const media = video(play);
    const leave = syncHeroPlayback(media, true, () => false);
    leave();
    syncHeroPlayback(media, true, () => false);
    media.pause.mockClear();
    complete();
    await pending;
    expect(media.pause).not.toHaveBeenCalled();
  });

  it("handles blocked autoplay without an unhandled rejection", async () => {
    const media = video(vi.fn(() => Promise.reject(new Error("Autoplay blocked"))));
    syncHeroPlayback(media, true, () => false);
    await Promise.resolve();
    await Promise.resolve();
    expect(media.pause).toHaveBeenCalledOnce();
  });
});

export type LastBellTouchHudViewport = Readonly<{
  pointerCoarse: boolean;
  width: number;
  height: number;
}>;

/**
 * Keep both required phone orientations playable even when browser automation
 * reports a fine pointer. Real phones normally match `pointer: coarse`, but
 * viewport QA and hybrid devices cannot use that signal as the only gate.
 */
export function shouldUseLastBellTouchHud({
  pointerCoarse,
  width,
  height,
}: LastBellTouchHudViewport): boolean {
  return pointerCoarse || width <= 520 || height <= 480;
}

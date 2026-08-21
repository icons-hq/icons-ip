/** Reduced-motion users get an equivalent static cafeteria action. */
export function cafeteriaActionForPreference(
  reducedMotion: boolean,
  running: boolean,
): 'complete' | 'start' | 'attempt' {
  if (reducedMotion) return 'complete';
  return running ? 'attempt' : 'start';
}

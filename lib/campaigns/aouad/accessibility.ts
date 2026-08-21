/** Every visitor can choose an equivalent static cafeteria action. */
export function cafeteriaActionForPreference(
  reducedMotion: boolean,
  running: boolean,
  staticAlternative = false,
): 'complete' | 'start' | 'attempt' {
  if (reducedMotion || staticAlternative) return 'complete';
  return running ? 'attempt' : 'start';
}

/** Reduced-motion visitors must never wait for the 10-second ceremony timer. */
export function isAouadOpeningReady(timerReady: boolean, reducedMotion: boolean): boolean {
  return timerReady || reducedMotion;
}

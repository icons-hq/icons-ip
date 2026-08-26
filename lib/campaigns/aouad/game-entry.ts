export const LAST_BELL_LOCAL_QA_PATH = '/games/prototype-last-bell';
export const LAST_BELL_VERIFIED_EXPERIENCE_PATH = '/experiences/all-of-us-are-dead/last-bell';
export const LAST_BELL_VERIFIED_STORE_PATH = '/experiences/all-of-us-are-dead/last-bell/store';
export const LAST_BELL_POPUP_PATH = '/games/prototype-last-bell/popup';

export type AouadGameEntryContext = {
  gameHref: typeof LAST_BELL_LOCAL_QA_PATH | typeof LAST_BELL_VERIFIED_EXPERIENCE_PATH;
  authority: 'local-qa' | 'verified-candidate';
  authConfigured: boolean;
  isAuthenticated: boolean;
  displayName: string | null;
};

export function isLastBellVerifiedExperienceEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.ICONS_LAST_BELL_VERIFIED_EXPERIENCE === '1'
    && isLastBellVerifiedCatalogEligible(environment);
}

/** A server-injected catalog readiness flag; client CTA code never decides this. */
export function isLastBellVerifiedCatalogEligible(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.ICONS_LAST_BELL_VERIFIED_CATALOG === '1';
}

export function lastBellGameHref(
  environment: Record<string, string | undefined> = process.env,
): AouadGameEntryContext['gameHref'] {
  return isLastBellVerifiedExperienceEnabled(environment)
    ? LAST_BELL_VERIFIED_EXPERIENCE_PATH
    : LAST_BELL_LOCAL_QA_PATH;
}

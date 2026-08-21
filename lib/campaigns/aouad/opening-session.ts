/**
 * A popup route can remount while moving between the hub and a zone. This
 * document-scoped dismissal intentionally avoids browser storage, so it still
 * works when storage access is blocked while allowing a fresh document entry
 * to show the short revisit ceremony. Reading is pure: React Strict Mode can
 * render or mount a component more than once before the visitor responds.
 */
let aouadOpeningDismissedInDocument = false;

export function isAouadOpeningDismissedInDocument(): boolean {
  return aouadOpeningDismissedInDocument;
}

/** Only a real visitor response (continue, skip, or Escape) dismisses it. */
export function markAouadOpeningDismissedInDocument(): void {
  aouadOpeningDismissedInDocument = true;
}

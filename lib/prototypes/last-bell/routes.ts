import type { LastBellRouteId } from './state';

/**
 * Approved player-facing names for the three Chapter 1 escape routes.
 * Keep this separate from the interaction copy: prompts describe an action,
 * while records and results describe the route that was actually completed.
 */
export const LAST_BELL_ROUTE_LABELS: Record<LastBellRouteId, string> = {
  central: '중앙 복도',
  rear: '후면 복도',
  systems: '시스템 통로',
};

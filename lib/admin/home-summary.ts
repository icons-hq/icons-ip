export interface AdminHomeSummary {
  claims: { cancel: number | null; return: number | null; exchange: number | null };
  goods: { published: number | null; soldout: number | null };
  reviews: { total: number | null; lowRating: number | null; awaitingReply: number | null };
}

export const ADMIN_INSIGHT_PERIODS = [1, 7, 30] as const;
export type AdminInsightPeriod = typeof ADMIN_INSIGHT_PERIODS[number];
export function adminInsightPeriod(value: unknown): AdminInsightPeriod {
  const days = Number(value);
  return ADMIN_INSIGHT_PERIODS.includes(days as AdminInsightPeriod) ? days as AdminInsightPeriod : 30;
}

/**
 * 통계 리포트 (#258) — 조회 전용.
 *
 * 집계는 DB RPC가 끝낸다(`admin_sales_report`·`admin_claims_report`·
 * `admin_customer_report`). 이 모듈은 기간 파라미터를 다듬고, 화면이 그대로 그릴
 * 수 있게 파생값(비율·합계)만 만든다 — 앱에서 다시 합산하면 PostgREST 1000행
 * 절단과 KST 경계 차이로 대시보드와 다른 숫자가 나온다.
 */

export const ADMIN_STATS_RANGE_DAYS = [7, 30, 90] as const;
export type AdminStatsRangeDays = (typeof ADMIN_STATS_RANGE_DAYS)[number];

export const ADMIN_STATS_DEFAULT_RANGE: AdminStatsRangeDays = 30;

export interface AdminStatsFilters {
  /** 조회 기간(일). 프리셋만 허용한다 — 임의 기간은 CSV와 함께 후속이다. */
  days: AdminStatsRangeDays;
  /** 판매분석 전용 IP 필터. 다른 화면에서는 무시한다. */
  ipId: string;
}

export interface AdminStatsRange {
  from: string;
  to: string;
}

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function normalizeAdminStatsFilters(
  params: Record<string, string | string[] | undefined>,
): AdminStatsFilters {
  const parsed = Number.parseInt(readParam(params, 'days'), 10);
  const days = (ADMIN_STATS_RANGE_DAYS as readonly number[]).includes(parsed)
    ? (parsed as AdminStatsRangeDays)
    : ADMIN_STATS_DEFAULT_RANGE;
  return { days, ipId: readParam(params, 'ip').trim().slice(0, 64) };
}

/**
 * 기간 경계. 끝을 "지금"이 아니라 다음 KST 자정으로 잡는 이유는, DB 버킷이 KST
 * 일자이기 때문이다 — 오늘 오후에 열면 오늘 버킷이 반쯤 잘린 채로 보인다.
 */
export function adminStatsRange(
  days: AdminStatsRangeDays,
  now: Date = new Date(),
): AdminStatsRange {
  const kstDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dayMs = 24 * 60 * 60 * 1000;
  const todayKst = kstDay.format(now);
  const startKst = kstDay.format(new Date(now.getTime() - (days - 1) * dayMs));
  return {
    from: new Date(`${startKst}T00:00:00+09:00`).toISOString(),
    to: new Date(Date.parse(`${todayKst}T00:00:00+09:00`) + dayMs).toISOString(),
  };
}

export function adminStatsHref(base: string, filters: Partial<AdminStatsFilters>) {
  const params = new URLSearchParams();
  if (filters.days && filters.days !== ADMIN_STATS_DEFAULT_RANGE) {
    params.set('days', String(filters.days));
  }
  if (filters.ipId) params.set('ip', filters.ipId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export interface AdminSalesDailyRow {
  date: string;
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
}

export interface AdminSalesMethodRow {
  method: string;
  orderCount: number;
  revenue: number;
}

export interface AdminSalesGoodRow {
  goodId: string;
  name: string;
  ipId: string;
  qty: number;
  revenue: number;
}

export interface AdminSalesTicketRow {
  eventId: string;
  eventTitle: string;
  orderCount: number;
  ticketCount: number;
  revenue: number;
}

export interface AdminSalesReport {
  daily: AdminSalesDailyRow[];
  paymentMethods: AdminSalesMethodRow[];
  goods: AdminSalesGoodRow[];
  tickets: AdminSalesTicketRow[];
}

export interface AdminClaimTypeRow {
  claimType: string;
  total: number;
  completed: number;
  rejected: number;
  open: number;
  /** 주문 1000건당 클레임 수. 판매가 없던 기간에는 null이다. */
  ratePerMille: number | null;
}

export interface AdminClaimReasonRow {
  claimType: string;
  reasonType: string;
  total: number;
}

export interface AdminClaimsReport {
  orderCount: number;
  claimCount: number;
  byType: AdminClaimTypeRow[];
  byReason: AdminClaimReasonRow[];
  refunds: {
    completedCount: number;
    averageHours: number | null;
    within72h: number;
  };
}

export interface AdminCustomerReport {
  signups: { date: string; total: number }[];
  signupTotal: number;
  buyerCount: number;
  repeatBuyerCount: number;
  inquiries: {
    total: number;
    unanswered: number;
    averageFirstResponseHours: number | null;
  };
}

export const ADMIN_PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: '신용·체크카드',
  bank_transfer: '무통장 입금',
};

export function adminPaymentMethodLabel(method: string) {
  return ADMIN_PAYMENT_METHOD_LABELS[method] ?? method;
}

export const ADMIN_CLAIM_TYPE_LABELS: Record<string, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
};

export function adminClaimTypeLabel(claimType: string) {
  return ADMIN_CLAIM_TYPE_LABELS[claimType] ?? claimType;
}

export const ADMIN_CLAIM_REASON_LABELS: Record<string, string> = {
  change_of_mind: '단순 변심',
  defect: '하자·오배송',
};

export function adminClaimReasonLabel(reasonType: string) {
  return ADMIN_CLAIM_REASON_LABELS[reasonType] ?? reasonType;
}

/**
 * 구성비. 분모가 0이면 0%가 아니라 null이다 — "무통장이 0%"와 "판매가 없었다"는
 * 다른 사실이고, 0%로 적으면 운영자가 결제수단을 껐다고 읽는다.
 */
export function adminShareOfTotal(value: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((value / total) * 1000) / 10;
}

export function adminPercentLabel(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/** 기간 내 재구매율. 구매자가 없으면 비율이 없다. */
export function adminRepeatRate(repeatBuyers: number, buyers: number) {
  return adminShareOfTotal(repeatBuyers, buyers);
}

import 'server-only';

import { createClient } from '@/lib/supabase/server';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const RECENT_ORDER_LIMIT = 5;
const TOP_IP_LIMIT = 5;

export const ADMIN_ORDER_STATUSES = ['pending', 'paid', 'shipping', 'done', 'canceled'] as const;
export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];

/** 매출로 집계하는 주문 상태 — 결제 확정 이후 */
const REVENUE_ORDER_STATUSES: AdminOrderStatus[] = ['paid', 'shipping', 'done'];

export interface AdminMetricWindow {
  current: number;
  previous: number;
}

export interface AdminDailyRevenue {
  date: string; // KST YYYY-MM-DD
  goods: number;
  tickets: number;
}

export interface AdminPipelineStage {
  status: AdminOrderStatus;
  count: number;
}

export interface AdminRecentOrder {
  id: string;
  kind: 'good' | 'ticket';
  buyerName: string;
  total: number;
  status: string;
  createdAt: string;
}

export interface AdminTopIp {
  ipId: string;
  title: string;
  revenue: number;
  orderCount: number;
}

export interface AdminInsights {
  revenue: AdminMetricWindow;
  paymentCount: AdminMetricWindow;
  avgPayment: AdminMetricWindow;
  signupCount: AdminMetricWindow;
  dailyRevenue: AdminDailyRevenue[];
  pipeline: AdminPipelineStage[];
  recentOrders: AdminRecentOrder[];
  topIps: AdminTopIp[];
}

interface PaymentRow {
  purpose: 'order' | 'ticket' | 'wallet';
  amount: number;
  created_at: string;
}

interface OrderListRow {
  id: string;
  user_id: string;
  total: number;
  status: string;
  created_at: string;
}

interface PublicProfileRow {
  id: string;
  nickname: string | null;
}

interface SignupCountsRow {
  current_count: number | string;
  previous_count: number | string;
}

interface OrderItemRow {
  qty: number;
  unit_price: number;
  good_ip_id_snapshot: string;
  order: { id: string } | null;
}

const kstDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function buyerName(nickname: string | null | undefined, userId: string) {
  return nickname?.trim() || `fan_${userId.slice(0, 6)}`;
}

/** PostgREST max_rows(1000)가 결과를 조용히 자르므로 페이지 단위로 전량 수집한다 */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load admin insights ${label}: ${error.message}`);
    const chunk = (data as T[] | null) ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
}

export async function getAdminInsights(): Promise<AdminInsights> {
  const supabase = await createClient();
  const now = Date.now();

  // 윈도우 경계를 일별 버킷과 같은 KST 자정 기준으로 정렬 — 차트 30일 합계 = 매출 카드
  const dayKeys: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
    dayKeys.push(kstDay.format(new Date(now - i * DAY_MS)));
  }
  const windowStartMs = Date.parse(`${dayKeys[0]}T00:00:00+09:00`);
  const prevWindowStartMs = windowStartMs - WINDOW_DAYS * DAY_MS;
  const windowStart = new Date(windowStartMs).toISOString();
  const prevWindowStart = new Date(prevWindowStartMs).toISOString();

  const [payments, items, ordersResult, ticketOrdersResult, pipelineCounts, signupCountsResult] = await Promise.all([
    fetchAllRows<PaymentRow>('payments', (from, to) =>
      supabase
        .from('payment_summaries')
        .select('purpose,amount,created_at')
        .eq('status', 'paid')
        .in('purpose', ['order', 'ticket'])
        .gte('created_at', prevWindowStart)
        .order('created_at', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<OrderItemRow>('order_items', (from, to) =>
      supabase
        .from('order_items')
        .select('qty,unit_price,good_ip_id_snapshot,order:orders!inner(id,status,created_at)')
        .in('order.status', REVENUE_ORDER_STATUSES)
        .gte('order.created_at', windowStart)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    supabase
      .from('orders')
      .select('id,user_id,total,status,created_at')
      .order('created_at', { ascending: false })
      .limit(RECENT_ORDER_LIMIT),
    supabase
      .from('ticket_orders')
      .select('id,user_id,total,status,created_at')
      .order('created_at', { ascending: false })
      .limit(RECENT_ORDER_LIMIT),
    Promise.all(
      ADMIN_ORDER_STATUSES.map((status) =>
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', status),
      ),
    ),
    supabase.rpc('admin_profile_signup_counts', {
      target_current_end: new Date(now + 1).toISOString(),
      target_current_start: windowStart,
      target_previous_start: prevWindowStart,
    }),
  ]);

  for (const [label, result] of [
    ['orders', ordersResult],
    ['ticket_orders', ticketOrdersResult],
  ] as const) {
    if (result.error) throw new Error(`Failed to load admin insights ${label}: ${result.error.message}`);
  }

  // ── 결제 메트릭 + 일별 매출 (paid payments 기준, KST 일자 버킷) ─────────────
  const revenue: AdminMetricWindow = { current: 0, previous: 0 };
  const paymentCount: AdminMetricWindow = { current: 0, previous: 0 };
  const dailyBuckets = new Map<string, { goods: number; tickets: number }>(
    dayKeys.map((key) => [key, { goods: 0, tickets: 0 }]),
  );

  for (const payment of payments) {
    const createdMs = new Date(payment.created_at).getTime();
    const inCurrentWindow = createdMs >= windowStartMs;
    const windowKey = inCurrentWindow ? 'current' : 'previous';
    revenue[windowKey] += payment.amount;
    paymentCount[windowKey] += 1;

    if (inCurrentWindow) {
      const bucket = dailyBuckets.get(kstDay.format(new Date(createdMs)));
      if (bucket) {
        if (payment.purpose === 'ticket') bucket.tickets += payment.amount;
        else bucket.goods += payment.amount;
      }
    }
  }

  const avgPayment: AdminMetricWindow = {
    current: paymentCount.current ? Math.round(revenue.current / paymentCount.current) : 0,
    previous: paymentCount.previous ? Math.round(revenue.previous / paymentCount.previous) : 0,
  };

  // ── 신규 가입 ────────────────────────────────────────────────────────────
  if (signupCountsResult.error) {
    throw new Error(`Failed to count admin profiles: ${signupCountsResult.error.message}`);
  }
  const signupCounts = (signupCountsResult.data ?? []) as SignupCountsRow[];
  const signupCount = signupCounts.length === 1 ? signupCounts[0] : null;
  const signupsCurrent = Number(signupCount?.current_count);
  const signupsPrevious = Number(signupCount?.previous_count);
  if (!Number.isSafeInteger(signupsCurrent) || signupsCurrent < 0
    || !Number.isSafeInteger(signupsPrevious) || signupsPrevious < 0) {
    throw new Error('Failed to count admin profiles: invalid aggregate');
  }

  // ── 주문 상태 파이프라인 ──────────────────────────────────────────────────
  const pipeline: AdminPipelineStage[] = ADMIN_ORDER_STATUSES.map((status, index) => {
    const result = pipelineCounts[index];
    if (result.error) throw new Error(`Failed to count admin orders(${status}): ${result.error.message}`);
    return { status, count: result.count ?? 0 };
  });

  // ── 최근 주문 (굿즈 + 티켓 병합) ─────────────────────────────────────────
  const goodOrderRows = (ordersResult.data ?? []) as unknown as OrderListRow[];
  const ticketOrderRows = (ticketOrdersResult.data ?? []) as unknown as OrderListRow[];
  const profileIds = [...new Set([...goodOrderRows, ...ticketOrderRows].map((row) => row.user_id))];
  let profileNicknames = new Map<string, string | null>();
  if (profileIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from('public_profiles')
      .select('id,nickname')
      .in('id', profileIds);
    if (profilesError) {
      throw new Error(`Failed to load admin insights public_profiles: ${profilesError.message}`);
    }
    profileNicknames = new Map(
      ((profiles ?? []) as PublicProfileRow[]).map((profile) => [profile.id, profile.nickname]),
    );
  }

  const goodOrders = goodOrderRows.map((row) => ({
    id: row.id,
    kind: 'good' as const,
    buyerName: buyerName(profileNicknames.get(row.user_id), row.user_id),
    total: row.total,
    status: row.status,
    createdAt: row.created_at,
  }));
  const ticketOrders = ticketOrderRows.map((row) => ({
    id: row.id,
    kind: 'ticket' as const,
    buyerName: buyerName(profileNicknames.get(row.user_id), row.user_id),
    total: row.total,
    status: row.status,
    createdAt: row.created_at,
  }));
  const recentOrders = [...goodOrders, ...ticketOrders]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, RECENT_ORDER_LIMIT);

  // ── IP별 매출 톱 N (최근 30일, 결제 확정 주문 아이템 기준) ────────────────
  const validItems = items.filter((item) => item.order);
  const byIp = new Map<string, { revenue: number; orderIds: Set<string> }>();
  for (const item of validItems) {
    const entry = byIp.get(item.good_ip_id_snapshot) ?? { revenue: 0, orderIds: new Set<string>() };
    entry.revenue += item.qty * item.unit_price;
    entry.orderIds.add(item.order!.id);
    byIp.set(item.good_ip_id_snapshot, entry);
  }
  const rankedIps = [...byIp.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, TOP_IP_LIMIT);

  let ipTitles = new Map<string, string>();
  if (rankedIps.length) {
    const { data: ips, error: ipsError } = await supabase
      .from('ips')
      .select('id,title')
      .in('id', rankedIps.map(([ipId]) => ipId));
    if (ipsError) throw new Error(`Failed to load admin insights ips: ${ipsError.message}`);
    ipTitles = new Map((ips ?? []).map((ip) => [ip.id as string, ip.title as string]));
  }

  return {
    revenue,
    paymentCount,
    avgPayment,
    signupCount: { current: signupsCurrent, previous: signupsPrevious },
    dailyRevenue: [...dailyBuckets.entries()].map(([date, bucket]) => ({ date, ...bucket })),
    pipeline,
    recentOrders,
    topIps: rankedIps.map(([ipId, entry]) => ({
      ipId,
      title: ipTitles.get(ipId) ?? ipId,
      revenue: entry.revenue,
      orderCount: entry.orderIds.size,
    })),
  };
}

import 'server-only';

import { isCoinReason, kstTodayIsoDate, type CoinReason } from '@/lib/coins';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/* 코인 잔액·출석·원장 로더 (S8 #330).
 *
 * 읽기는 RLS select 로 한다 — coin_balances·coin_attendance·coin_ledger 는 전부
 * 본인 행(또는 staff)만 보이는 정책이 걸려 있고, 쓰기는 RPC 두 개뿐이다.
 *
 * 절대 던지지 않는다. 캠페인 상세는 비로그인도 보는 공개 표면이라, 코인 조회 실패가
 * 페이지를 500 으로 만들면 열람 자체가 막힌다 — 잔액 0·미출석으로 접는다. */

export interface CoinOverview {
  balance: number;
  /** Asia/Seoul 기준 오늘 출석했는지. RPC의 하루 경계와 같은 정의다. */
  attendedToday: boolean;
}

export interface CoinLedgerEntry {
  id: string;
  amount: number;
  reason: CoinReason;
  attendedOn: string | null;
  createdAt: string;
}

interface LedgerRow {
  id: number | string;
  amount: number;
  reason: string;
  attended_on: string | null;
  created_at: string;
}

type CoinSupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function currentUserId(supabase: CoinSupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/**
 * 잔액 + 오늘 출석 여부.
 *
 * 비로그인은 null 이다 — 잔액 0 과 "로그인 안 함"은 화면에서 다르게 그려야 한다
 * (게스트에게는 같은 자리에 로그인 CTA 가 온다, R-06 §2.2).
 */
export async function loadCoinOverview(): Promise<CoinOverview | null> {
  if (!getSupabaseConfig().isConfigured) return null;

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;

  const [balanceResult, attendanceResult] = await Promise.all([
    supabase
      .from('coin_balances')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle<{ balance: number }>(),
    supabase
      .from('coin_attendance')
      .select('attended_on')
      .eq('user_id', userId)
      .eq('attended_on', kstTodayIsoDate())
      .maybeSingle<{ attended_on: string }>(),
  ]);

  /* 잔액 행은 첫 적립 때 생긴다 — 없는 것이 정상이고 0 을 뜻한다. */
  return {
    balance: balanceResult.error ? 0 : balanceResult.data?.balance ?? 0,
    attendedToday: attendanceResult.error ? false : Boolean(attendanceResult.data),
  };
}

/**
 * 코인 원장 최신순.
 *
 * 다음 웨이브의 `/my/coins` 가 이 로더를 그대로 임포트한다 — 잔액 화면이 자기
 * 쿼리를 새로 쓰기 시작하면 원장 표기가 두 벌로 갈린다.
 */
export async function loadCoinLedger(limit: number = 50): Promise<CoinLedgerEntry[]> {
  if (!getSupabaseConfig().isConfigured) return [];

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return [];

  const { data, error } = await supabase
    .from('coin_ledger')
    .select('id,amount,reason,attended_on,created_at')
    .eq('user_id', userId)
    .order('id', { ascending: false })
    .limit(limit);

  if (error) return [];

  /* reason 은 DB 체크 제약이 지키지만, 제약이 늘어난 뒤 배포된 구버전 화면이
     원장 줄을 통째로 잃지 않도록 모르는 값은 'attendance' 로 접지 않고 뺀다 —
     금액 부호가 뜻을 이미 담고 있어 사유 없는 줄은 오해를 만든다. */
  return ((data ?? []) as LedgerRow[]).flatMap((row) => (
    isCoinReason(row.reason)
      ? [{
        id: String(row.id),
        amount: row.amount,
        reason: row.reason,
        attendedOn: row.attended_on,
        createdAt: row.created_at,
      }]
      : []
  ));
}

import 'server-only';

import { createServiceClient, getServiceRoleConfig } from '../supabase/service';
import {
  normalizeBankDepositBatch,
  type BankDepositAdapter,
  type BankDepositRecord,
} from './bank-deposit-feed';

/**
 * 입금 내역 수집 실행 (#257).
 *
 * 어댑터가 등록돼 있지 않으면 아무것도 하지 않는다. 계약(#255) 전까지가 그
 * 상태이며, 그때도 운영은 수동 대조 콘솔(#256)로 굴러간다 — 이 경로가 비어
 * 있다고 해서 무통장 결제가 막히지는 않는다.
 */

export interface BankDepositIngestResult {
  /** 어댑터가 돌려준 정상 항목 수. */
  readonly fetched: number;
  /** 이번 실행에서 새로 적재된 행 수. 재수집이면 0이 정상이다. */
  readonly inserted: number;
  readonly source: string;
}

/**
 * 계약 전이라 구현체가 없다. provider가 정해지면 여기서 env를 읽어 어댑터를
 * 만들어 돌려준다 — 호출부(cron route)는 바뀌지 않는다.
 */
export function resolveBankDepositAdapter(): BankDepositAdapter | null {
  return null;
}

/** 겹쳐 받아도 DB가 (source, external_id)로 걸러 내므로 창을 넉넉히 잡는다. */
const LOOKBACK_HOURS = 72;

export async function ingestBankDeposits(
  adapter: BankDepositAdapter | null = resolveBankDepositAdapter(),
  now: Date = new Date(),
): Promise<BankDepositIngestResult | null> {
  if (!adapter || !getServiceRoleConfig().isConfigured) return null;

  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000);
  const fetched: readonly BankDepositRecord[] = await adapter.fetchSince(since);
  const records = normalizeBankDepositBatch(fetched);
  if (!records.length) {
    return { fetched: 0, inserted: 0, source: adapter.name };
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('record_bank_deposits', {
    p_source: adapter.name,
    p_deposits: records,
  });
  if (error) throw new Error(`Failed to record bank deposits: ${error.message}`);

  return {
    fetched: records.length,
    inserted: typeof data === 'number' ? data : 0,
    source: adapter.name,
  };
}

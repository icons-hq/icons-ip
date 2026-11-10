import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { fetchTossSettlementPage, SettlementFetchError, type SettlementPage, type TossSettlementConfiguration } from './toss-settlements.server';
import { jobMatchesQuery, parsePgSettlementJob, type PgSettlementJob } from './report';
import { parseSettlementQuery, type SettlementMode, type SettlementQuery } from './types';
import { readAccountSettlementConfiguration, type AccountSettlementConfiguration } from './accounts.server';
import { parseSettlementAccountKey, settlementAccountKey, settlementAccountMatches, type SettlementAccountIdentity } from './accounts';
import { settlementFailureLabel } from './console';

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
export interface SettlementWorkerDependencies {
  serviceRpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  readJob: (id: string) => PromiseLike<RpcResult>;
  configuration: (account?: string | null, expected?: SettlementAccountIdentity & { mode: SettlementMode }) => AccountSettlementConfiguration | null | Promise<AccountSettlementConfiguration | null>;
  fetchPage: (configuration: TossSettlementConfiguration, query: SettlementQuery, page: number) => Promise<SettlementPage>;
}
export type PgSettlementActionResult =
  | { ok: true; kind: 'created' | 'accepted' | 'paused' | 'busy' | 'complete' | 'failed'; job: PgSettlementJob }
  | { ok: false; error: string; uncertain?: boolean; recoveryRequired?: boolean };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const unknown = (): PgSettlementActionResult => ({ ok: false, uncertain: true, error: '처리 결과를 확인하지 못했습니다. 같은 요청의 현재 상태를 다시 확인해주세요.' });
const unavailable = (): PgSettlementActionResult => ({ ok: false, error: '이 환경의 PG 정산 연결이 꺼져 있습니다. 저장된 자료는 계속 조회할 수 있습니다.' });

/** Test dependency seam supplies a synthetic provider only outside product entry points. */
export function createPgSettlementWorker(dependencies: SettlementWorkerDependencies) {
  const read = async (id: string): Promise<PgSettlementJob | null> => {
    try {
      const result = await dependencies.readJob(id);
      const data = object(result.data);
      const job = result.error ? null : parsePgSettlementJob(data?.job ?? result.data);
      return job?.id === id ? job : null;
    } catch { return null; }
  };
  const resultFromJob = (job: PgSettlementJob, fallback: 'accepted' | 'busy' | 'paused'): PgSettlementActionResult => ({
    ok: true, kind: job.state === 'complete' ? 'complete' : job.state === 'failed' ? 'failed' : fallback, job,
  });
  return {
    read,
    async start(actorId: string, operationId: string, query: SettlementQuery & { mode: SettlementMode; account?: string | null }): Promise<PgSettlementActionResult> {
      if (!isUuid(actorId) || !isUuid(operationId) || !parseSettlementQuery(query) || !['test', 'live'].includes(query.mode) || query.account && !parseSettlementAccountKey(query.account)) return { ok: false, error: settlementFailureLabel('invalid_request')! };
      const config = await dependencies.configuration(query.account);
      if (!config) return unavailable();
      if (config.mode !== query.mode) return { ok: false, error: '조회 환경과 연결된 PG 환경이 다릅니다. 테스트·실거래 선택을 확인해주세요.' };
      const account = config.account;
      if (query.account && query.account !== 'current' && (!account || settlementAccountKey(account) !== query.account)) return unavailable();
      try {
        const { data, error } = await dependencies.serviceRpc('service_create_profile_pg_settlement_import', {
          p_actor_id: actorId, p_operation_id: operationId, p_query: parseSettlementQuery(query), p_mode: config.mode,
          p_scope_hash: config.scopeHash, p_mid: config.mId, p_integration: account?.integration ?? 'toss_payment', p_profile_id: account?.profileId ?? null,
        });
        if (error?.code === '42501') return { ok: false, error: '현재 정산 관리 권한을 확인해주세요.' };
        if (error?.code === '23505' && error.message === 'settlement_operation_conflict') return {
          ok: false, recoveryRequired: true, error: '이 수집 요청의 계정 또는 연결 정보가 바뀌었습니다. 저장된 작업을 다시 불러와 현재 상태를 확인해주세요.',
        };
        const job = error ? null : parsePgSettlementJob(object(data)?.job);
        if (!job || job.operationId !== operationId || !jobMatchesQuery(job, query) || (account ? !settlementAccountMatches(job, account) : job.integration !== 'toss_payment')) return unknown();
        return { ok: true, kind: job.state === 'complete' ? 'complete' : job.state === 'failed' ? 'failed' : 'created', job };
      } catch { return unknown(); }
    },
    async advance(actorId: string, importId: string): Promise<PgSettlementActionResult> {
      if (!isUuid(actorId) || !isUuid(importId)) return { ok: false, error: '수집 작업을 확인해주세요.' };
      const initial = await read(importId);
      if (!initial) return unknown();
      if (initial.state === 'complete' || initial.state === 'failed') return resultFromJob(initial, 'busy');
      const config = await dependencies.configuration(settlementAccountKey(initial), initial);
      if (!config) return unavailable();
      if (config.mode !== initial.mode || !config.account || !settlementAccountMatches(config.account, initial)) return { ok: false, error: settlementFailureLabel('scope_changed')! };
      let claim: Record<string, unknown> | null;
      try {
        const { data, error } = await dependencies.serviceRpc('service_claim_pg_settlement_import', {
          p_actor_id: actorId, p_import_id: importId, p_scope_hash: config.scopeHash,
        });
        if (error?.code === '42501') return { ok: false, error: '현재 정산 관리 권한을 확인해주세요.' };
        claim = error ? null : object(data);
      } catch { return unknown(); }
      const job = parsePgSettlementJob(claim?.job);
      if (!claim || !job || job.id !== importId || !jobMatchesQuery(job, { ...initial, account: settlementAccountKey(initial) }) || !settlementAccountMatches(job, initial)) return unknown();
      if (claim.kind === 'busy' || claim.kind === 'complete' || claim.kind === 'failed') return resultFromJob(job, 'busy');
      const query = parseSettlementQuery(claim.query);
      if (claim.kind !== 'ready' || !isUuid(claim.claimId) || !query || !jobMatchesQuery(job, { ...query, mode: config.mode, account: settlementAccountKey(initial) })
        || claim.scan !== job.scan || claim.page !== job.nextPage) return unknown();
      const claimId = claim.claimId, scan = job.scan, page = job.nextPage;
      const args = { p_actor_id: actorId, p_import_id: importId, p_claim_id: claimId, p_scope_hash: config.scopeHash };
      try {
        const providerPage = await dependencies.fetchPage(config, query, page);
        const result = await dependencies.serviceRpc('service_finish_pg_settlement_import', { ...args, p_page: providerPage });
        const receipt = object(result.data), finished = result.error ? null : parsePgSettlementJob(receipt?.job);
        if (finished && finished.id === importId && jobMatchesQuery(finished, { ...job, account: settlementAccountKey(job) }) && settlementAccountMatches(finished, job)
          && ['accepted', 'stale', 'complete', 'failed'].includes(String(receipt?.kind))
          && (receipt?.kind === 'stale' || finished.state === 'complete' || finished.state === 'failed'
            || finished.scan > scan || (finished.scan === scan && finished.nextPage > page))) return resultFromJob(finished, receipt?.kind === 'stale' ? 'busy' : 'accepted');
      } catch (error) {
        if (error instanceof SettlementFetchError) {
          try {
            const result = await dependencies.serviceRpc('service_fail_pg_settlement_import', { ...args, p_error: error.code });
            const failed = result.error ? null : parsePgSettlementJob(object(result.data)?.job);
            if (failed && failed.id === importId && jobMatchesQuery(failed, { ...job, account: settlementAccountKey(job) }) && settlementAccountMatches(failed, job)) return resultFromJob(failed, 'paused');
          } catch { /* Read the committed result before allowing another provider request. */ }
        }
      }
      // A response can disappear after COMMIT. Resume from the database cursor,
      // never blindly append this page again or retry an old lease's write.
      const current = await read(importId);
      if (current && jobMatchesQuery(current, { ...job, account: settlementAccountKey(job) }) && settlementAccountMatches(current, job)) {
        if (current.state === 'complete' || current.state === 'failed') return resultFromJob(current, 'busy');
        if (current.scan > scan || (current.scan === scan && current.nextPage > page)) return resultFromJob(current, 'accepted');
      }
      return unknown();
    },
  };
}

export async function pgSettlementWorker() {
  const service = createServiceClient(), client = await createClient();
  return createPgSettlementWorker({
    serviceRpc: (name, args) => service.rpc(name, args),
    readJob: id => client.rpc('admin_get_pg_settlement_import', { p_import_id: id }),
    configuration: readAccountSettlementConfiguration,
    fetchPage: fetchTossSettlementPage,
  });
}

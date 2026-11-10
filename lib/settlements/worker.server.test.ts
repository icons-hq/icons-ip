import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createPgSettlementWorker, type SettlementWorkerDependencies } from './worker.server';
import { SETTLEMENT_FIXTURE_JOB as initial } from './fixture';
import { SettlementFetchError } from './toss-settlements.server';
import type { PgSettlementJob } from './report';

const actor = '287b949d-af67-4398-b0d2-09adbd123454', claimId = '287b949d-af67-4398-b0d2-09adbd123455';
const config = { mId: 'iconsfixture', secretKey: 'test_gsk_fixture00000001', mode: 'test' as const, scopeHash: 'a'.repeat(64), account: { accountId: initial.accountId, integration: 'toss_payment' as const, profileId: null, merchantId: 'iconsfixture', mode: 'test' as const } };
const page = { records: [], sourceCount: 0, sourceTransactionKeys: [], page: 1, sourceHash: 'b'.repeat(64), recordsHash: 'c'.repeat(64), terminal: true };
const query = { dateType: initial.dateType, startDate: initial.startDate, endDate: initial.endDate, mode: initial.mode };
let current: PgSettlementJob;
let dependencies: SettlementWorkerDependencies;
beforeEach(() => {
  current = { ...initial };
  dependencies = {
    readJob: vi.fn(async () => ({ data: current, error: null })), configuration: () => config,
    fetchPage: vi.fn(async () => page),
    serviceRpc: vi.fn(async name => {
      if (name === 'service_create_profile_pg_settlement_import') return { data: { job: current }, error: null };
      if (name === 'service_claim_pg_settlement_import') return { data: { kind: 'ready', job: current, claimId, scan: current.scan, page: current.nextPage, query }, error: null };
      current = { ...current, state: 'verifying', scan: 2, nextPage: 1 };
      return { data: { kind: 'accepted', job: current }, error: null };
    }),
  };
});
describe('private settlement worker', () => {
  it('does not create or fetch while disconnected or when the selected mode differs', async () => {
    dependencies.configuration = () => null;
    expect(await createPgSettlementWorker(dependencies).start(actor, initial.operationId, query)).toMatchObject({ ok: false });
    expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: false });
    expect(dependencies.serviceRpc).not.toHaveBeenCalled(); expect(dependencies.fetchPage).not.toHaveBeenCalled();
    dependencies.configuration = () => config;
    expect(await createPgSettlementWorker(dependencies).start(actor, initial.operationId, { ...query, mode: 'live' })).toMatchObject({ ok: false });
    expect(dependencies.serviceRpc).not.toHaveBeenCalled();
  });
  it('binds creation to actor, operation, exact query and private connection scope', async () => {
    expect(await createPgSettlementWorker(dependencies).start(actor, initial.operationId, query)).toMatchObject({ ok: true, kind: 'created', job: initial });
    expect(dependencies.serviceRpc).toHaveBeenCalledWith('service_create_profile_pg_settlement_import', {
      p_actor_id: actor, p_operation_id: initial.operationId, p_query: { dateType: query.dateType, startDate: query.startDate, endDate: query.endDate }, p_mode: 'test', p_scope_hash: config.scopeHash, p_mid: config.mId, p_integration: 'toss_payment', p_profile_id: null,
    });
    expect(dependencies.fetchPage).not.toHaveBeenCalled();
  });
  it('checks the current job, obtains a lease, fetches only one page and commits that claim', async () => {
    expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: true, kind: 'accepted', job: { scan: 2 } });
    expect(dependencies.fetchPage).toHaveBeenCalledExactlyOnceWith(config, { dateType: query.dateType, startDate: query.startDate, endDate: query.endDate }, 1);
    expect(dependencies.serviceRpc).toHaveBeenLastCalledWith('service_finish_pg_settlement_import', { p_actor_id: actor, p_import_id: initial.id, p_claim_id: claimId, p_scope_hash: config.scopeHash, p_page: page });
  });
  it('never fetches for another worker lease, a terminal job, or revoked access', async () => {
    dependencies.serviceRpc = vi.fn(async () => ({ data: { kind: 'busy', job: current }, error: null }));
    expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: true, kind: 'busy' });
    current = { ...current, state: 'failed', errorCode: 'scope_changed' };
    expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: true, kind: 'failed' });
    dependencies.readJob = vi.fn(async () => ({ data: null, error: { code: '42501' } }));
    expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: false });
    expect(dependencies.fetchPage).not.toHaveBeenCalled();
  });
  it('reads the committed cursor after a lost write response without fetching twice', async () => {
    const normal = dependencies.serviceRpc;
    dependencies.serviceRpc = vi.fn(async (name, args) => {
      const result = await normal(name, args);
      if (name === 'service_finish_pg_settlement_import') throw new Error('connection lost after commit');
      return result;
    });
    expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: true, kind: 'accepted', job: { scan: 2 } });
    expect(dependencies.fetchPage).toHaveBeenCalledOnce(); expect(dependencies.readJob).toHaveBeenCalledTimes(2);
  });
  it('pauses a transient provider error with its original cursor for explicit resume', async () => {
    dependencies.fetchPage = vi.fn(async () => { throw new SettlementFetchError('provider_unavailable'); });
    const normal = dependencies.serviceRpc;
    dependencies.serviceRpc = vi.fn(async (name, args) => {
      if (name === 'service_fail_pg_settlement_import') return { data: { kind: 'accepted', job: { ...current, errorCode: 'provider_unavailable' } }, error: null };
      return normal(name, args);
    });
    expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: true, kind: 'paused', job: { scan: 1, nextPage: 1 } });
    expect(dependencies.serviceRpc).toHaveBeenLastCalledWith('service_fail_pg_settlement_import', expect.objectContaining({ p_error: 'provider_unavailable', p_claim_id: claimId }));
  });
  it('keeps an unknown finish unresolved until its cursor or final state is confirmed', async () => {
    const normal = dependencies.serviceRpc;
    dependencies.serviceRpc = vi.fn(async (name, args) => name === 'service_finish_pg_settlement_import'
      ? { data: null, error: { code: '08006', message: 'private-error' } } : normal(name, args));
    const result = await createPgSettlementWorker(dependencies).advance(actor, initial.id);
    expect(result).toMatchObject({ ok: false, uncertain: true }); expect(JSON.stringify(result)).not.toContain('private-error');
    expect(dependencies.fetchPage).toHaveBeenCalledOnce();
  });
  it('rejects a mismatched create receipt or lease before provider work', async () => {
    dependencies.serviceRpc = vi.fn(async () => ({ data: { job: { ...initial, operationId: claimId }, kind: 'ready', claimId, scan: 2, page: 1, query }, error: null }));
    expect(await createPgSettlementWorker(dependencies).start(actor, initial.operationId, query)).toMatchObject({ ok: false, uncertain: true });
    expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: false, uncertain: true });
    expect(dependencies.fetchPage).not.toHaveBeenCalled();
  });
  it('distinguishes a confirmed operation conflict from an unknown creation outcome', async () => {
    dependencies.serviceRpc = vi.fn(async () => ({ data: null, error: { code: '23505', message: 'settlement_operation_conflict' } }));
    expect(await createPgSettlementWorker(dependencies).start(actor, initial.operationId, query)).toMatchObject({ ok: false, recoveryRequired: true });
    dependencies.serviceRpc = vi.fn(async () => ({ data: null, error: { code: '08006', message: 'transport failed' } }));
    expect(await createPgSettlementWorker(dependencies).start(actor, initial.operationId, query)).toMatchObject({ ok: false, uncertain: true });
    expect(dependencies.fetchPage).not.toHaveBeenCalled();
  });
});

it('billing 조회·재개는 DB job의불변 profile/MID와맞는 설정만 사용한다', async () => {
  current = { ...initial, integration: 'toss_billing', accountId: '287b949d-af67-4398-b0d2-09adbd123458' };
  const account = { accountId: current.accountId, integration: current.integration, profileId: '287b949d-af67-4398-b0d2-09adbd123456', merchantId: 'billingmid', mode: 'test' as const };
  const billingConfig = { ...config, mId: 'billingmid', account };
  dependencies.configuration = vi.fn(() => billingConfig);
  expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: true, kind: 'accepted' });
  expect(dependencies.configuration).toHaveBeenCalledWith(account.accountId, expect.objectContaining({ accountId: account.accountId, integration: account.integration }));
  expect(dependencies.fetchPage).toHaveBeenCalledWith(billingConfig, expect.any(Object), 1);
  current = { ...initial, ...account };dependencies.configuration = vi.fn(() => ({ ...billingConfig, account: { ...account, accountId: initial.accountId } }));vi.mocked(dependencies.fetchPage).mockClear();
  expect(await createPgSettlementWorker(dependencies).advance(actor, initial.id)).toMatchObject({ ok: false });expect(dependencies.fetchPage).not.toHaveBeenCalled();
});

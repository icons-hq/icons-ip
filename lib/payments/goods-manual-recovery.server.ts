import 'server-only';

import { randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type GoodsManualRecoveryOperation = 'provider_cancel_confirmed';

export type GoodsManualRecoveryOutcome =
  | 'provider_cancel_confirmed'
  | 'in_progress';

export interface GoodsManualRecoveryInput {
  operation: 'provider_cancel_confirmed';
  attemptId: string;
  actorId: string;
  requestId: string;
  operatorAttested: true;
}

export interface GoodsManualRecoveryClaimInput {
  readonly operation: GoodsManualRecoveryOperation;
  readonly attemptId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly caseRef: string;
  readonly claimToken: string;
}

export interface GoodsManualRecoveryFinalizationInput
  extends GoodsManualRecoveryClaimInput {
  readonly operatorAttested: boolean;
}

export type GoodsManualRecoveryClaim =
  | { readonly status: 'claimed' }
  | { readonly status: 'in_progress' }
  | {
      readonly status: 'terminal';
      readonly outcome: 'provider_cancel_confirmed';
    };

export interface GoodsManualRecoveryRepository {
  claim(input: GoodsManualRecoveryClaimInput): Promise<GoodsManualRecoveryClaim>;
  finalize(input: GoodsManualRecoveryFinalizationInput): Promise<'provider_cancel_confirmed'>;
}

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export class GoodsManualRecoveryContractError extends Error {
  constructor() {
    super('goods_manual_recovery_contract_invalid');
    this.name = 'GoodsManualRecoveryContractError';
  }
}

export class GoodsManualRecoveryRepositoryError extends Error {
  constructor() {
    super('goods_manual_recovery_repository_failed');
    this.name = 'GoodsManualRecoveryRepositoryError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function assertInput(input: unknown): asserts input is GoodsManualRecoveryInput {
  if (!isRecord(input)
    || !UUID.test(String(input.attemptId ?? ''))
    || !UUID.test(String(input.actorId ?? ''))
  ) throw new GoodsManualRecoveryContractError();

  if (input.operation === 'provider_cancel_confirmed') {
    if (!exactKeys(input, [
      'operation',
      'attemptId',
      'actorId',
      'requestId',
      'operatorAttested',
    ])
      || !UUID.test(String(input.requestId ?? ''))
      || input.operatorAttested !== true
    ) throw new GoodsManualRecoveryContractError();
    return;
  }

  throw new GoodsManualRecoveryContractError();
}

function parseOutcome(value: unknown): 'provider_cancel_confirmed' {
  if (value === 'provider_cancel_confirmed') {
    return value;
  }
  throw new GoodsManualRecoveryRepositoryError();
}

function parseClaim(value: unknown): GoodsManualRecoveryClaim {
  if (!isRecord(value)) throw new GoodsManualRecoveryRepositoryError();
  if (value.claim_status === 'claimed') return { status: 'claimed' };
  if (value.claim_status === 'in_progress') return { status: 'in_progress' };
  if (value.claim_status === 'terminal') {
    return { status: 'terminal', outcome: parseOutcome(value.outcome) };
  }
  throw new GoodsManualRecoveryRepositoryError();
}

async function rpc(client: RpcClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new GoodsManualRecoveryRepositoryError();
  return data;
}

export function createGoodsManualRecoveryRepository(
  client: RpcClient,
): GoodsManualRecoveryRepository {
  return {
    async claim(input) {
      return parseClaim(await rpc(client, 'claim_goods_manual_payment_recovery', {
        p_attempt_id: input.attemptId,
        p_actor_id: input.actorId,
        p_request_id: input.requestId,
        p_case_ref: input.caseRef,
        p_operation: input.operation,
        p_claim_token: input.claimToken,
      }));
    },
    async finalize(input) {
      return parseOutcome(await rpc(client, 'finalize_goods_manual_payment_recovery', {
        p_attempt_id: input.attemptId,
        p_actor_id: input.actorId,
        p_request_id: input.requestId,
        p_case_ref: input.caseRef,
        p_operation: input.operation,
        p_claim_token: input.claimToken,
        p_operator_attested: input.operatorAttested,
      }));
    },
  };
}

/**
 * 한 admin이 provider 원장을 수동 확인한 뒤 한 attempt를 정합화하는 유일한 서버 seam.
 * Provider API를 호출하지 않으며 raw paymentKey, TID, PAN을 입력 계약에 두지 않는다.
 */
export async function recoverGoodsPaymentManually(
  input: GoodsManualRecoveryInput,
  providedRepository?: GoodsManualRecoveryRepository,
): Promise<{ outcome: GoodsManualRecoveryOutcome }> {
  assertInput(input);
  const repository = providedRepository
    ?? createGoodsManualRecoveryRepository(createServiceClient());
  const claimToken = randomUUID();
  const caseRef = `case_v1_${randomUUID().replaceAll('-', '')}`;
  const shared = {
    operation: input.operation,
    attemptId: input.attemptId,
    actorId: input.actorId,
    requestId: input.requestId,
    caseRef,
    claimToken,
  } as const;
  const claim = await repository.claim(shared);
  if (claim.status === 'in_progress') return { outcome: 'in_progress' };
  if (claim.status === 'terminal') return { outcome: claim.outcome };

  const outcome = await repository.finalize({
    ...shared,
    operatorAttested: true,
  });
  return { outcome };
}

import 'server-only';

import {
  LAST_BELL_CHAPTER_IDS,
  LAST_BELL_COLLECTIBLE_KEYS,
  LAST_BELL_RUN_MODES,
  type LastBellClaimResult,
  type LastBellCompletionResult,
  type LastBellEventResult,
  type LastBellInventoryItem,
  type LastBellRunStartInput,
  type LastBellRunStartResult,
  type LastBellRuntimeEventInput,
} from './contract';

interface RpcError {
  readonly message: string;
}

export interface LastBellRpcClient {
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

export class LastBellRpcFailure extends Error {
  constructor(readonly rpcMessage: string) {
    super('Last Bell service RPC failed');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string | null {
  return typeof value[field] === 'string' ? value[field] : null;
}

function numberField(value: Record<string, unknown>, field: string): number | null {
  return typeof value[field] === 'number' && Number.isSafeInteger(value[field]) ? value[field] : null;
}

function stringArrayField(value: Record<string, unknown>, field: string): string[] | null {
  const candidate = value[field];
  return Array.isArray(candidate) && candidate.every((item) => typeof item === 'string') ? candidate : null;
}

async function rpc(client: LastBellRpcClient, functionName: string, params: Record<string, unknown>) {
  const { data, error } = await client.rpc(functionName, params);
  if (error) throw new LastBellRpcFailure(error.message);
  return data;
}

export async function startVerifiedLastBellRun(
  client: LastBellRpcClient,
  input: {
    readonly userId: string | null;
    readonly guestTokenDigest: string | null;
    readonly start: LastBellRunStartInput;
  },
): Promise<LastBellRunStartResult> {
  const data = await rpc(client, 'last_bell_start_run', {
    p_user_id: input.userId,
    p_guest_token_digest: input.guestTokenDigest,
    p_start_chapter_id: input.start.startChapterId,
    p_run_mode: input.start.runMode,
  });
  if (!isRecord(data)) throw new LastBellRpcFailure('invalid_start_run_response');
  const runId = stringField(data, 'runId');
  const catalogVersion = stringField(data, 'catalogVersion');
  const startChapterId = stringField(data, 'startChapterId');
  const runMode = stringField(data, 'runMode');
  const activeUntil = stringField(data, 'activeUntil');
  const lastSequence = numberField(data, 'lastSequence');
  const progressStage = numberField(data, 'progressStage');
  const pickedCollectibleKeys = stringArrayField(data, 'pickedCollectibleKeys');
  if (
    !runId
    || !catalogVersion
    || !activeUntil
    || !LAST_BELL_RUN_MODES.includes(runMode as (typeof LAST_BELL_RUN_MODES)[number])
    || lastSequence === null
    || lastSequence < 0
    || progressStage === null
    || progressStage < 0
    || !pickedCollectibleKeys
    || pickedCollectibleKeys.some((key) => !LAST_BELL_COLLECTIBLE_KEYS.includes(key as (typeof LAST_BELL_COLLECTIBLE_KEYS)[number]))
    || !LAST_BELL_CHAPTER_IDS.includes(startChapterId as (typeof LAST_BELL_CHAPTER_IDS)[number])
    || typeof data.resumed !== 'boolean'
  ) throw new LastBellRpcFailure('invalid_start_run_response');
  return {
    runId,
    catalogVersion,
    startChapterId: startChapterId as LastBellRunStartResult['startChapterId'],
    runMode: runMode as LastBellRunStartResult['runMode'],
    resumed: data.resumed,
    activeUntil,
    lastSequence,
    progressStage,
    pickedCollectibleKeys: pickedCollectibleKeys as LastBellRunStartResult['pickedCollectibleKeys'],
  };
}

export async function recordVerifiedLastBellEvent(
  client: LastBellRpcClient,
  input: {
    readonly runId: string;
    readonly userId: string | null;
    readonly guestTokenDigest: string | null;
    readonly event: LastBellRuntimeEventInput;
  },
): Promise<LastBellEventResult> {
  const { event } = input;
  const data = await rpc(client, 'last_bell_record_event', {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_guest_token_digest: input.guestTokenDigest,
    p_sequence: event.sequence,
    p_operation_id: event.operationId,
    p_event_type: event.type,
    p_chapter_id: event.chapterId,
    p_zone_id: event.zoneId,
    p_objective_id: event.objectiveId,
    p_collectible_key: event.collectibleKey,
    p_checkpoint_id: event.checkpointId,
  });
  if (!isRecord(data)) throw new LastBellRpcFailure('invalid_event_response');
  const sequence = numberField(data, 'sequence');
  const progressStage = numberField(data, 'progressStage');
  if ((data.status !== 'recorded' && data.status !== 'idempotent') || sequence === null || progressStage === null) {
    throw new LastBellRpcFailure('invalid_event_response');
  }
  return { status: data.status, sequence, progressStage };
}

export async function completeVerifiedLastBellRun(
  client: LastBellRpcClient,
  input: { readonly runId: string; readonly userId: string | null; readonly guestTokenDigest: string | null },
): Promise<LastBellCompletionResult> {
  const data = await rpc(client, 'last_bell_complete_run', {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_guest_token_digest: input.guestTokenDigest,
  });
  if (!isRecord(data) || (data.status !== 'completed' && data.status !== 'idempotent')) {
    throw new LastBellRpcFailure('invalid_completion_response');
  }
  const claimUntil = stringField(data, 'claimUntil');
  if (!claimUntil) throw new LastBellRpcFailure('invalid_completion_response');
  return { status: data.status, claimUntil };
}

export async function claimVerifiedLastBellRun(
  client: LastBellRpcClient,
  input: { readonly runId: string; readonly userId: string; readonly guestTokenDigest: string },
): Promise<LastBellClaimResult> {
  const data = await rpc(client, 'last_bell_claim_run', {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_guest_token_digest: input.guestTokenDigest,
  });
  if (!isRecord(data) || (data.status !== 'claimed' && data.status !== 'idempotent')) {
    throw new LastBellRpcFailure('invalid_claim_response');
  }
  const granted = numberField(data, 'granted');
  if (granted === null || granted < 0) throw new LastBellRpcFailure('invalid_claim_response');
  return { status: data.status, granted };
}

export async function listVerifiedLastBellInventory(
  client: LastBellRpcClient,
  userId: string,
): Promise<LastBellInventoryItem[]> {
  const data = await rpc(client, 'last_bell_list_inventory', { p_user_id: userId });
  if (!Array.isArray(data)) throw new LastBellRpcFailure('invalid_inventory_response');
  const result: LastBellInventoryItem[] = [];
  for (const row of data) {
    if (!isRecord(row)) throw new LastBellRpcFailure('invalid_inventory_response');
    const collectibleKey = stringField(row, 'collectible_key');
    const goodId = stringField(row, 'good_id');
    const validUntil = stringField(row, 'valid_until');
    if (
      !collectibleKey
      || !LAST_BELL_COLLECTIBLE_KEYS.includes(collectibleKey as (typeof LAST_BELL_COLLECTIBLE_KEYS)[number])
      || !goodId
      || !validUntil
      || typeof row.is_purchasable !== 'boolean'
    ) throw new LastBellRpcFailure('invalid_inventory_response');
    result.push({
      collectibleKey: collectibleKey as LastBellInventoryItem['collectibleKey'],
      goodId,
      validUntil,
      isPurchasable: row.is_purchasable,
    });
  }
  return result;
}

import {
  normalizePickupExternalId,
  normalizePickupTrackingNumber,
  parseReturnPickupWorkItem,
  pickupErrorCode,
  type PickupAddress,
  type ReturnPickupAdapter,
  type ReturnPickupResult,
  type ReturnPickupWorkItem,
} from './types';
import type { ReturnPickupAdapterChoice, ReturnPickupAdapterUnavailable } from './adapter.server';

/**
 * 반품 자동 회수 접수 크론 한 회차(QNA-032·ADR-0034). 순서: DB가 고른 할 일(새 회수 묶음은 DB가 큐에 넣고, 필요 없어진 접수는 DB가 닫거나
 * 취소로 돌린다) → 택배사 접수·취소 → 결과 기록. 스위치가 꺼져 있으면 DB가 할 일을 넘기지 않으므로 어댑터를 만들지도, 외부를 부르지도
 * 않는다(화면·동작 불변). 이 함수는 상태를 바꾸지 않는다 — 접수됨·실패·취소 전이는 `service_record_return_pickup_results`만 한다.
 * 응답·로그에는 건수와 실패한 단계 이름만 남긴다(회수지 개인정보·회수 송장·택배사 오류 본문은 싣지 않는다).
 */
export interface ReturnPickupWork { enabled: false }
export interface ReturnPickupWorkEnabled { enabled: true; items: unknown[] }

export interface ReturnPickupRepository {
  work(limit: number): Promise<ReturnPickupWork | ReturnPickupWorkEnabled>;
  record(results: ReturnPickupResult[]): Promise<{ recorded: number; requested: number; failed: number; canceled: number; cancelFailed: number; stale: number; invalid: number }>;
}

export type ReturnPickupStage = 'work' | 'record';

export interface ReturnPickupTickResult {
  /** DB 스위치. 할 일을 읽지 못했으면 null이다. */
  enabled: boolean | null;
  /** 이 서버에 어댑터가 없어 접수하지 못한 이유(있을 때만). 그 일은 실패로 남겨 운영 화면에 '자동 수거 실패'로 보인다. */
  unavailable?: ReturnPickupAdapterUnavailable;
  failedStages?: ReturnPickupStage[];
  leased: number;
  requested: number;
  failed: number;
  canceled: number;
  cancelFailed: number;
  /** 다른 회차가 다시 잡아 이번 결과를 받지 않은 건수. */
  stale: number;
  /** 형식이 틀려 실패로 남긴(또는 열쇠조차 읽지 못한) 일 수. */
  invalid: number;
  /** 회차 시간 예산이 끝나 이번에 보내지 않은 일(임대가 끝나면 DB가 다시 넘긴다). */
  deferred: number;
}

export interface ReturnPickupTickOptions {
  repository: ReturnPickupRepository;
  adapterFor: (provider: string) => ReturnPickupAdapterChoice;
  /** 회수 주소 정정(암호문)을 연다. 열지 못하면 던진다. */
  openSealedAddress: (sender: Extract<NonNullable<Extract<ReturnPickupWorkItem, { kind: 'request' }>['sender']>, { source: 'sealed' }>) => PickupAddress;
  limit?: number;
  concurrency?: number;
  timeoutMs?: number;
  /** 새 외부 호출을 시작하지 않는 시점(크론 maxDuration 안에 기록까지 끝내게). */
  budgetMs?: number;
  now?: () => number;
}

const EMPTY = { leased: 0, requested: 0, failed: 0, canceled: 0, cancelFailed: 0, stale: 0, invalid: 0, deferred: 0 };

async function withTimeout<T>(timeoutMs: number, call: (signal: AbortSignal) => Promise<T>): Promise<{ value: T } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return { value: await call(controller.signal) };
  } catch {
    return { error: controller.signal.aborted ? 'pickup_timeout' : 'pickup_failed' };
  } finally {
    clearTimeout(timer);
  }
}

async function handle(item: ReturnPickupWorkItem, adapter: ReturnPickupAdapter, options: ReturnPickupTickOptions, timeoutMs: number): Promise<ReturnPickupResult> {
  const key = { pickupId: item.pickupId, leaseToken: item.leaseToken };
  if (item.kind === 'cancel') {
    const outcome = await withTimeout(timeoutMs, signal => adapter.cancel({ idempotencyKey: item.idempotencyKey, carrier: item.carrier,
      trackingNumber: item.trackingNumber, externalId: item.externalId }, signal));
    if ('error' in outcome) return { ...key, kind: 'cancel', outcome: 'error', errorCode: outcome.error };
    const result = outcome.value;
    if (result.outcome === 'canceled' || result.outcome === 'not_found') return { ...key, kind: 'cancel', outcome: result.outcome };
    return { ...key, kind: 'cancel', outcome: 'error', errorCode: pickupErrorCode((result as { errorCode?: unknown }).errorCode) };
  }
  let sender: PickupAddress;
  try {
    if (!item.sender) throw new Error('pickup_address_unavailable');
    sender = item.sender.source === 'plain' ? item.sender.address : options.openSealedAddress(item.sender);
  } catch {
    return { ...key, kind: 'request', outcome: 'error', errorCode: 'pickup_address_unavailable' };
  }
  const outcome = await withTimeout(timeoutMs, signal => adapter.request({ idempotencyKey: item.idempotencyKey, carrier: item.carrier,
    outboundTrackingNumber: item.outboundTrackingNumber, sender, receiver: item.receiver, items: item.items }, signal));
  if ('error' in outcome) return { ...key, kind: 'request', outcome: 'error', errorCode: outcome.error };
  const result = outcome.value;
  if (result.outcome !== 'requested') return { ...key, kind: 'request', outcome: 'error', errorCode: pickupErrorCode(result.errorCode) };
  const trackingNumber = normalizePickupTrackingNumber(result.trackingNumber);
  if (!trackingNumber) return { ...key, kind: 'request', outcome: 'error', errorCode: 'invalid_tracking' };
  const externalId = normalizePickupExternalId(result.externalId);
  return { ...key, kind: 'request', outcome: 'requested', trackingNumber, ...(externalId ? { externalId } : {}) };
}

export async function runReturnPickupTick(options: ReturnPickupTickOptions): Promise<ReturnPickupTickResult> {
  const { repository, adapterFor, limit = 20, concurrency = 4, timeoutMs = 8000, budgetMs = 35_000, now = Date.now } = options;
  const started = now();
  let work: Awaited<ReturnType<ReturnPickupRepository['work']>>;
  try {
    work = await repository.work(limit);
  } catch {
    return { enabled: null, failedStages: ['work'], ...EMPTY };
  }
  if (!work.enabled) return { enabled: false, ...EMPTY };

  const results: ReturnPickupResult[] = [];
  let invalid = 0, deferred = 0;
  let unavailable: ReturnPickupAdapterUnavailable | undefined;
  const choices = new Map<string, ReturnPickupAdapterChoice>();
  const queue: ReturnPickupWorkItem[] = [];
  for (const raw of work.items) {
    const parsed = parseReturnPickupWorkItem(raw);
    if (!parsed) { invalid += 1; continue; }
    if ('invalid' in parsed) {
      invalid += 1;
      results.push({ ...parsed.invalid, outcome: 'error', errorCode: 'invalid_work_item' } as ReturnPickupResult);
      continue;
    }
    queue.push(parsed.item);
  }
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (now() - started > budgetMs) { deferred += 1; continue; }
      let choice = choices.get(item.provider);
      if (!choice) { choice = adapterFor(item.provider); choices.set(item.provider, choice); }
      if (!choice.configured) {
        unavailable = choice.reason;
        results.push({ pickupId: item.pickupId, leaseToken: item.leaseToken, kind: item.kind, outcome: 'error', errorCode: 'adapter_unavailable' } as ReturnPickupResult);
        continue;
      }
      results.push(await handle(item, choice.adapter, options, timeoutMs));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));

  let recorded = { requested: 0, failed: 0, canceled: 0, cancelFailed: 0, stale: 0, invalid: 0 };
  const failedStages: ReturnPickupStage[] = [];
  if (results.length) {
    try {
      const value = await repository.record(results);
      recorded = { requested: value.requested, failed: value.failed, canceled: value.canceled, cancelFailed: value.cancelFailed, stale: value.stale, invalid: value.invalid };
    } catch {
      failedStages.push('record');
    }
  }
  return {
    enabled: true,
    ...(unavailable ? { unavailable } : {}),
    ...(failedStages.length ? { failedStages } : {}),
    leased: work.items.length,
    ...recorded,
    invalid: invalid + recorded.invalid,
    deferred,
  };
}

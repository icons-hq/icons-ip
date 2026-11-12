import { trackingErrorCode, type TrackingAdapter, type TrackingPollResult, type TrackingTarget } from './types';
import type { TrackingAdapterChoice, TrackingAdapterUnavailable } from './adapter.server';

/**
 * 택배 추적 cron 한 회차(QNA-028). 순서: DB가 고른 조회 대상 → 어댑터 조회 → 이벤트 기록 → DB가 배송완료 판정.
 * 스위치가 꺼져 있으면 DB가 대상을 고르지 않으므로 어댑터를 만들지도, 외부를 부르지도 않는다(화면·동작 불변).
 * 이 함수는 상태를 바꾸지 않는다 — 배송완료 전이는 `service_complete_tracked_deliveries`만 한다.
 */
export interface DeliveryTrackingRepository {
  targets(limit: number): Promise<{ enabled: false } | { enabled: true; provider: string; targets: TrackingTarget[] }>;
  record(provider: string, results: TrackingPollResult[]): Promise<{ recorded: number; duplicates: number; ignored: number }>;
  complete(limit: number): Promise<{ enabled: boolean; completed: number; held: number }>;
}

export interface DeliveryTrackingTickResult {
  enabled: boolean;
  /** 켜져 있는데 이 서버의 어댑터를 만들지 못한 이유. 이미 받은 이벤트의 배송완료 판정은 그대로 한다. */
  unavailable?: TrackingAdapterUnavailable;
  polled: number;
  failed: number;
  recorded: number;
  duplicates: number;
  ignored: number;
  completed: number;
  held: number;
}

export interface DeliveryTrackingTickOptions {
  repository: DeliveryTrackingRepository;
  adapterFor: (provider: string) => TrackingAdapterChoice;
  /** 한 회차에 조회할 운송장 수(외부 호출 상한). */
  targetLimit?: number;
  /** 한 회차에 배송완료로 판정할 배송 건 수. */
  completeLimit?: number;
  concurrency?: number;
  lookupTimeoutMs?: number;
  /** 조회를 새로 시작하지 않는 시점(cron maxDuration 안에 기록·판정까지 끝내게). */
  budgetMs?: number;
  now?: () => number;
}

const EMPTY = { polled: 0, failed: 0, recorded: 0, duplicates: 0, ignored: 0, completed: 0, held: 0 };

async function lookupWithTimeout(adapter: TrackingAdapter, target: TrackingTarget, timeoutMs: number): Promise<TrackingPollResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await adapter.lookup(target, controller.signal);
    if (result.outcome === 'ok') return { ...target, outcome: 'ok', events: result.events };
    if (result.outcome === 'not_found') return { ...target, outcome: 'not_found' };
    return { ...target, outcome: 'error', errorCode: trackingErrorCode(result.errorCode) };
  } catch {
    return { ...target, outcome: 'error', errorCode: controller.signal.aborted ? 'lookup_timeout' : 'lookup_failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function runDeliveryTrackingTick(options: DeliveryTrackingTickOptions): Promise<DeliveryTrackingTickResult> {
  const { repository, adapterFor, targetLimit = 40, completeLimit = 100, concurrency = 4, lookupTimeoutMs = 6000, budgetMs = 35_000, now = Date.now } = options;
  const started = now();
  const selection = await repository.targets(targetLimit);
  if (!selection.enabled) return { enabled: false, ...EMPTY };

  const choice = adapterFor(selection.provider);
  const results: TrackingPollResult[] = [];
  if (choice.configured) {
    const queue = [...selection.targets];
    const worker = async () => {
      for (let target = queue.shift(); target; target = queue.shift()) {
        if (now() - started > budgetMs) return;
        results.push(await lookupWithTimeout(choice.adapter, target, lookupTimeoutMs));
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  }
  const recorded = results.length ? await repository.record(selection.provider, results) : { recorded: 0, duplicates: 0, ignored: 0 };
  const completion = await repository.complete(completeLimit);
  return {
    enabled: true, ...(choice.configured ? {} : { unavailable: choice.reason }),
    polled: results.length, failed: results.filter(result => result.outcome === 'error').length,
    ...recorded, completed: completion.completed, held: completion.held,
  };
}

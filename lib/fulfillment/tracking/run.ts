import { normalizeTrackingEvents, trackingErrorCode, type TrackingAdapter, type TrackingPollResult, type TrackingTarget } from './types';
import type { TrackingAdapterChoice, TrackingAdapterUnavailable } from './adapter.server';

/**
 * 택배 추적 cron 한 회차(QNA-028). 순서: DB가 고른 조회 대상 → 어댑터 조회 → 이벤트 기록 → DB가 배송완료 판정.
 * 스위치가 꺼져 있으면 DB가 대상을 고르지 않으므로 어댑터를 만들지도, 외부를 부르지도 않는다(화면·동작 불변).
 * 단계는 서로를 막지 않는다: 대상 고르기나 기록이 실패해도 이미 받은 이벤트의 배송완료 판정은 한다(판정은 DB가 스위치를 다시 본다).
 * 실패한 단계는 개인정보 없는 단계 이름(`failedStages`)으로만 남긴다. 이 함수는 상태를 바꾸지 않는다 — 배송완료 전이는
 * `service_complete_tracked_deliveries`만 한다.
 */
export interface DeliveryTrackingRepository {
  targets(limit: number): Promise<{ enabled: false } | { enabled: true; provider: string; targets: TrackingTarget[] }>;
  record(provider: string, results: TrackingPollResult[]): Promise<{ recorded: number; duplicates: number; ignored: number; invalid: number }>;
  complete(limit: number): Promise<{ enabled: boolean; completed: number; held: number; skipped: number }>;
}

/** 실패한 단계. 응답에 그대로 싣는다(운송장번호·오류 본문은 싣지 않는다). */
export type DeliveryTrackingStage = 'targets' | 'record' | 'complete';

export interface DeliveryTrackingTickResult {
  /** DB 스위치. 대상 고르기와 판정이 모두 실패해 읽지 못했으면 null이다. */
  enabled: boolean | null;
  /** 켜져 있는데 이 서버의 어댑터를 만들지 못한 이유. 이미 받은 이벤트의 배송완료 판정은 그대로 한다. */
  unavailable?: TrackingAdapterUnavailable;
  /** 실패한 단계(있을 때만). */
  failedStages?: DeliveryTrackingStage[];
  polled: number;
  failed: number;
  recorded: number;
  duplicates: number;
  ignored: number;
  /** DB가 형식이 틀렸다고 본 운송장 결과 수(그 운송장만 조회 오류로 남고 나머지는 기록된다). */
  invalid: number;
  completed: number;
  held: number;
  /** 다른 처리(운영자 일괄 처리 등)가 잠금을 쥐고 있어 다음 회차로 넘긴 묶음 수. */
  skipped: number;
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

const EMPTY = { polled: 0, failed: 0, recorded: 0, duplicates: 0, ignored: 0, invalid: 0, completed: 0, held: 0, skipped: 0 };

async function lookupWithTimeout(adapter: TrackingAdapter, target: TrackingTarget, timeoutMs: number): Promise<TrackingPollResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await adapter.lookup(target, controller.signal);
    // 어댑터마다 다시 다듬는다: 형식이 틀리거나 하루 넘게 미래인 이벤트는 그 이벤트만 빠지고 같은 운송장의 나머지는 남는다.
    if (result.outcome === 'ok') return { ...target, outcome: 'ok', events: normalizeTrackingEvents(result.events) };
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
  const failedStages: DeliveryTrackingStage[] = [];
  let selection: Awaited<ReturnType<DeliveryTrackingRepository['targets']>> | null = null;
  try {
    selection = await repository.targets(targetLimit);
  } catch {
    failedStages.push('targets');
  }
  if (selection && !selection.enabled) return { enabled: false, ...EMPTY };

  let unavailable: TrackingAdapterUnavailable | undefined;
  const results: TrackingPollResult[] = [];
  if (selection) {
    const choice = adapterFor(selection.provider);
    if (choice.configured) {
      const queue = [...selection.targets];
      const worker = async () => {
        for (let target = queue.shift(); target; target = queue.shift()) {
          if (now() - started > budgetMs) return;
          results.push(await lookupWithTimeout(choice.adapter, target, lookupTimeoutMs));
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
    } else {
      unavailable = choice.reason;
    }
  }
  let recorded = { recorded: 0, duplicates: 0, ignored: 0, invalid: 0 };
  if (selection && results.length) {
    try {
      recorded = await repository.record(selection.provider, results);
    } catch {
      failedStages.push('record');
    }
  }
  let completion: Awaited<ReturnType<DeliveryTrackingRepository['complete']>> | null = null;
  try {
    completion = await repository.complete(completeLimit);
  } catch {
    failedStages.push('complete');
  }
  return {
    enabled: completion ? completion.enabled : selection ? true : null,
    ...(unavailable ? { unavailable } : {}),
    ...(failedStages.length ? { failedStages } : {}),
    polled: results.length, failed: results.filter(result => result.outcome === 'error').length,
    ...recorded,
    completed: completion?.completed ?? 0, held: completion?.held ?? 0, skipped: completion?.skipped ?? 0,
  };
}

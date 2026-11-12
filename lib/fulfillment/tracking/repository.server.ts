import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { DeliveryTrackingRepository } from './run';
import type { TrackingTarget } from './types';

/**
 * 추적 cron의 DB 경계(service_role 전용 RPC 세 개). 오류이거나 응답 모양이 틀리면 던진다 — 회차는 그 단계만 실패로 남기고
 * 다음 단계(판정)를 계속하며, 응답 본문에는 단계 이름만 싣는다(운송장번호·이벤트·오류 본문은 싣지 않는다).
 */
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function parseTargets(value: unknown): TrackingTarget[] | null {
  if (!Array.isArray(value)) return null;
  const targets = value.flatMap(entry => record(entry) && typeof entry.carrier === 'string' && typeof entry.trackingNumber === 'string'
    ? [{ carrier: entry.carrier, trackingNumber: entry.trackingNumber }] : []);
  return targets.length === value.length ? targets : null;
}

export function deliveryTrackingRepository(): DeliveryTrackingRepository {
  const service = createServiceClient();
  return {
    async targets(limit) {
      const { data, error } = await service.rpc('service_delivery_tracking_targets', { p_limit: limit });
      if (error || !record(data) || typeof data.enabled !== 'boolean') throw new Error('delivery_tracking_targets_failed');
      if (!data.enabled) return { enabled: false };
      const targets = parseTargets(data.targets);
      if (typeof data.provider !== 'string' || !targets) throw new Error('delivery_tracking_targets_failed');
      return { enabled: true, provider: data.provider, targets };
    },
    async record(provider, results) {
      const { data, error } = await service.rpc('service_record_delivery_tracking', { p_provider: provider, p_results: results });
      if (error || !record(data) || !count(data.recorded) || !count(data.duplicates) || !count(data.ignored) || !count(data.invalid)) {
        throw new Error('delivery_tracking_record_failed');
      }
      return { recorded: data.recorded, duplicates: data.duplicates, ignored: data.ignored, invalid: data.invalid };
    },
    async complete(limit) {
      const { data, error } = await service.rpc('service_complete_tracked_deliveries', { p_limit: limit });
      if (error || !record(data) || typeof data.enabled !== 'boolean') throw new Error('delivery_tracking_complete_failed');
      if (!data.enabled) return { enabled: false, completed: 0, held: 0, skipped: 0 };
      if (!Array.isArray(data.completed) || !Array.isArray(data.held) || !count(data.skipped)) throw new Error('delivery_tracking_complete_failed');
      return { enabled: true, completed: data.completed.length, held: data.held.length, skipped: data.skipped };
    },
  };
}

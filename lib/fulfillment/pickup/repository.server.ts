import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { ReturnPickupRepository } from './run';

/**
 * 회수 접수 크론의 DB 경계(service_role 전용 RPC 두 개). 오류이거나 응답 모양이 틀리면 던진다 — 회차는 그 단계 이름만 남긴다
 * (회수지 개인정보·회수 송장·오류 본문은 싣지 않는다).
 */
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const COUNT_KEYS = ['recorded', 'requested', 'failed', 'canceled', 'cancelFailed', 'stale', 'invalid'] as const;

export function returnPickupRepository(): ReturnPickupRepository {
  const service = createServiceClient();
  return {
    async work(limit) {
      const { data, error } = await service.rpc('service_return_pickup_work', { p_limit: limit });
      if (error || !record(data) || typeof data.enabled !== 'boolean') throw new Error('return_pickup_work_failed');
      if (!data.enabled) return { enabled: false };
      if (!Array.isArray(data.items)) throw new Error('return_pickup_work_failed');
      return { enabled: true, items: data.items };
    },
    async record(results) {
      const { data, error } = await service.rpc('service_record_return_pickup_results', { p_results: results });
      if (error || !record(data) || !COUNT_KEYS.every(key => count(data[key]))) throw new Error('return_pickup_record_failed');
      return { recorded: Number(data.recorded), requested: Number(data.requested), failed: Number(data.failed), canceled: Number(data.canceled),
        cancelFailed: Number(data.cancelFailed), stale: Number(data.stale), invalid: Number(data.invalid) };
    },
  };
}

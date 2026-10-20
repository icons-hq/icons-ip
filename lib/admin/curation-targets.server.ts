import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminCurationTargetSource, AdminCurationTargetRecord } from './curation-targets';

function targetRecords(value: unknown): AdminCurationTargetRecord[] | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  for (const record of value) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id || ids.has(record.id)
      || typeof record.title !== 'string' || (record.publicSlug !== undefined && typeof record.publicSlug !== 'string')
      || (record.archivedAt !== null && (typeof record.archivedAt !== 'string' || !Number.isFinite(Date.parse(record.archivedAt))))) return null;
    ids.add(record.id);
  }
  return value.map(record => ({ id: record.id, title: record.title, archivedAt: record.archivedAt,
    ...(record.publicSlug !== undefined ? { publicSlug: record.publicSlug } : {}) }));
}

export async function loadAdminCurationTargets(): Promise<AdminCurationTargetSource> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_curation_target_options');
  const ips = targetRecords(data?.ips), goods = targetRecords(data?.goods), events = targetRecords(data?.events);
  if (error || !ips || !goods || !events) throw new Error('전시 대상 목록을 불러오지 못했습니다. 다시 조회해주세요.');
  return { ips, goods, events };
}

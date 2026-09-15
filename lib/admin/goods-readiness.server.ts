import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { GOODS_READINESS_REASONS, unknownGoodsReadiness, type AdminGoodsReadiness, type GoodsReadinessReasonCode } from './goods-readiness';

export function parseGoodsReadiness(value: unknown): AdminGoodsReadiness {
  if (!value || typeof value !== 'object') return unknownGoodsReadiness();
  const row = value as Record<string, unknown>;
  const codes = row.reasonCodes;
  const blockers = row.blockingCodes;
  if (!['ready', 'blocked', 'review_required', 'unknown'].includes(String(row.state))
    || !['draft', 'published', 'archived'].includes(String(row.publication))
    || !['active', 'stopped'].includes(String(row.operation))
    || !['current', 'required', 'legacy_unrecorded', 'unknown'].includes(String(row.publicReview))
    || !['ready', 'blocked', 'unknown'].includes(String(row.saleSettings))
    || typeof row.checkedAt !== 'string' || Number.isNaN(Date.parse(row.checkedAt))
    || (row.availableQty !== null && (!Number.isSafeInteger(row.availableQty) || Number(row.availableQty) < 0))
    || typeof row.reviewRequired !== 'boolean'
    || !Array.isArray(codes) || !codes.every(code => typeof code === 'string' && Object.hasOwn(GOODS_READINESS_REASONS, code))
    || !Array.isArray(blockers) || !blockers.every(code => codes.includes(code))) return unknownGoodsReadiness();
  return {
    state: row.state as AdminGoodsReadiness['state'], checkedAt: row.checkedAt,
    publication: row.publication as AdminGoodsReadiness['publication'], operation: row.operation as AdminGoodsReadiness['operation'],
    availableQty: row.availableQty as number | null, publicReview: row.publicReview as AdminGoodsReadiness['publicReview'],
    saleSettings: row.saleSettings as AdminGoodsReadiness['saleSettings'], reviewRequired: row.reviewRequired,
    reasons: codes.map((code: GoodsReadinessReasonCode) => ({ code, ...GOODS_READINESS_REASONS[code], kind: blockers.includes(code) ? 'blocking' : 'review' })),
  };
}

export async function loadAdminGoodsReadiness(goodId: string): Promise<AdminGoodsReadiness> {
  try {
    const client = await createClient();
    const result = await client.rpc('admin_read_goods_readiness', { p_good_id: goodId });
    return result.error ? unknownGoodsReadiness() : parseGoodsReadiness(result.data);
  } catch { return unknownGoodsReadiness(); }
}

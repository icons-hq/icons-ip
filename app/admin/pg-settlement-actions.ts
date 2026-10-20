'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { PG_SETTLEMENT_PATH } from '@/lib/settlements/console';
import { pgSettlementWorker, type PgSettlementActionResult } from '@/lib/settlements/worker.server';
import type { SettlementMode, SettlementQuery } from '@/lib/settlements/types';
import { isUuid } from '@/lib/uuid';

const forbidden = (): PgSettlementActionResult => ({ ok: false, error: '현재 정산 관리 권한을 확인해주세요.' });
const uncertain = (): PgSettlementActionResult => ({ ok: false, uncertain: true, error: '처리 결과를 확인하지 못했습니다. 같은 요청의 현재 상태를 다시 확인해주세요.' });
export async function startPgSettlementImportAction(operationId: string, query: SettlementQuery & { mode: SettlementMode; account?: string | null }): Promise<PgSettlementActionResult> {
  try {
    const auth = await requireAdminActionAccess(PG_SETTLEMENT_PATH, { capability: 'sales.manage', adminOnly: true });
    if (!auth) return forbidden();
    return await (await pgSettlementWorker()).start(auth.user.id, operationId, query);
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function advancePgSettlementImportAction(importId: string): Promise<PgSettlementActionResult> {
  try {
    const auth = await requireAdminActionAccess(PG_SETTLEMENT_PATH, { capability: 'sales.manage', adminOnly: true });
    if (!auth) return forbidden();
    return await (await pgSettlementWorker()).advance(auth.user.id, importId);
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function readPgSettlementImportAction(importId: string): Promise<PgSettlementActionResult> {
  try {
    if (!await requireAdminActionAccess(PG_SETTLEMENT_PATH, { capability: 'sales.manage', adminOnly: true })) return forbidden();
    if (!isUuid(importId)) return { ok: false, error: '수집 작업을 확인해주세요.' };
    const job = await (await pgSettlementWorker()).read(importId);
    if (!job) return uncertain();
    return { ok: true, kind: job.state === 'complete' ? 'complete' : job.state === 'failed' ? 'failed' : 'paused', job };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}

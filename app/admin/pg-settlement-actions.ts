'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { PG_SETTLEMENT_PATH } from '@/lib/settlements/console';
import { pgSettlementWorker, type PgSettlementActionResult } from '@/lib/settlements/worker.server';
import type { SettlementMode, SettlementQuery } from '@/lib/settlements/types';
import { isUuid } from '@/lib/uuid';

const forbidden = (): PgSettlementActionResult => ({ ok: false, error: '정산 관리 권한이 없거나 로그인이 끝났습니다. 로그인 계정을 확인해주세요.' });
const uncertain = (): PgSettlementActionResult => ({ ok: false, uncertain: true, error: '가져왔는지 확인하지 못했습니다. [가져왔는지 확인]을 누르면 같은 자료를 두 번 가져오지 않습니다.' });
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
    if (!isUuid(importId)) return { ok: false, error: '가져오던 자료를 찾지 못했습니다. 화면을 새로고침한 뒤 다시 해주세요.' };
    const job = await (await pgSettlementWorker()).read(importId);
    if (!job) return uncertain();
    return { ok: true, kind: job.state === 'complete' ? 'complete' : job.state === 'failed' ? 'failed' : 'paused', job };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}

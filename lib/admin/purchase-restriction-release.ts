import { isUuid } from '@/lib/uuid';

export interface PurchaseRestrictionReleaseReceipt {
  id: string;
  reason: string;
  completedAt: string;
  rows: { id: string; userId: string | null; outcome: 'released' | 'already_released' | 'not_found'; releasedAt: string | null; customerRestricted: boolean | null }[];
}
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export function normalizeRestrictionRelease(id: unknown, ids: unknown, reason: unknown): { error: string } | { value: { id: string; ids: string[]; reason: string } } {
  if (!isUuid(id) || !Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every(isUuid)
    || new Set(ids.map(value => value.toLowerCase())).size !== ids.length) return { error: '해제할 구매제한 기록을 1~100개 선택해주세요.' } as const;
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(reason)) return { error: '해제 사유를 줄바꿈 없이 1~200자로 입력해주세요.' } as const;
  return { value: { id: id.toLowerCase(), ids: ids.map(value => value.toLowerCase()).sort(), reason: reason.trim() } } as const;
}
export function parseRestrictionReleaseReceipt(value: unknown): PurchaseRestrictionReleaseReceipt | null {
  if (!record(value) || !isUuid(value.id) || typeof value.reason !== 'string' || !value.reason || value.reason.length > 200
    || !date(value.completedAt) || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 100) return null;
  const ids = new Set<string>();
  for (const row of value.rows) {
    if (!record(row) || !isUuid(row.id) || ids.has(row.id) || !['released', 'already_released', 'not_found'].includes(String(row.outcome))) return null;
    ids.add(row.id);
    if (row.outcome === 'not_found') {
      if (row.userId !== null || row.releasedAt !== null || row.customerRestricted !== null) return null;
    } else if (!isUuid(row.userId) || !date(row.releasedAt) || typeof row.customerRestricted !== 'boolean') return null;
  }
  return value as unknown as PurchaseRestrictionReleaseReceipt;
}
export function restrictionReleaseError(code: string | undefined) {
  if (code === '42501') return '현재 매니저 권한으로 구매제한을 해제할 수 없습니다.';
  if (code === 'PT409' || code === '23505') return '앞서 보낸 해제 요청과 대상이나 사유가 달라 처리하지 않았습니다. 화면을 새로고침해 앞 요청의 결과를 확인한 뒤 다시 선택해주세요.';
  if (code === '22023') return '해제하지 않았습니다. 기록을 1~100개 고르고 해제 사유를 줄바꿈 없이 1~200자로 적어주세요.';
  return '해제됐는지 확인하지 못했습니다. ‘같은 요청 결과 조회’를 눌러 결과를 확인해주세요. 다시 조회해도 두 번 해제되지 않습니다.';
}

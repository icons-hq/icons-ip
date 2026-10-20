import { parseHomeLayoutBlocks, type HomeLayoutBlock } from '@/lib/home-layout';

export interface AdminHomeLayout { blocks: HomeLayoutBlock[] | null; revision: number; updatedAt: string }
export interface AdminHomeLayoutActionState { errors?: { form: string }; message?: string; conflict?: boolean }

export function normalizeAdminHomeLayoutForm(formData: FormData):
  | { ok: true; value: { operationId: string; expectedRevision: number; blocks: HomeLayoutBlock[] } }
  | { ok: false; errors: { form: string } } {
  const fail = (form: string) => ({ ok: false as const, errors: { form } });
  const operationId = formData.get('operationId');
  const rawRevision = formData.get('expectedRevision');
  if (typeof operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) return fail('유효한 저장 요청이 아닙니다.');
  if (typeof rawRevision !== 'string' || !/^\d+$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision))) return fail('저장 기준을 확인할 수 없습니다. 화면을 다시 불러와주세요.');
  let rawBlocks: unknown;
  try { rawBlocks = JSON.parse(String(formData.get('blocks'))); } catch { return fail('영역 순서를 다시 확인해주세요.'); }
  const blocks = parseHomeLayoutBlocks(rawBlocks);
  if (!blocks) return fail('영역 순서를 다시 확인해주세요.');
  return { ok: true, value: { operationId: operationId.toLowerCase(), expectedRevision: Number(rawRevision), blocks } };
}

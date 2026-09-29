/** Synthetic in-memory KC boundary. Never sends Auth, database or storage requests. */
import { parseGoodsKcSaveInput, type AdminGoodsKc } from '../../lib/admin/goods-kc';
import type { GoodsNoticePresetActionState } from '../../app/admin/goods-notice-preset-actions';

export const fixtureKcVariant = { id: '00000000-0000-4000-8000-000000050911', code: 'FIXTURE-OPTION', name: '합성 기본 옵션', active: true };
const records = new Map<string, AdminGoodsKc>();
function configuration(id: string): AdminGoodsKc {
  return records.get(id) ?? { revision: null, status: 'unreviewed', models: [], contextFingerprint: 'a'.repeat(64),
    publishedAt: null, archivedAt: null, reviewedAt: null, reviewerName: null, variants: [fixtureKcVariant], history: [] };
}
export async function readGoodsKcAction(id: string) {
  return { ok: true as const, configuration: configuration(id) };
}
export async function saveGoodsKcAction(id: string, raw: unknown) {
  await new Promise(resolve => setTimeout(resolve, 1500));
  const input = parseGoodsKcSaveInput(raw);
  if (!input || input.status !== 'unreviewed') return { ok: false as const, error: '합성 fixture에서는 미검토 저장만 가능합니다.' };
  const saved = { ...configuration(id), models: input.models, revision: (configuration(id).revision ?? 0) + 1 };
  records.set(id, saved);
  return { ok: true as const, configuration: saved, message: '합성 KC 미검토 저장 완료' };
}
export async function saveGoodsNoticePresetAction(previous: GoodsNoticePresetActionState, form: FormData): Promise<GoodsNoticePresetActionState> {
  const values = Object.fromEntries([...form.entries()].filter((row): row is [string, string] => typeof row[1] === 'string'));
  return { attempt: (previous.attempt ?? 0) + 1, values, errors: { form: '합성 저장 충돌 · 입력 보존 확인' } };
}
export async function deleteGoodsNoticePresetAction(): Promise<GoodsNoticePresetActionState> {
  return { errors: { form: '합성 fixture에서는 삭제하지 않습니다.' } };
}

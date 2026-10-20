import { normalizeAdminCurationForm, type AdminCurationActionState } from '../../lib/admin/curations';
import { normalizeAdminHomeLayoutForm, type AdminHomeLayoutActionState } from '../../lib/admin/home-layout';

/** Fail closed: exercise the real form contract without a database or Storage write. */
export async function upsertAdminCurationAction(_previous: AdminCurationActionState, formData: FormData): Promise<AdminCurationActionState> {
  const submitted = Object.fromEntries([...formData.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  window.dispatchEvent(new CustomEvent('store-fixture-submission', { detail: submitted }));
  const normalized = normalizeAdminCurationForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };
  return { errors: { form: '합성 저장 실패 — 외부 저장은 실행하지 않았습니다. 입력값 보존을 확인하세요.' } };
}

export async function saveAdminHomeLayoutAction(_previous: AdminHomeLayoutActionState, formData: FormData): Promise<AdminHomeLayoutActionState> {
  const parsed = normalizeAdminHomeLayoutForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const saved = { blocks: parsed.value.blocks, revision: parsed.value.expectedRevision + 1, updatedAt: new Date().toISOString() };
  localStorage.setItem('icons-fixture-home-layout', JSON.stringify(saved));
  window.dispatchEvent(new CustomEvent('store-fixture-layout-saved', { detail: saved }));
  return { message: '합성 홈 영역 순서를 저장했습니다. 외부 저장은 실행하지 않았습니다.' };
}

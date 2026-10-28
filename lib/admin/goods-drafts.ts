import { GOOD_LOCAL_DRAFT_FIELDS } from './good-editor';

export const GOODS_DRAFT_PATH = '/admin/catalog/goods?create=1';
export const GOODS_DRAFT_LIMIT = 40;
/** DB admin_goods_drafts.form_values 상한과 같다. 상세 HTML 상한(200,000자, 한글 약 600KB)을 담을 수 있게 2MB(R17). */
export const GOODS_DRAFT_MAX_BYTES = 2 * 1024 * 1024;
export const GOODS_DRAFT_META_FIELDS = ['serverDraftId', 'serverDraftRevision'] as const;
const allowed = new Set(GOOD_LOCAL_DRAFT_FIELDS.filter(name => !(GOODS_DRAFT_META_FIELDS as readonly string[]).includes(name)));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const image = /^public-media\/catalog\/good\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
export interface GoodsDraftSummary { id: string; name: string; imagePath: string | null; revision: number; updatedAt: string; archived: boolean; completedGoodId: string | null }
export interface GoodsDraft extends GoodsDraftSummary { values: Record<string, string> }
export interface GoodsDraftPage { rows: GoodsDraftSummary[]; total: number; page: number; pageSize: 20 }
export interface GoodsDraftIdentity { id: string; revision: number }

export function validGoodsDraftIdentity(value: unknown, allowNew = false): value is GoodsDraftIdentity {
  if (!value || typeof value !== 'object') return false;
  const data = value as GoodsDraftIdentity;
  return typeof data.id === 'string' && uuid.test(data.id) && Number.isSafeInteger(data.revision) && data.revision >= (allowNew ? 0 : 1);
}
export function goodsDraftIdentity(form: FormData): GoodsDraftIdentity | null | 'invalid' {
  const id = String(form.get('serverDraftId') ?? '');
  const revision = String(form.get('serverDraftRevision') ?? '');
  if (!id && !revision) return null;
  const value = { id, revision: Number(revision) };
  return validGoodsDraftIdentity(value) ? value : 'invalid';
}
export function collectGoodsDraftValues(entries: Iterable<readonly [string, unknown]>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (allowed.has(name) && typeof value === 'string' && !Object.hasOwn(values, name)) values[name] = value;
  }
  return values;
}
export function validateGoodsDraftValues(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const values = value as Record<string, unknown>;
  if (typeof values.name !== 'string' || !values.name.trim() || values.name.trim().length > 100
    || new TextEncoder().encode(JSON.stringify(values)).length > GOODS_DRAFT_MAX_BYTES) return false;
  if (Object.entries(values).some(([key, item]) => !allowed.has(key) || typeof item !== 'string' || /^(?:\s*)(?:blob:|data:)/i.test(item))) return false;
  if ((values.variantBaseline ?? '[]') !== '[]' || (values.customInputsExpectedRevision ?? '0') !== '0') return false;
  return Object.entries(values).every(([key, item]) => !['imagePath','detailImagePath','descriptionUploadPath'].includes(key) && !key.startsWith('galleryPath') || !item || image.test(String(item)));
}
export function parseGoodsDraftSummary(value: unknown): GoodsDraftSummary | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as GoodsDraftSummary;
  if (!validGoodsDraftIdentity(d) || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 100
    || d.imagePath !== null && (typeof d.imagePath !== 'string' || !image.test(d.imagePath))
    || typeof d.updatedAt !== 'string' || !Number.isFinite(Date.parse(d.updatedAt)) || typeof d.archived !== 'boolean'
    || d.completedGoodId !== null && (typeof d.completedGoodId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(d.completedGoodId))) return null;
  return d;
}
export function parseGoodsDraft(value: unknown): GoodsDraft | null {
  const summary = parseGoodsDraftSummary(value);
  return summary && validateGoodsDraftValues((value as GoodsDraft).values) ? value as GoodsDraft : null;
}
export function parseGoodsDraftPage(value: unknown): GoodsDraftPage | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as GoodsDraftPage;
  if (!Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.page) || data.page < 1 || data.pageSize !== 20
    || !Array.isArray(data.rows) || data.rows.length > 20 || data.rows.some(row => !parseGoodsDraftSummary(row))) return null;
  return data;
}
export function goodsDraftError(message?: string): string {
  if (message?.includes('goods_draft_limit')) return '임시저장은 최대 40건입니다. 사용하지 않는 항목을 삭제한 뒤 저장해주세요.';
  if (message?.includes('goods_draft_completed')) return '이미 상품으로 등록한 임시저장입니다. 상품 목록에서 확인해주세요.';
  if (message?.includes('goods_draft_changed')) return '다른 창에서 임시저장이 변경되었습니다. 현재 입력은 유지됩니다. 최신 내용을 불러오거나 새 임시저장으로 저장해주세요.';
  if (message?.includes('goods_draft_not_found')) return '임시저장을 찾을 수 없습니다. 목록을 다시 조회해주세요.';
  if (message?.includes('unverified_artwork')) return '이미지 업로드가 완료되지 않았거나 사용할 수 없습니다. 해당 이미지를 다시 확인해주세요. 입력은 유지됩니다.';
  return '임시저장 처리 결과를 확인하지 못했습니다. 목록에서 저장 여부를 확인해주세요. 입력은 유지됩니다.';
}

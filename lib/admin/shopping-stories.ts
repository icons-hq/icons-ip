import { isUuid } from '@/lib/uuid';
import { sanitizeShoppingStoryContent } from '@/lib/shopping-stories-content';
import { SHOPPING_STORY_BODY_MAX, SHOPPING_STORY_GOODS_MAX, SHOPPING_STORY_SECTION_GOODS_MAX,
  SHOPPING_STORY_SECTION_MAX, SHOPPING_STORY_SECTION_TITLE_MAX, SHOPPING_STORY_TITLE_MAX, storyCharacterLength,
  type PublicShoppingStoryGood, type ShoppingStoryInput, type ShoppingStorySectionInput, type ShoppingStoryState } from '@/lib/shopping-stories';

export const ADMIN_SHOPPING_STORIES_PATH = '/admin/display/stories';
export const SHOPPING_STORY_STATE_LABELS: Record<ShoppingStoryState, string> = { scheduled: '전시대기', active: '전시중', ended: '전시중지' };
export const SHOPPING_STORY_SORTS = { created_desc: '등록일 최신순', created_asc: '등록일 오래된순', updated_desc: '수정일 최신순' } as const;
export type ShoppingStorySort = keyof typeof SHOPPING_STORY_SORTS;
export interface ShoppingStoryFilters {
  query: string; state: ShoppingStoryState | 'all'; from: string; to: string; page: number; pageSize: 20 | 50 | 100; sort: ShoppingStorySort;
}
export interface AdminShoppingStoryRow {
  id: string; reference: number; title: string; startsAt: string | null; endsAt: string | null;
  state: ShoppingStoryState; revision: number; createdAt: string; updatedAt: string; sectionCount: number; goodCount: number;
}
export interface ShoppingStoryGoodOption extends PublicShoppingStoryGood {
  code: string; imageUrl: string | null; archived: boolean; published: boolean;
}
export interface AdminShoppingStory extends AdminShoppingStoryRow, ShoppingStoryInput {
  goods: ShoppingStoryGoodOption[];
}
export interface AdminShoppingStoryList { rows: AdminShoppingStoryRow[]; total: number; filters: ShoppingStoryFilters; checkedAt: string }
export interface ShoppingStoryGoodCandidates { rows: ShoppingStoryGoodOption[]; total: number; page: number; pageSize: number }
export type ShoppingStoryEditorInput = Omit<ShoppingStoryInput, 'imagePaths'>;
export interface ShoppingStorySaveRequest { id: string; expectedRevision: number; operationId: string; values: ShoppingStoryEditorInput }

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown) => value === null || (typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && storyKstToIso(value.slice(0, 16)) !== null && Number.isFinite(Date.parse(value)));
const ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
function exactKeys(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)); }

export function normalizeShoppingStoryInput(raw: unknown): { ok: true; value: ShoppingStoryInput; warnings: string[] } | { ok: false; error: string } {
  if (!record(raw) || !exactKeys(raw, ['title', 'bodyHtml', 'startsAt', 'endsAt', 'sections'])) return { ok: false, error: '스토리 입력을 다시 확인해주세요.' };
  if (typeof raw.title !== 'string' || !raw.title.trim() || storyCharacterLength(raw.title.trim()) > SHOPPING_STORY_TITLE_MAX) return { ok: false, error: '제목을 1~50자로 입력해주세요.' };
  if (typeof raw.bodyHtml !== 'string' || storyCharacterLength(raw.bodyHtml) > SHOPPING_STORY_BODY_MAX) return { ok: false, error: '본문은 최대 30,000자까지 입력할 수 있습니다.' };
  const content = sanitizeShoppingStoryContent(raw.bodyHtml.trim());
  if (!content.text && !content.imagePaths.length) return { ok: false, error: '본문에 텍스트 또는 업로드한 이미지를 넣어주세요.' };
  if (storyCharacterLength(content.html) > SHOPPING_STORY_BODY_MAX) return { ok: false, error: '정리된 본문이 30,000자를 넘습니다. 내용을 줄여주세요.' };
  if (!instant(raw.startsAt) || !instant(raw.endsAt) || (raw.startsAt !== null && raw.endsAt !== null && Date.parse(String(raw.startsAt)) >= Date.parse(String(raw.endsAt)))) return { ok: false, error: '전시 종료 시각은 시작 시각보다 뒤여야 합니다.' };
  if (!Array.isArray(raw.sections) || raw.sections.length > SHOPPING_STORY_SECTION_MAX) return { ok: false, error: '관련상품 섹션은 최대 10개까지 만들 수 있습니다.' };
  const sectionIds = new Set<string>(), goodIds = new Set<string>();
  const sections: ShoppingStorySectionInput[] = [];
  for (const entry of raw.sections) {
    if (!record(entry) || !exactKeys(entry, ['id', 'title', 'imageShape', 'goodIds']) || !isUuid(entry.id) || sectionIds.has(entry.id.toLowerCase())) return { ok: false, error: '관련상품 섹션을 다시 확인해주세요.' };
    if (typeof entry.title !== 'string' || !entry.title.trim() || storyCharacterLength(entry.title.trim()) > SHOPPING_STORY_SECTION_TITLE_MAX) return { ok: false, error: '섹션 제목을 1~13자로 입력해주세요.' };
    if (!['square', 'portrait'].includes(String(entry.imageShape)) || !Array.isArray(entry.goodIds) || !entry.goodIds.length || entry.goodIds.length > SHOPPING_STORY_SECTION_GOODS_MAX) return { ok: false, error: '각 섹션에 상품을 1~200개 선택해주세요.' };
    sectionIds.add(entry.id.toLowerCase());
    for (const goodId of entry.goodIds) {
      if (typeof goodId !== 'string' || !ID.test(goodId)) return { ok: false, error: '선택 상품을 다시 확인해주세요.' };
      if (goodIds.has(goodId)) return { ok: false, error: '같은 상품은 한 스토리에서 한 번만 선택할 수 있습니다.' };
      goodIds.add(goodId);
    }
    sections.push({ id: entry.id.toLowerCase(), title: entry.title.trim(), imageShape: entry.imageShape as ShoppingStorySectionInput['imageShape'], goodIds: entry.goodIds as string[] });
  }
  if (goodIds.size > SHOPPING_STORY_GOODS_MAX) return { ok: false, error: '한 스토리에 상품을 최대 300개까지 선택할 수 있습니다.' };
  return { ok: true, value: { title: raw.title.trim(), bodyHtml: content.html, imagePaths: content.imagePaths,
    startsAt: raw.startsAt === null ? null : new Date(String(raw.startsAt)).toISOString(),
    endsAt: raw.endsAt === null ? null : new Date(String(raw.endsAt)).toISOString(), sections }, warnings: content.warnings };
}

/** Round-trip calendar components: Date's silent February rollover is not a valid operator date. */
export function storyKstToIso(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return null;
  const time = Date.parse(`${raw}:00+09:00`);
  return Number.isFinite(time) && new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) === raw ? new Date(time).toISOString() : null;
}
export function storyIsoToKst(value: string | null) { return value ? new Date(Date.parse(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''; }
export function validStoryDay(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && storyKstToIso(`${value}T00:00`) !== null; }
export function storyDatePreset(months: number, now = new Date()) {
  const end = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const start = new Date(end); const originalDay = start.getUTCDate();
  start.setUTCMonth(start.getUTCMonth() - months);
  if (start.getUTCDate() !== originalDay) start.setUTCDate(0);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
export function normalizeShoppingStoryFilters(query: Record<string, string | string[] | undefined>, now = new Date()): ShoppingStoryFilters {
  const defaults = storyDatePreset(3, now);
  const from = query.from === undefined ? defaults.from : validStoryDay(query.from) ? query.from : '';
  const to = query.to === undefined ? defaults.to : validStoryDay(query.to) ? query.to : '';
  const page = typeof query.page === 'string' && /^[1-9]\d*$/.test(query.page) ? Number(query.page) : 1;
  return { query: typeof query.query === 'string' ? Array.from(query.query.trim()).slice(0, 100).join('') : '',
    state: typeof query.state === 'string' && Object.hasOwn(SHOPPING_STORY_STATE_LABELS, query.state) ? query.state as ShoppingStoryState : 'all',
    from: from && to && from > to ? to : from, to: from && to && from > to ? from : to,
    page: Number.isSafeInteger(page) && page <= 1_000_000 ? page : 1,
    pageSize: query.pageSize === '20' ? 20 : query.pageSize === '50' ? 50 : 100,
    sort: typeof query.sort === 'string' && Object.hasOwn(SHOPPING_STORY_SORTS, query.sort) ? query.sort as ShoppingStorySort : 'created_desc' };
}
export function adminShoppingStoriesHref(filters: ShoppingStoryFilters, updates: Partial<ShoppingStoryFilters> = {}) {
  const values = { ...filters, ...updates };
  const params = new URLSearchParams({ from: values.from, to: values.to, page: String(values.page), pageSize: String(values.pageSize), sort: values.sort });
  if (values.query) params.set('query', values.query);
  if (values.state !== 'all') params.set('state', values.state);
  return `${ADMIN_SHOPPING_STORIES_PATH}?${params}`;
}
export function shoppingStoryError(message: string | undefined) {
  if (message?.includes('shopping_story_conflict') || message?.includes('operation_conflict')) return '다른 매니저가 이 스토리를 변경했습니다. 입력은 유지됩니다. 최신 저장 내용을 확인한 뒤 다시 저장해주세요.';
  if (message?.includes('unverified_artwork')) return '새 이미지를 다시 업로드해주세요. 이 스토리에 저장된 이미지는 그대로 사용할 수 있습니다.';
  if (message?.includes('shopping_story_good_unavailable')) return '선택 상품이 삭제되었거나 보관되었습니다. 관련상품을 다시 확인해주세요.';
  if (message?.includes('shopping_story_not_found')) return '스토리가 삭제되었거나 더 이상 수정할 수 없습니다.';
  if (message?.includes('operator_capability_required')) return '쇼핑스토리 관리 권한이 필요합니다.';
  return '스토리를 저장하지 못했습니다. 입력을 확인하고 다시 시도해주세요.';
}

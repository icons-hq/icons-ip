import { sanitizeGoodsDescription } from '@/lib/goods-description';
import { isUuid } from '@/lib/uuid';
import { customerServiceDate } from './customer-service-list';
import { toKstDateTimeInput } from './goods-price-periods';
import { GOODS_ANNOUNCEMENT_GOOD_LIMIT } from './goods-announcement-limits';
export { GOODS_ANNOUNCEMENT_GOOD_LIMIT } from './goods-announcement-limits';

export const GOODS_ANNOUNCEMENTS_PATH = '/admin/catalog/announcements';
export const GOODS_ANNOUNCEMENT_CATEGORIES = [
  { value: 'general', label: '일반 공지' }, { value: 'event', label: '이벤트' },
  { value: 'shipping', label: '배송 지연' }, { value: 'product', label: '상품 안내' },
] as const;
export const GOODS_ANNOUNCEMENT_DEVICES = [{ value: 'all', label: 'PC·모바일' }, { value: 'pc', label: 'PC' }, { value: 'mobile', label: '모바일' }] as const;
export const GOODS_ANNOUNCEMENT_STATES = [{ value: 'waiting', label: '전시대기' }, { value: 'shown', label: '전시중' }, { value: 'stopped', label: '전시중지' }] as const;
export type GoodsAnnouncementCategory = typeof GOODS_ANNOUNCEMENT_CATEGORIES[number]['value'];
export type GoodsAnnouncementDevice = typeof GOODS_ANNOUNCEMENT_DEVICES[number]['value'];
export type GoodsAnnouncementDisplayState = typeof GOODS_ANNOUNCEMENT_STATES[number]['value'];
export interface GoodsAnnouncementGood { id: string; name: string; code: string; archived: boolean }
export interface GoodsAnnouncementPopupSelection { selected: boolean; revision: number; startsAt: string | null; endsAt: string | null }
export interface GoodsAnnouncement {
  id: string; reference: number | null; title: string; body: string; format: 'plain' | 'html'; category: GoodsAnnouncementCategory;
  device: GoodsAnnouncementDevice; enabled: boolean; important: boolean; allGoods: boolean;
  startsAt: string | null; endsAt: string | null; importantStartsAt: string | null; importantEndsAt: string | null;
  popup: GoodsAnnouncementPopupSelection;
  revision: number; createdAt: string | null; updatedAt: string | null; goods: GoodsAnnouncementGood[];
}
export interface GoodsAnnouncementListRow extends Omit<GoodsAnnouncement, 'body' | 'format' | 'goods' | 'popup' | 'importantStartsAt' | 'importantEndsAt'> { state: GoodsAnnouncementDisplayState; goodCount: number }
export interface GoodsAnnouncementFilters { query: string; field: 'title' | 'reference'; category: 'all' | GoodsAnnouncementCategory; state: 'all' | GoodsAnnouncementDisplayState; from: string; to: string; page: number; pageSize: 20 | 50 | 100 }
export interface GoodsAnnouncementListData { rows: GoodsAnnouncementListRow[]; total: number; filters: GoodsAnnouncementFilters }
export interface GoodsAnnouncementCandidates { rows: GoodsAnnouncementGood[]; total: number; page: number; pageSize: number }
export interface PublicGoodsAnnouncement { id: string; title: string; body: string; format: 'plain' | 'html'; category: GoodsAnnouncementCategory; device: GoodsAnnouncementDevice; important: boolean }
export interface GoodAnnouncementsData { items: PublicGoodsAnnouncement[]; nextChangeAt: string | null; unavailable?: boolean }
export function blankGoodsAnnouncement(id: string): GoodsAnnouncement {
  return { id, reference: null, title: '', body: '', format: 'plain', category: 'general', device: 'all', enabled: false, important: false, allGoods: true,
    startsAt: null, endsAt: null, importantStartsAt: null, importantEndsAt: null,
    popup: { selected: false, revision: 0, startsAt: null, endsAt: null }, revision: 0, createdAt: null, updatedAt: null, goods: [] };
}
const string = (value: unknown) => typeof value === 'string' ? value : '';
const inOptions = <T extends string>(value: string, options: readonly { value: T }[], fallback: T): T => options.some(item => item.value === value) ? value as T : fallback;
export function normalizeGoodsAnnouncementFilters(params: Record<string, string | string[] | undefined>): GoodsAnnouncementFilters {
  const from = customerServiceDate(params.from) ?? ''; let to = customerServiceDate(params.to) ?? '';
  if (from && to && from > to) to = '';
  const size = Number(params.pageSize);
  return { query: string(params.q).trim().slice(0, 100), field: params.field === 'reference' ? 'reference' : 'title',
    category: inOptions(string(params.category), [{ value: 'all' }, ...GOODS_ANNOUNCEMENT_CATEGORIES], 'all'),
    state: inOptions(string(params.state), [{ value: 'all' }, ...GOODS_ANNOUNCEMENT_STATES], 'all'), from, to,
    page: Math.min(100000, Math.max(1, Number.parseInt(string(params.page), 10) || 1)), pageSize: size === 50 || size === 100 ? size : 20 };
}
export function goodsAnnouncementHref(filters: GoodsAnnouncementFilters, page = filters.page) {
  const params = new URLSearchParams({ page: String(page) });
  for (const key of ['field', 'category', 'state', 'from', 'to', 'pageSize'] as const) {
    const value = filters[key]; if (value !== '' && value !== 'all' && value !== 'title' && value !== 20) params.set(key, String(value));
  }
  if (filters.query) params.set('q', filters.query);
  return `${GOODS_ANNOUNCEMENTS_PATH}?${params}`;
}
export function goodsAnnouncementState(row: Pick<GoodsAnnouncement, 'enabled' | 'startsAt' | 'endsAt'>, now = Date.now()): GoodsAnnouncementDisplayState {
  if (!row.enabled || (row.endsAt && Date.parse(row.endsAt) <= now)) return 'stopped';
  if (row.startsAt && Date.parse(row.startsAt) > now) return 'waiting';
  return 'shown';
}
export function announcementKstInput(value: string | null) { return toKstDateTimeInput(value); }
function dateInput(raw: string, key: string, errors: Record<string, string>) {
  if (!raw) return null;
  const value = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? new Date(`${raw}:00+09:00`) : new Date(NaN);
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || announcementKstInput(value.toISOString()) !== raw) {
    errors[key] = '올바른 날짜와 시각을 선택해주세요.'; return null;
  }
  return value.toISOString();
}
export function parseGoodsAnnouncementInput(form: FormData) {
  const value = (key: string) => string(form.get(key)).trim(); const errors: Record<string, string> = {};
  const id = value('id'); const revision = Number(value('revision')); const title = value('title');
  const format = value('format'); const category = value('category'); const device = value('device');
  if (!isUuid(id) || !/^\d+$/.test(value('revision')) || !Number.isSafeInteger(revision) || revision < 0) errors.form = '최신 공지 화면을 다시 열어주세요.';
  if (!title || title.length > 50) errors.title = '공지 제목은 1~50자로 입력해주세요.';
  if (!['plain', 'html'].includes(format)) errors.format = '본문 작성 방식을 선택해주세요.';
  if (!GOODS_ANNOUNCEMENT_CATEGORIES.some(item => item.value === category)) errors.category = '공지 분류를 선택해주세요.';
  if (!GOODS_ANNOUNCEMENT_DEVICES.some(item => item.value === device)) errors.device = '노출 화면을 선택해주세요.';
  const rawBody = value('body');
  const cleaned = format === 'html' && rawBody.length <= 30000 ? sanitizeGoodsDescription(rawBody, { imagePaths: [] }) : null;
  const body = cleaned?.html ?? rawBody;
  if (!body.trim() || rawBody.length > 30000 || body.length > 30000) errors.body = '공지 내용은 정리된 코드를 포함해 1~30,000자로 입력해주세요.';
  for (const key of ['enabled', 'important', 'allGoods']) if (!['true', 'false'].includes(value(key))) errors[key] = '설정을 다시 선택해주세요.';
  const allGoods = value('allGoods') === 'true'; let goodIds: string[] = [];
  try {
    const raw: unknown = JSON.parse(value('goodIds'));
    if (!Array.isArray(raw) || raw.length > GOODS_ANNOUNCEMENT_GOOD_LIMIT || raw.some(id => typeof id !== 'string' || !id.trim() || id.length > 120 || id !== id.trim()) || new Set(raw).size !== raw.length) throw new Error();
    goodIds = allGoods ? [] : raw;
    if (!allGoods && !goodIds.length) errors.goodIds = '공지에 연결할 상품을 1개 이상 선택해주세요.';
  } catch { errors.goodIds = `연결 상품을 다시 선택해주세요. 최대 ${GOODS_ANNOUNCEMENT_GOOD_LIMIT}개까지 연결할 수 있습니다.`; }
  const usePeriod = value('usePeriod') === 'true';
  const startsAt = usePeriod ? dateInput(value('startsAt'), 'startsAt', errors) : null;
  const endsAt = usePeriod ? dateInput(value('endsAt'), 'endsAt', errors) : null;
  if (usePeriod && !startsAt && !endsAt) errors.startsAt = '시작 또는 종료 일시를 입력해주세요.';
  if (startsAt && endsAt && startsAt >= endsAt) errors.endsAt = '종료 일시는 시작 일시보다 늦어야 합니다.';
  const useImportantPeriod = value('useImportantPeriod') === 'true';
  const importantStartsAt = useImportantPeriod ? dateInput(value('importantStartsAt'), 'importantStartsAt', errors) : null;
  const importantEndsAt = useImportantPeriod ? dateInput(value('importantEndsAt'), 'importantEndsAt', errors) : null;
  if (useImportantPeriod && (!importantStartsAt || !importantEndsAt)) errors.importantPeriod = '중요 표시의 시작과 종료 일시를 모두 입력해주세요.';
  if (importantStartsAt && importantEndsAt && importantStartsAt >= importantEndsAt) errors.importantPeriod = '중요 표시 종료는 시작보다 늦어야 합니다.';
  const popupIntent = value('popupIntent') || 'preserve';
  const popupRevision = Number(value('popupRevision') || '0');
  if (!['preserve', 'set', 'clear'].includes(popupIntent) || !Number.isSafeInteger(popupRevision) || popupRevision < 0
    || (popupIntent !== 'preserve' && !/^\d+$/.test(value('popupRevision')))) errors.popup = '최신 팝업 설정을 다시 불러와주세요.';
  const popupStartsAt = popupIntent === 'set' ? dateInput(value('popupStartsAt'), 'popupStartsAt', errors) : null;
  const popupEndsAt = popupIntent === 'set' ? dateInput(value('popupEndsAt'), 'popupEndsAt', errors) : null;
  if (popupIntent === 'set' && (!popupStartsAt || !popupEndsAt)) errors.popup = '홈 팝업의 시작과 종료 일시를 모두 입력해주세요.';
  if (popupStartsAt && popupEndsAt && popupStartsAt >= popupEndsAt) errors.popup = '홈 팝업 종료는 시작보다 늦어야 합니다.';
  return Object.keys(errors).length ? { ok: false as const, errors } : { ok: true as const, id, revision,
    popupIntent: popupIntent as 'preserve' | 'set' | 'clear', popupRevision,
    value: { title, body, format: format as 'plain' | 'html', category: category as GoodsAnnouncementCategory, device: device as GoodsAnnouncementDevice,
      enabled: value('enabled') === 'true', important: value('important') === 'true', allGoods, goodIds, startsAt, endsAt,
      importantStartsAt, importantEndsAt, popupStartsAt, popupEndsAt }, warnings: cleaned?.warnings ?? [] };
}

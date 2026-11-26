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
/** 상품 상세에서 공지가 보이는 자리(1027T-005). 상단 = 하부 탭 위 '상품 공지사항', 하단 = 상세정보 탭의 상세설명 바로 아래. */
export const GOODS_ANNOUNCEMENT_PLACEMENTS = [{ value: 'top', label: '상세 상단' }, { value: 'bottom', label: '상세 하단' }] as const;
export type GoodsAnnouncementCategory = typeof GOODS_ANNOUNCEMENT_CATEGORIES[number]['value'];
export type GoodsAnnouncementDevice = typeof GOODS_ANNOUNCEMENT_DEVICES[number]['value'];
export type GoodsAnnouncementPlacement = typeof GOODS_ANNOUNCEMENT_PLACEMENTS[number]['value'];
export type GoodsAnnouncementDisplayState = typeof GOODS_ANNOUNCEMENT_STATES[number]['value'];
export interface GoodsAnnouncementGood { id: string; name: string; code: string; archived: boolean }
export interface GoodsAnnouncementPopupSelection { selected: boolean; revision: number; startsAt: string | null; endsAt: string | null }
export interface GoodsAnnouncement {
  id: string; reference: number | null; title: string; body: string; format: 'plain' | 'html'; category: GoodsAnnouncementCategory;
  device: GoodsAnnouncementDevice; placement: GoodsAnnouncementPlacement; enabled: boolean; important: boolean; allGoods: boolean;
  startsAt: string | null; endsAt: string | null; importantStartsAt: string | null; importantEndsAt: string | null;
  popup: GoodsAnnouncementPopupSelection;
  revision: number; createdAt: string | null; updatedAt: string | null; goods: GoodsAnnouncementGood[];
}
export interface GoodsAnnouncementListRow extends Omit<GoodsAnnouncement, 'body' | 'format' | 'goods' | 'popup' | 'importantStartsAt' | 'importantEndsAt'> { state: GoodsAnnouncementDisplayState; goodCount: number }
export interface GoodsAnnouncementFilters { query: string; field: 'title' | 'reference'; category: 'all' | GoodsAnnouncementCategory; state: 'all' | GoodsAnnouncementDisplayState; from: string; to: string; page: number; pageSize: 20 | 50 | 100 }
export interface GoodsAnnouncementListData { rows: GoodsAnnouncementListRow[]; total: number; filters: GoodsAnnouncementFilters }
export interface GoodsAnnouncementCandidates { rows: GoodsAnnouncementGood[]; total: number; page: number; pageSize: number }
export interface PublicGoodsAnnouncement { id: string; title: string; body: string; format: 'plain' | 'html'; category: GoodsAnnouncementCategory; device: GoodsAnnouncementDevice; placement: GoodsAnnouncementPlacement; important: boolean }
export interface GoodAnnouncementsData { items: PublicGoodsAnnouncement[]; nextChangeAt: string | null; unavailable?: boolean }
export function blankGoodsAnnouncement(id: string): GoodsAnnouncement {
  return { id, reference: null, title: '', body: '', format: 'plain', category: 'general', device: 'all', placement: 'top', enabled: false, important: false, allGoods: true,
    startsAt: null, endsAt: null, importantStartsAt: null, importantEndsAt: null,
    popup: { selected: false, revision: 0, startsAt: null, endsAt: null }, revision: 0, createdAt: null, updatedAt: null, goods: [] };
}
const string = (value: unknown) => typeof value === 'string' ? value : '';
/** 위치를 싣지 않는 응답(배포 전 DB)은 기존 공지와 같은 상단이다. 그 밖의 값은 받지 않는다(null). */
export function goodsAnnouncementPlacement(value: unknown): GoodsAnnouncementPlacement | null {
  if (value === undefined) return 'top';
  return GOODS_ANNOUNCEMENT_PLACEMENTS.find(item => item.value === value)?.value ?? null;
}
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

/* 저장 결과를 모를 때의 버튼·문장. 화면과 서버 액션이 같은 말을 쓴다(템플릿·연관상품 화면과도 같은 말). */
export const GOODS_ANNOUNCEMENT_CHECK_LABEL = '저장됐는지 확인';
export const GOODS_ANNOUNCEMENT_RETRY_LABEL = '다시 저장';
/* 이 화면에는 버튼이 둘이다. [저장됐는지 확인]은 읽기만 하고, 다시 보내는 것은 [다시 저장]이다(같은 작업 번호라 두 번 저장되지 않는다). 어느 버튼을 먼저 누르는지까지 말한다. */
export const GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE = `저장됐는지 확인하지 못했습니다. [${GOODS_ANNOUNCEMENT_CHECK_LABEL}]으로 먼저 확인하고, 저장되지 않았으면 [${GOODS_ANNOUNCEMENT_RETRY_LABEL}]을 누릅니다. 같은 내용이 두 번 저장되지 않습니다.`;
/** 저장하려던 내용을 이 브라우저에 보관하지 못할 때의 한 줄. 저장은 되지만, 화면을 떠났다 돌아오면 결과를 다시 확인할 수 없다. */
export const GOODS_ANNOUNCEMENT_STORAGE_UNAVAILABLE = '이 브라우저에서는 화면을 떠났다 돌아오면 저장됐는지 다시 확인할 수 없습니다. 저장 결과가 나올 때까지 이 화면에 있어 주세요.';
/** 이 공지가 아직 홈 팝업이 아닌데 켜서 저장할 때의 확인창. 홈 팝업은 쇼핑몰에 하나뿐이라 다른 공지의 팝업이 내려간다. */
export const GOODS_ANNOUNCEMENT_POPUP_CONFIRM = { title: '이 공지를 홈 팝업으로 띄울까요?', message: '홈 팝업은 하나뿐입니다. 지금 홈 팝업으로 걸린 다른 공지가 있으면 내려갑니다.', confirmLabel: '저장' } as const;

/** KST 입력값('YYYY-MM-DDTHH:mm')을 "2026년 12월 1일 10:00"으로 읽는다. `omitYear`와 같은 해면 연도를 뺀다. */
function kstInputPhrase(value: string, omitYear = '') {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day, time] = match;
  return `${year === omitYear ? '' : `${year}년 `}${Number(month)}월 ${Number(day)}일 ${time}`;
}
const kstRangePhrase = (start: string, end: string) => `${kstInputPhrase(start)}부터 ${kstInputPhrase(end, start.slice(0, 4))}까지`;

export interface GoodsAnnouncementOutcomeInput {
  enabled: boolean; allGoods: boolean; goodCount: number; placement: GoodsAnnouncementPlacement; device: GoodsAnnouncementDevice;
  /** 전시 기간(KST 입력값). 기간을 두지 않으면 null. */
  period: { startsAt: string; endsAt: string } | null;
  /** 이 공지를 홈 팝업으로 띄우면 그 기간(KST 입력값), 아니면 null. */
  popup: { startsAt: string; endsAt: string } | null;
  /** 지금 이 공지가 홈 팝업으로 걸려 있는가. 걸려 있는데 끄면 저장할 때 내려간다. */
  popupSelectedNow: boolean;
  /**
   * 지금 시각(ms, 화면을 연 시각). 주면 이미 지난 기간을 가려 "저장해도 보이지 않는다"고 말한다.
   * 기준은 목록의 판정(goodsAnnouncementState)과 같다 — 종료가 지금보다 늦지 않으면 끝난 기간이다.
   */
  now?: number;
}
/**
 * 저장 막대의 결과 한 줄: 지금 입력대로 저장하면 고객 화면에 어떻게 보이는지(설명 글 대신 결과를 보인다).
 * 고객 화면의 판정과 같다 — 전시중지면 상세·홈 팝업 모두 안 보이고, 홈 팝업은 전시 기간과 팝업 기간이 겹치는 동안만 뜬다.
 * 전시 기간이나 홈 팝업 기간이 이미 지났으면 날짜를 읽어 주지 않고 보이지 않는다고 먼저 말한다(날짜만 읽으면 '저장하면 보인다'로 읽힌다).
 */
export function goodsAnnouncementOutcome(input: GoodsAnnouncementOutcomeInput): string {
  const start = input.period?.startsAt ?? '', end = input.period?.endsAt ?? '';
  /* KST 입력값은 분 단위라 지금 시각도 분까지 잘라 같은 모양으로 견준다. 종료 <= 지금이면 끝난 기간이다. */
  const nowInput = typeof input.now === 'number' && Number.isFinite(input.now) ? announcementKstInput(new Date(input.now).toISOString()) : '';
  const past = (endInput: string) => Boolean(nowInput && endInput && endInput <= nowInput);
  if (!input.allGoods && !input.goodCount) return '적용 상품을 1개 이상 골라야 저장할 수 있습니다.';
  if (input.period && !start && !end) return '전시 기간의 시작이나 종료를 넣어야 저장할 수 있습니다.';
  if (start && end && start >= end) return '전시 기간의 종료가 시작보다 늦어야 저장할 수 있습니다.';
  if (input.popup && (!input.popup.startsAt || !input.popup.endsAt)) return '홈 팝업 기간의 시작과 종료를 넣어야 저장할 수 있습니다.';
  if (input.popup && input.popup.startsAt >= input.popup.endsAt) return '홈 팝업 기간의 종료가 시작보다 늦어야 저장할 수 있습니다.';
  const popupToo = input.popup ? ' 홈 팝업도 뜨지 않습니다.' : input.popupSelectedNow ? ' 홈 팝업에서도 내려갑니다.' : '';
  if (!input.enabled) return `전시중지라 저장해도 고객에게 보이지 않습니다.${popupToo}`;
  if (past(end)) return `전시 기간이 끝나 저장해도 고객에게 보이지 않습니다. 다시 보이려면 종료를 늦춰 주세요.${popupToo}`;
  const when = start && end ? `${kstRangePhrase(start, end)} ` : start ? `${kstInputPhrase(start)}부터 ` : end ? `${kstInputPhrase(end)}까지 ` : '';
  const target = input.allGoods ? '공개된 모든 상품' : `고른 상품 ${input.goodCount.toLocaleString('ko-KR')}개(공개된 상품만)`;
  const sentences = [`저장하면 ${when}${target}의 상세 ${input.placement === 'bottom' ? '하단' : '상단'}에 보입니다.`];
  if (input.popup) {
    const from = start > input.popup.startsAt ? start : input.popup.startsAt;
    const to = end && end < input.popup.endsAt ? end : input.popup.endsAt;
    sentences.push(from >= to ? '홈 팝업 기간이 전시 기간과 겹치지 않아 홈 팝업은 뜨지 않습니다.'
      : past(to) ? '홈 팝업 기간이 끝나 홈 팝업은 뜨지 않습니다. 다시 띄우려면 홈 팝업 기간의 종료를 늦춰 주세요.'
        : `${kstRangePhrase(from, to)}는 홈 팝업으로도 뜹니다.`);
  } else if (input.popupSelectedNow) sentences.push('홈 팝업에서는 내려갑니다.');
  if (input.device !== 'all') sentences.push(input.device === 'pc' ? 'PC처럼 넓은 화면에서만 보입니다.' : '휴대폰처럼 좁은 화면에서만 보입니다.');
  return sentences.join(' ');
}
const CHOICE_ERRORS = { enabled: '전시 여부를 골라 주세요.', important: '중요 공지로 보일지 골라 주세요.', allGoods: '적용 상품을 전체 상품과 선택 상품 가운데 골라 주세요.' };
function dateInput(raw: string, key: string, errors: Record<string, string>) {
  if (!raw) return null;
  const value = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? new Date(`${raw}:00+09:00`) : new Date(NaN);
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || announcementKstInput(value.toISOString()) !== raw) {
    errors[key] = '날짜와 시각을 다시 골라 주세요.'; return null;
  }
  return value.toISOString();
}
export function parseGoodsAnnouncementInput(form: FormData) {
  const value = (key: string) => string(form.get(key)).trim(); const errors: Record<string, string> = {};
  const id = value('id'); const revision = Number(value('revision')); const title = value('title');
  const format = value('format'); const category = value('category'); const device = value('device');
  /* 위치 칸이 없는 요청(이 칸 이전에 보관된 미확인 저장)은 위치를 보내지 않아 서버가 저장된 위치를 지킨다. */
  const placement = form.has('placement') ? value('placement') : null;
  if (!isUuid(id) || !/^\d+$/.test(value('revision')) || !Number.isSafeInteger(revision) || revision < 0) errors.form = '공지를 다시 열어야 저장할 수 있습니다. 적은 내용을 복사해 두고 목록에서 이 공지를 다시 열어 주세요.';
  if (!title || title.length > 50) errors.title = '공지 제목을 1~50자로 적어 주세요.';
  if (!['plain', 'html'].includes(format)) errors.format = '공지 내용을 직접 입력할지 HTML로 쓸지 골라 주세요.';
  if (!GOODS_ANNOUNCEMENT_CATEGORIES.some(item => item.value === category)) errors.category = '공지 분류를 골라 주세요.';
  if (!GOODS_ANNOUNCEMENT_DEVICES.some(item => item.value === device)) errors.device = '보이는 기기를 골라 주세요.';
  if (placement !== null && !GOODS_ANNOUNCEMENT_PLACEMENTS.some(item => item.value === placement)) errors.placement = '보이는 자리를 골라 주세요.';
  const rawBody = value('body');
  const cleaned = format === 'html' && rawBody.length <= 30000 ? sanitizeGoodsDescription(rawBody, { imagePaths: [] }) : null;
  const body = cleaned?.html ?? rawBody;
  if (!body.trim() || rawBody.length > 30000 || body.length > 30000) errors.body = '공지 내용을 1~30,000자로 적어 주세요. HTML은 태그도 글자 수에 들어가고, 저장할 때 지워지는 코드만 있으면 내용이 없는 것으로 봅니다.';
  for (const [key, message] of Object.entries(CHOICE_ERRORS)) if (!['true', 'false'].includes(value(key))) errors[key] = message;
  const allGoods = value('allGoods') === 'true'; let goodIds: string[] = [];
  try {
    const raw: unknown = JSON.parse(value('goodIds'));
    if (!Array.isArray(raw) || raw.length > GOODS_ANNOUNCEMENT_GOOD_LIMIT || raw.some(id => typeof id !== 'string' || !id.trim() || id.length > 120 || id !== id.trim()) || new Set(raw).size !== raw.length) throw new Error();
    goodIds = allGoods ? [] : raw;
    if (!allGoods && !goodIds.length) errors.goodIds = '[상품 고르기]로 상품을 1개 이상 골라 주세요. 모든 상품에 보이려면 전체 상품을 고릅니다.';
  } catch { errors.goodIds = `적용 상품을 다시 골라 주세요. 최대 ${GOODS_ANNOUNCEMENT_GOOD_LIMIT}개까지 고를 수 있습니다.`; }
  const usePeriod = value('usePeriod') === 'true';
  const startsAt = usePeriod ? dateInput(value('startsAt'), 'startsAt', errors) : null;
  const endsAt = usePeriod ? dateInput(value('endsAt'), 'endsAt', errors) : null;
  if (usePeriod && !startsAt && !endsAt) errors.startsAt = '전시 기간의 시작이나 종료 가운데 하나는 넣어 주세요. 기간을 두지 않으려면 기간 설정을 꺼 주세요.';
  if (startsAt && endsAt && startsAt >= endsAt) errors.endsAt = '전시 기간의 종료는 시작보다 늦어야 합니다.';
  /* 중요 공지가 아니면 기간을 받지 않는다 — 꺼 둔 채 넣은 기간이 저장만 되고 아무 일도 하지 않는 일이 없게 한다. */
  const useImportantPeriod = value('important') === 'true' && value('useImportantPeriod') === 'true';
  const importantStartsAt = useImportantPeriod ? dateInput(value('importantStartsAt'), 'importantStartsAt', errors) : null;
  const importantEndsAt = useImportantPeriod ? dateInput(value('importantEndsAt'), 'importantEndsAt', errors) : null;
  if (useImportantPeriod && (!importantStartsAt || !importantEndsAt)) errors.importantPeriod = '중요 공지 기간의 시작과 종료를 모두 넣어 주세요.';
  if (importantStartsAt && importantEndsAt && importantStartsAt >= importantEndsAt) errors.importantPeriod = '중요 공지 기간의 종료는 시작보다 늦어야 합니다.';
  const popupIntent = value('popupIntent') || 'preserve';
  const popupRevision = Number(value('popupRevision') || '0');
  if (!['preserve', 'set', 'clear'].includes(popupIntent) || !Number.isSafeInteger(popupRevision) || popupRevision < 0
    || (popupIntent !== 'preserve' && !/^\d+$/.test(value('popupRevision')))) errors.popup = '홈 팝업 설정을 읽지 못했습니다. 적은 내용을 복사해 두고 공지를 다시 연 뒤 저장해 주세요.';
  const popupStartsAt = popupIntent === 'set' ? dateInput(value('popupStartsAt'), 'popupStartsAt', errors) : null;
  const popupEndsAt = popupIntent === 'set' ? dateInput(value('popupEndsAt'), 'popupEndsAt', errors) : null;
  if (popupIntent === 'set' && (!popupStartsAt || !popupEndsAt)) errors.popup = '홈 팝업 기간의 시작과 종료를 모두 넣어 주세요.';
  if (popupStartsAt && popupEndsAt && popupStartsAt >= popupEndsAt) errors.popup = '홈 팝업 기간의 종료는 시작보다 늦어야 합니다.';
  return Object.keys(errors).length ? { ok: false as const, errors } : { ok: true as const, id, revision,
    popupIntent: popupIntent as 'preserve' | 'set' | 'clear', popupRevision,
    value: { title, body, format: format as 'plain' | 'html', category: category as GoodsAnnouncementCategory, device: device as GoodsAnnouncementDevice,
      ...(placement !== null ? { placement: placement as GoodsAnnouncementPlacement } : {}),
      enabled: value('enabled') === 'true', important: value('important') === 'true', allGoods, goodIds, startsAt, endsAt,
      importantStartsAt, importantEndsAt, popupStartsAt, popupEndsAt }, warnings: cleaned?.warnings ?? [] };
}

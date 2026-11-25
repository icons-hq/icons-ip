import { isUuid } from '@/lib/uuid';
import { GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_DEVICES, GOODS_ANNOUNCEMENT_PLACEMENTS } from './goods-announcements';

/** Only the submitted operator-authored fields are retained, never auth tokens or fetched records. */
export interface GoodsAnnouncementPendingSave {
  accountId: string;
  id: string;
  operationId: string;
  entries: [string, string][];
}
/* placement is optional: operations stored before the field existed omit it, and the
 * server then keeps the notice's saved position. */
/** This workspace contains submitted operations only; time cannot confirm a save outcome. */
export const retainGoodsAnnouncementPendingSave = () => true;

const FIELD_LIMITS: Record<string, number> = {
  accountId: 36, id: 36, operationId: 36, revision: 16, popupRevision: 16,
  title: 50, body: 30000, format: 5, category: 8, device: 6, placement: 6,
  enabled: 5, important: 5, allGoods: 5, usePeriod: 5, useImportantPeriod: 5,
  popupIntent: 8, goodIds: 65000,
  startsAt: 16, endsAt: 16, importantStartsAt: 16, importantEndsAt: 16, popupStartsAt: 16, popupEndsAt: 16,
};
const REQUIRED_FIELDS = ['accountId', 'id', 'operationId', 'revision', 'popupRevision', 'title', 'body', 'format', 'category', 'device',
  'enabled', 'important', 'allGoods', 'usePeriod', 'useImportantPeriod', 'popupIntent', 'goodIds'];

export function parseGoodsAnnouncementPendingSave(value: unknown): GoodsAnnouncementPendingSave | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<GoodsAnnouncementPendingSave>;
  if (!isUuid(raw.accountId) || !isUuid(raw.id) || !isUuid(raw.operationId) || !Array.isArray(raw.entries)
    || raw.entries.length > Object.keys(FIELD_LIMITS).length) return null;
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  for (const entry of raw.entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string'
      || !Object.hasOwn(FIELD_LIMITS, entry[0]) || seen.has(entry[0]) || entry[1].length > FIELD_LIMITS[entry[0]]) return null;
    seen.add(entry[0]); entries.push([entry[0], entry[1]]);
  }
  const fields = Object.fromEntries(entries);
  if (REQUIRED_FIELDS.some(field => !seen.has(field)) || fields.accountId !== raw.accountId || fields.id !== raw.id || fields.operationId !== raw.operationId) return null;
  for (const field of ['revision', 'popupRevision']) if (!/^\d+$/.test(fields[field]) || !Number.isSafeInteger(Number(fields[field]))) return null;
  return { accountId: raw.accountId, id: raw.id, operationId: raw.operationId, entries };
}

export function createGoodsAnnouncementPendingSave(form: FormData, accountId: string, id: string, operationId: string) {
  const entries: [string, string][] = [];
  for (const [key, value] of form) {
    if (key.startsWith('$ACTION_')) continue;
    if (typeof value !== 'string') return null;
    if (key === 'accountId' || key === 'operationId') continue;
    entries.push([key, value]);
  }
  entries.push(['accountId', accountId], ['operationId', operationId]);
  return parseGoodsAnnouncementPendingSave({ accountId, id, operationId, entries });
}

export function goodsAnnouncementPendingForm(value: GoodsAnnouncementPendingSave) {
  const form = new FormData();
  for (const [key, text] of value.entries) form.append(key, text);
  return form;
}

/* '앞서 저장하려던 내용'에 보이는 칸 이름. 편집 화면의 칸 이름과 같은 말을 쓴다. */
export const GOODS_ANNOUNCEMENT_PENDING_LABELS: Record<string, string> = {
  title: '공지 제목', body: '공지 내용', format: '내용 쓰는 방식', category: '공지 분류', device: '보이는 기기', placement: '보이는 자리',
  enabled: '전시 여부', important: '중요 공지', allGoods: '적용 상품', goodIds: '고른 상품',
  usePeriod: '전시 기간', startsAt: '전시 시작 (KST)', endsAt: '전시 종료 (KST)',
  useImportantPeriod: '중요 공지 기간', importantStartsAt: '중요 공지 시작 (KST)', importantEndsAt: '중요 공지 종료 (KST)',
  popupIntent: '홈 팝업', popupStartsAt: '홈 팝업 시작 (KST)', popupEndsAt: '홈 팝업 종료 (KST)',
};
const YES_NO: Record<string, Record<string, string>> = {
  enabled: { true: '전시', false: '전시중지' }, allGoods: { true: '전체 상품', false: '선택 상품' },
  important: { true: '중요 공지로 보임', false: '안 함' },
  usePeriod: { true: '기간 있음', false: '기간 없음' }, useImportantPeriod: { true: '기간 동안만', false: '기간 없음' },
};

/** 보관해 둔 값을 화면의 말로 바꾼다. 고른 상품은 내부 값을 늘어놓지 않고 개수만 보인다. */
export function goodsAnnouncementPendingDisplayValue(field: string, value: string): string {
  if (!value) return '(비어 있음)';
  if (field === 'category') return GOODS_ANNOUNCEMENT_CATEGORIES.find(item => item.value === value)?.label ?? value;
  if (field === 'device') return GOODS_ANNOUNCEMENT_DEVICES.find(item => item.value === value)?.label ?? value;
  if (field === 'placement') return GOODS_ANNOUNCEMENT_PLACEMENTS.find(item => item.value === value)?.label ?? value;
  if (field === 'format') return ({ plain: '직접 입력', html: 'HTML' } as Record<string, string>)[value] ?? value;
  if (field === 'popupIntent') return ({ preserve: '그대로 둠', set: '이 공지를 홈 팝업으로 띄움', clear: '홈 팝업에서 내림' } as Record<string, string>)[value] ?? value;
  if (YES_NO[field]) return YES_NO[field][value] ?? value;
  if (field.endsWith('At') && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value.replace('T', ' ');
  if (field === 'goodIds') {
    try { const ids: unknown = JSON.parse(value); if (Array.isArray(ids)) return ids.length ? `${ids.length.toLocaleString('ko-KR')}개` : '고른 상품 없음'; }
    catch { /* Preserve unrecognized submitted text for the operator to inspect. */ }
  }
  return value;
}

/**
 * '앞서 저장하려던 내용'에 보일 줄. 고르지 않은 쪽에 딸린 값(전체 상품일 때의 고른 상품, 중요 공지가 아닐 때의 기간 여부)은 뺀다.
 * 화면 전용 값과 내부 값(공지·계정 번호 등)은 칸 이름이 없어 보이지 않는다.
 */
export function goodsAnnouncementPendingRows(entries: readonly (readonly [string, string])[]): { field: string; label: string; value: string }[] {
  const values: Record<string, string> = Object.fromEntries(entries);
  return entries.filter(([field]) => GOODS_ANNOUNCEMENT_PENDING_LABELS[field]
    && !(field === 'goodIds' && values.allGoods === 'true') && !(field === 'useImportantPeriod' && values.important !== 'true'))
    .map(([field, value]) => ({ field, label: GOODS_ANNOUNCEMENT_PENDING_LABELS[field], value: goodsAnnouncementPendingDisplayValue(field, value) }));
}

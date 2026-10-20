import { isUuid } from '@/lib/uuid';
import { GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_DEVICES } from './goods-announcements';

/** Only the submitted operator-authored fields are retained, never auth tokens or fetched records. */
export interface GoodsAnnouncementPendingSave {
  accountId: string;
  id: string;
  operationId: string;
  entries: [string, string][];
}
/** This workspace contains submitted operations only; time cannot confirm a save outcome. */
export const retainGoodsAnnouncementPendingSave = () => true;

const FIELD_LIMITS: Record<string, number> = {
  accountId: 36, id: 36, operationId: 36, revision: 16, popupRevision: 16,
  title: 50, body: 30000, format: 5, category: 8, device: 6,
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

export const GOODS_ANNOUNCEMENT_PENDING_LABELS: Record<string, string> = {
  title: '공지 제목', body: '공지 내용', format: '본문 작성 방식', category: '공지 분류', device: '노출 화면',
  enabled: '전시 여부', important: '중요 공지', allGoods: '전체 상품 적용', goodIds: '연결 상품번호',
  usePeriod: '전시 기간 설정', startsAt: '전시 시작일시', endsAt: '전시 종료일시',
  useImportantPeriod: '중요 표시 기간 설정', importantStartsAt: '중요 표시 시작일시', importantEndsAt: '중요 표시 종료일시',
  popupIntent: '홈 팝업 처리', popupStartsAt: '홈 팝업 시작일시', popupEndsAt: '홈 팝업 종료일시',
};

export function goodsAnnouncementPendingDisplayValue(field: string, value: string): string {
  if (!value) return '(비어 있음)';
  if (field === 'category') return GOODS_ANNOUNCEMENT_CATEGORIES.find(item => item.value === value)?.label ?? value;
  if (field === 'device') return GOODS_ANNOUNCEMENT_DEVICES.find(item => item.value === value)?.label ?? value;
  if (field === 'format') return ({ plain: '직접 입력', html: 'HTML' } as Record<string, string>)[value] ?? value;
  if (field === 'popupIntent') return ({ preserve: '현재 팝업 설정 유지', set: '이 공지로 팝업 변경', clear: '이 공지의 팝업 해제' } as Record<string, string>)[value] ?? value;
  if (field === 'enabled') return ({ true: '전시', false: '전시중지' } as Record<string, string>)[value] ?? value;
  if (field === 'allGoods') return ({ true: '전체 상품', false: '선택 상품' } as Record<string, string>)[value] ?? value;
  if (['important', 'usePeriod', 'useImportantPeriod'].includes(field)) return ({ true: '설정함', false: '설정안함' } as Record<string, string>)[value] ?? value;
  if (field.endsWith('At') && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value.replace('T', ' ')} (한국 시간)`;
  if (field === 'goodIds') {
    try { const ids: unknown = JSON.parse(value); if (Array.isArray(ids) && ids.every(id => typeof id === 'string')) return ids.length ? ids.join(', ') : '개별 선택 없음'; }
    catch { /* Preserve unrecognized submitted text for the operator to inspect. */ }
  }
  return value;
}

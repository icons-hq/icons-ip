import { isUuid } from '@/lib/uuid';
import { normalizeReviewEventFilters, parseReviewEvent, reviewEventProblemLabel, reviewEventStateLabel, type ReviewEvent, type ReviewEventFilters } from '@/lib/review-events';
import { kstDateTimeText, listExportPeriodLabel, type ListExportColumn, type ListExportCellValue } from './list-export';

export const REVIEW_EVENT_EXPORT_PATH = '/api/admin/review-events/export';
export const REVIEW_EVENT_ENTRY_FILTERS = { all: '전체', eligible: '선정 가능', selected: '선정됨', awarded: '지급 완료', revoked: '회수됨', unavailable: '선정 불가' } as const;
export type ReviewEventExportFilters = { mode: 'events'; query: string; state: ReviewEventFilters['state']; dateField: ReviewEventFilters['dateField']; from: string | null; to: string | null }
  | { mode: 'entries'; eventId: string; query: string; filter: keyof typeof REVIEW_EVENT_ENTRY_FILTERS };
export type ReviewEventExportEvent = Omit<ReviewEvent, 'goodIds' | 'categoryIds'> & { targetCount: number; targetsFingerprint: string };
export interface ReviewEventExportEntry {
  id: string; reviewId: string; goodId: string; goodCode: string; goodName: string; nickname: string; rating: number | null; imageCount: number;
  enteredAt: string; reviewUpdatedAt: string | null; selected: boolean; selectionChanged: boolean; problem: string | null;
  creditAmount: number; creditValidityDays: number; eventRevision: number; grantedAt: string | null; revokedAt: string | null; expiresAt: string | null;
}
export interface ReviewEventExportSnapshot {
  filters: ReviewEventExportFilters; event: ReviewEvent | null; total: number; capturedAt: string; fingerprint: string;
  rows: ReviewEventExportEvent[] | ReviewEventExportEntry[];
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableInstant = (value: unknown) => value === null || instant(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function normalizeReviewEventExportFilters(raw: Record<string, string | undefined>): ReviewEventExportFilters | null {
  if (raw.mode === 'entries') {
    if (!isUuid(raw.eventId)) return null;
    return { mode: 'entries', eventId: raw.eventId, query: (raw.q ?? '').trim().slice(0, 100), filter: Object.hasOwn(REVIEW_EVENT_ENTRY_FILTERS, raw.filter ?? '') ? raw.filter as keyof typeof REVIEW_EVENT_ENTRY_FILTERS : 'all' };
  }
  if (raw.mode !== 'events') return null;
  const filters = normalizeReviewEventFilters(raw);
  return { mode: 'events', query: filters.query, state: filters.state, dateField: filters.dateField, from: filters.from || null, to: filters.to || null };
}
export function reviewEventExportHref(filters: ReviewEventExportFilters) {
  const params = new URLSearchParams({ mode: filters.mode, q: filters.query });
  if (filters.mode === 'events') { params.set('state', filters.state); params.set('dateField', filters.dateField); if (filters.from) params.set('from', filters.from); if (filters.to) params.set('to', filters.to); }
  else { params.set('eventId', filters.eventId); params.set('filter', filters.filter); }
  return `${REVIEW_EVENT_EXPORT_PATH}?${params}`;
}
export function parseReviewEventExportSnapshot(value: unknown, filters: ReviewEventExportFilters): ReviewEventExportSnapshot | null {
  if (!object(value) || !object(value.filters) || Object.keys(value.filters).length !== Object.keys(filters).length
    || Object.entries(filters).some(([key, item]) => value.filters && (value.filters as Record<string, unknown>)[key] !== item)
    || !integer(value.total, 0, 10000) || !digest(value.fingerprint) || !instant(value.capturedAt) || !Array.isArray(value.rows) || value.rows.length !== value.total
    || new Set(value.rows.map(row => row?.id)).size !== value.total) return null;
  if (filters.mode === 'events') {
    if (value.event !== null || value.rows.some(row => !object(row) || !parseReviewEvent({ ...row, goodIds: [], categoryIds: [] }) || !integer(row.targetCount, 0, 500) || !digest(row.targetsFingerprint))) return null;
  } else {
    const event = parseReviewEvent(value.event); if (!event || event.id !== filters.eventId) return null;
    for (const row of value.rows) {
      if (!object(row) || !isUuid(row.id) || !isUuid(row.reviewId) || !['goodId', 'goodCode', 'goodName', 'nickname'].every(key => typeof row[key] === 'string')
        || row.rating !== null && !integer(row.rating, 1, 5) || !integer(row.imageCount) || !instant(row.enteredAt) || !nullableInstant(row.reviewUpdatedAt)
        || typeof row.selected !== 'boolean' || typeof row.selectionChanged !== 'boolean' || row.problem !== null && typeof row.problem !== 'string'
        || !integer(row.creditAmount, 1, 999999999999) || !integer(row.creditValidityDays, 1, 36500) || !integer(row.eventRevision, 1)
        || ![row.grantedAt, row.revokedAt, row.expiresAt].every(nullableInstant)) return null;
    }
  }
  return value as unknown as ReviewEventExportSnapshot;
}
const column = (header: string, kind: ListExportColumn['kind'] = 'text', width = 24): ListExportColumn => ({ header, kind, width });
const targetLabels = { all: '전체 상품', goods: '상품 지정', categories: '카테고리 지정' } as const;
export function reviewEventExportSheet(snapshot: ReviewEventExportSnapshot) {
  const { filters, event } = snapshot;
  const conditions: [string, string][] = [['조회 범위', '현재 검색 조건의 전체 페이지'], ['검색어', filters.query || '전체'], ['조회 시각 (KST)', kstDateTimeText(snapshot.capturedAt)]];
  let columns: ListExportColumn[]; let rows: ListExportCellValue[][];
  if (filters.mode === 'events') {
    conditions.push(['상태', filters.state === 'all' ? '전체 (보관 제외)' : reviewEventStateLabel[filters.state]], ['기간 기준', { created: '등록일', start: '시작일', end: '종료일', announce: '발표일' }[filters.dateField]], ['기간', listExportPeriodLabel(filters.from, filters.to)], ['정렬', '등록일 최신순, 같은 시각은 이벤트 ID 오름차순']);
    columns = [column('이벤트 번호', 'code', 16), column('이벤트명', 'text', 28), column('상태', 'text', 16), column('이벤트 내용', 'text', 44), column('대상', 'text', 18), column('지정 대상 수', 'count', 16),
      column('시작일 (KST)', 'code', 18), column('종료일 (KST)', 'code', 18), column('발표 예정일 (KST)', 'code', 22), column('선정 예정 인원', 'count', 18), column('1인 혜택 (원)', 'amount', 20), column('유효기간 (일)', 'count', 18),
      column('응모 수', 'count', 14), column('저장된 선정 수', 'count', 18), column('누적 지급 수', 'count', 18), column('회수 수', 'count', 14), column('발표 시각 (KST)'), column('등록 시각 (KST)'), column('수정 시각 (KST)'), column('보관 시각 (KST)'), column('이벤트 버전', 'count', 16), column('이벤트 ID', 'code', 40)];
    rows = (snapshot.rows as ReviewEventExportEvent[]).map(row => [String(row.number), row.title, reviewEventStateLabel[row.state], row.description, targetLabels[row.targetType], row.targetType === 'all' ? null : row.targetCount,
      row.startsOn, row.endsOn, row.announcesOn, row.plannedWinners, row.creditAmount, row.creditValidityDays, row.entryCount, row.selectedCount, row.awardedCount, row.revokedCount,
      kstDateTimeText(row.announcedAt), kstDateTimeText(row.createdAt), kstDateTimeText(row.updatedAt), kstDateTimeText(row.archivedAt), row.revision, row.id]);
  } else {
    conditions.push(['이벤트', `#${event!.number} ${event!.title}`], ['이벤트 상태', reviewEventStateLabel[event!.state]], ['응모 상태', REVIEW_EVENT_ENTRY_FILTERS[filters.filter]], ['정렬', '응모일 최신순, 같은 시각은 응모 ID 오름차순'], ['이벤트 버전', String(event!.revision)]);
    columns = [column('응모 ID', 'code', 40), column('리뷰 ID', 'code', 40), column('닉네임', 'text', 24), column('상품코드', 'code', 20), column('상품명', 'text', 42), column('별점', 'count', 10), column('사진 수', 'count', 12), column('응모 시각 (KST)'), column('리뷰 수정 시각 (KST)'),
      column('저장된 선정', 'text', 18), column('선정 후 리뷰 변경', 'text', 22), column('현재 선정 자격', 'text', 36), column('혜택 처리 상태', 'text', 20), column('선정 혜택 (원)', 'amount', 20), column('유효기간 (일)', 'count', 18), column('지급 시각 (KST)'), column('유효기한 (KST)'), column('회수 시각 (KST)'), column('응모 당시 이벤트 버전', 'count', 26)];
    rows = (snapshot.rows as ReviewEventExportEntry[]).map(row => [row.id, row.reviewId, row.nickname, row.goodCode || row.goodId, row.goodName, row.rating, row.imageCount, kstDateTimeText(row.enteredAt), kstDateTimeText(row.reviewUpdatedAt),
      row.selected ? '선정됨' : '미선정', row.selectionChanged ? '재확인 필요' : '없음', row.grantedAt ? '기지급 · 재선정 불가' : reviewEventProblemLabel(row.problem), row.revokedAt ? '회수 완료' : row.grantedAt ? '지급 완료' : '미지급', row.creditAmount, row.creditValidityDays,
      kstDateTimeText(row.grantedAt), kstDateTimeText(row.expiresAt), kstDateTimeText(row.revokedAt), row.eventRevision]);
  }
  return { screenLabel: '리뷰이벤트', title: filters.mode === 'events' ? '리뷰이벤트 목록' : '리뷰이벤트 응모', columns, rows, recordCount: snapshot.total, conditions,
    notes: [filters.mode === 'events' ? '한 행은 이벤트 한 건입니다. 누적 지급 수에는 이후 회수된 지급도 포함합니다.' : '한 행은 응모 리뷰 한 건입니다. 화면에서 수정 중인 선택은 포함하지 않으며 저장된 선정 상태를 표시합니다.',
      '조회 시점의 확인용 파일이며 선정·발표·지급·회수 작업을 실행하지 않습니다.',
      '리뷰 본문·사진 주소·회원번호·주문번호·이메일·연락처·선정 및 회수 사유를 제외합니다. 검색어 자체에 고객 정보를 입력했다면 조회 정보 시트에 포함될 수 있습니다.'],
    filters: { ...filters, fingerprint: snapshot.fingerprint } as Record<string, string | null> };
}

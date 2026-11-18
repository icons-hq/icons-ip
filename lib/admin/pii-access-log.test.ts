import { describe, expect, it } from 'vitest';
import {
  PII_ACCESS_LOG_RETENTION_YEARS,
  PII_ORDER_SEARCH_FIELDS,
  normalizePiiAccessLogFilters,
  parsePiiAccessLog,
  parsePiiAccessLogExport,
  piiAccessDetailText,
  piiAccessLogExportHref,
  piiAccessLogExportSheet,
  piiAccessLogHref,
  piiAccessPath,
  piiAccessSubjectSummary,
} from './pii-access-log';

const NOW = new Date('2026-11-18T03:00:00Z');
const ACTOR = 'a9000000-0000-4000-8000-000000000002';
const MEMBER = 'a9000000-0000-4000-8000-000000000001';
const ORDER = 'a9000000-0000-4000-8000-000000000101';
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: '12', at: '2026-11-18T01:00:00Z', actorId: ACTOR, actorName: '점검 합성', actorAccess: 'owner', ip: '203.0.113.9', action: 'view',
  surface: 'order.detail', path: `/admin/sales/orders/${ORDER}`, subjectKind: 'order', subjectIds: [ORDER], subjectCount: 1,
  memberIds: [MEMBER], memberCount: 1, detail: { via: 'page' }, flags: ['off_hours'], ...overrides,
});
const page = (overrides: Record<string, unknown> = {}) => ({
  from: '2026-10-18', to: '2026-11-18', page: 1, pageSize: 50, total: 1,
  summary: { total: 1, offHours: 1, bulk: 0, burst: 0, flagged: 1 }, items: [entry()], actors: [{ id: ACTOR, name: '점검 합성', count: 1 }], ...overrides,
});

describe('개인정보 접속기록 조회 조건', () => {
  it('기본은 최근 1개월이고, 잘못된 기간·ID·코드는 버리고 안내 표시를 켠다', () => {
    expect(normalizePiiAccessLogFilters({}, NOW)).toMatchObject({ actor: null, action: null, surface: null, subject: null, flag: null, page: 1, adjusted: false, chosen: false });
    const adjusted = normalizePiiAccessLogFilters({ from: '2025-01-01', to: '2026-11-18', actor: 'x', action: 'peek', surface: 'nope', flag: 'weird', subject: 'bad' }, NOW);
    expect(adjusted).toMatchObject({ actor: null, action: null, surface: null, subject: null, flag: null, adjusted: true });
    const chosen = normalizePiiAccessLogFilters({ from: '2026-11-01', to: '2026-11-10', actor: ACTOR.toUpperCase(), action: 'export', surface: 'export.list', flag: 'bulk', subject: MEMBER, page: '3' }, NOW);
    expect(chosen).toMatchObject({ from: '2026-11-01', to: '2026-11-10', actor: ACTOR, action: 'export', surface: 'export.list', flag: 'bulk', subject: MEMBER, page: 3, adjusted: false, chosen: true });
  });
  it('주소는 조건을 그대로 싣고, 내려받기 주소에는 쪽 번호를 싣지 않는다', () => {
    const filters = normalizePiiAccessLogFilters({ from: '2026-11-01', to: '2026-11-10', flag: 'any', page: '2' }, NOW);
    expect(piiAccessLogHref(filters)).toBe('/admin/settings/access-log?from=2026-11-01&to=2026-11-10&flag=any&page=2');
    expect(piiAccessLogHref(filters, { subject: MEMBER, page: 1 })).toBe(`/admin/settings/access-log?from=2026-11-01&to=2026-11-10&subject=${MEMBER}&flag=any`);
    expect(piiAccessLogExportHref(filters)).toBe('/api/admin/pii-access-log/export?from=2026-11-01&to=2026-11-10&flag=any');
  });
  it('기록하는 경로에서 검색어가 담긴 쿼리 문자열을 버린다', () => {
    expect(piiAccessPath('/admin/sales/orders?field=phone&query=01012345678')).toBe('/admin/sales/orders');
    expect(piiAccessPath('/admin/customers/abc/')).toBe('/admin/customers/abc');
    expect(piiAccessPath('https://evil.test/admin')).toBe('/admin');
    expect(PII_ORDER_SEARCH_FIELDS.has('phone')).toBe(true); expect(PII_ORDER_SEARCH_FIELDS.has('order')).toBe(false);
    expect(PII_ACCESS_LOG_RETENTION_YEARS).toBe(2);
  });
});

describe('점검 응답 파싱', () => {
  it('계약대로인 응답을 읽고 대상·참고 문구를 만든다', () => {
    const parsed = parsePiiAccessLog(page());
    expect(parsed?.items[0]).toMatchObject({ actorName: '점검 합성', flags: ['off_hours'], memberIds: [MEMBER] });
    expect(piiAccessSubjectSummary(parsed!.items[0])).toBe('주문 1건');
    expect(piiAccessSubjectSummary({ subjectKind: 'none', subjectCount: 0, subjectIds: [] })).toBe('대상 없음');
    expect(piiAccessDetailText({ screen: 'orders', rowCount: 1200, auditId: null })).toBe('화면 orders · 파일 행 1,200');
  });
  it('계약과 다른 응답은 빈 목록이 아니라 읽기 실패다', () => {
    expect(parsePiiAccessLog(page({ items: [entry({ action: 'peek' })] }))).toBeNull();
    expect(parsePiiAccessLog(page({ items: [entry({ subjectIds: [ORDER, 'x'] })] }))).toBeNull();
    expect(parsePiiAccessLog(page({ items: [entry({ detail: { nested: { raw: 1 } } })] }))).toBeNull();
    expect(parsePiiAccessLog(page({ items: [entry({ flags: ['strange'] })] }))).toBeNull();
    expect(parsePiiAccessLog(page({ items: [entry(), entry()], total: 2 }))).toBeNull();
    expect(parsePiiAccessLog(page({ summary: { total: 1, offHours: 0, bulk: 0, burst: 0, flagged: 2 } }))).toBeNull();
    expect(parsePiiAccessLog(page({ total: 0 }))).toBeNull();
    expect(parsePiiAccessLog(null)).toBeNull();
  });
});

describe('점검 목록 엑셀 시트', () => {
  it('한 기록이 한 행이고, 대상 ID 칸은 앞의 100개와 나머지 건수만 적는다', () => {
    const ids = Array.from({ length: 150 }, (_, n) => `a9000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
    const data = parsePiiAccessLogExport({ from: '2026-11-01', to: '2026-11-10', total: 1, capturedAt: '2026-11-18T01:00:00Z',
      rows: [entry({ action: 'export', surface: 'export.list', subjectKind: 'shipment', subjectIds: ids, subjectCount: 3000, memberIds: [], memberCount: 0, flags: ['bulk'], detail: { screen: 'dispatch' } })] });
    expect(data).not.toBeNull();
    const filters = normalizePiiAccessLogFilters({ from: '2026-11-01', to: '2026-11-10', flag: 'bulk' }, NOW);
    const sheet = piiAccessLogExportSheet(data!, filters, null);
    expect(sheet.columns.map(column => column.header)).toContain('접속지(IP)');
    expect(sheet.rows).toHaveLength(1);
    const row = sheet.rows[0];
    expect(row[6]).toBe('내려받기'); expect(row[7]).toBe('목록 엑셀'); expect(row[9]).toBe('배송 건'); expect(row[10]).toBe(3000);
    expect(String(row[11]).split(', ')).toHaveLength(100); expect(String(row[11])).toMatch(/외 2,900건$/);
    expect(row[14]).toBe('대량');
    expect(sheet.conditions).toContainEqual(['이상 징후', '대량']);
    expect(sheet.notes.join(' ')).toContain('개인정보 원문');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeReviewEventExportFilters, parseReviewEventExportSnapshot, reviewEventExportHref, reviewEventExportSheet, type ReviewEventExportSnapshot } from './review-event-export';
import { buildAdminListExportWorkbook } from './list-export.server';
import { loadSafeWorkbook, readSafeWorkbookCell } from './workbook-safety';
import { newReviewEventValues, type ReviewEvent } from '@/lib/review-events';

const id = 'bfc03000-0000-4000-8000-000000000101';
const event: ReviewEvent = { ...newReviewEventValues('2026-10-13'), id, number: 7, title: '리뷰 이벤트', description: '별점과 무관한 선정', revision: 2, createdAt: '2026-10-13T01:00:00Z', updatedAt: '2026-10-13T01:00:00Z', archivedAt: null, announcedAt: '2026-10-13T02:00:00Z', state: 'announced', canEdit: false, entryCount: 1, selectedCount: 1, awardedCount: 1, revokedCount: 1 };
const filters = { mode: 'entries' as const, eventId: id, query: '고객', filter: 'revoked' as const };
const snapshot: ReviewEventExportSnapshot = { filters, event, total: 1, capturedAt: '2026-10-13T01:30:00Z', fingerprint: 'a'.repeat(64), rows: [{
  id, reviewId: id, goodId: 'g2', goodCode: '00001234', goodName: '키링', nickname: '=HYPERLINK("https://invalid.test")', rating: 1, imageCount: 2,
  enteredAt: '2026-10-12T15:00:00Z', reviewUpdatedAt: '2026-10-12T15:01:00Z', selected: true, selectionChanged: true, problem: 'review_hidden',
  creditAmount: 1000, creditValidityDays: 10, eventRevision: 1, grantedAt: '2026-10-13T02:00:00Z', revokedAt: '2026-10-13T03:00:00Z', expiresAt: '2026-10-23T02:00:00Z',
} ] };

describe('review event XLSX contract', () => {
  it('preserves applied filters across all pages and rejects missing event IDs', () => {
    expect(normalizeReviewEventExportFilters({ mode: 'events', q: ' 내용 ', page: '3', pageSize: '50', state: 'ready', from: '2026-10-01', to: '2026-10-13', dateField: 'announce' }))
      .toEqual({ mode: 'events', query: '내용', state: 'ready', from: '2026-10-01', to: '2026-10-13', dateField: 'announce' });
    expect(normalizeReviewEventExportFilters({ mode: 'entries' })).toBeNull();
    const href = reviewEventExportHref(filters); expect(href).toContain('filter=revoked'); expect(href).toContain(`eventId=${id}`); expect(href).not.toMatch(/page=|pageSize=/);
  });
  it('refuses incomplete, duplicated or mismatched snapshots', () => {
    expect(parseReviewEventExportSnapshot(snapshot, filters)).toEqual(snapshot);
    for (const broken of [{ ...snapshot, total: 2 }, { ...snapshot, total: 2, rows: [...snapshot.rows, ...snapshot.rows] }, { ...snapshot, filters: { ...filters, query: '' } }, { ...snapshot, fingerprint: '' }, { ...snapshot, event: { ...event, id: 'bfc03000-0000-4000-8000-000000000102' } }]) expect(parseReviewEventExportSnapshot(broken, filters)).toBeNull();
  });
  it('reopens a real XLSX with stored selection, refund history, typed money, safe codes and no source body', async () => {
    const sheet = reviewEventExportSheet(snapshot);
    const bytes = await buildAdminListExportWorkbook(sheet, new Date(snapshot.capturedAt));
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 5 * 1024 * 1024 });
    const data = workbook.worksheets[0], row = data.getRow(2);
    expect(data.name).toBe('리뷰이벤트 응모'); expect(data.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 }); expect(data.autoFilter).toBeTruthy();
    expect(row.getCell(3).value).toBe('=HYPERLINK("https://invalid.test")'); expect(row.getCell(4).value).toBe('00001234');
    expect(row.getCell(6).value).toBe(1); expect(row.getCell(8).value).toBe('2026-10-13 00:00');
    expect(row.getCell(10).value).toBe('선정됨'); expect(row.getCell(11).value).toBe('재확인 필요'); expect(row.getCell(12).value).toBe('기지급 · 재선정 불가'); expect(row.getCell(13).value).toBe('회수 완료'); expect(row.getCell(14).value).toBe(1000); expect(row.getCell(14).numFmt).toBe('#,##0');
    const info = workbook.getWorksheet('내려받기 정보')!; const lines: string[] = [];
    workbook.eachSheet(worksheet => worksheet.eachRow(item => item.eachCell(cell => expect(readSafeWorkbookCell(cell).error).toBeUndefined())));
    info.eachRow(item => lines.push(String(item.getCell(2).value))); expect(lines).toContain('고객'); expect(lines).toContain('회수됨'); expect(lines).toContain('현재 검색 조건의 전체 페이지');
    expect(sheet.columns.map(value => value.header)).not.toContain('리뷰 본문'); expect(sheet.columns.map(value => value.header)).not.toContain('회원번호');
  });
  it('exports no matching results as a valid empty table with query metadata', async () => {
    const bytes = await buildAdminListExportWorkbook(reviewEventExportSheet({ ...snapshot, rows: [], total: 0 }), new Date(snapshot.capturedAt));
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 5 * 1024 * 1024 }); expect(workbook.worksheets[0].rowCount).toBe(1); expect(workbook.worksheets).toHaveLength(2);
  });
  it('preserves all 10,000 rows at the supported cap', async () => {
    const entry = snapshot.rows[0];
    const expanded = { ...snapshot, total: 10000, rows: Array.from({ length: 10000 }, (_, index) => ({ ...entry, id: `bfc03000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` })) } as ReviewEventExportSnapshot;
    const started = performance.now();
    const bytes = await buildAdminListExportWorkbook(reviewEventExportSheet(expanded), new Date(snapshot.capturedAt));
    const buildMs = Math.round(performance.now() - started);
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 10 * 1024 * 1024, totalBytes: 40 * 1024 * 1024, entryBytes: 30 * 1024 * 1024 });
    expect(workbook.worksheets[0].rowCount).toBe(10001);
    expect(workbook.worksheets[0].getRow(10001).getCell(1).value).toBe('bfc03000-0000-4000-8000-000000010000');
    console.info(`review-event XLSX cap: 10000 rows, ${bytes.length} bytes, build ${buildMs}ms, reopened without truncation`);
  }, 15000);
});

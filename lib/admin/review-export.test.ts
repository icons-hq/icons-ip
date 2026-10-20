import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { ADMIN_REVIEW_SORT_OPTIONS, DEFAULT_ADMIN_REVIEW_FILTERS, normalizeAdminReviewFilters } from './reviews';
import { parseReviewExportFilters, parseReviewExportQuery, parseReviewExportSnapshot, reviewExportFilters, reviewExportHref, reviewExportSheet } from './review-export';
import { buildAdminListExportWorkbook } from './list-export.server';
import { loadSafeWorkbook } from './workbook-safety';
import { reviewExportFilterFixture, reviewExportId, reviewExportRowFixture, reviewExportSnapshotFixture } from '@/test/fixtures/review-export';

describe('일반 리뷰 export 조건과 snapshot', () => {
  it.each(ADMIN_REVIEW_SORT_OPTIONS.map(option => option.value))('정렬 %s과 적용된 14조건만 보존한다', sort => {
    const screen = normalizeAdminReviewFilters({ from: '2026-10-01', to: '2026-10-15', rating: '2', low: '1', status: 'hidden', photo: 'with', reply: 'without',
      best: 'needs_review', query: '\t검증\u00a0', field: 'body', sort, reviewId: reviewExportId(1), page: '3', pageSize: '100', detail: reviewExportId(2) });
    const filters = reviewExportFilters(screen), href = reviewExportHref(filters), query = new URL(href, 'https://example.test').searchParams;
    expect(parseReviewExportQuery(query)).toEqual(filters);
    expect(filters).toEqual({ from: '2026-10-01', to: '2026-10-15', rating: '2', lowRating: true, status: 'hidden', photo: 'with', reply: 'without', best: 'needs_review', query: '검증', field: 'body', sort, reviewId: reviewExportId(1), kind: 'all', repeat: 'all' });
    for (const key of ['page', 'pageSize', 'detail', 'selected', 'accountId']) expect(query.has(key)).toBe(false);
  });
  it.each(['page=2', 'query=a&query=b', 'rating=6', 'rating=', 'low=true', 'status=deleted', 'photo=yes', 'reply=none', 'best=invalid', 'sort=invalid', 'field=email',
    'from=2026-02-30', 'from=0099-01-01', 'to=', 'from=2026-10-15&to=2026-10-01', 'reviewId=no', 'query=%00', `query=${'가'.repeat(101)}`, `query=${'😀'.repeat(51)}`])('잘못된 직접 조건 %s을 전체조회로 바꾸지 않는다', query => {
    expect(parseReviewExportQuery(new URLSearchParams(query))).toBeNull();
  });
  it('UTF16 100단위와 JS trim을 현재 화면처럼 정규화한다', () => {
    for (const query of ['가'.repeat(100), '😀'.repeat(50), '\t\n\u00a0\u1680검증\u3000\ufeff']) {
      const params = new URLSearchParams({ query });
      expect(parseReviewExportQuery(params)?.query).toBe(normalizeAdminReviewFilters({ query }).query);
    }
    expect(parseReviewExportQuery(new URLSearchParams('from=2024-02-29&to=2024-02-29'))).not.toBeNull();
    expect(parseReviewExportQuery(new URLSearchParams('reviewId=A7200000-0000-4000-8000-000000000001'))?.reviewId).toBe(reviewExportId(1));
  });
  it('DTO 키와 타입은 정확히 일치해야 한다', () => {
    const filters = reviewExportFilterFixture();
    expect(parseReviewExportFilters({ ...filters, page: 1 })).toBeNull();
    expect(parseReviewExportFilters({ ...filters, lowRating: 'false' })).toBeNull();
    expect(parseReviewExportFilters({ ...filters, query: ' raw ' })).toBeNull();
    const missing = { ...filters } as Partial<typeof filters>; delete missing.reviewId;
    expect(parseReviewExportFilters(missing)).toBeNull();
  });
  it('0/1/10,000건은 허용하고 10,001건·중복·누락·다른 조건은 거절한다', () => {
    const filters = reviewExportFilterFixture();
    for (const total of [0, 1, 10_000]) {
      const rows = Array.from({ length: total }, (_, index) => reviewExportRowFixture({ id: reviewExportId(index + 1) }));
      expect(parseReviewExportSnapshot(reviewExportSnapshotFixture({ total, rows }), filters)?.total).toBe(total);
    }
    const snapshot = reviewExportSnapshotFixture();
    for (const value of [{ ...snapshot, total: 10001 }, { ...snapshot, total: 2 }, { ...snapshot, rows: [snapshot.rows[0], snapshot.rows[0]], total: 2 },
      { ...snapshot, filters: { ...filters, sort: 'helpful_desc' } }, { ...snapshot, extra: true }, { ...snapshot, version: 3 }]) expect(parseReviewExportSnapshot(value, filters)).toBeNull();
  });
  it.each([{ helpfulCount: '7' }, { helpfulCount: -1 }, { helpfulCount: NaN }, { helpfulCount: Number.MAX_SAFE_INTEGER + 1 }, { imageCount: null }, { openReportCount: 4 },
    { rating: 0 }, { status: 'deleted' }, { bestState: 'unavailable' }, { hasReply: 'no' }, { replyAt: '' }, { createdAt: '2026-02-30T00:00:00Z' },
    { createdAt: '2026-10-15' }, { editedAt: 'infinity' }, { body: 'a'.repeat(32768) }, { email: 'must-not-export@example.test' }])('잘못된 행을 0이나 정상값으로 바꾸지 않는다: %j', patch => {
    const snapshot = reviewExportSnapshotFixture();
    expect(parseReviewExportSnapshot({ ...snapshot, rows: [{ ...snapshot.rows[0], ...patch }] }, snapshot.filters)).toBeNull();
  });
  it('선택·페이지 정보를 내보내기 DTO에 섞지 않는다', () => {
    expect(Object.keys(reviewExportFilters({ ...DEFAULT_ADMIN_REVIEW_FILTERS, page: 99, pageSize: 100 }))).toHaveLength(14);
  });
});

describe('일반 리뷰 18열 workbook', () => {
  it('한 리뷰 한 행, 본문 전체·KST·숫자 셀·빈칸을 재개봉해 확인한다', async () => {
    const body = '원문 전체 '.repeat(80) + '\n끝', snapshot = reviewExportSnapshotFixture({ rows: [reviewExportRowFixture({ body })] });
    const bytes = await buildAdminListExportWorkbook(reviewExportSheet(snapshot), new Date('2026-10-15T04:05:00Z'));
    const book = await loadSafeWorkbook(bytes, { fileBytes: 5 * 1024 * 1024 });
    expect(book.worksheets.map(sheet => sheet.name)).toEqual(['리뷰', '내려받기 정보']);
    const sheet = book.worksheets[0];
    expect(sheet.columnCount).toBe(18); expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(1).values).toEqual([, '리뷰 ID', '상품 ID', '상품명', '작성자 표시명', '평점', '리뷰 내용', '사진 수', '리뷰도움수', '상태', 'BEST 상태', '전체 신고 수', '미처리 신고 수', '답글 등록 여부', '답글 등록 시각 (KST)', '작성 시각 (KST)', '수정 시각 (KST)', '리뷰 구분', '재구매 표시']);
    expect(sheet.getCell('A2').value).toBe(reviewExportId(1)); expect(sheet.getCell('A2').numFmt).toBe('@');
    expect(sheet.getCell('B2').value).toBe('000012-good'); expect(sheet.getCell('F2').value).toBe(body);
    expect(sheet.getCell('H2').value).toBe(7); expect(sheet.getCell('H2').numFmt).toBe('#,##0');
    expect(sheet.getCell('N2').value).toBeNull(); expect(sheet.getCell('O2').value).toBe('2026-10-15 09:00'); expect(sheet.getCell('P2').value).toBeNull();
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 }); expect(sheet.autoFilter).toBeTruthy();
  });
  it('수식 접두어는 문자열이며 검색 원문과 제외된 개인정보를 메타데이터에 넣지 않는다', async () => {
    const attacks = ['=HYPERLINK("https://example.test","literal")', '+SUM(A1:A2)', '-1+1', '@SUM(A1:A2)', ' =1+1', '\t=1+1', '\n=1+1', '\u00a0=1+1', '한글\u0001\n줄바꿈'];
    const filters = { ...reviewExportFilterFixture(), query: 'PRIVATE_QUERY@example.test' };
    const snapshot = reviewExportSnapshotFixture({ filters, total: attacks.length, rows: attacks.map((body, index) => reviewExportRowFixture({ id: reviewExportId(index + 1), body, goodName: body, authorName: body })) });
    const model = reviewExportSheet(snapshot), bytes = await buildAdminListExportWorkbook(model, new Date('2026-10-15T04:05:00Z'));
    const book = await loadSafeWorkbook(bytes, { fileBytes: 5 * 1024 * 1024 });
    attacks.forEach((body, index) => {
      for (const column of ['C', 'D', 'F']) expect(book.worksheets[0].getCell(`${column}${index + 2}`).value).toBe(body.replace('\u0001', ''));
    });
    const zip = await JSZip.loadAsync(bytes), parts = await Promise.all(Object.values(zip.files).filter(file => !file.dir && /\.xml$/.test(file.name)).map(file => file.async('string')));
    const xml = parts.join('\n');
    expect(xml).not.toMatch(/<f(?:\s|>)/); expect(Object.keys(zip.files).some(name => name.includes('externalLinks'))).toBe(false);
    expect(xml).not.toContain(filters.query); expect(JSON.stringify(model.filters)).not.toContain(filters.query);
    expect(xml).toContain('검색어 있음(26자)');
    for (const excluded of ['회원 ID', '주문 ID', '이메일', '연락처', '사진 주소']) expect(model.columns.some(column => column.header === excluded)).toBe(false);
  });
  it('0건은 머리글과 정보 시트를 포함한다', async () => {
    const bytes = await buildAdminListExportWorkbook(reviewExportSheet(reviewExportSnapshotFixture({ total: 0, rows: [] })), new Date());
    const book = await loadSafeWorkbook(bytes, { fileBytes: 5 * 1024 * 1024 });
    expect(book.worksheets[0].rowCount).toBe(1); expect(book.worksheets[0].columnCount).toBe(18); expect(book.worksheets).toHaveLength(2);
  });
});

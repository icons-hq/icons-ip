import { describe, expect, it } from 'vitest';
import { goodsAnnouncementHref, goodsAnnouncementState, normalizeGoodsAnnouncementFilters, parseGoodsAnnouncementInput } from './goods-announcements';

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ id: '00000000-0000-4000-8000-000000062211', revision: '0', title: '휴무 안내', body: '배송 일정을 확인해주세요.', format: 'plain', category: 'shipping', device: 'all', enabled: 'true', important: 'false', allGoods: 'true', goodIds: '[]', usePeriod: 'false', ...extra })) data.set(key, value);
  return data;
}
describe('상품 공지 입력과 목록 계약', () => {
  it('중요 표시 기간과 홈 팝업 기간을 별도 검증하고 보존 요청에는 팝업 기간을 보내지 않는다', () => {
    const dates = { useImportantPeriod: 'true', importantStartsAt: '2026-10-14T09:00', importantEndsAt: '2026-10-15T09:00', popupIntent: 'set', popupRevision: '4', popupStartsAt: '2026-10-14T12:00', popupEndsAt: '2026-10-16T12:00' };
    expect(parseGoodsAnnouncementInput(form(dates))).toMatchObject({ ok: true, popupIntent: 'set', popupRevision: 4, value: { importantStartsAt: '2026-10-14T00:00:00.000Z', popupStartsAt: '2026-10-14T03:00:00.000Z' } });
    expect(parseGoodsAnnouncementInput(form({ ...dates, importantEndsAt: '' }))).toMatchObject({ ok: false, errors: { importantPeriod: expect.any(String) } });
    expect(parseGoodsAnnouncementInput(form({ ...dates, popupEndsAt: '2026-10-14T11:00' }))).toMatchObject({ ok: false, errors: { popup: expect.any(String) } });
    expect(parseGoodsAnnouncementInput(form({ ...dates, popupIntent: 'preserve' }))).toMatchObject({ ok: true, value: { popupStartsAt: null, popupEndsAt: null } });
    expect(parseGoodsAnnouncementInput(form({ ...dates, popupRevision: '-1' }))).toMatchObject({ ok: false });
  });
  it('표시 기간을 KST로 바꾸고 비활성 기간 입력은 적용하지 않는다', () => {
    expect(parseGoodsAnnouncementInput(form({ usePeriod: 'true', startsAt: '2026-10-12T00:00', endsAt: '2026-10-13T00:00' }))).toMatchObject({ ok: true, value: { startsAt: '2026-10-11T15:00:00.000Z', endsAt: '2026-10-12T15:00:00.000Z' } });
    expect(parseGoodsAnnouncementInput(form({ startsAt: 'not-a-date' }))).toMatchObject({ ok: true, value: { startsAt: null, endsAt: null } });
    for (const startsAt of ['2026-02-29T10:00', '2026-13-01T10:00', '0000-01-01T00:00']) expect(parseGoodsAnnouncementInput(form({ usePeriod: 'true', startsAt }))).toMatchObject({ ok: false, errors: { startsAt: expect.any(String) } });
    expect(parseGoodsAnnouncementInput(form({ usePeriod: 'true', startsAt: '2026-10-13T00:00', endsAt: '2026-10-12T00:00' }))).toMatchObject({ ok: false, errors: { endsAt: expect.any(String) } });
  });
  it('선택 상품은 필수·중복 금지이고 전체 상품으로 전환하면 선택 목록을 저장하지 않는다', () => {
    expect(parseGoodsAnnouncementInput(form({ allGoods: 'false' }))).toMatchObject({ ok: false, errors: { goodIds: expect.any(String) } });
    expect(parseGoodsAnnouncementInput(form({ allGoods: 'false', goodIds: '["a","a"]' }))).toMatchObject({ ok: false });
    expect(parseGoodsAnnouncementInput(form({ goodIds: '["a"]' }))).toMatchObject({ ok: true, value: { allGoods: true, goodIds: [] } });
  });
  it('HTML 실행 코드와 소유 확인되지 않은 저장소 이미지를 저장 전에 제거한다', () => {
    const parsed = parseGoodsAnnouncementInput(form({ format: 'html', body: '<h3 onclick="bad()">안내</h3><script>alert(1)</script><img src="https://example.test/notice.jpg" onerror="bad()">' }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) { expect(parsed.value.body).toContain('안내'); expect(parsed.value.body).toContain('https://example.test/notice.jpg'); expect(parsed.value.body).not.toMatch(/script|onclick|onerror|alert/); }
    expect(parseGoodsAnnouncementInput(form({ format: 'html', body: '<script>alert(1)</script>' }))).toMatchObject({ ok: false, errors: { body: expect.any(String) } });
  });
  it('목록 조건과 페이지 크기를 링크에 보존한다', () => {
    const filters = normalizeGoodsAnnouncementFilters({ q: ' 휴무 ', field: 'reference', category: 'shipping', state: 'waiting', from: '2026-10-01', to: '2026-10-31', page: '2', pageSize: '50' });
    const params = Object.fromEntries(new URL(goodsAnnouncementHref(filters), 'https://example.test').searchParams);
    expect(normalizeGoodsAnnouncementFilters(params)).toEqual(filters);
    expect(normalizeGoodsAnnouncementFilters({ from: '2026-02-30', pageSize: '500', state: 'bad' })).toMatchObject({ from: '', pageSize: 20, state: 'all' });
  });
  it('시작을 포함하고 종료부터 중지하며 전시중지가 기간보다 우선한다', () => {
    const range = { enabled: true, startsAt: '2026-10-12T00:00:00Z', endsAt: '2026-10-13T00:00:00Z' };
    expect(goodsAnnouncementState(range, Date.parse(range.startsAt) - 1)).toBe('waiting');
    expect(goodsAnnouncementState(range, Date.parse(range.startsAt))).toBe('shown');
    expect(goodsAnnouncementState(range, Date.parse(range.endsAt))).toBe('stopped');
    expect(goodsAnnouncementState({ ...range, enabled: false }, Date.parse(range.startsAt))).toBe('stopped');
  });
});

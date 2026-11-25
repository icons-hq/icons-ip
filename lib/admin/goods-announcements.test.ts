import { describe, expect, it } from 'vitest';
import { blankGoodsAnnouncement, GOODS_ANNOUNCEMENT_CHECK_LABEL, GOODS_ANNOUNCEMENT_POPUP_CONFIRM, GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE, goodsAnnouncementHref, goodsAnnouncementOutcome, goodsAnnouncementPlacement, goodsAnnouncementState, normalizeGoodsAnnouncementFilters, parseGoodsAnnouncementInput, type GoodsAnnouncementOutcomeInput } from './goods-announcements';

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ id: '00000000-0000-4000-8000-000000062211', revision: '0', title: '휴무 안내', body: '배송 일정을 확인해주세요.', format: 'plain', category: 'shipping', device: 'all', enabled: 'true', important: 'false', allGoods: 'true', goodIds: '[]', usePeriod: 'false', ...extra })) data.set(key, value);
  return data;
}
describe('상품 공지 입력과 목록 계약', () => {
  it('중요 표시 기간과 홈 팝업 기간을 별도 검증하고 보존 요청에는 팝업 기간을 보내지 않는다', () => {
    const dates = { important: 'true', useImportantPeriod: 'true', importantStartsAt: '2026-10-14T09:00', importantEndsAt: '2026-10-15T09:00', popupIntent: 'set', popupRevision: '4', popupStartsAt: '2026-10-14T12:00', popupEndsAt: '2026-10-16T12:00' };
    expect(parseGoodsAnnouncementInput(form(dates))).toMatchObject({ ok: true, popupIntent: 'set', popupRevision: 4, value: { importantStartsAt: '2026-10-14T00:00:00.000Z', popupStartsAt: '2026-10-14T03:00:00.000Z' } });
    expect(parseGoodsAnnouncementInput(form({ ...dates, importantEndsAt: '' }))).toMatchObject({ ok: false, errors: { importantPeriod: expect.any(String) } });
    expect(parseGoodsAnnouncementInput(form({ ...dates, popupEndsAt: '2026-10-14T11:00' }))).toMatchObject({ ok: false, errors: { popup: expect.any(String) } });
    expect(parseGoodsAnnouncementInput(form({ ...dates, popupIntent: 'preserve' }))).toMatchObject({ ok: true, value: { popupStartsAt: null, popupEndsAt: null } });
    expect(parseGoodsAnnouncementInput(form({ ...dates, popupRevision: '-1' }))).toMatchObject({ ok: false });
  });
  /* 중요 공지가 아니면 기간을 받지 않는다. 꺼 둔 채 넣은 기간이 저장만 되고 아무 일도 하지 않는 일이 없다. */
  it('중요 공지를 끄면 함께 온 중요 공지 기간을 저장하지 않고 오류로도 보지 않는다', () => {
    const period = { useImportantPeriod: 'true', importantStartsAt: '2026-10-14T09:00', importantEndsAt: '2026-10-15T09:00' };
    expect(parseGoodsAnnouncementInput(form({ important: 'false', ...period }))).toMatchObject({ ok: true, value: { important: false, importantStartsAt: null, importantEndsAt: null } });
    expect(parseGoodsAnnouncementInput(form({ important: 'false', ...period, importantEndsAt: '' }))).toMatchObject({ ok: true, value: { importantStartsAt: null, importantEndsAt: null } });
    expect(parseGoodsAnnouncementInput(form({ important: 'true', ...period }))).toMatchObject({ ok: true, value: { important: true, importantStartsAt: '2026-10-14T00:00:00.000Z', importantEndsAt: '2026-10-15T00:00:00.000Z' } });
    expect(parseGoodsAnnouncementInput(form({ important: 'true', useImportantPeriod: 'false', importantStartsAt: period.importantStartsAt }))).toMatchObject({ ok: true, value: { important: true, importantStartsAt: null } });
  });
  it('오류는 어느 칸이 왜 안 되는지를 화면의 칸 이름으로 말한다', () => {
    const errors = (extra: Record<string, string>) => { const parsed = parseGoodsAnnouncementInput(form(extra)); return parsed.ok ? {} : parsed.errors; };
    expect(errors({ device: 'tv' }).device).toBe('보이는 기기를 골라 주세요.');
    expect(errors({ placement: 'middle' }).placement).toBe('보이는 자리를 골라 주세요.');
    expect(errors({ allGoods: 'false' }).goodIds).toContain('[상품 고르기]');
    expect(errors({ enabled: '' }).enabled).toBe('전시 여부를 골라 주세요.');
    expect(errors({ allGoods: '' }).allGoods).toContain('전체 상품과 선택 상품');
    expect(errors({ usePeriod: 'true' }).startsAt).toContain('기간 설정을 꺼 주세요');
    expect(errors({ important: 'true', useImportantPeriod: 'true', importantStartsAt: '2026-10-14T09:00' }).importantPeriod).toBe('중요 공지 기간의 시작과 종료를 모두 넣어 주세요.');
    expect(errors({ popupIntent: 'set', popupRevision: '1', popupStartsAt: '2026-10-14T09:00' }).popup).toBe('홈 팝업 기간의 시작과 종료를 모두 넣어 주세요.');
    const all = Object.values({ ...errors({ id: 'bad', device: 'tv', placement: 'x', body: '', enabled: '', important: '', allGoods: '', goodIds: 'x', usePeriod: 'true', popupIntent: 'bad' }) }).join(' ');
    for (const word of ['노출', '일시', '요청', '최신', '연결 상품', '정리된 코드']) expect(all).not.toContain(word);
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
  /* 1027T-005: 위치는 상단·하단 중 하나다. 위치 칸이 없는 요청(칸 이전에 보관된 저장)은 위치를 보내지 않아 서버가 저장된 위치를 지킨다. */
  it('보이는 자리를 상단·하단으로 받고 칸이 없으면 위치를 보내지 않는다', () => {
    expect(parseGoodsAnnouncementInput(form({ placement: 'bottom' }))).toMatchObject({ ok: true, value: { placement: 'bottom' } });
    expect(parseGoodsAnnouncementInput(form({ placement: 'top' }))).toMatchObject({ ok: true, value: { placement: 'top' } });
    const legacy = parseGoodsAnnouncementInput(form());
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.value).not.toHaveProperty('placement');
    expect(parseGoodsAnnouncementInput(form({ placement: 'middle' }))).toMatchObject({ ok: false, errors: { placement: expect.any(String) } });
    expect(parseGoodsAnnouncementInput(form({ placement: '' }))).toMatchObject({ ok: false, errors: { placement: expect.any(String) } });
  });
  it('위치를 싣지 않는 응답은 상단, 모르는 값은 받지 않는다', () => {
    expect(goodsAnnouncementPlacement(undefined)).toBe('top');
    expect(goodsAnnouncementPlacement('bottom')).toBe('bottom');
    expect(goodsAnnouncementPlacement('middle')).toBeNull();
    expect(goodsAnnouncementPlacement(null)).toBeNull();
    expect(blankGoodsAnnouncement('00000000-0000-4000-8000-000000062211').placement).toBe('top');
  });
  it('목록 조건과 페이지 크기를 링크에 보존한다', () => {
    const filters = normalizeGoodsAnnouncementFilters({ q: ' 휴무 ', field: 'reference', category: 'shipping', state: 'waiting', from: '2026-10-01', to: '2026-10-31', page: '2', pageSize: '50' });
    const params = Object.fromEntries(new URL(goodsAnnouncementHref(filters), 'https://example.test').searchParams);
    expect(normalizeGoodsAnnouncementFilters(params)).toEqual(filters);
    expect(normalizeGoodsAnnouncementFilters({ from: '2026-02-30', pageSize: '500', state: 'bad' })).toMatchObject({ from: '', pageSize: 20, state: 'all' });
  });
  /* 저장 막대의 결과 한 줄. 고객 화면의 판정(전시 여부·기간·홈 팝업 기간의 겹침)을 그대로 되읽는다. */
  describe('저장하면 어떻게 보이는지 한 줄', () => {
    const base: GoodsAnnouncementOutcomeInput = { enabled: true, allGoods: true, goodCount: 0, placement: 'top', device: 'all', period: null, popup: null, popupSelectedNow: false };
    it('전시중지면 상세와 홈 팝업 모두 보이지 않는다고 말한다', () => {
      expect(goodsAnnouncementOutcome({ ...base, enabled: false })).toBe('전시중지라 저장해도 고객에게 보이지 않습니다.');
      expect(goodsAnnouncementOutcome({ ...base, enabled: false, popup: { startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' } })).toBe('전시중지라 저장해도 고객에게 보이지 않습니다. 홈 팝업도 뜨지 않습니다.');
      expect(goodsAnnouncementOutcome({ ...base, enabled: false, popupSelectedNow: true })).toBe('전시중지라 저장해도 고객에게 보이지 않습니다. 홈 팝업에서도 내려갑니다.');
    });
    it('대상·자리·기간·기기를 한 문장으로 읽는다', () => {
      expect(goodsAnnouncementOutcome(base)).toBe('저장하면 공개된 모든 상품의 상세 상단에 보입니다.');
      expect(goodsAnnouncementOutcome({ ...base, allGoods: false, goodCount: 3, placement: 'bottom', device: 'pc' })).toBe('저장하면 고른 상품 3개(공개된 상품만)의 상세 하단에 보입니다. PC처럼 넓은 화면에서만 보입니다.');
      expect(goodsAnnouncementOutcome({ ...base, device: 'mobile', period: { startsAt: '2026-12-01T10:00', endsAt: '' } })).toBe('저장하면 2026년 12월 1일 10:00부터 공개된 모든 상품의 상세 상단에 보입니다. 휴대폰처럼 좁은 화면에서만 보입니다.');
      expect(goodsAnnouncementOutcome({ ...base, period: { startsAt: '', endsAt: '2026-12-07T23:59' } })).toBe('저장하면 2026년 12월 7일 23:59까지 공개된 모든 상품의 상세 상단에 보입니다.');
      expect(goodsAnnouncementOutcome({ ...base, period: { startsAt: '2026-12-28T10:00', endsAt: '2027-01-03T10:00' } })).toBe('저장하면 2026년 12월 28일 10:00부터 2027년 1월 3일 10:00까지 공개된 모든 상품의 상세 상단에 보입니다.');
    });
    it('홈 팝업은 전시 기간과 겹치는 동안만 뜬다고 읽고, 끄면 내려간다고 말한다', () => {
      const popup = { startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' };
      expect(goodsAnnouncementOutcome({ ...base, popup })).toBe('저장하면 공개된 모든 상품의 상세 상단에 보입니다. 2026년 12월 1일 10:00부터 12월 7일 23:59까지는 홈 팝업으로도 뜹니다.');
      expect(goodsAnnouncementOutcome({ ...base, popup, period: { startsAt: '2026-12-03T00:00', endsAt: '2026-12-05T00:00' } })).toContain('2026년 12월 3일 00:00부터 12월 5일 00:00까지는 홈 팝업으로도 뜹니다.');
      expect(goodsAnnouncementOutcome({ ...base, popup, period: { startsAt: '2026-12-08T00:00', endsAt: '' } })).toContain('홈 팝업 기간이 전시 기간과 겹치지 않아 홈 팝업은 뜨지 않습니다.');
      expect(goodsAnnouncementOutcome({ ...base, popupSelectedNow: true })).toBe('저장하면 공개된 모든 상품의 상세 상단에 보입니다. 홈 팝업에서는 내려갑니다.');
    });
    it('저장할 수 없는 입력은 무엇을 넣어야 하는지 먼저 말한다', () => {
      expect(goodsAnnouncementOutcome({ ...base, allGoods: false })).toBe('적용 상품을 1개 이상 골라야 저장할 수 있습니다.');
      expect(goodsAnnouncementOutcome({ ...base, period: { startsAt: '', endsAt: '' } })).toBe('전시 기간의 시작이나 종료를 넣어야 저장할 수 있습니다.');
      expect(goodsAnnouncementOutcome({ ...base, period: { startsAt: '2026-12-07T00:00', endsAt: '2026-12-01T00:00' } })).toBe('전시 기간의 종료가 시작보다 늦어야 저장할 수 있습니다.');
      expect(goodsAnnouncementOutcome({ ...base, popup: { startsAt: '2026-12-01T10:00', endsAt: '' } })).toBe('홈 팝업 기간의 시작과 종료를 넣어야 저장할 수 있습니다.');
      expect(goodsAnnouncementOutcome({ ...base, popup: { startsAt: '2026-12-07T10:00', endsAt: '2026-12-01T10:00' } })).toBe('홈 팝업 기간의 종료가 시작보다 늦어야 저장할 수 있습니다.');
    });
  });
  it('결과를 모를 때의 버튼·문장과 홈 팝업 확인창은 공통 낱말 표의 말이다', () => {
    expect(GOODS_ANNOUNCEMENT_CHECK_LABEL).toBe('저장됐는지 확인');
    expect(GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
    expect(GOODS_ANNOUNCEMENT_POPUP_CONFIRM.message).toContain('지금 홈 팝업으로 걸린 다른 공지가 있으면 내려갑니다');
  });
  it('시작을 포함하고 종료부터 중지하며 전시중지가 기간보다 우선한다', () => {
    const range = { enabled: true, startsAt: '2026-10-12T00:00:00Z', endsAt: '2026-10-13T00:00:00Z' };
    expect(goodsAnnouncementState(range, Date.parse(range.startsAt) - 1)).toBe('waiting');
    expect(goodsAnnouncementState(range, Date.parse(range.startsAt))).toBe('shown');
    expect(goodsAnnouncementState(range, Date.parse(range.endsAt))).toBe('stopped');
    expect(goodsAnnouncementState({ ...range, enabled: false }, Date.parse(range.startsAt))).toBe('stopped');
  });
});

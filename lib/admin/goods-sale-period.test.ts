import { expect, it } from 'vitest';
import { goodSaleTimingMode, goodsSalePeriodPreset, goodsSalePeriodReadback, kstInputLabel, kstInputRangeLabel, readGoodsSalePeriod } from './goods-sale-period';
import { goodEditorValues, GOOD_LOCAL_DRAFT_FIELDS, buildGoodEditorPreview } from './good-editor';

function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
it('필드가 없는 구버전 제출은 기존 설정을 보존하고 설정안함은 명시적으로 해제한다', () => {
  expect(readGoodsSalePeriod(new FormData())).toEqual({ ok: true, fields: {} });
  expect(readGoodsSalePeriod(form({ salePeriodEnabled: 'false', salePeriodRevision: '3' }))).toEqual({
    ok: true, fields: { sale_period: { startsAt: null, endsAt: null, expectedRevision: 3 } },
  });
});
it('한국시간 입력은 UTC로 변환하고 누락·역전·잘못된 날짜·리비전을 거부한다', () => {
  const values = { salePeriodEnabled: 'true', saleStartsAt: '2026-10-13T00:00', saleEndsAt: '2026-10-16T00:00', salePeriodRevision: '2' };
  expect(readGoodsSalePeriod(form(values))).toEqual({ ok: true, fields: { sale_period: {
    startsAt: '2026-10-12T15:00:00.000Z', endsAt: '2026-10-15T15:00:00.000Z', expectedRevision: 2,
  } } });
  for (const patch of [{ saleStartsAt: '' }, { saleEndsAt: values.saleStartsAt }, { saleStartsAt: '2026-02-30T00:00' }, { salePeriodRevision: '-1' }]) {
    expect(readGoodsSalePeriod(form({ ...values, ...patch })).ok).toBe(false);
  }
});
it('일수 프리셋은 한국 달력의 오늘을 포함한 마지막 날 전체를 판매한다', () => {
  expect(goodsSalePeriodPreset(3, new Date('2026-10-12T23:00:00Z'))).toEqual({ saleStartsAt: '2026-10-13T00:00', saleEndsAt: '2026-10-16T00:00' });
});
it('입력 복구와 미리보기에 판매기간과 CAS 리비전을 보존한다', () => {
  const values = goodEditorValues(null, { values: { previousId: '', salePeriodEnabled: 'true', saleStartsAt: '2099-10-13T00:00', saleEndsAt: '2099-10-16T00:00', salePeriodRevision: '7' } });
  expect(values.salePeriodRevision).toBe('7');
  expect(GOOD_LOCAL_DRAFT_FIELDS).toEqual(expect.arrayContaining(['salePeriodEnabled', 'saleStartsAt', 'saleEndsAt', 'salePeriodRevision']));
  expect(buildGoodEditorPreview({ values, imageUrls: {}, selected: null, catalogIps: [], origins: [], shippingNoticeOptions: [] }).detail.good.salePeriod?.state).toBe('scheduled');
});

/* '글보다 화면' 3: 판매기간을 설명 문단 대신 한 줄로 되읽는다. */
it('판매기간을 한 줄로 되읽고, 덜 채웠으면 채운 만큼만, 종료가 시작보다 앞이면 그 자리에서 말한다', () => {
  const now = new Date('2026-11-25T03:00:00Z');
  expect(goodsSalePeriodReadback({ saleStartsAt: '2026-12-01T10:00', saleEndsAt: '2026-12-07T23:59' }, now)).toEqual({ text: '12월 1일 10:00부터 7일 23:59까지 팝니다.', problem: false });
  expect(goodsSalePeriodReadback({ saleStartsAt: '2026-12-29T00:00', saleEndsAt: '2027-01-05T00:00' }, now)?.text).toBe('12월 29일 00:00부터 2027년 1월 5일 00:00까지 팝니다.');
  expect(goodsSalePeriodReadback({ saleStartsAt: '2026-12-01T10:00', saleEndsAt: '' }, now)?.text).toBe('12월 1일 10:00부터 팝니다.');
  expect(goodsSalePeriodReadback({ saleStartsAt: '', saleEndsAt: '2026-12-07T23:59' }, now)?.text).toBe('12월 7일 23:59까지 팝니다.');
  expect(goodsSalePeriodReadback({ saleStartsAt: '2026-12-07T10:00', saleEndsAt: '2026-12-01T10:00' }, now)).toEqual({ text: '판매 종료가 판매 시작보다 앞입니다. 날짜를 다시 확인해주세요.', problem: true });
  expect(goodsSalePeriodReadback({}, now)).toBeNull();
  /* 일수 버튼이 채운 값도 그대로 되읽는다(오늘 00:00부터 마지막 판매일 다음 날 00:00까지). */
  expect(goodsSalePeriodReadback(goodsSalePeriodPreset(7, now), now)?.text).toBe('11월 25일 00:00부터 12월 2일 00:00까지 팝니다.');
  expect(kstInputLabel('2026-12-20', now)).toBe('12월 20일');
  expect(kstInputLabel('2026-02-30', now)).toBeNull();
  expect(kstInputRangeLabel('2026-13-01T00:00', '', now)).toBeNull();
});

/* 규칙 5: 판매 시기는 셋 중 하나다. 저장된 상품은 예약 조건을 읽기 전에는 알 수 없어 고르지 못하게 잠근다. */
it('판매 시기는 판매기간·등록 화면의 예약 입력·저장된 상품의 예약 연결로 정한다', () => {
  expect(goodSaleTimingMode({ salePeriodEnabled: false, draftPreorder: false })).toBe('now');
  expect(goodSaleTimingMode({ salePeriodEnabled: true, draftPreorder: false })).toBe('period');
  expect(goodSaleTimingMode({ salePeriodEnabled: false, draftPreorder: true })).toBe('preorder');
  expect(goodSaleTimingMode({ salePeriodEnabled: false, draftPreorder: false, saved: null })).toBeNull();
  expect(goodSaleTimingMode({ salePeriodEnabled: false, draftPreorder: false, saved: { state: 'loading', linked: 0, wanted: true } })).toBeNull();
  expect(goodSaleTimingMode({ salePeriodEnabled: false, draftPreorder: false, saved: { state: 'error', linked: 0, wanted: false } })).toBeNull();
  expect(goodSaleTimingMode({ salePeriodEnabled: true, draftPreorder: false, saved: null })).toBe('period');
  expect(goodSaleTimingMode({ salePeriodEnabled: false, draftPreorder: false, saved: { state: 'ready', linked: 0, wanted: false } })).toBe('now');
  /* 접수를 중지했거나 접수 기간이 끝나도 예약 연결이 남아 있으면 예약판매다([일반 재고 판매로 전환] 전까지). */
  expect(goodSaleTimingMode({ salePeriodEnabled: false, draftPreorder: false, saved: { state: 'ready', linked: 2, wanted: false } })).toBe('preorder');
  expect(goodSaleTimingMode({ salePeriodEnabled: false, draftPreorder: false, saved: { state: 'ready', linked: 0, wanted: true } })).toBe('preorder');
});

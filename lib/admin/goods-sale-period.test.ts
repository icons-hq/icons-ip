import { expect, it } from 'vitest';
import { goodsSalePeriodPreset, readGoodsSalePeriod } from './goods-sale-period';
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

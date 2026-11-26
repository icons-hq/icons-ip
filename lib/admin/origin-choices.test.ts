import { describe, expect, it } from 'vitest';
import { COUNTRY_NAMES } from './country-names';
import { KOREAN_ORIGIN_VALUES, KOREAN_PROVINCES } from './korean-regions';
import { ORIGIN_CHOICE_FILTERS, originChoiceLoader, searchOriginChoices } from './origin-choices';

const values = (query: string, scope = '') => searchOriginChoices(query, scope).map(row => row.value);
async function page(query = '', filter = '', number = 1) {
  const result = await originChoiceLoader({ query, field: '', filter, page: number });
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('원산지 선택창의 줄 목록', () => {
  it('국내 지역은 원산지 칸에 들어가는 글자 그대로, 시·도 다음에 그 시·군·구가 이어진다', () => {
    expect(KOREAN_ORIGIN_VALUES).toHaveLength(16 + 268);
    expect(KOREAN_ORIGIN_VALUES.every(value => /^대한민국\(.+\)$/.test(value))).toBe(true);
    const first = KOREAN_PROVINCES[0];
    expect(KOREAN_ORIGIN_VALUES.slice(0, first.districts.length + 2)).toEqual([
      `대한민국(${first.name})`, ...first.districts.map(district => `대한민국(${first.name} ${district.name})`), `대한민국(${KOREAN_PROVINCES[1].name})`,
    ]);
    /* 시·군·구가 없는 세종은 시·도 한 줄뿐이다. */
    expect(KOREAN_ORIGIN_VALUES.filter(value => value.includes('세종특별자치시'))).toEqual(['대한민국(세종특별자치시)']);
  });

  it('국가·지역 249줄 다음에 국내 지역 284줄이 오고, 줄의 값은 서로 겹치지 않는다', () => {
    const all = searchOriginChoices('');
    expect(all).toHaveLength(249 + 284);
    expect(new Set(all.map(row => row.value)).size).toBe(all.length);
    expect(all.slice(0, 249).map(row => row.value)).toEqual(COUNTRY_NAMES.map(row => row.name));
    expect(all.slice(0, 249).every(row => row.kind === 'country' && row.english)).toBe(true);
    expect(all.slice(249).map(row => row.value)).toEqual(KOREAN_ORIGIN_VALUES);
    expect(all.slice(249).every(row => row.kind === 'domestic' && row.english === '')).toBe(true);
  });

  it('줄에는 국가 코드·법정동 코드를 싣지 않는다', () => {
    const [korea] = searchOriginChoices('KR');
    expect(korea).toEqual({ value: '대한민국', kind: 'country', english: 'South Korea' });
    expect(searchOriginChoices('수원 영통')).toEqual([{ value: '대한민국(경기도 수원시 영통구)', kind: 'domestic', english: '' }]);
  });

  it('범위 조건은 전체·국가·지역·국내 지역이고 고른 범위의 줄만 낸다', async () => {
    expect(ORIGIN_CHOICE_FILTERS.map(option => [option.value, option.label])).toEqual([['', '전체'], ['country', '국가·지역'], ['domestic', '국내 지역']]);
    expect((await page('', 'country')).total).toBe(249);
    expect((await page('', 'domestic')).total).toBe(284);
    expect((await page('', 'domestic')).rows[0].value).toBe(KOREAN_ORIGIN_VALUES[0]);
    expect(values('대한민국', 'country')).toEqual(['대한민국']);
    expect(values('중국', 'domestic')).toEqual([]);
  });

  it('20개씩 마지막 쪽까지 중복·누락 없이 넘기고, 범위를 벗어난 쪽은 마지막 쪽으로 맞춘다', async () => {
    const pages = await Promise.all(Array.from({ length: 27 }, (_, index) => page('', '', index + 1)));
    expect(pages.every(result => result.total === 533 && result.pageSize === 20)).toBe(true);
    expect(pages.slice(0, -1).every(result => result.rows.length === 20)).toBe(true);
    expect(pages[26].rows).toHaveLength(13);
    expect(pages.flatMap(result => result.rows.map(row => row.value))).toEqual(values(''));
    expect((await page('', '', 99)).page).toBe(27);
    expect((await page('', 'country', 99)).page).toBe(13);
    expect((await page('', 'country', 13)).rows).toHaveLength(9);
    expect(await page('없는이름', '', 4)).toEqual({ rows: [], total: 0, page: 1, pageSize: 20 });
    expect((await page('', '', Number.NaN)).page).toBe(1);
  });

  it.each([
    ['수원 영통', ['대한민국(경기도 수원시 영통구)']],
    ['수원시영통구', ['대한민국(경기도 수원시 영통구)']],
    ['경기 김포', ['대한민국(경기도 김포시)']],
    ['대한민국(경기도 김포시)', ['대한민국(경기도 김포시)']],
    ['세종', ['대한민국(세종특별자치시)']],
  ])('국내 지역은 %s처럼 낱말로 찾는다', (query, expected) => {
    expect(values(query)).toEqual(expected);
  });

  it('시 이름으로 찾으면 그 시와 일반구가 함께 나온다', () => {
    expect(values('수원')).toEqual(['대한민국(경기도 수원시)', '대한민국(경기도 수원시 권선구)', '대한민국(경기도 수원시 영통구)', '대한민국(경기도 수원시 장안구)', '대한민국(경기도 수원시 팔달구)']);
  });

  it('대한민국으로 찾으면 나라가 맨 앞에 오고 국내 지역이 이어진다', () => {
    const found = values('대한민국');
    expect(found[0]).toBe('대한민국');
    expect(found.slice(1)).toEqual(KOREAN_ORIGIN_VALUES);
  });

  it('국가·지역은 별칭·영어·정확한 코드로 찾고 국내 지역을 섞지 않는다', () => {
    for (const query of ['한국', 'South Korea', 'KR', 'kor', ' 410 ', 'ＫＲ']) expect(values(query)).toEqual(['대한민국']);
    expect(values('홍콩')).toEqual(['홍콩(중국 특별행정구)']);
    expect(values('Vietnam')).toEqual(['베트남']);
  });
});

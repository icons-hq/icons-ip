import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COUNTRY_NAMES, COUNTRY_NAME_PAGE_SIZE, countryNamePage, findCountryName } from './country-names';

const raw = (path: string) => readFileSync(new URL(path, import.meta.url));
describe('고정 CLDR 국가·지역명 사전', () => {
  it('승인한 원본과 라이선스 및 249개 파생 파일의 해시를 보존한다', () => {
    const source = JSON.parse(raw('../../vendor/unicode-cldr/48.2.0/source.json').toString());
    expect(source.rowCount).toBe(249);
    for (const [name, entry] of Object.entries(source.files)) {
      expect(createHash('sha256').update(raw(`../../vendor/unicode-cldr/48.2.0/${name}`)).digest('hex')).toBe((entry as { sha256: string }).sha256);
    }
    expect(createHash('sha256').update(raw('./country-names-data.json')).digest('hex')).toBe(source.generatedSha256);
    expect(raw('../../public/licenses/unicode-cldr-48.2.0.txt')).toEqual(raw('../../vendor/unicode-cldr/48.2.0/LICENSE'));
    expect(source.license).toBe('Unicode-3.0');
  });
  it('국가·지역 코드가 중복되지 않고 상위 지역·특수·폐기 코드를 포함하지 않는다', () => {
    expect(COUNTRY_NAMES).toHaveLength(249);
    expect(new Set(COUNTRY_NAMES.map(row => row.code)).size).toBe(249);
    expect(COUNTRY_NAMES.every(row => row.name && row.english && /^[A-Z]{2}$/.test(row.code))).toBe(true);
    for (const code of ['AC', 'CP', 'CQ', 'DG', 'EA', 'IC', 'TA', 'XK', 'EU', 'ZZ', 'AN', 'XA', 'XB', '001']) expect(findCountryName(code)).toBeUndefined();
    expect(COUNTRY_NAMES.map(row => row.name)).toEqual(COUNTRY_NAMES.map(row => row.name).sort((a, b) => a.localeCompare(b, 'ko')));
  });
  it.each(['대한민국', '한국', 'South Korea', 'KR', 'kor', ' 410 ', 'ＫＲ'])('%s 검색은 코드 대신 대한민국을 적용할 수 있게 한다', query => {
    expect(countryNamePage(query).rows.map(row => [row.code, row.name])).toEqual([['KR', '대한민국']]);
  });
  it('한글·영문 별칭은 검색에만 쓰고 기본 명칭을 임의로 바꾸지 않는다', () => {
    expect(countryNamePage('홍콩').rows[0]).toMatchObject({ code: 'HK', name: '홍콩(중국 특별행정구)' });
    expect(countryNamePage('United States').rows[0]).toMatchObject({ code: 'US', name: '미국' });
    expect(findCountryName('AU')?.name).toBe('오스트레일리아');
  });
  it('20개씩 마지막 9개까지 중복·누락 없이 이동하고 빈 결과도 1페이지로 처리한다', () => {
    expect(COUNTRY_NAME_PAGE_SIZE).toBe(20);
    const pages = Array.from({ length: 13 }, (_, i) => countryNamePage('', i + 1));
    expect(pages.slice(0, -1).every(page => page.rows.length === 20)).toBe(true);
    expect(pages[12].rows).toHaveLength(9);
    expect(pages.flatMap(page => page.rows.map(row => row.code))).toEqual(COUNTRY_NAMES.map(row => row.code));
    expect(countryNamePage('', 99).page).toBe(13);
    expect(countryNamePage('없는국가명', 4)).toEqual({ rows: [], total: 0, page: 1, pages: 1 });
    expect(countryNamePage('', Number.NaN).page).toBe(1);
  });
});

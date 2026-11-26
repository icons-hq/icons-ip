import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COUNTRY_NAMES, findCountryName, searchCountryNames } from './country-names';

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
    expect(searchCountryNames(query).map(row => [row.code, row.name])).toEqual([['KR', '대한민국']]);
  });
  it('한글·영문 별칭은 검색에만 쓰고 기본 명칭을 임의로 바꾸지 않는다', () => {
    expect(searchCountryNames('홍콩')[0]).toMatchObject({ code: 'HK', name: '홍콩(중국 특별행정구)' });
    expect(searchCountryNames('United States')[0]).toMatchObject({ code: 'US', name: '미국' });
    expect(findCountryName('AU')?.name).toBe('오스트레일리아');
  });
  it('빈 검색어는 가나다순 전체이고 없는 이름은 빈 결과다', () => {
    expect(searchCountryNames('')).toBe(COUNTRY_NAMES);
    expect(searchCountryNames('   ')).toHaveLength(249);
    expect(searchCountryNames('없는국가명')).toEqual([]);
  });
  it('국가 코드는 정확히 같을 때만 찾아 이름에 그 글자가 든 다른 나라를 섞지 않는다', () => {
    /* 'kr'은 Ukraine의 영어 이름에도 들어 있다. 코드와 정확히 같으면 그 나라만 낸다. */
    expect(searchCountryNames('kr').map(row => row.code)).toEqual(['KR']);
    expect(searchCountryNames('ukr').map(row => row.code)).toEqual(['UA']);
    expect(searchCountryNames('ukra').map(row => row.code)).toEqual(['UA']);
  });
});

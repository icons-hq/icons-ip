import data from './country-names-data.json';

export type CountryName = {
  code: string; alpha3: string; numeric: string; name: string; english: string; aliases: string[];
};
export const COUNTRY_NAME_SOURCE = {
  version: '48.2.0',
  url: 'https://github.com/unicode-org/cldr-json/tree/48.2.0',
  licenseUrl: '/licenses/unicode-cldr-48.2.0.txt',
} as const;

/** Codes only identify/search the dictionary. Product and workbook values remain Korean text. */
export const COUNTRY_NAMES: readonly CountryName[] = [...data].sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.code.localeCompare(b.code));
const searchable = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('ko').replace(/\s+/g, '');
const searchRows = COUNTRY_NAMES.map(row => ({ row, text: [row.name, row.english, ...row.aliases].map(searchable) }));

export function findCountryName(code: string): CountryName | undefined {
  return COUNTRY_NAMES.find(row => row.code === code);
}

/**
 * 국가·지역을 찾는다(가나다순). 빈 검색어는 전체다.
 * 한국어·영어 이름과 별칭('한국')은 띄어쓰기·대소문자·전각을 무시하고 들어 있는지로 찾는다.
 * 국가 코드(KR·KOR·410)는 화면에 보이지 않지만 정확히 같으면 그 나라만 낸다.
 */
export function searchCountryNames(query: string): readonly CountryName[] {
  const term = searchable(query);
  if (!term) return COUNTRY_NAMES;
  const exactCodes = COUNTRY_NAMES.filter(row => [row.code, row.alpha3, row.numeric].some(code => searchable(code) === term));
  return exactCodes.length ? exactCodes : searchRows.filter(({ text }) => text.some(value => value.includes(term))).map(({ row }) => row);
}

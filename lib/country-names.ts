import data from './admin/country-names-data.json';

export type CountryName = typeof data[number];

/** 가입과 상품 원산지 선택에서 같은 CLDR 국가·지역명과 별칭을 사용한다. */
export const COUNTRY_NAMES: readonly CountryName[] = [...data].sort(
  (a, b) => a.name.localeCompare(b.name, 'ko') || a.code.localeCompare(b.code),
);
const byCode = new Map(COUNTRY_NAMES.map(country => [country.code, country]));

export function findCountryName(code: string): CountryName | undefined {
  return byCode.get(code);
}

export function normalizeCountrySearch(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ko').replace(/\s+/g, '');
}

export interface CountryOption {
  iso: string;
  label: string;
  dial?: string;
}

export const RESIDENCE_COUNTRIES: readonly CountryOption[] = COUNTRY_NAMES.map(({ code, name }) => ({ iso: code, label: name }));
const englishRegions = new Intl.DisplayNames('en', { type: 'region' });
const isoBySearchCode = new Map<string, string>();
for (const country of COUNTRY_NAMES) {
  isoBySearchCode.set(country.code.toLowerCase(), country.code);
  isoBySearchCode.set(country.alpha3.toLowerCase(), country.code);
}

export function matchesCountry(option: CountryOption, query: string): boolean {
  const term = normalizeCountrySearch(query);
  if (!term) return true;
  if (option.dial && /^\+?\d+$/.test(term)) return option.dial.startsWith(term.replace('+', ''));
  const exactCode = isoBySearchCode.get(term);
  if (exactCode) return option.iso === exactCode;
  if (option.iso.toLowerCase() === term) return true;
  const name = findCountryName(option.iso);
  const english = name?.english ?? (option.iso.length === 2 ? englishRegions.of(option.iso) : '');
  return [option.label, english ?? '', ...(name?.aliases ?? [])].some(text => normalizeCountrySearch(text).includes(term));
}

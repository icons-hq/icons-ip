import data from './country-names-data.json';

export type CountryName = {
  code: string; alpha3: string; numeric: string; name: string; english: string; aliases: string[];
};
export const COUNTRY_NAME_PAGE_SIZE = 20;
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

export function countryNamePage(query: string, requestedPage = 1) {
  const term = searchable(query);
  const exactCodes = term ? COUNTRY_NAMES.filter(row => [row.code, row.alpha3, row.numeric].some(code => searchable(code) === term)) : [];
  const rows = exactCodes.length ? exactCodes : searchRows.filter(({ text }) => !term || text.some(value => value.includes(term))).map(({ row }) => row);
  const pages = Math.max(1, Math.ceil(rows.length / COUNTRY_NAME_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
  return { rows: rows.slice((page - 1) * COUNTRY_NAME_PAGE_SIZE, page * COUNTRY_NAME_PAGE_SIZE), total: rows.length, page, pages };
}

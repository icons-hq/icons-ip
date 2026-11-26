import { searchCountryNames } from './country-names';
import { KOREAN_ORIGIN_VALUES } from './korean-regions';
import { adminPickerLocalPage, adminPickerMatches, type AdminPickerLoader } from './picker';

/**
 * 원산지 선택창(components/admin/CountryNameFinder)의 한 줄.
 * `value`가 원산지 칸과 엑셀에 들어가는 글자이고, 줄의 이름으로 그대로 보인다 — 고르기 전에 무엇이 들어가는지 안다.
 * 국가 코드·법정동 코드는 줄에 싣지 않는다(화면 규칙 8). 값은 서로 겹치지 않아 줄의 키로도 쓴다.
 */
export type OriginChoice = {
  value: string;
  kind: 'country' | 'domestic';
  /** 국가·지역의 영어 이름(같은 이름을 가려내는 보조 글). 국내 지역은 빈 문자열. */
  english: string;
};

/** 선택창의 범위 조건. 첫 항목이 '전체'다. */
export const ORIGIN_CHOICE_FILTERS = [
  { value: '', label: '전체' },
  { value: 'country', label: '국가·지역' },
  { value: 'domestic', label: '국내 지역' },
] as const;

/* 국내 지역은 줄에 보이는 글자 전체로 찾는다. 띄어쓰기를 빼 두어 '수원시영통구'처럼 붙여 적어도 찾는다. */
const DOMESTIC = KOREAN_ORIGIN_VALUES.map(value => ({ choice: { value, kind: 'domestic', english: '' } satisfies OriginChoice, text: value.replace(/\s+/g, '') }));

/**
 * 조건에 맞는 원산지 줄 전체. 국가·지역(가나다순) 다음에 국내 지역(시·도 → 그 시·군·구)이 온다.
 * 국가·지역은 `searchCountryNames`(한국어·영어 이름, 별칭, 정확한 국가 코드)로, 국내 지역은 검색어의 낱말이 모두 들어 있는지로 찾는다('경기 김포', '수원 영통').
 */
export function searchOriginChoices(query: string, scope = ''): OriginChoice[] {
  const countries = scope === 'domestic' ? [] : searchCountryNames(query).map((row): OriginChoice => ({ value: row.name, kind: 'country', english: row.english }));
  const domestic = scope === 'country' ? [] : DOMESTIC.filter(({ text }) => adminPickerMatches(text, query)).map(({ choice }) => choice);
  return [...countries, ...domestic];
}

/** 공용 선택창의 조회. 자료가 모두 코드에 있어 새로 읽는 것이 없고, 찾은 줄을 20개씩 자르기만 한다. */
export const originChoiceLoader: AdminPickerLoader<OriginChoice> = async request =>
  adminPickerLocalPage(searchOriginChoices(request.query, request.filter), { ...request, query: '', filter: '' }, { textOf: () => '' });

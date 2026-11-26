import data from './korean-regions-data.json';

export type KoreanDistrict = { code: string; name: string };
export type KoreanProvince = { code: string; name: string; districts: readonly KoreanDistrict[] };
export const KOREAN_REGION_SOURCE = {
  url: 'https://www.data.go.kr/data/15063424/fileData.do',
  version: '2026-07-29',
} as const;

/** Internal codes identify choices only. The existing origin value stays free text. */
export const KOREAN_PROVINCES: readonly KoreanProvince[] = data.map(province => ({
  ...province, districts: [...province.districts].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
})).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

export function findKoreanProvince(code: string): KoreanProvince | undefined {
  return KOREAN_PROVINCES.find(province => province.code === code);
}

/** Reject stale/mismatched child selections instead of silently applying another region. */
export function koreanOriginValue(provinceCode: string, districtCode = ''): string {
  const province = findKoreanProvince(provinceCode);
  if (!province) return '';
  if (!districtCode) return `대한민국(${province.name})`;
  const district = province.districts.find(row => row.code === districtCode);
  return district ? `대한민국(${province.name} ${district.name})` : '';
}

/**
 * 국내 지역을 원산지 칸에 들어가는 글자 그대로 한 줄씩 편 목록. 시·도 다음에 그 시·도의 시·군·구가 이어진다(둘 다 가나다순).
 * 원산지 선택창이 국가·지역과 같은 목록에 놓아 '수원' 같은 검색어로 바로 찾게 한다. 값은 `koreanOriginValue`가 만든다.
 */
export const KOREAN_ORIGIN_VALUES: readonly string[] = KOREAN_PROVINCES.flatMap(province => [
  koreanOriginValue(province.code), ...province.districts.map(district => koreanOriginValue(province.code, district.code)),
]);

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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { KOREAN_PROVINCES, findKoreanProvince, koreanOriginValue } from './korean-regions';
import metadata from '../../vendor/korean-legal-regions/20260729/source.json';

it('공식 원본과 배포 사전 해시가 검토한 버전에 결속된다', () => {
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  expect(hash('vendor/korean-legal-regions/20260729/legal-regions.csv')).toBe(metadata.sourceSha256);
  expect(hash('lib/admin/korean-regions-data.json')).toBe(metadata.generatedSha256);
  expect(KOREAN_PROVINCES).toHaveLength(16);
  const districts = KOREAN_PROVINCES.flatMap(province => province.districts);
  expect(districts).toHaveLength(268);
  expect(new Set(districts.map(row => row.code)).size).toBe(268);
});

it('시도와 일반구를 구분하고 세종 중복 단계와 폐지 시도는 노출하지 않는다', () => {
  expect(findKoreanProvince('4100000000')?.districts).toHaveLength(55);
  expect(koreanOriginValue('4100000000', '4111700000')).toBe('대한민국(경기도 수원시 영통구)');
  expect(koreanOriginValue('4100000000', '4159700000')).toBe('대한민국(경기도 화성시 동탄구)');
  expect(findKoreanProvince('3600000000')?.districts).toEqual([]);
  expect(koreanOriginValue('3600000000')).toBe('대한민국(세종특별자치시)');
  expect(koreanOriginValue('1200000000')).toBe('대한민국(전남광주통합특별시)');
  expect(findKoreanProvince('2900000000')).toBeUndefined();
  expect(findKoreanProvince('4600000000')).toBeUndefined();
});

it('다른 시도의 하위 코드·읍면동·출장소·없는 선택을 저장 문구로 만들지 않는다', () => {
  for (const [province, district] of [['', ''], ['4100000000', '1111000000'], ['4100000000', '4111710100'], ['4100000000', '4110500000'], ['3600000000', '3611000000'], ['2900000000', '']]) {
    expect(koreanOriginValue(province, district)).toBe('');
  }
});

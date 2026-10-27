import { describe, expect, it } from 'vitest';
import {
  normalizeSuggestedSearchTerm,
  parseSuggestedSearchTerms,
  resolveSuggestedSearchTerms,
  SEARCH_TERM_LIMIT,
  SUGGESTED_SEARCH_TERMS,
  suggestedSearchHref,
} from './search-terms';
import { normalizeSearchQuery } from './search';

describe('추천 검색어 운영 목록 (11 CH-10)', () => {
  it('DB 가 저장한 정규화 목록을 그대로 읽는다', () => {
    expect(parseSuggestedSearchTerms(['리락쿠마', '키링 세트', '100%_굿즈', 'BT21'])).toEqual(['리락쿠마', '키링 세트', '100%_굿즈', 'BT21']);
    expect(parseSuggestedSearchTerms(Array.from({ length: SEARCH_TERM_LIMIT }, (_, index) => `검색어${index}`))).toHaveLength(SEARCH_TERM_LIMIT);
  });

  it.each([
    ['배열이 아님', '키링'],
    ['빈 목록', []],
    ['11개', Array.from({ length: 11 }, (_, index) => `검색어${index}`)],
    ['21자', ['가'.repeat(21)]],
    ['정규화 전 공백', [' 키링']],
    ['겹 공백', ['키링  세트']],
    ['제어 문자', ['키\u0001링']],
    ['대소문자 무시 중복', ['BT21', 'bt21']],
    ['문자열 아님', [21]],
  ])('%s 이면 목록 전체를 버린다(폴백 상수)', (_label, value) => {
    expect(parseSuggestedSearchTerms(value)).toBeNull();
  });

  it('칩 라벨 정규화는 검색 질의 정규화와 같은 결과를 낸다', () => {
    for (const raw of ['  리락쿠마 ', '키링\t  세트', '가 나  다']) {
      expect(normalizeSuggestedSearchTerm(raw)).toBe(normalizeSearchQuery(raw));
    }
  });

  it('운영 목록이 없으면 코드 상수가 폴백이다', () => {
    expect(resolveSuggestedSearchTerms(null)).toBe(SUGGESTED_SEARCH_TERMS);
    expect(resolveSuggestedSearchTerms([])).toBe(SUGGESTED_SEARCH_TERMS);
    expect(resolveSuggestedSearchTerms(['키링'])).toEqual(['키링']);
  });

  it('칩 링크는 입력값을 그대로 인코딩해 검색 결과로 보낸다', () => {
    expect(suggestedSearchHref('100%_굿즈 & 키링')).toBe(`/search?q=${encodeURIComponent('100%_굿즈 & 키링')}`);
    expect(new URL(suggestedSearchHref('100%_굿즈'), 'https://icons.test').searchParams.get('q')).toBe('100%_굿즈');
  });
});

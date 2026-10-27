import { describe, expect, it } from 'vitest';
import {
  describeSearchTermsError,
  liveSuggestedSearchTerms,
  normalizeSuggestedSearchTerm,
  parseSuggestedSearchTerms,
  resolveSuggestedSearchTerms,
  SEARCH_TERM_LIMIT,
  searchTermFieldIssues,
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

  it('요청 시각에 노출 중인 첫 목록을 고르고, 끝난 목록은 건너뛴다', () => {
    const lists = [{ terms: ['가을 한정'], endsAt: 1_000 }, { terms: ['상시'], endsAt: null }];
    expect(liveSuggestedSearchTerms(lists, 999)).toEqual(['가을 한정']);
    expect(liveSuggestedSearchTerms(lists, 1_000)).toEqual(['상시']);
    expect(liveSuggestedSearchTerms([{ terms: ['가을 한정'], endsAt: 1_000 }], 1_000)).toBeNull();
    expect(liveSuggestedSearchTerms([], 0)).toBeNull();
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

  /* l8b-qa-3 — 거절된 목록에서 고칠 칸만 짚는다. */
  it('칸별 문제는 겹친 칸 전부·20자 초과·제어 문자만 짚고 빈 칸·정상 칸은 비운다', () => {
    expect(searchTermFieldIssues(['키링', 'BT21', '', ' bt21 ', '가'.repeat(21), '키\u0001링', '인형']))
      .toEqual([null, 'duplicate', null, 'duplicate', 'too_long', 'control', null]);
    expect(searchTermFieldIssues(['키링', '인형'])).toEqual([null, null]);
  });

  it('목록 오류 문구는 저장 규칙을 지키면 null 이고, 어기면 고칠 것을 적는다', () => {
    expect(describeSearchTermsError(['키링', '', '인형'])).toBeNull();
    expect(describeSearchTermsError(['', ' '])).toBe('추천 검색어를 1개 이상 입력해주세요.');
    expect(describeSearchTermsError(['BT21', 'bt21', 'Bt21'])).toBe('겹치는 추천 검색어가 있습니다: BT21 · bt21 · Bt21. 영문 대소문자는 같은 검색어로 보니 하나만 남겨주세요.');
    expect(describeSearchTermsError([...Array.from({ length: 11 }, (_, index) => `검색어${index}`)])).toBe('추천 검색어는 10개까지 입력할 수 있습니다.');
    /* 규칙 판정은 저장 파서와 같다 — 문구가 null 이면 파서가 받고, 문구가 있으면 파서가 거절한다. */
    for (const terms of [['키링'], ['BT21', 'bt21'], ['가'.repeat(21)], ['키\u0001링'], Array.from({ length: 11 }, (_, index) => `t${index}`)]) {
      const normalized = terms.map(normalizeSuggestedSearchTerm).filter(Boolean);
      expect(describeSearchTermsError(terms) === null).toBe(parseSuggestedSearchTerms(normalized) !== null);
    }
  });
});

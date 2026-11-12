import { describe, expect, it } from 'vitest';
import { resultParticle, topicParticle } from './korean-particle';

describe('topicParticle — 은/는', () => {
  it('한글 음절은 받침(종성) 유무로 고른다', () => {
    expect(topicParticle('빨강')).toBe('은');
    expect(topicParticle('키링')).toBe('은');
    expect(topicParticle('블랙')).toBe('은');
    expect(topicParticle('레드')).toBe('는');
    expect(topicParticle('포토카드 A세트')).toBe('는');
    expect(topicParticle('화이트')).toBe('는');
  });

  it('아라비아 숫자는 한국어로 읽는 끝소리로 고른다(끝자리 0은 십·백·천·만이라 받침)', () => {
    for (const word of ['1', '3', '6', '7', '8', '10', '100', '0', '포토카드 21']) expect(topicParticle(word)).toBe('은');
    for (const word of ['2', '4', '5', '9', '포토카드 12', '2025']) expect(topicParticle(word)).toBe('는');
  });

  it('읽는 소리가 정해지지 않은 영문·기호 끝은 은(는)으로 둘 다 적는다', () => {
    expect(topicParticle('Red')).toBe('은(는)');
    expect(topicParticle('XL')).toBe('은(는)');
    expect(topicParticle('★')).toBe('은(는)');
    expect(topicParticle('')).toBe('은(는)');
  });

  it('끝의 괄호 덧붙임과 기호는 앞말을 따른다', () => {
    expect(topicParticle('블랙(L)')).toBe('은');
    expect(topicParticle('레드 (대형)')).toBe('는');
    expect(topicParticle('레드!')).toBe('는');
    expect(topicParticle('  빨강  ')).toBe('은');
    expect(topicParticle('(한정)')).toBe('은');
  });
});

describe('resultParticle — 로/으로', () => {
  it('받침 없음·ㄹ 받침은 로, 그 밖의 받침은 으로', () => {
    expect(resultParticle('피규어')).toBe('로');
    expect(resultParticle('굴')).toBe('로');
    expect(resultParticle('인형')).toBe('으로');
    expect(resultParticle('문구')).toBe('로');
    expect(resultParticle('키링')).toBe('으로');
    expect(resultParticle('아크릴')).toBe('로');
    expect(resultParticle('기타')).toBe('로');
    expect(resultParticle('세트')).toBe('로');
    expect(resultParticle('8')).toBe('로');
    expect(resultParticle('3')).toBe('으로');
  });
  it('판정할 수 없으면 (으)로', () => {
    expect(resultParticle('ABC')).toBe('(으)로');
  });
});

import { describe, expect, it } from 'vitest';
import { directionParticle, objectParticle, topicParticle } from './korean-particle';

describe('directionParticle — 로/으로', () => {
  it('받침 없음·ㄹ 받침은 로, 그 밖의 받침은 으로', () => {
    expect(directionParticle('ICONS 표준 양식')).toBe('으로');
    expect(directionParticle('기존 창고 양식')).toBe('으로');
    expect(directionParticle('서원 송장양식')).toBe('으로');
    expect(directionParticle('파일')).toBe('로');
    expect(directionParticle('택배사')).toBe('로');
    expect(directionParticle('8')).toBe('로');
    expect(directionParticle('3')).toBe('으로');
    expect(directionParticle('2')).toBe('로');
  });
  it('판정 불가는 (으)로', () => {
    expect(directionParticle('CSV')).toBe('(으)로');
  });
});

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

/* QA1 고객: 직접입력 필수 안내가 '각인 문구을(를)'처럼 두 조사를 다 적었다. */
describe('objectParticle — 을/를', () => {
  it('받침 유무로 고르고, 판정할 수 없으면 둘 다 적는다', () => {
    expect(objectParticle('각인 문구')).toBe('를');
    expect(objectParticle('이니셜')).toBe('을');
    expect(objectParticle('문구 3')).toBe('을');
    expect(objectParticle('문구 2')).toBe('를');
    expect(objectParticle('Name')).toBe('을(를)');
  });
});

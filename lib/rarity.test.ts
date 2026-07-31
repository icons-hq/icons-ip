import { describe, expect, it } from 'vitest';
import { isRarityKey, rarityTag, RARITY_META, RARITY_ORDER } from './rarity';

describe('RARITY_ORDER', () => {
  it('희귀도 내림차순이고 모든 등급을 한 번씩 담는다', () => {
    expect(RARITY_ORDER).toEqual(['HOLO', 'SSR', 'SR', 'R', 'N']);
    expect(new Set(RARITY_ORDER).size).toBe(Object.keys(RARITY_META).length);
  });
});

describe('isRarityKey', () => {
  it.each(Object.keys(RARITY_META))('%s를 등급으로 인정한다', (key) => {
    expect(isRarityKey(key)).toBe(true);
  });

  it.each([['ur'], [''], ['n'], [null], [undefined], [0], [{}]])(
    '등급이 아닌 값 %s는 거른다',
    (value) => {
      expect(isRarityKey(value)).toBe(false);
    },
  );

  it('Object.prototype의 키를 등급으로 착각하지 않는다', () => {
    expect(isRarityKey('toString')).toBe(false);
    expect(isRarityKey('constructor')).toBe(false);
  });
});

describe('rarityTag', () => {
  it('HOLO는 홀로 그라디언트 위에 잉크색 글자를 쓴다', () => {
    expect(rarityTag('HOLO')).toEqual({
      color: '#0A0813',
      bg: 'var(--holo)',
      ring: `${RARITY_META.HOLO.color}99`,
    });
  });

  it('R만 밝은 cyan이라 글자를 잉크색으로 뒤집는다', () => {
    expect(rarityTag('R').color).toBe('#0A0813');
    expect(rarityTag('SR').color).toBe('var(--text)');
    expect(rarityTag('SSR').color).toBe('var(--text)');
  });

  it('N은 등급색 대신 중립 배경을 쓴다', () => {
    expect(rarityTag('N').bg).toBe('rgba(8,6,15,.75)');
  });

  it('모든 등급이 세 값을 빠짐없이 낸다', () => {
    for (const rarity of RARITY_ORDER) {
      const tag = rarityTag(rarity);
      expect(tag.color).toBeTruthy();
      expect(tag.bg).toBeTruthy();
      expect(tag.ring).toBeTruthy();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeProfileNickname } from '@/lib/profile';
import { AUTO_NICKNAME_PREFIX, generateAutoNickname } from './nickname';

describe('generateAutoNickname (1014-004)', () => {
  it('makes a fan_ + 8 lowercase alphanumeric nickname that passes the shared nickname validator', () => {
    for (let index = 0; index < 50; index += 1) {
      const nickname = generateAutoNickname();
      expect(nickname).toMatch(/^fan_[a-z0-9]{8}$/);
      expect(normalizeProfileNickname(nickname)).toEqual({ ok: true, value: nickname });
    }
  });

  it('draws every character from the injected random source', () => {
    let calls = 0;
    const nickname = generateAutoNickname((max) => {
      calls += 1;
      expect(max).toBe(36);
      return 35;
    });

    expect(calls).toBe(8);
    expect(nickname).toBe(`${AUTO_NICKNAME_PREFIX}99999999`);
    expect(generateAutoNickname(() => 0)).toBe('fan_aaaaaaaa');
  });
});

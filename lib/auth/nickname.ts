import { randomInt } from 'node:crypto';

/*
 * 가입 간소화(10/14 회의 1014-004): 온보딩은 닉네임을 묻지 않고 자동으로 만든다. 닉네임은 설정에서 언제든
 * 바꿀 수 있다(나중에 변경). 모양은 닉네임이 없는 회원에게 이미 쓰는 표시 폴백(`fan_` + 사용자 id 앞 6자,
 * lib/catalog.ts·lib/community.server.ts)과 같은 `fan_` 접두를 따르되, 저장되는 값이라 profiles.nickname의
 * unique 제약에 부딪히지 않도록 사용자 id가 아닌 무작위 8자를 쓴다(36^8 ≈ 2.8조 가지).
 * 그래도 충돌하면(23505) 호출부가 새 값으로 다시 시도한다.
 */
export const AUTO_NICKNAME_PREFIX = 'fan_';
export const AUTO_NICKNAME_SUFFIX_LENGTH = 8;
export const AUTO_NICKNAME_MAX_ATTEMPTS = 5;
const AUTO_NICKNAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export type NicknameRandom = (maxExclusive: number) => number;

export function generateAutoNickname(random: NicknameRandom = randomInt): string {
  let suffix = '';
  for (let index = 0; index < AUTO_NICKNAME_SUFFIX_LENGTH; index += 1) {
    suffix += AUTO_NICKNAME_ALPHABET[random(AUTO_NICKNAME_ALPHABET.length)];
  }
  return `${AUTO_NICKNAME_PREFIX}${suffix}`;
}

/**
 * 한국어 조사 고르기 — 앞말 끝소리에 받침이 있는지로 고른다.
 *
 * 끝소리를 판정할 수 있는 앞말만 한쪽으로 고른다.
 * - 한글 음절: 종성 유무.
 * - 아라비아 숫자: 한국어로 읽는 끝소리. 1 일·3 삼·6 육·7 칠·8 팔은 받침, 2 이·4 사·5 오·9 구는 받침 없음.
 *   끝자리 0은 영·십·백·천·만이라 언제나 받침이다.
 * 영문·기호처럼 읽는 소리가 하나로 정해지지 않은 끝은 '은(는)'처럼 둘 다 적는다.
 * 끝의 괄호 덧붙임('블랙(L)')은 괄호 앞말('블랙')을 따른다.
 */

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
/* 끝에 붙은 괄호 덧붙임 한 겹. 앞말이 있어야 떼어 낸다('(한정)'만 있으면 그대로 둔다). */
const TRAILING_GROUP = /^(.*\S)\s*[(（[［][^()（）[\]［］]*[)）\]］]$/u;
const TRAILING_SYMBOLS = /[^\p{L}\p{N}]+$/u;
const DIGIT_WITH_FINAL = new Set(['0', '1', '3', '6', '7', '8']);

/** 앞말 끝에 받침이 있으면 true, 없으면 false, 판정할 수 없으면 null. */
function hasFinalConsonant(word: string): boolean | null {
  let text = word.trim();
  for (let match = TRAILING_GROUP.exec(text); match; match = TRAILING_GROUP.exec(text)) text = match[1];
  const last = [...text.replace(TRAILING_SYMBOLS, '')].at(-1);
  if (!last) return null;
  const code = last.codePointAt(0)!;
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) return (code - HANGUL_FIRST) % 28 !== 0;
  if (last >= '0' && last <= '9') return DIGIT_WITH_FINAL.has(last);
  return null;
}

/** 주제 조사 은/는. 판정할 수 없으면 '은(는)'. */
export function topicParticle(word: string): '은' | '는' | '은(는)' {
  const final = hasFinalConsonant(word);
  return final === null ? '은(는)' : final ? '은' : '는';
}

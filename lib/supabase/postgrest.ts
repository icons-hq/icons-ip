/* PostgREST 필터 문법 헬퍼. `not('col', 'in', ...)` 같은 자리는 값 목록을
   괄호로 감싼 문자열을 요구하는데, 이 서식이 갈리면 필터가 조용히 무시된다. */

/** `('a','b')`가 아니라 `(a,b)` — PostgREST의 in 목록 서식이다. */
export const postgrestInList = (values: readonly string[]) => `(${values.join(',')})`;

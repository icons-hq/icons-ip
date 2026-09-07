/*
 * 저장이 실패했을 때 제출값 보존 (전수 수리).
 *
 * React 19 는 액션이 끝나면 비제어 폼을 초기화한다 — **실패해도 마찬가지**라서 운영자가
 * 채운 값이 통째로 사라진다. 열 칸을 채우고 저장을 눌렀다가 「이미 쓰는 코드입니다」 한 줄을
 * 보고 처음부터 다시 치는 일이 실제로 보고됐다(현업 취합 2026-09-07 3-4 #2).
 *
 * 그래서 실패 상태에 제출된 문자열 필드를 실어 보내고, 폼이 그 값으로 다시 시드한다.
 * 파일 입력은 되돌릴 수 없으므로 뺀다(브라우저가 값을 돌려주지 않는다).
 */

/** 제출된 문자열 필드. 파일은 제외한다. */
export function submittedValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * 실패 상태에 제출값을 붙인다.
 *
 * **성공에는 붙이지 않는다** — 성공한 폼은 비워지거나 저장된 레코드로 다시 그려져야 하고,
 * 거기에 옛 제출값이 남으면 「저장됐는데 화면은 방금 친 값」이라는 더 나쁜 상태가 된다.
 */
export function keepSubmittedValues<T extends object>(
  state: T,
  formData: FormData,
): T & { values: Record<string, string> } {
  return { ...state, values: submittedValues(formData) };
}

/**
 * 액션 하나를 감싸 **실패에만** 제출값을 붙인다.
 *
 * 실패 반환 지점마다 손으로 붙이면 새 분기가 생길 때마다 하나씩 빠진다 — 문을 하나로 둔다.
 * 성공(에러 없음)·리다이렉트는 그대로 통과한다.
 */
export async function preserveValues<S extends object>(
  formData: FormData,
  run: () => Promise<S>,
): Promise<S> {
  const next = await run();
  return next && isFailedActionState(next) ? { ...next, values: submittedValues(formData) } : next;
}

/*
 * 실패 판정. 어드민 액션 상태가 한 모양이 아니다 — `errors`(필드별 지도)를 쓰는 폼도 있고
 * `error`(한 줄 메시지)를 쓰는 폼도 있다. 둘 다 실패로 본다.
 *
 * 성공에 값을 붙이면 「저장됐는데 화면은 방금 친 값」이 되므로, 애매하면 안 붙이는 쪽이다.
 */
function isFailedActionState(state: object): boolean {
  const candidate = state as { errors?: unknown; error?: unknown };
  if (typeof candidate.error === 'string' && candidate.error.length > 0) return true;
  const errors = candidate.errors;
  return Boolean(errors) && typeof errors === 'object' && Object.keys(errors as object).length > 0;
}

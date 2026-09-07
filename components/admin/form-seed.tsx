'use client';

import { createContext, useContext } from 'react';

/*
 * 저장 실패 시 제출값을 폼 안으로 내려 보내는 통로 (전수 수리).
 *
 * 필드마다 `defaultValue={seed.x ?? record?.x}` 를 손으로 쓰면 폼 하나에 열 번, 어드민
 * 전체로는 150번 넘게 같은 문장을 반복해야 하고, 새 필드를 넣을 때마다 빠뜨릴 자리가 하나씩
 * 늘어난다. **폼이 값을 한 번 내려 주고, 필드는 자기 `name` 으로 찾아 쓴다.**
 *
 * `<select>` 만 예외 처리가 필요하다 — React 는 마운트 뒤의 `defaultValue` 변경을 무시하므로,
 * 시드가 바뀌면 안쪽 요소를 다시 마운트해야 값이 붙는다(`fields.tsx` 의 key).
 */

const SeedContext = createContext<Record<string, string> | null>(null);

/** 이 필드에 되돌릴 제출값. 없으면 `undefined` — 필드는 원래 `defaultValue` 를 쓴다. */
export function useFieldSeed(name: string | undefined): string | undefined {
  const values = useContext(SeedContext);
  if (!values || !name) return undefined;
  return values[name];
}

type SeededFormProps = React.FormHTMLAttributes<HTMLFormElement> & {
  /** 액션이 실패하며 돌려준 제출값. 성공·초기 상태에서는 `undefined` 다. */
  values?: Record<string, string>;
};

/**
 * 실패한 제출값을 안쪽 필드에 되돌려 주는 `<form>`.
 *
 * 폼마다 액션 상태가 따로라 컨텍스트도 폼 단위다 — 화면 전체에 하나 두면 옆 폼의 실패값이
 * 이 폼으로 새어 든다.
 */
export function SeededForm({ children, values, ...formProps }: SeededFormProps) {
  return (
    <SeedContext.Provider value={values ?? null}>
      <form {...formProps}>{children}</form>
    </SeedContext.Provider>
  );
}

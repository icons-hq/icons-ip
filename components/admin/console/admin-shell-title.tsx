'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** 셸이 h1로 그리는 화면 제목. 셸 밖(단위 테스트·미리보기)에서는 비어 있다. */
const AdminShellTitleContext = createContext<string | undefined>(undefined);

export function AdminShellTitleProvider({ title, children }: { title: string; children: ReactNode }) {
  return <AdminShellTitleContext.Provider value={title}>{children}</AdminShellTitleContext.Provider>;
}

const normalize = (value: string) => value.replace(/\s+/g, '');

/**
 * 화면 머리 제목(h2). 셸 h1과 같은 이름이면 화면에서는 감추고(스크린리더에는 남긴다) 설명·동작만 보인다 —
 * 같은 제목이 두 번 연달아 서지 않게 한다.
 */
export function AdminPageHeading({ title }: { title: string }) {
  const shellTitle = useContext(AdminShellTitleContext);
  const duplicate = shellTitle !== undefined && normalize(shellTitle) === normalize(title);
  /* 인쇄에서는 셸 제목(h1)을 숨기므로 감췄던 h2를 다시 보인다. */
  return <h2
    className={duplicate
      ? 'sr-only print:not-sr-only print:text-lg print:font-semibold'
      : 'text-base leading-tight font-semibold text-foreground'}
    data-shell-duplicate={duplicate || undefined}
  >{title}</h2>;
}

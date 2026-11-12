'use client';

import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';

/**
 * ERP 품목 화면의 패널 사이 연결(1027T-016·1027T-X04). 반입이 끝나면 반입 패널이 방금 붙여넣은 품목으로
 * '연결 상품 반영' 비교를 시작하고, '미연결 분류 N건 — 연결하기'가 분류 연결 표를 '연결 필요만'으로 연다.
 * 각 패널은 자기 동작을 등록만 하고 상태는 자기가 가진다. 등록이 없으면(패널 단독 렌더·시험) 아무 일도 하지 않는다.
 */
export interface ErpItemsWorkspaceHandlers {
  /** 방금 반입한 ERP 코드로 연결 상품과 비교한다. 비교 패널로 스크롤한다. */
  comparePasted(codes: readonly string[]): void;
  /** 분류 연결 표를 연결 필요만 보이게 하고 그곳으로 옮긴다. */
  showUnlinkedCategories(): void;
}

interface ErpItemsWorkspaceRegistry extends ErpItemsWorkspaceHandlers {
  registerCompare(handler: ((codes: readonly string[]) => void) | null): void;
  registerUnlinked(handler: (() => void) | null): void;
}

const ErpItemsWorkspaceContext = createContext<ErpItemsWorkspaceRegistry | null>(null);

export function ErpItemsWorkspace({ children }: { children: ReactNode }) {
  const compare = useRef<((codes: readonly string[]) => void) | null>(null);
  const unlinked = useRef<(() => void) | null>(null);
  const registry = useMemo<ErpItemsWorkspaceRegistry>(() => ({
    registerCompare(handler) { compare.current = handler; },
    registerUnlinked(handler) { unlinked.current = handler; },
    comparePasted(codes) { compare.current?.(codes); },
    showUnlinkedCategories() { unlinked.current?.(); },
  }), []);
  return <ErpItemsWorkspaceContext.Provider value={registry}>{children}</ErpItemsWorkspaceContext.Provider>;
}

/** 패널이 쓰는 연결. 화면 밖(단독 렌더)에서는 null이다. */
export function useErpItemsWorkspace(): ErpItemsWorkspaceRegistry | null {
  return useContext(ErpItemsWorkspaceContext);
}

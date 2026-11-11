'use client';

import { createContext, useContext, type ReactNode } from 'react';

const CategoryTemplatesAvailable = createContext(false);

/**
 * 고를 수 있는 `자주 쓰는 카테고리`(카테고리 템플릿)가 있는지 서버가 알려 준 값.
 * 상품 편집기까지 여러 층을 지나는 값이라 대표 카테고리 칸이 직접 읽는다. 값을 주지 않으면 없음으로 쳐서 버튼을 그리지 않는다.
 */
export function CategoryTemplatesAvailableProvider({ available, children }: { available: boolean; children: ReactNode }) {
  return <CategoryTemplatesAvailable.Provider value={available}>{children}</CategoryTemplatesAvailable.Provider>;
}

export function useCategoryTemplatesAvailable() {
  return useContext(CategoryTemplatesAvailable);
}

'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { COLLECTIBLE_FEATURES_OFF, type CollectibleFeatures } from '@/lib/collectible-features';

/* 루트 레이아웃이 서버에서 읽은 공개 스위치(lib/collectible-features.server.ts 의 캐시 읽기)를 화면 안 링크로 내려준다.
   공급자 밖(시험·단독 렌더)의 기본값은 꺼짐이다 — 값을 모르면 링크를 그리지 않는다. 노출만 정한다:
   라우트·서버 동작은 매 요청 DB 값을 따로 확인한다. */
const CollectibleFeaturesContext = createContext<CollectibleFeatures>(COLLECTIBLE_FEATURES_OFF);

export function CollectibleFeaturesProvider({ value, children }: { value: CollectibleFeatures; children: ReactNode }) {
  return <CollectibleFeaturesContext.Provider value={value}>{children}</CollectibleFeaturesContext.Provider>;
}

export function useCollectibleFeatures(): CollectibleFeatures {
  return useContext(CollectibleFeaturesContext);
}

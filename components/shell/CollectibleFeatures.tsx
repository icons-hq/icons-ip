'use client';

import { createContext, useContext, type ReactNode } from 'react';

/* 임시 호환 껍데기(2026-11-24 일반 쇼핑몰 전환, ADR-0052).
   카드 바인더·굿즈 마켓·카드 트레이드 화면과 공개 스위치는 삭제했다. 이 파일은 아직 정리되지 않은 IP 상세
   (`components/screens/IpDetail.tsx`, 다른 작업이 고치는 중)의 바인더 링크가 컴파일되도록 남긴 것이다.
   루트 레이아웃이 더 이상 공급자를 두지 않으므로 값은 언제나 꺼짐이고 링크는 그려지지 않는다.
   IP 상세에서 바인더 링크를 지우면 이 파일도 함께 지운다. */
export type CollectibleFeatures = { binder: boolean; market: boolean; exchange: boolean };

const COLLECTIBLE_FEATURES_OFF: CollectibleFeatures = Object.freeze({ binder: false, market: false, exchange: false });
const CollectibleFeaturesContext = createContext<CollectibleFeatures>(COLLECTIBLE_FEATURES_OFF);

export function CollectibleFeaturesProvider({ value, children }: { value: CollectibleFeatures; children: ReactNode }) {
  return <CollectibleFeaturesContext.Provider value={value}>{children}</CollectibleFeaturesContext.Provider>;
}

export function useCollectibleFeatures(): CollectibleFeatures {
  return useContext(CollectibleFeaturesContext);
}

'use client';

import { createContext, isValidElement, useContext, type ReactNode } from 'react';
import type { GoodSaleTimingMode, SavedPreorderTimingStatus } from '@/lib/admin/goods-sale-period';

/*
 * 판매 시기(GoodSaleTiming)와 그 안의 예약판매 자리(등록 화면 입력 · 저장된 상품의 별도 저장 패널)를 잇는다.
 * 판매 시기는 지금 고른 선택을 내려 주고, 저장된 상품의 패널은 불러온 예약 상태를 올려 준다 — 패널이 예약 조건을 스스로 읽기 때문이다.
 */

/** 저장된 상품의 패널이 알리는 상태. `setWanted`는 운영자가 고른 '예약판매'를 패널 쪽(상품별 보관)에 남긴다. */
export interface SavedPreorderTimingReport extends SavedPreorderTimingStatus { setWanted: (wanted: boolean) => void }
export interface GoodSaleTimingBridge {
  /** 지금 고른 판매 시기. 저장된 상품의 예약 조건을 아직 읽지 못했으면 null. */
  mode: GoodSaleTimingMode | null;
  report: (status: SavedPreorderTimingReport | null) => void;
}
const Bridge = createContext<GoodSaleTimingBridge | null>(null);
export const GoodSaleTimingProvider = Bridge.Provider;
/** 판매 시기 밖(다른 화면·시험)에서는 null이다. 그때 예약판매 자리는 스스로 열려 있다. */
export function useGoodSaleTiming() { return useContext(Bridge); }

/** 예약판매 자리의 종류: 등록 화면 입력('draft')인지 저장된 상품의 패널('saved')인지. */
export type GoodPreorderSlotKind = 'draft' | 'saved';
/** 자리 부품(GoodWorkspacePreorderRow·GoodSavedPreorderSection)에 붙이는 표식(함수의 정적 속성 이름). 판매 시기가 첫 그리기부터 종류를 안다. */
export const GOOD_PREORDER_SLOT_KIND = 'goodPreorderSlotKind';
export function goodPreorderSlotKind(slot: ReactNode): GoodPreorderSlotKind | null {
  if (!isValidElement(slot)) return null;
  const kind = typeof slot.type === 'function' ? (slot.type as unknown as Record<string, unknown>)[GOOD_PREORDER_SLOT_KIND] : undefined;
  return kind === 'draft' || kind === 'saved' ? kind : null;
}

'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { AdminNotice } from './console/AdminKit';
import { Button } from './kit/ui/button';
import { GoodsDiscountStopPriceDialog, useDiscountStopPrice, type DiscountStopTarget } from './GoodsDiscountStopPriceDialog';
import { GoodsOptionStockDialog, useOptionStockDialog, type OptionStockTarget } from './GoodsOptionStockDialog';
import { discountStopPriceDoneNotice } from './goods-inline-bulk';

/*
 * 상품 목록 바로 수정의 두 창(옵션별 재고·할인 중지 후 판매가 변경)을 목록 화면 수준에서 연다.
 * 행의 칸은 창을 여는 값 버튼과 창에 넘길 상품 값(스냅샷)만 갖는다. 창과 그 상태는 표 밖(같은 어드민 화면 안)에 있어
 * - 표의 선택자(최소 폭·칸 정렬)와 칸의 글자 굵기가 창 안에 걸리지 않고,
 * - 저장 뒤 목록이 다시 그려지며 그 상품이 현재 페이지에서 빠져도(품절 필터·정렬 이동) 창과 결과가 남는다.
 * 창이 모두 저장하고 닫히면 결과 문구를 목록 위(GoodsInlineDialogNotice)에 남긴다 — 그 상품이 목록에서 빠져도 보인다.
 */
interface GoodsInlineDialogs {
  openOptionStock: (target: OptionStockTarget) => void;
  openDiscountStop: (target: DiscountStopTarget) => void;
  notice: string;
  dismissNotice: () => void;
}
const GoodsInlineDialogContext = createContext<GoodsInlineDialogs | null>(null);

/** 목록 칸이 창을 연다. 목록 화면 밖(창 주인이 없음)에서는 null이라 칸은 값만 보인다. */
export function useGoodsInlineDialogs() { return useContext(GoodsInlineDialogContext); }

export function GoodsInlineDialogHost({ identity, children }: { identity?: GoodsGroupIdentity; children: ReactNode }) {
  const [notice, setNotice] = useState('');
  const stock = useOptionStockDialog({ onSaved: (target, count) => setNotice(`‘${target.goodName}’ 옵션 ${count.toLocaleString('ko-KR')}개의 재고수량을 저장했습니다.`) });
  const discount = useDiscountStopPrice({ identity, onDone: (target, price, stoppedHere) => setNotice(discountStopPriceDoneNotice(target.goodName, price, stoppedHere)) });
  /* 창은 한 번에 하나만 연다(모달). 새 창을 열면 지난 결과 문구는 지운다. */
  const value: GoodsInlineDialogs = {
    openOptionStock(target) { if (discount.phase || stock.rows) return; setNotice(''); stock.open(target); },
    openDiscountStop(target) { if (discount.phase || stock.rows) return; setNotice(''); discount.open(target); },
    notice, dismissNotice: () => setNotice(''),
  };
  return <GoodsInlineDialogContext.Provider value={value}>
    {children}
    <GoodsOptionStockDialog flow={stock} />
    <GoodsDiscountStopPriceDialog flow={discount} />
  </GoodsInlineDialogContext.Provider>;
}

/** 창이 모두 저장하고 닫힌 뒤의 결과 문구. 목록 위에 두고 다음 창을 열거나 닫기를 누르면 지운다. */
export function GoodsInlineDialogNotice() {
  const dialogs = useGoodsInlineDialogs();
  if (!dialogs?.notice) return null;
  return <AdminNotice role="status" tone="success" title={dialogs.notice}>
    <Button type="button" size="xs" variant="ghost" className="-my-1" onClick={dialogs.dismissNotice}><X aria-hidden="true" />닫기</Button>
  </AdminNotice>;
}

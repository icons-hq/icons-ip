'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * 창이 모두 저장하고 닫히면 결과 문구를 목록 위(GoodsInlineDialogNotice)에 남긴다. 그 상품이 목록에 남으면 포커스는 그 행의 값 버튼으로
 * 돌아가고(창이 돌려줌) 바뀐 값이 그 자리에 보인다. 목록에서 빠지면 값 버튼이 사라지므로 결과 문구를 화면에 들이고 포커스를 옮긴다.
 */
/** 모두 저장되어 창이 닫힌 결과. `id`는 같은 문구가 다시 생겨도 한 번씩만 화면에 들이도록 매번 바뀐다. */
export interface GoodsInlineNotice { id: number; goodId: string; text: string }
interface GoodsInlineDialogs {
  openOptionStock: (target: OptionStockTarget) => void;
  openDiscountStop: (target: DiscountStopTarget) => void;
  notice: GoodsInlineNotice | null;
  dismissNotice: () => void;
}
const GoodsInlineDialogContext = createContext<GoodsInlineDialogs | null>(null);

/** 목록 칸이 창을 연다. 목록 화면 밖(창 주인이 없음)에서는 null이라 칸은 값만 보인다. */
export function useGoodsInlineDialogs() { return useContext(GoodsInlineDialogContext); }

export function GoodsInlineDialogHost({ identity, children }: { identity?: GoodsGroupIdentity; children: ReactNode }) {
  const [notice, setNotice] = useState<GoodsInlineNotice | null>(null);
  const sequence = useRef(0);
  const show = (goodId: string, text: string) => { sequence.current += 1; setNotice({ id: sequence.current, goodId, text }); };
  const stock = useOptionStockDialog({ onSaved: (target, count) => show(target.goodId, `‘${target.goodName}’ 옵션 ${count.toLocaleString('ko-KR')}개의 재고수량을 저장했습니다.`) });
  const discount = useDiscountStopPrice({ identity, onDone: (target, price, stoppedHere) => show(target.goodId, discountStopPriceDoneNotice(target.goodName, price, stoppedHere)) });
  /* 창은 한 번에 하나만 연다(모달). 새 창을 열면 지난 결과 문구는 지운다. */
  const value: GoodsInlineDialogs = {
    openOptionStock(target) { if (discount.phase || stock.rows) return; setNotice(null); stock.open(target); },
    openDiscountStop(target) { if (discount.phase || stock.rows) return; setNotice(null); discount.open(target); },
    notice, dismissNotice: () => setNotice(null),
  };
  return <GoodsInlineDialogContext.Provider value={value}>
    {children}
    <GoodsOptionStockDialog flow={stock} />
    <GoodsDiscountStopPriceDialog flow={discount} />
  </GoodsInlineDialogContext.Provider>;
}

/**
 * 결과 문구를 화면에 들일지: 그 상품이 지금 목록에서 빠졌고(`listed`가 false), 이 결과를 아직 들이지 않았을 때만이다.
 * 상품이 목록에 남으면 포커스는 창이 그 행의 값 버튼으로 돌려주므로 화면을 옮기지 않는다(보던 자리를 잃지 않는다).
 */
export function goodsInlineNoticeNeedsReveal(notice: GoodsInlineNotice | null, listed: boolean, revealedId: number): notice is GoodsInlineNotice {
  return notice !== null && !listed && notice.id !== revealedId;
}

/**
 * 창이 모두 저장하고 닫힌 뒤의 결과 문구. 목록 위에 두고 다음 창을 열거나 닫기를 누르면 지운다.
 * 저장 뒤 목록이 다시 그려져 그 상품이 목록에서 빠지면(필터·정렬) 운영자가 아래로 스크롤해 있어도 이 문구를 화면에 들이고 포커스를 옮긴다.
 */
export function GoodsInlineDialogNotice({ listedGoodIds }: { listedGoodIds: readonly string[] }) {
  const dialogs = useGoodsInlineDialogs();
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useRef(0);
  const notice = dialogs?.notice ?? null;
  /* 목록이 다시 그려질 때마다(그 상품이 빠졌는지) 다시 본다. 한 결과는 한 번만 들인다. */
  const listed = notice ? listedGoodIds.includes(notice.goodId) : true;
  useEffect(() => {
    if (!goodsInlineNoticeNeedsReveal(notice, listed, revealed.current)) return;
    revealed.current = notice.id;
    ref.current?.scrollIntoView({ block: 'nearest' });
    ref.current?.focus({ preventScroll: true });
  }, [notice, listed]);
  if (!notice) return null;
  return <div ref={ref} tabIndex={-1} className="outline-none" data-goods-inline-notice="">
    <AdminNotice role="status" tone="success" title={notice.text}>
      <Button type="button" size="xs" variant="ghost" className="-my-1" onClick={dialogs?.dismissNotice}><X aria-hidden="true" />닫기</Button>
    </AdminNotice>
  </div>;
}

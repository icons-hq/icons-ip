'use client';

import { buttonVariants } from '@/components/admin/kit/ui/button';
import { preorderCapacityFromStock, preorderCapacityStockNote } from '@/lib/admin/goods-preorders';
import { GOOD_DETACHED_FORM_ID } from './GoodWorkspace';

/**
 * 예약 물량 칸 아래 안내(11/19 '예약 물량 = 재고수량'). 재고수량을 따라가는 중이면 그 사실을, 직접 고친 값이 재고수량과 다르면
 * 경고와 [재고수량과 같게]를 보인다. 막지는 않는다.
 */
export function PreorderCapacityStockHint({ fromStock, capacity, stockQty, disabled, onUseStock }: {
  fromStock: boolean; capacity: string; stockQty: number | null | undefined; disabled?: boolean; onUseStock: () => void;
}) {
  const stock = preorderCapacityFromStock(stockQty);
  if (fromStock) {
    return <p className="text-xs text-muted-foreground" data-preorder-capacity-stock="follow">{stock
      ? `재고수량 ${Number(stock).toLocaleString('ko-KR')}개를 예약 물량으로 씁니다. 재고수량을 바꾸면 따라 바뀝니다.`
      : '재고수량이 0이라 예약 물량을 직접 입력합니다.'}</p>;
  }
  const note = preorderCapacityStockNote(capacity, stockQty);
  return note ? <div className="flex flex-col items-start gap-1" data-preorder-capacity-stock="differs">
    <p className="text-xs font-medium text-warning">{note}</p>
    {stock ? <button className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" form={GOOD_DETACHED_FORM_ID} type="button" disabled={disabled} onClick={onUseStock}>재고수량과 같게</button> : null}
  </div> : null;
}

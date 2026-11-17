import type { ReactNode } from 'react';
import { ADULT_GOOD_LABEL } from '@/lib/adult-goods';
import { krw } from '@/lib/format';
import { goodsImageBackground } from '@/lib/goods-image';
import { orderLinePriceDisplay, visibleOptionName, type OrderLineView } from '@/lib/orders/order-lines';
import '@/app/styles/wc-order-history.css';

/**
 * 주문 품목 한 줄(MD-0036·0037): 썸네일 · IP명 · 굿즈명 · 옵션 · 수량 · 구매가/정가. 주문내역과 주문 상세가 함께 쓴다.
 * 서버 컴포넌트로 그릴 수 있다(훅·상태 없음). 줄 아래 부가 정보(직접 입력 옵션·예약 발송일)는 `children`으로 받는다.
 * 줄을 감싸는 목록(`ul`/`li`)은 호출부가 정한다.
 *
 * 부분 취소(재고 부족)가 있으면 수량·가격은 남은 수량 기준이고, 취소된 수량은 줄 아래에 따로 적는다(`line.canceledQty`).
 * 남은 수량이 0이면 `0개`와 가격을 그리지 않고 `{원래 수량}개 취소됨`만 보인다.
 */
export function OrderLineItem({ line, children }: { line: OrderLineView; children?: ReactNode }) {
  const option = visibleOptionName(line.optionName);
  const price = orderLinePriceDisplay(line);
  const thumbnail = goodsImageBackground(line.thumbnail);
  const canceledQty = line.canceledQty ?? 0;
  const fullyCanceled = line.qty < 1 && canceledQty > 0;

  return (
    <div className="wc-order-line">
      {line.adultMasked ? (
        /* 19금 굿즈는 인증 전에 이미지를 보이지 않는다 — 이름은 주문 스냅샷이라 그대로 보인다. */
        <span className="wc-order-line__thumb wc-order-line__thumb--adult">
          <span aria-hidden>19</span>
          <span className="wc-sr-only">{ADULT_GOOD_LABEL}</span>
        </span>
      ) : (
        <span aria-hidden className="wc-order-line__thumb" style={thumbnail ? { background: thumbnail } : undefined} />
      )}
      <div className="wc-order-line__body">
        {line.ipName ? <p className="wc-order-line__ip">{line.ipName}</p> : null}
        <p className="wc-order-line__name">{line.name}</p>
        {option ? <p className="wc-order-line__option">옵션 {option}</p> : null}
        {fullyCanceled ? null : <p className="wc-order-line__qty">{line.qty.toLocaleString('ko-KR')}개</p>}
        {canceledQty > 0 ? (
          <p className="wc-order-line__canceled" data-order-item-canceled={canceledQty}>
            {`${fullyCanceled ? '' : '· '}${canceledQty.toLocaleString('ko-KR')}개 취소됨`}
          </p>
        ) : null}
        {children}
      </div>
      {price && !fullyCanceled ? (
        <p className="wc-order-line__price">
          {price.strike !== null ? (
            <>
              <span className="wc-sr-only">구매가격 </span>
              <strong>{krw(price.primary)}</strong>
              <span className="wc-sr-only"> 정가 </span>
              <del>{krw(price.strike)}</del>
            </>
          ) : (
            <strong>{krw(price.primary)}</strong>
          )}
        </p>
      ) : null}
    </div>
  );
}

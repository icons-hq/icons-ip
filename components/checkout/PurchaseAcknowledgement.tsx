import Link from 'next/link';
import { checkoutAcknowledgementText } from '@/lib/checkout-acknowledgement';
import { LEGAL_DOCUMENT_LABELS, legalDocumentHref } from '@/lib/legal/links';

/*
 * 결제 전 주문 내용 확인·구매 조건 동의(원장 PAY-015). 두 주문서(Checkout·GoodsTransactionCheckout)가 결제 버튼 바로 위에 둔다.
 * 카드는 다음 화면 토스 위젯 약관에, 무통장은 버튼 한 번에 기대던 빈틈을 주문 생성 전에 메운다. 체크 전에는 결제 버튼이 잠기고,
 * 서버 액션도 true가 아니면 거절한다(화면을 건너뛴 요청 방지). 청약철회가 제한되는 굿즈가 있으면 같은 동의에 그 사실이 더해진다.
 */
export function PurchaseAcknowledgement({
  checked,
  disabled = false,
  hasRestrictedGoods,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  hasRestrictedGoods: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="checkout-acknowledgement" data-restricted={hasRestrictedGoods ? 'true' : undefined}>
      <label className="checkout-acknowledgement__label">
        <input
          type="checkbox"
          name="purchaseAcknowledgement"
          checked={checked}
          disabled={disabled}
          aria-describedby="checkout-acknowledgement-links"
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{checkoutAcknowledgementText(hasRestrictedGoods)} <em>필수</em></span>
      </label>
      <p className="checkout-acknowledgement__links" id="checkout-acknowledgement-links">
        <Link href={legalDocumentHref('terms')} rel="noopener" target="_blank">{LEGAL_DOCUMENT_LABELS.terms}<span className="wc-sr-only"> 새 창</span></Link>
        {' · '}
        <Link href={legalDocumentHref('shipping')} rel="noopener" target="_blank">{LEGAL_DOCUMENT_LABELS.shipping}<span className="wc-sr-only"> 새 창</span></Link>
      </p>
    </div>
  );
}

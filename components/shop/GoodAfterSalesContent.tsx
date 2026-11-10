import type { GoodsAfterSalesValues } from '@/lib/goods-after-sales';

export function GoodAfterSalesContent({ value }: { value: GoodsAfterSalesValues | null }) {
  if (!value?.phone || !value.guide) return null;
  return <section className="wc-goods-after-sales" aria-label="A/S 안내와 구매 추가정보">
    <h2>A/S 안내</h2>
    <dl><div><dt>A/S 전화번호</dt><dd>{value.phone}</dd></div><div><dt>A/S 안내</dt><dd>{value.guide}</dd></div></dl>
    {value.sellerSpecialNotes ? <section aria-label="판매자 특이사항"><h3>판매자 특이사항</h3><p>{value.sellerSpecialNotes}</p></section> : null}
  </section>;
}

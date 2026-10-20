'use client';
import type { GoodsAfterSalesValues } from '@/lib/goods-after-sales';

export function GoodsAfterSalesFields({ values, onChange }: { values: GoodsAfterSalesValues; onChange: (value: GoodsAfterSalesValues) => void }) {
  const update = (key: keyof GoodsAfterSalesValues, value: string, limit: number) => onChange({ ...values, [key]: Array.from(value).slice(0, limit).join('') });
  return <>
    <label className="admin-goods-after-sales__field">A/S 전화번호 (필수)<input type="tel" value={values.phone} maxLength={40} required onChange={event => update('phone', event.target.value, 20)} /><small>{Array.from(values.phone).length}/20</small></label>
    <p>구매 후 A/S 문의에 사용할 연락처입니다. 상품정보고시의 A/S 책임자·전화번호와 별도로 저장합니다.</p>
    <label className="admin-goods-after-sales__field">A/S 안내 (필수)<textarea value={values.guide} maxLength={2600} rows={6} required onChange={event => update('guide', event.target.value, 1300)} /><small>{Array.from(values.guide).length}/1,300</small></label>
    <label className="admin-goods-after-sales__field">판매자 특이사항<textarea value={values.sellerSpecialNotes} maxLength={2600} rows={6} onChange={event => update('sellerSpecialNotes', event.target.value, 1300)} /><small>{Array.from(values.sellerSpecialNotes).length}/1,300</small></label>
    <p>배송 기간·방법, 교환·반품 추가 비용, 판매 지역·수량 등 구매 전에 확인할 특이사항을 적어주세요. 상품 상세 하단에 표시합니다.</p>
  </>;
}

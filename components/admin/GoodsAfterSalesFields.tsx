'use client';
import type { GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { GOOD_INPUT_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 상품별 A/S 패널·템플릿 편집·그룹 공통정보(C 트랙)가 같이 쓴다. 글자 수 칸은 입력과 같은 라벨에 둔다. */
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';
const COUNT_CLASS = 'self-end text-xs text-muted-foreground tabular-nums';
const TEXTAREA_CLASS = `${GOOD_TEXTAREA_CLASS} min-h-32 resize-y whitespace-pre-wrap`;

export function GoodsAfterSalesFields({ values, onChange }: { values: GoodsAfterSalesValues; onChange: (value: GoodsAfterSalesValues) => void }) {
  const update = (key: keyof GoodsAfterSalesValues, value: string, limit: number) => onChange({ ...values, [key]: Array.from(value).slice(0, limit).join('') });
  return <>
    <label className={`${FIELD_CLASS} sm:max-w-xs`} data-goods-after-sales-field="phone"><span className="font-medium">A/S 전화번호 (필수)</span><input className={GOOD_INPUT_CLASS} data-slot="input" type="tel" value={values.phone} maxLength={40} required onChange={event => update('phone', event.target.value, 20)} /><small className={COUNT_CLASS}>{Array.from(values.phone).length}/20</small></label>
    <p className="text-sm text-muted-foreground">구매 후 A/S 문의에 사용할 연락처입니다. 상품정보고시의 A/S 책임자·전화번호와 별도로 저장합니다.</p>
    <label className={FIELD_CLASS} data-goods-after-sales-field="guide"><span className="font-medium">A/S 안내 (필수)</span><textarea className={TEXTAREA_CLASS} data-slot="textarea" value={values.guide} maxLength={2600} rows={6} required onChange={event => update('guide', event.target.value, 1300)} /><small className={COUNT_CLASS}>{Array.from(values.guide).length}/1,300</small></label>
    <label className={FIELD_CLASS} data-goods-after-sales-field="seller-notes"><span className="font-medium">판매자 특이사항</span><textarea className={TEXTAREA_CLASS} data-slot="textarea" value={values.sellerSpecialNotes} maxLength={2600} rows={6} onChange={event => update('sellerSpecialNotes', event.target.value, 1300)} /><small className={COUNT_CLASS}>{Array.from(values.sellerSpecialNotes).length}/1,300</small></label>
    <p className="text-sm text-muted-foreground">배송 기간·방법, 교환·반품 추가 비용, 판매 지역·수량 등 구매 전에 확인할 특이사항을 적어주세요. 상품 상세 하단에 표시합니다.</p>
  </>;
}

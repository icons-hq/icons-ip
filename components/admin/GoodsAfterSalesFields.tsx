'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import type { GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { GOOD_INPUT_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 상품별 A/S 패널·템플릿 편집·그룹 공통정보(C 트랙)가 같이 쓴다. 글자 수 칸은 입력과 같은 라벨에 둔다. */
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';
const COUNT_CLASS = 'self-end text-xs text-muted-foreground tabular-nums';
const TEXTAREA_CLASS = `${GOOD_TEXTAREA_CLASS} min-h-32 resize-y whitespace-pre-wrap`;

/**
 * 상품 편집기가 알려 주는 그 상품의 상품정보고시 A/S 연락처(저장값). 템플릿 편집·그룹 공통정보 화면은 알려 주지 않아 비어 있다.
 * ADM-004(복잡도 표 387행): 같은 연락처를 두 번 입력하지 않게 A/S 전화번호를 미리 채운다. 저장은 지금처럼 안내 저장으로 따로 한다(값 복사만).
 */
export const GoodsAfterSalesPhoneSuggestion = createContext('');
/** 고시 A/S 연락처가 전화번호 모양일 때만 쓴다(이메일·설명 문구는 채우지 않는다). 칸 상한은 20자다. */
export function afterSalesPhoneSuggestion(contact: string | null | undefined): string {
  const value = (contact ?? '').trim();
  return /^[0-9+()\-.\s]{7,20}$/.test(value) && /\d{3}/.test(value.replace(/\D/g, '')) ? value : '';
}

/**
 * 저장된 안내를 다 읽어 칸을 처음 고칠 수 있게 된 때(바깥 fieldset이 풀린 때) 한 번만 정한다: 전화번호가 비어 있으면 고시 연락처를 넣는다.
 * 그 뒤 지우거나 안내를 해제해도 다시 채우지 않는다. 읽기 전에는 패널이 칸을 잠가 두므로(빈 칸으로 보이는 미확인 기록) 그때는 정하지 않는다.
 */
function AfterSalesPhonePrefill({ phone, onFill }: { phone: string; onFill: (phone: string) => void }) {
  const suggestion = afterSalesPhoneSuggestion(useContext(GoodsAfterSalesPhoneSuggestion));
  const marker = useRef<HTMLSpanElement>(null);
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || !marker.current || marker.current.closest('fieldset:disabled')) return;
    decided.current = true;
    if (suggestion && !phone.trim()) onFill(suggestion);
  });
  return <span className="contents" ref={marker}>
    {suggestion && phone.trim() === suggestion ? <small className="text-xs text-muted-foreground" data-goods-after-sales-prefill="">상품정보고시의 A/S 연락처와 같은 번호입니다. 바꾸려면 직접 고친 뒤 안내 저장을 누릅니다.</small> : null}
  </span>;
}

export function GoodsAfterSalesFields({ values, onChange }: { values: GoodsAfterSalesValues; onChange: (value: GoodsAfterSalesValues) => void }) {
  const update = (key: keyof GoodsAfterSalesValues, value: string, limit: number) => onChange({ ...values, [key]: Array.from(value).slice(0, limit).join('') });
  return <>
    <label className={`${FIELD_CLASS} sm:max-w-xs`} data-goods-after-sales-field="phone"><span className="font-medium">A/S 전화번호 (필수)</span><input className={GOOD_INPUT_CLASS} data-slot="input" type="tel" value={values.phone} maxLength={40} required onChange={event => update('phone', event.target.value, 20)} /><small className={COUNT_CLASS}>{Array.from(values.phone).length}/20</small></label>
    <AfterSalesPhonePrefill phone={values.phone} onFill={(phone) => update('phone', phone, 20)} />
    <p className="text-sm text-muted-foreground">구매 후 A/S 문의에 사용할 연락처입니다. 상품정보고시의 A/S 책임자·전화번호와 별도로 저장합니다.</p>
    <label className={FIELD_CLASS} data-goods-after-sales-field="guide"><span className="font-medium">A/S 안내 (필수)</span><textarea className={TEXTAREA_CLASS} data-slot="textarea" value={values.guide} maxLength={2600} rows={6} required onChange={event => update('guide', event.target.value, 1300)} /><small className={COUNT_CLASS}>{Array.from(values.guide).length}/1,300</small></label>
    <label className={FIELD_CLASS} data-goods-after-sales-field="seller-notes"><span className="font-medium">판매자 특이사항</span><textarea className={TEXTAREA_CLASS} data-slot="textarea" value={values.sellerSpecialNotes} maxLength={2600} rows={6} onChange={event => update('sellerSpecialNotes', event.target.value, 1300)} /><small className={COUNT_CLASS}>{Array.from(values.sellerSpecialNotes).length}/1,300</small></label>
    <p className="text-sm text-muted-foreground">배송 기간·방법, 교환·반품 추가 비용, 판매 지역·수량 등 구매 전에 확인할 특이사항을 적어주세요. 상품 상세 하단에 표시합니다.</p>
  </>;
}

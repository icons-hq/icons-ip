'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import type { GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { GOOD_INPUT_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 상품별 A/S 패널·템플릿 편집(forTemplate)·그룹 공통정보(C 트랙)가 같이 쓴다. 글자 수 칸은 입력과 같은 라벨에 둔다. */
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
  /* 이 칸은 고시의 A/S 연락처와 따로 저장된다. 고시 번호로 미리 채웠을 때는 그 사실을 같은 줄에서 말한다. */
  const same = Boolean(suggestion) && phone.trim() === suggestion;
  return <span className="contents" ref={marker}>
    <small className="text-xs text-muted-foreground" data-goods-after-sales-prefill={same ? '' : undefined}>{same ? '상품정보제공고시의 A/S 연락처와 같은 번호입니다. 이 칸은 따로 저장됩니다.' : '상품정보제공고시의 A/S 연락처와는 따로 저장됩니다.'}</small>
  </span>;
}

export function GoodsAfterSalesFields({ values, onChange, forTemplate = false, readOnly = false }: {
  values: GoodsAfterSalesValues; onChange: (value: GoodsAfterSalesValues) => void;
  /** 템플릿 편집 창이면 true. 템플릿에는 상품도 상품정보제공고시도 없어, 고시 연락처 한 줄과 미리 채움을 두지 않는다. */
  forTemplate?: boolean;
  /** 고칠 수는 없지만 글자를 긁어 복사할 수 있게 둔다(다른 사람이 먼저 바꿔 저장이 멈춘 동안 — 잠근 칸에서는 복사가 안 되는 브라우저가 있다). */
  readOnly?: boolean;
}) {
  const update = (key: keyof GoodsAfterSalesValues, value: string, limit: number) => onChange({ ...values, [key]: Array.from(value).slice(0, limit).join('') });
  return <>
    <label className={`${FIELD_CLASS} sm:max-w-xs`} data-goods-after-sales-field="phone"><span className="font-medium">A/S 전화번호 (필수)</span><input className={GOOD_INPUT_CLASS} data-slot="input" type="tel" value={values.phone} maxLength={40} required readOnly={readOnly} onChange={event => update('phone', event.target.value, 20)} /><small className={COUNT_CLASS}>{Array.from(values.phone).length}/20</small></label>
    {forTemplate ? null : <AfterSalesPhonePrefill phone={values.phone} onFill={(phone) => update('phone', phone, 20)} />}
    <label className={FIELD_CLASS} data-goods-after-sales-field="guide"><span className="font-medium">A/S 안내 (필수)</span><textarea className={TEXTAREA_CLASS} data-slot="textarea" value={values.guide} maxLength={2600} rows={6} required readOnly={readOnly} placeholder="예: 접수 방법, 처리 기간, 무상 수리 범위" onChange={event => update('guide', event.target.value, 1300)} /><small className={COUNT_CLASS}>{Array.from(values.guide).length}/1,300</small></label>
    <label className={FIELD_CLASS} data-goods-after-sales-field="seller-notes"><span className="font-medium">판매자 특이사항 (선택)</span><textarea className={TEXTAREA_CLASS} data-slot="textarea" value={values.sellerSpecialNotes} maxLength={2600} rows={6} readOnly={readOnly} placeholder="예: 배송 기간·방법, 교환·반품 추가 비용, 판매 지역·수량" onChange={event => update('sellerSpecialNotes', event.target.value, 1300)} /><small className={COUNT_CLASS}>{Array.from(values.sellerSpecialNotes).length}/1,300</small></label>
    <p className="text-xs text-muted-foreground">{forTemplate ? '템플릿을 가져간 상품의 상세 하단에 A/S 안내와 판매자 특이사항이 보입니다.' : 'A/S 안내와 판매자 특이사항은 상품 상세 하단에 보입니다.'}</p>
  </>;
}

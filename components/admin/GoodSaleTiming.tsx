'use client';

import type { ReactNode } from 'react';
import { GoodsSalePeriodFields } from './GoodsSalePeriodFields';
import { GoodEditorSubsection } from './GoodWorkspace';

/**
 * 판매 정보 카드의 '언제 파는지' 영역: 판매기간과 예약판매.
 * 판매기간 값은 상품 폼이 제출하고(name 있는 입력), 예약판매는 상위가 넘긴 자리(`preorderSlot`)에 그린다 —
 * 등록 화면은 상품과 함께 저장하는 입력, 저장된 상품은 별도 저장 패널이다.
 */
export function GoodSaleTiming({ values, error, errorCount, onChange, preorderSlot }: {
  values: Record<string, string>;
  error?: string;
  errorCount: number;
  onChange: (patch: Record<string, string>) => void;
  preorderSlot?: ReactNode;
}) {
  return <>
    <GoodEditorSubsection title="판매기간" id="good-section-period" errorCount={errorCount} summary={values.salePeriodEnabled === 'true' ? `${values.saleStartsAt?.replace('T', ' ') || '시작 미입력'} ~ ${values.saleEndsAt?.replace('T', ' ') || '종료 미입력'} · KST` : '설정안함'}>
      <GoodsSalePeriodFields values={values} error={error} onChange={onChange} />
    </GoodEditorSubsection>
    {/* 예약판매 입력은 이름이 없고 소속 폼을 뗐다(GOOD_DETACHED_FORM_ID). Enter로 상품이 저장되지 않게 막고, 자동복구는 이 안의 입력을 수정으로 세지 않는다. */}
    {preorderSlot ? <div className="contents" data-good-preorder-slot="" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>{preorderSlot}</div> : null}
  </>;
}

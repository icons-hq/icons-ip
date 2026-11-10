'use client';

import { useEffect, useState } from 'react';
import { suggestGoodsIdentifiersAction } from '@/app/admin/goods-identifier-actions';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { ErrorText } from './fields';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

export function GoodIdentifierFields({ ipId, name, code='', defaultVariantCode='', slug='', slugLocked=false, hideVariantCode=false, onCodeSuggestion, errors }: {
  ipId: string; name: string; code?: string; defaultVariantCode?: string; slug?: string;
  slugLocked?: boolean; hideVariantCode?: boolean; onCodeSuggestion?: (code: string) => void; errors: Record<string,string>;
}) {
  const [suggestion,setSuggestion]=useState<Awaited<ReturnType<typeof suggestGoodsIdentifiersAction>>>(null);
  const [values,setValues]=useState({code,defaultVariantCode,id:slug});
  useEffect(()=>{
    if (!ipId || !name.trim()) return;
    let active=true;
    const timer=setTimeout(()=>{
      void suggestGoodsIdentifiersAction(ipId,name).then((result)=>{if(active){setSuggestion(result);onCodeSuggestion?.(result?.code ?? '');}}).catch(()=>{});
    },300);
    return ()=>{active=false;clearTimeout(timer);};
  },[ipId,name,onCodeSuggestion]);
  const fields=[
    {key:'code' as const,label:ADMIN_VOCABULARY.goodsCode,placeholder:suggestion?.code,limit:100},
    {key:'defaultVariantCode' as const,label:ADMIN_VOCABULARY.optionCode,placeholder:suggestion?.defaultVariantCode,limit:120},
    {key:'id' as const,label:'상품 URL',placeholder:suggestion?.slug,limit:64},
  ];
  /* AdminFormGrid와 같은 격자(ADR-0028). 라벨이 입력·도움말을 함께 감싸 누르는 자리가 넓다. */
  return <fieldset className="m-0 grid min-w-0 gap-x-6 gap-y-5 border-0 p-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(16rem,calc((100%-1.5rem)/2))),1fr))]" data-good-identifier-fields="">
    <legend className="sr-only">판매자상품코드와 상품 URL</legend>
    {fields.filter((field) => !hideVariantCode || field.key !== 'defaultVariantCode').map((field)=><label className="flex min-w-0 flex-col gap-2" key={field.key}>
      <span className="text-sm leading-snug font-medium text-foreground">{field.label}</span>
      <input aria-describedby={`${field.key}-help`} aria-invalid={Boolean(errors[field.key])} className={GOOD_INPUT_CLASS} data-slot="input"
        maxLength={field.limit} name={field.key} onChange={(event)=>setValues((current)=>({...current,[field.key]:event.target.value}))}
        placeholder={field.placeholder??'비워두면 자동 생성'} readOnly={field.key==='id'&&slugLocked} value={values[field.key]} />
      <span className="text-sm text-muted-foreground" id={`${field.key}-help`}>
        {field.key==='id'&&slugLocked?'한 번 공개한 URL은 변경할 수 없습니다.':
          field.key==='id'?'비워두면 상품명에서 자동 생성합니다.':'비워두면 자동 생성합니다. 창고 품번으로 덮어쓸 수 있습니다.'}
      </span>
      <ErrorText>{errors[field.key]}</ErrorText>
    </label>)}
  </fieldset>;
}

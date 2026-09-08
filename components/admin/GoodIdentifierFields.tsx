'use client';

import { useEffect, useState } from 'react';
import { suggestGoodsIdentifiersAction } from '@/app/admin/goods-identifier-actions';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { ErrorText } from './fields';

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
    {key:'defaultVariantCode' as const,label:`${ADMIN_VOCABULARY.option}코드`,placeholder:suggestion?.defaultVariantCode,limit:120},
    {key:'id' as const,label:'URL 슬러그',placeholder:suggestion?.slug,limit:64},
  ];
  return <fieldset className="admin-form-grid" style={{border:0,padding:0,margin:0}}>
    <legend className="sr-only">상품코드와 URL</legend>
    {fields.filter((field) => !hideVariantCode || field.key !== 'defaultVariantCode').map((field)=><label className="col" key={field.key} style={{gap:7}}>
      <span className="mono" style={{color:'var(--dim)',fontSize:11}}>{field.label}</span>
      <input aria-describedby={`${field.key}-help`} aria-invalid={Boolean(errors[field.key])} className="admin-field-control"
        maxLength={field.limit} name={field.key} onChange={(event)=>setValues((current)=>({...current,[field.key]:event.target.value}))}
        placeholder={field.placeholder??'비워두면 자동 생성'} readOnly={field.key==='id'&&slugLocked} value={values[field.key]} />
      <span className="muted" id={`${field.key}-help`} style={{fontSize:12}}>
        {field.key==='id'&&slugLocked?'한 번 공개한 URL은 변경할 수 없습니다.':
          field.key==='id'?'비워두면 상품명에서 자동 생성합니다.':'비워두면 자동 생성합니다. 창고 품번으로 덮어쓸 수 있습니다.'}
      </span>
      <ErrorText>{errors[field.key]}</ErrorText>
    </label>)}
  </fieldset>;
}

'use client';

import { useEffect, useState } from 'react';
import { suggestGoodsIdentifiersAction } from '@/app/admin/goods-identifier-actions';
import { autoCodeBarcodeWarning, looksLikeBarcode } from '@/lib/admin/goods-code-hint';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { goodCodeSegment, goodDetailHref } from '@/lib/goods-display';
import { CANONICAL_SITE_ORIGIN } from '@/lib/site-domains.mjs';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { ErrorText } from './fields';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

type IdentifierKey = 'code' | 'defaultVariantCode' | 'id';
type AutoCodeKey = Exclude<IdentifierKey, 'id'>;

export const AUTO_CODE_BADGE = '자동 생성 · 입력할 필요 없음';
/** 코드 칸을 열고 고칠 때 보이는 안내. 잠겨 있을 때는 입력할 일이 없어 보이지 않는다. */
export const AUTO_CODE_HELP = '바코드·ERP 코드는 여기에 넣지 않고, 옵션 상세 정보의 바코드·ERP 코드 칸에 넣습니다.';
/** 고객 화면 주소 칸의 안내(ADR-0050). 상품 자동코드를 직접 바꿀 때만 보인다 — 바꾸면 주소가 함께 바뀌어 옛 주소로 들어온 고객이 상품을 찾지 못한다. */
export const GOOD_ADDRESS_HELP = '상품 자동코드를 바꾸면 이 주소도 바뀌어, 바꾸기 전 주소로 들어온 고객은 상품을 찾지 못합니다. 이미 알린 주소가 있으면 새 주소로 다시 알려주세요.';
const SITE_HOST = new URL(CANONICAL_SITE_ORIGIN).host;

/**
 * 잠긴 칸은 저장할 때 지금 값을 그대로 보내도록 입력을 남긴 채 읽기 전용으로 둔다(GOOD_INPUT_CLASS의 read-only 모양).
 * 상품 자동코드·옵션 자동코드는 시스템이 저장할 때 만든다(2026-11-19 MD가 바코드를 이 칸에 넣은 사고, ADR-0048).
 * 기본은 잠가 '자동 생성 · 입력할 필요 없음'을 보이고, 창고 품번처럼 정해진 코드가 있거나 잘못 들어간 값을 고칠 때만 '직접 바꾸기'로 연다.
 * 잠긴 칸도 같은 값을 보내므로 저장 계약(빈 값이면 새로 만들고, 기존 상품은 지금 코드를 지킨다)은 그대로다.
 */
/*
 * 고객 화면 주소(ADR-0050, MD-0051): 상품 상세는 `/shop/<상품 자동코드 소문자>`로 열린다. 예전 'URL' 칸에 보이던 내부 id(상품명을
 * 로마자로 바꾼 값)는 주소가 아니므로 입력·표시하지 않고 숨은 값으로 그대로 보낸다 — 저장 계약(비우면 자동 생성, 기존 상품은 그대로)은 같다.
 */
export function GoodIdentifierFields({ ipId, name, code='', defaultVariantCode='', slug='', hideVariantCode=false, onCodeSuggestion, errors }: {
  ipId: string; name: string; code?: string; defaultVariantCode?: string; slug?: string;
  hideVariantCode?: boolean; onCodeSuggestion?: (code: string) => void; errors: Record<string,string>;
}) {
  const [suggestion,setSuggestion]=useState<Awaited<ReturnType<typeof suggestGoodsIdentifiersAction>>>(null);
  const [values,setValues]=useState({code,defaultVariantCode,id:slug});
  /* 저장 오류가 난 자동코드 칸은 고칠 수 있게 열어 둔다. */
  const [unlocked,setUnlocked]=useState<Record<AutoCodeKey,boolean>>({code:Boolean(errors.code),defaultVariantCode:Boolean(errors.defaultVariantCode)});
  useEffect(()=>{
    if (!ipId || !name.trim()) return;
    let active=true;
    const timer=setTimeout(()=>{
      void suggestGoodsIdentifiersAction(ipId,name).then((result)=>{if(active){setSuggestion(result);onCodeSuggestion?.(result?.code ?? '');}}).catch(()=>{});
    },300);
    return ()=>{active=false;clearTimeout(timer);};
  },[ipId,name,onCodeSuggestion]);
  const fields: { key: IdentifierKey; label: string; placeholder?: string; limit: number }[]=[
    {key:'code',label:ADMIN_VOCABULARY.goodsCode,placeholder:suggestion?.code,limit:100},
    {key:'defaultVariantCode',label:ADMIN_VOCABULARY.optionCode,placeholder:suggestion?.defaultVariantCode,limit:120},
    {key:'id',label:ADMIN_VOCABULARY.goodsAddress,limit:64},
  ];
  /* AdminFormGrid와 같은 격자(ADR-0028). 자동코드 칸은 머리에 '직접 바꾸기' 버튼이 있어 라벨이 입력을 감싸지 않는다. */
  return <fieldset className="m-0 grid min-w-0 gap-x-6 gap-y-5 border-0 p-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(16rem,calc((100%-1.5rem)/2))),1fr))]" data-good-identifier-fields="">
    <legend className="sr-only">{ADMIN_VOCABULARY.goodsCode}와 {ADMIN_VOCABULARY.goodsAddress}</legend>
    {fields.filter((field) => !hideVariantCode || field.key !== 'defaultVariantCode').map((field)=>{
      const inputId=`good-identifier-${field.key}`;
      if (field.key==='id') {
        /* 지금 칸의 상품 자동코드(직접 바꾸는 중이면 그 값), 새 상품이면 예상 코드로 주소를 보인다. 저장 규칙과 같게 정규화한다. */
        const typedCode=values.code.trim();
        const addressCode=typedCode || suggestion?.code || '';
        const pending=!typedCode;
        const codeSegment=goodCodeSegment(addressCode);
        const segment=codeSegment ?? values.id;
        /* 공백·한글·기호가 든 코드는 주소로 쓰지 않는다 — 처음 저장할 때 정한 영문 값으로 열린다. */
        const codeUnusable=Boolean(addressCode) && !codeSegment;
        const address=segment ? `${SITE_HOST}${goodDetailHref({ id: segment })}` : '';
        /* 상품 자동코드를 직접 바꾸는 중일 때만 주소가 바뀐다는 결과를 말한다. 잠겨 있으면 입력할 것이 없다. */
        const addressNote=[codeUnusable?'상품 자동코드에 주소로 쓸 수 없는 글자(공백·한글·기호)가 있어, 처음 저장할 때 정해진 영문 값으로 열립니다.':'',unlocked.code?GOOD_ADDRESS_HELP:''].filter(Boolean).join(' ');
        return <div className="flex min-w-0 flex-col gap-2" key={field.key} data-good-address="">
          <input name="id" type="hidden" value={values.id} />
          <label className="text-sm leading-snug font-medium text-foreground" htmlFor={inputId}>{field.label}</label>
          <input id={inputId} aria-describedby={addressNote?`${field.key}-help`:undefined} aria-invalid={Boolean(errors[field.key])} className={GOOD_INPUT_CLASS} data-slot="input"
            readOnly value={address ? (pending ? `저장 시 확정 · 예상 ${address}` : address) : '저장할 때 상품 자동코드로 정해집니다'} />
          {addressNote?<span className="text-sm text-muted-foreground" id={`${field.key}-help`}>{addressNote}</span>:null}
          <ErrorText>{errors[field.key]}</ErrorText>
        </div>;
      }
      const key=field.key;
      const open=unlocked[key];
      const expected=field.placeholder;
      /* 잠긴 칸에 이미 들어간 바코드도 열어 보지 않고 알아보게 한다. 창고 품번일 수 있어 막지는 않는다. */
      const barcodeWarning=looksLikeBarcode(values[key]);
      return <div className="flex min-w-0 flex-col gap-2" key={key} data-good-auto-code={key} data-locked={open?undefined:''}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <label className="text-sm leading-snug font-medium text-foreground" htmlFor={inputId}>{field.label}</label>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{open?'직접 바꾸는 중':AUTO_CODE_BADGE}</span>
          <button type="button" className={`${buttonVariants({ variant: 'ghost', size: 'xs' })} ml-auto`} data-slot="button" aria-controls={inputId}
            onClick={()=>{
              if (open) setValues((current)=>({...current,[key]:key==='code'?code:defaultVariantCode}));
              setUnlocked((current)=>({...current,[key]:!open}));
            }}>{open?'자동코드로 두기':'직접 바꾸기'}</button>
        </div>
        <input id={inputId} aria-describedby={barcodeWarning?`${key}-help ${key}-barcode`:`${key}-help`} aria-invalid={Boolean(errors[key])} className={GOOD_INPUT_CLASS} data-slot="input"
          maxLength={field.limit} name={key} onChange={(event)=>setValues((current)=>({...current,[key]:event.target.value}))}
          placeholder={open?'창고 품번처럼 정해진 코드':expected?`저장 시 자동 생성 · 예상 ${expected}`:'저장 시 자동 생성'} readOnly={!open} value={values[key]} />
        <span className="text-sm text-muted-foreground" id={`${key}-help`}>
          {open
            ? `창고 품번처럼 정해진 코드가 있거나 잘못 들어간 값을 고칠 때만 바꿉니다. 상품 엑셀은 이 코드로 수정할 상품을 찾습니다. ${AUTO_CODE_HELP}`
            : key==='code' ? "출고지시 엑셀의 '상품코드' 열에 찍히고 고객 화면 주소 끝에도 쓰입니다." : "출고지시 엑셀의 '옵션코드' 열에 찍힙니다."}
        </span>
        {barcodeWarning?<span className="text-sm text-warning" data-good-code-barcode-warning="" id={`${key}-barcode`} role="status">{autoCodeBarcodeWarning(key==='code'?'goods':'option',open)}</span>:null}
        <ErrorText>{errors[key]}</ErrorText>
      </div>;
    })}
  </fieldset>;
}

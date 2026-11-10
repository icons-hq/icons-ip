'use client';

import { GOODS_CUSTOM_INPUT_LIMIT, GOODS_CUSTOM_INPUT_NAME_LIMIT, GOODS_CUSTOM_INPUT_VALUE_LIMIT, type GoodsCustomInputField } from '@/lib/goods-custom-inputs';
import { isUuid } from '@/lib/uuid';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 설정함/설정안함 라디오는 GoodChoiceOption과 같은 모양이다. */
const CHOICE_LABEL_CLASS = 'inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50';
const FIELD_LABEL_CLASS = 'text-sm font-medium text-foreground';

function draftFrom(value: string | undefined): {enabled:boolean;fields:GoodsCustomInputField[]} {
  try {
    const draft = JSON.parse(value ?? '{}');
    if (draft && typeof draft.enabled === 'boolean' && Array.isArray(draft.fields) && draft.fields.length <= GOODS_CUSTOM_INPUT_LIMIT
      && draft.fields.every((field: unknown) => !!field && typeof field === 'object' && 'id' in field && typeof field.id === 'string' && isUuid(field.id)
        && 'name' in field && typeof field.name === 'string' && 'active' in field && typeof field.active === 'boolean')) return draft;
  } catch { /* Malformed recovery is never submitted as an active definition. */ }
  return {enabled:false,fields:[]};
}
function blankField(): GoodsCustomInputField { return {id:crypto.randomUUID(),name:'',active:true}; }

export function GoodsCustomInputEditor({ value, revision, onChange, error }: {
  value?:string; revision:string; onChange:(value:string)=>void; error?:string;
}) {
  const draft=draftFrom(value);
  const change=(next:typeof draft)=>onChange(JSON.stringify(next));
  const fieldChange=(id:string,patch:Partial<GoodsCustomInputField>)=>change({...draft,fields:draft.fields.map(field=>field.id===id?{...field,...patch}:field)});
  return <section className="flex min-w-0 flex-col gap-4 border-t pt-5" aria-labelledby="goods-custom-inputs-title" data-good-custom-inputs="">
    <input name="customInputs" type="hidden" value={JSON.stringify(draft)} />
    <input name="customInputsExpectedRevision" type="hidden" value={revision} />
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1"><h5 id="goods-custom-inputs-title" className="mr-2 text-sm leading-snug font-medium text-foreground">직접입력형</h5>
      <label className={CHOICE_LABEL_CLASS}><input type="radio" name="customInputsUsage" checked={draft.enabled} onChange={()=>change({...draft,enabled:true,fields:draft.fields.length?draft.fields:[blankField()]})} /> 설정함</label>
      <label className={CHOICE_LABEL_CLASS}><input type="radio" name="customInputsUsage" checked={!draft.enabled} onChange={()=>change({...draft,enabled:false})} /> 설정안함</label>
    </div>
    <p className="text-sm text-muted-foreground">각인 문구처럼 고객이 직접 입력할 내용을 받습니다. 옵션별 가격·재고는 위 선택형 옵션을 따릅니다.</p>
    {draft.enabled && <>
      <div className="flex flex-wrap items-center gap-3">
        <label className={FIELD_LABEL_CLASS} htmlFor="goods-custom-inputs-count">옵션명 개수</label>
        <NativeSelect className="w-28" id="goods-custom-inputs-count" value={draft.fields.length} onChange={event=>{
          const count=Number(event.target.value);
          change({...draft,fields:count<=draft.fields.length?draft.fields.slice(0,count):[...draft.fields,...Array.from({length:count-draft.fields.length},blankField)]});
        }}>{Array.from({length:GOODS_CUSTOM_INPUT_LIMIT},(_,index)=><option key={index} value={index+1}>{index+1}개</option>)}</NativeSelect>
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">{draft.fields.map((field,index)=><div className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-3 sm:grid-cols-[minmax(10rem,1fr)_8.75rem_auto]" key={field.id}>
        <label className={`flex min-w-0 flex-col gap-1.5 ${FIELD_LABEL_CLASS}`}>옵션명 <input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`직접입력형 옵션명 ${index+1}`} maxLength={GOODS_CUSTOM_INPUT_NAME_LIMIT*2} value={field.name} placeholder="예시: 각인 문구" onChange={event=>fieldChange(field.id,{name:[...event.target.value].slice(0,GOODS_CUSTOM_INPUT_NAME_LIMIT).join('')})} /></label>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className={FIELD_LABEL_CLASS} htmlFor={`goods-custom-input-active-${field.id}`}>사용여부</label>
          <NativeSelect className="w-full" id={`goods-custom-input-active-${field.id}`} aria-label={`직접입력형 옵션 ${index+1} 사용여부`} value={String(field.active)} onChange={event=>fieldChange(field.id,{active:event.target.value==='true'})}><option value="true">Y</option><option value="false">N</option></NativeSelect>
        </div>
        <button type="button" className={`${buttonVariants({ variant: 'outline' })} col-span-full justify-self-end sm:col-span-1`} data-slot="button" disabled={draft.fields.length===1} aria-label={`직접입력형 옵션 ${index+1} 삭제`} onClick={()=>change({...draft,fields:draft.fields.filter(item=>item.id!==field.id)})}>삭제</button>
      </div>)}</div>
      <button type="button" className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" disabled={draft.fields.length>=GOODS_CUSTOM_INPUT_LIMIT} onClick={()=>change({...draft,fields:[...draft.fields,blankField()]})}>직접입력형 옵션 추가</button>
      <p className="text-sm text-muted-foreground">사용 중인 항목은 고객이 모두 입력해야 하며 항목당 최대 {GOODS_CUSTOM_INPUT_VALUE_LIMIT}자입니다. 연락처·이메일 등 개인정보는 주문서에서 받습니다. 설정을 바꾸면 장바구니의 기존 입력을 다시 확인하도록 안내합니다.</p>
    </>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </section>;
}

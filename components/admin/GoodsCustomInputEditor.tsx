'use client';

import { GOODS_CUSTOM_INPUT_LIMIT, GOODS_CUSTOM_INPUT_NAME_LIMIT, GOODS_CUSTOM_INPUT_VALUE_LIMIT, type GoodsCustomInputField } from '@/lib/goods-custom-inputs';
import { isUuid } from '@/lib/uuid';

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
  return <section className="admin-custom-inputs" aria-labelledby="goods-custom-inputs-title">
    <input name="customInputs" type="hidden" value={JSON.stringify(draft)} />
    <input name="customInputsExpectedRevision" type="hidden" value={revision} />
    <div className="admin-custom-inputs__heading"><h5 id="goods-custom-inputs-title">직접입력형</h5>
      <label><input type="radio" name="customInputsUsage" checked={draft.enabled} onChange={()=>change({...draft,enabled:true,fields:draft.fields.length?draft.fields:[blankField()]})} /> 설정함</label>
      <label><input type="radio" name="customInputsUsage" checked={!draft.enabled} onChange={()=>change({...draft,enabled:false})} /> 설정안함</label>
    </div>
    <p className="muted">각인 문구처럼 고객이 직접 입력할 내용을 받습니다. 옵션별 가격·재고는 위 선택형 옵션을 따릅니다.</p>
    {draft.enabled && <>
      <label className="admin-custom-inputs__count">옵션명 개수 <select value={draft.fields.length} onChange={event=>{
        const count=Number(event.target.value);
        change({...draft,fields:count<=draft.fields.length?draft.fields.slice(0,count):[...draft.fields,...Array.from({length:count-draft.fields.length},blankField)]});
      }}>{Array.from({length:GOODS_CUSTOM_INPUT_LIMIT},(_,index)=><option key={index} value={index+1}>{index+1}개</option>)}</select></label>
      <div className="admin-custom-inputs__rows">{draft.fields.map((field,index)=><div className="admin-custom-inputs__row" key={field.id}>
        <label>옵션명 <input aria-label={`직접입력형 옵션명 ${index+1}`} maxLength={GOODS_CUSTOM_INPUT_NAME_LIMIT*2} value={field.name} placeholder="예시: 각인 문구" onChange={event=>fieldChange(field.id,{name:[...event.target.value].slice(0,GOODS_CUSTOM_INPUT_NAME_LIMIT).join('')})} /></label>
        <label>사용여부 <select aria-label={`직접입력형 옵션 ${index+1} 사용여부`} value={String(field.active)} onChange={event=>fieldChange(field.id,{active:event.target.value==='true'})}><option value="true">Y</option><option value="false">N</option></select></label>
        <button type="button" className="btn btn-ghost" disabled={draft.fields.length===1} aria-label={`직접입력형 옵션 ${index+1} 삭제`} onClick={()=>change({...draft,fields:draft.fields.filter(item=>item.id!==field.id)})}>삭제</button>
      </div>)}</div>
      <button type="button" className="btn btn-ghost" disabled={draft.fields.length>=GOODS_CUSTOM_INPUT_LIMIT} onClick={()=>change({...draft,fields:[...draft.fields,blankField()]})}>직접입력형 옵션 추가</button>
      <p className="muted">사용 중인 항목은 고객이 모두 입력해야 하며 항목당 최대 {GOODS_CUSTOM_INPUT_VALUE_LIMIT}자입니다. 연락처·이메일 등 개인정보는 주문서에서 받습니다. 설정을 바꾸면 장바구니의 기존 입력을 다시 확인하도록 안내합니다.</p>
    </>}
    {error && <p className="admin-form-error" role="alert">{error}</p>}
  </section>;
}

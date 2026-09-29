'use client';
import { useState } from 'react';
import { GOODS_KC_FAMILY_LABELS, GOODS_KC_SCHEME_LABELS, goodsKcSchemeAllowed, type GoodsKcFamily, type GoodsKcScheme } from '@/lib/goods-kc';
import type { GoodsKcPresetTemplate } from '@/lib/admin/goods-notice-presets';

function initialDraft(template:GoodsKcPresetTemplate|null|undefined,raw?:string) {
  let value:unknown=template??null;
  if (raw!==undefined) {try {value=JSON.parse(raw);} catch {value=null;}}
  const row=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
  return {enabled:value!==null,
    family:typeof row.family==='string'&&Object.hasOwn(GOODS_KC_FAMILY_LABELS,row.family)?row.family as GoodsKcFamily:'',
    scheme:typeof row.scheme==='string'&&Object.hasOwn(GOODS_KC_SCHEME_LABELS,row.scheme)?row.scheme as GoodsKcScheme:'',
    publicNote:typeof row.publicNote==='string'?row.publicNote:'',
  };
}

export function GoodsKcPresetFields({template,raw,error}:{template?:GoodsKcPresetTemplate|null;raw?:string;error?:string}) {
  const [draft,setDraft]=useState(()=>initialDraft(template,raw));
  return <fieldset className="col" style={{gap:12}}>
    <legend>KC 모델 틀 · 선택</legend>
    <input type="hidden" name="kcTemplate" value={JSON.stringify(draft.enabled?{
      family:draft.family,scheme:draft.scheme,publicNote:draft.scheme==='not_applicable'?draft.publicNote:'',
    }:null)}/>
    <label><input type="checkbox" checked={draft.enabled} onChange={event=>setDraft({...draft,enabled:event.target.checked})}/> KC 모델 틀 포함</label>
    {draft.enabled?<>
      <label>제품군<select required value={draft.family} onChange={event=>{
        const family=event.target.value as GoodsKcFamily|'';
        setDraft({...draft,family,scheme:family&&draft.scheme&&goodsKcSchemeAllowed(family,draft.scheme as GoodsKcScheme)?draft.scheme:''});
      }}><option value="">선택</option>{Object.entries(GOODS_KC_FAMILY_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>제도<select required value={draft.scheme} onChange={event=>setDraft({...draft,scheme:event.target.value as GoodsKcScheme|''})}>
        <option value="">선택</option>{Object.entries(GOODS_KC_SCHEME_LABELS).filter(([value])=>draft.family&&goodsKcSchemeAllowed(draft.family as GoodsKcFamily,value as GoodsKcScheme))
          .map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
      {draft.scheme==='not_applicable'?<label>해당 없음 안내 문구<textarea rows={3} maxLength={1000} value={draft.publicNote} onChange={event=>setDraft({...draft,publicNote:event.target.value})}/></label>:null}
    </>:null}
    <p>제품군·제도와 해당 없음 안내만 새 모델 초안으로 복사합니다. 옵션·인증번호·증빙·검토 완료 상태는 복사하지 않습니다.</p>
    {error?<p role="alert">{error}</p>:null}
  </fieldset>;
}

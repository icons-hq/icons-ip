'use client';
import { useId, useState } from 'react';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOODS_KC_FAMILY_LABELS, GOODS_KC_SCHEME_LABELS, goodsKcSchemeAllowed, type GoodsKcFamily, type GoodsKcScheme } from '@/lib/goods-kc';
import type { GoodsKcPresetTemplate } from '@/lib/admin/goods-notice-presets';
import { GOOD_TEXTAREA_CLASS } from './GoodEditorParts';

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

/* 템플릿 룩(ADR-0028). 고시정보 프리셋 폼(C 트랙 GoodsNoticePresetForm)이 쓰는 KC 모델 틀 입력이다. */
export function GoodsKcPresetFields({template,raw,error}:{template?:GoodsKcPresetTemplate|null;raw?:string;error?:string}) {
  const [draft,setDraft]=useState(()=>initialDraft(template,raw));
  const id=useId();
  return <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" data-kc-preset-fields="">
    <legend className="float-left w-full p-0 text-sm font-medium text-foreground">KC 모델 틀 · 선택</legend>
    <input type="hidden" name="kcTemplate" value={JSON.stringify(draft.enabled?{
      family:draft.family,scheme:draft.scheme,publicNote:draft.scheme==='not_applicable'?draft.publicNote:'',
    }:null)}/>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={event=>setDraft({...draft,enabled:event.target.checked})}/> KC 모델 틀 포함</label>
    {draft.enabled?<div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={`${id}-family`}>제품군</Label><NativeSelect className="w-full" id={`${id}-family`} required value={draft.family} onChange={event=>{
        const family=event.target.value as GoodsKcFamily|'';
        setDraft({...draft,family,scheme:family&&draft.scheme&&goodsKcSchemeAllowed(family,draft.scheme as GoodsKcScheme)?draft.scheme:''});
      }}><option value="">선택</option>{Object.entries(GOODS_KC_FAMILY_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect></div>
      <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={`${id}-scheme`}>제도</Label><NativeSelect className="w-full" id={`${id}-scheme`} required value={draft.scheme} onChange={event=>setDraft({...draft,scheme:event.target.value as GoodsKcScheme|''})}>
        <option value="">선택</option>{Object.entries(GOODS_KC_SCHEME_LABELS).filter(([value])=>draft.family&&goodsKcSchemeAllowed(draft.family as GoodsKcFamily,value as GoodsKcScheme))
          .map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </NativeSelect></div>
      {draft.scheme==='not_applicable'?<label className="flex min-w-0 flex-col gap-2 text-sm sm:col-span-2"><span className="font-medium">해당 없음 고객 안내 (선택)</span><textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" rows={3} maxLength={1000} value={draft.publicNote} onChange={event=>setDraft({...draft,publicNote:event.target.value})}/></label>:null}
    </div>:null}
    <p className="text-sm text-muted-foreground">제품군·제도와 해당 없음 안내만 새 모델 초안으로 복사합니다. 옵션·인증번호·증빙·검토 완료 상태는 복사하지 않습니다.</p>
    {error?<p className="text-sm text-destructive" role="alert">{error}</p>:null}
  </fieldset>;
}

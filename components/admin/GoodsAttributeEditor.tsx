'use client';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { readGoodsAttributesAction } from '@/app/admin/goods-attribute-actions';
import { Button } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';
import { EMPTY_GOODS_ATTRIBUTES, goodsAttributeValueLabel, parseGoodsAttributeFields, parseGoodsAttributeSubmission, validGoodsAttributeValue, type GoodsAttributeDocument, type GoodsAttributeField, type GoodsAttributeSchema, type GoodsAttributeSubmission } from '@/lib/goods-attributes';

type RawEntry = { field: GoodsAttributeField; raw: string | string[] };
function restoreRaw(value: string | undefined): RawEntry[] | null {
  try {
    const data: unknown = JSON.parse(value ?? 'null');
    if (!Array.isArray(data) || data.length > 100) return null;
    const ids = new Set<string>();
    for (const entry of data) {
      if (!entry || typeof entry !== 'object' || !parseGoodsAttributeFields([entry.field]) || ids.has(entry.field.id)
        || !(typeof entry.raw === 'string' && entry.raw.length <= 1000 || Array.isArray(entry.raw) && entry.raw.length <= 100 && entry.raw.every((v: unknown) => typeof v === 'string'))) return null;
      ids.add(entry.field.id);
    }
    return data as RawEntry[];
  } catch { return null; }
}
const rawDocument = (document: GoodsAttributeDocument): RawEntry[] => document.entries.map(entry => ({ field: entry.field, raw: Array.isArray(entry.value) ? entry.value : String(entry.value) }));
const compatible = (entry: RawEntry, field: GoodsAttributeField | undefined) => Boolean(field && entry.field.kind === field.kind && entry.field.unit === field.unit
  && (!['single','multi'].includes(field.kind) || (Array.isArray(entry.raw) ? entry.raw : entry.raw ? [entry.raw] : []).every(id => field.options.some(option => option.id === id))));

export function GoodsAttributeEditor({ categoryId, goodId, initialSubmission, initialDraft, error, onChange }: {
  categoryId: string; goodId: string | null; initialSubmission?: string; initialDraft?: string; error?: string;
  onChange: (submission: string, draft: string, initialize: boolean, preview: {id:string;name:string;value:string}[]) => void;
}) {
  const [schema, setSchema] = useState<GoodsAttributeSchema | null>(null); const [document, setDocument] = useState<GoodsAttributeDocument>(EMPTY_GOODS_ATTRIBUTES);
  const [raw, setRaw] = useState<RawEntry[]>(() => restoreRaw(initialDraft) ?? []); const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [expectedRevision, setExpectedRevision] = useState(0); const [schemaRevision, setSchemaRevision] = useState(0); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('');
  const [latest, setLatest] = useState<{ schema: GoodsAttributeSchema | null; document: GoodsAttributeDocument } | null>(null);
  const initialized = useRef(false); const announced = useRef(false); const request = useRef(0); const [loaded, setLoaded] = useState(false);
  const restored = useRef({ submission: initialSubmission, draft: initialDraft });
  useEffect(() => {
    let alive = true; const token = ++request.current;
    readGoodsAttributesAction(categoryId || null, goodId).then(result => {
      if (!alive || token !== request.current) return;
      if (!result.data) { setLoading(false); setLoadError(result.error ?? '상품속성을 불러오지 못했습니다.'); return; }
      setSchema(result.data.schema); setLoadError(''); setLoading(false);
      if (!initialized.current) {
        let previous: GoodsAttributeSubmission | null = null;
        try { previous = parseGoodsAttributeSubmission(JSON.parse(restored.current.submission ?? 'null')); } catch { /* Unfinished recovery is rendered from the draft. */ }
        setDocument(result.data.document); setExpectedRevision(previous?.expectedRevision ?? result.data.document.revision);
        setSchemaRevision(previous?.categoryId === (categoryId||null) ? previous.schemaRevision : result.data.schema?.revision ?? 0);
        const entries = previous ? restoreRaw(restored.current.draft) ?? rawDocument(result.data.document) : rawDocument(result.data.document);
        if (previous && !restoreRaw(restored.current.draft)) {
          for (const [id,value] of Object.entries(previous.values)) {
            const field=result.data.schema?.fields.find(item=>item.id===id); if (!field) continue;
            const entry={field,raw:value===null?'':Array.isArray(value)?value:String(value)};
            const index=entries.findIndex(item=>item.field.id===id); if(index<0)entries.push(entry);else entries[index]=entry;
          }
        }
        setRaw(entries); setRemoveIds(previous?.removeIds ?? []); initialized.current = true; setLoaded(true);
      } else setSchemaRevision(result.data.schema?.revision ?? 0);
    }).catch(() => { if(alive){setLoading(false);setLoadError('상품속성을 불러오지 못했습니다. 다시 조회해주세요.');} });
    return () => { alive=false; };
  }, [categoryId, goodId]);
  const ready = loaded && !loadError && (categoryId ? schema?.categoryId === categoryId : schema === null);
  const values: GoodsAttributeSubmission['values'] = {};
  for (const entry of raw) {
    if (removeIds.includes(entry.field.id)) continue;
    const field=schema?.fields.find(item=>item.id===entry.field.id);
    if (!compatible(entry,field)) {
      // Never silently discard a value entered before switching category, even before its first server save.
      if (!document.entries.some(item=>item.field.id===entry.field.id)) values[entry.field.id] = entry.raw;
      continue;
    }
    values[entry.field.id] = Array.isArray(entry.raw) ? entry.raw.length ? entry.raw : null
      : !entry.raw.trim() ? null : field!.kind==='number' && Number.isFinite(Number(entry.raw)) ? Number(entry.raw) : entry.raw.trim();
  }
  const submission: GoodsAttributeSubmission = { categoryId:categoryId||null, schemaRevision, expectedRevision, values,
    removeIds:removeIds.filter(id=>!(id in values)) };
  const serialized = ready ? JSON.stringify(submission) : '';
  const draft = JSON.stringify(raw.filter(entry=>!removeIds.includes(entry.field.id)));
  const preview = JSON.stringify((schema?.fields ?? []).flatMap(field => {
    const value = values[field.id];
    return validGoodsAttributeValue(field,value) ? [{id:field.id,name:field.name,value:goodsAttributeValueLabel(field,value)}] : [];
  }));
  useEffect(() => {
    if (!ready) return;
    onChange(serialized,draft,!announced.current,JSON.parse(preview)); announced.current=true;
  }, [serialized,draft,ready,onChange,preview]);
  function edit(field: GoodsAttributeField, value: string|string[]) {
    setRemoveIds(ids=>ids.filter(id=>id!==field.id)); setRaw(entries=>[...entries.filter(entry=>entry.field.id!==field.id),{field,raw:value}]);
  }
  const unmatched = raw.filter(entry=>!removeIds.includes(entry.field.id) && !compatible(entry,schema?.fields.find(field=>field.id===entry.field.id)));
  async function refresh() {
    const result=await readGoodsAttributesAction(categoryId||null,goodId);
    if (!result.data) {setLoadError(result.error ?? '조회하지 못했습니다.');return;}
    setLatest(result.data); setLoadError('');
  }
  /* 상품 폼 안에 놓인다. 버튼은 모두 type="button"이고, 값은 위 hidden 두 칸으로만 제출한다. */
  return <div className="flex min-w-0 flex-col gap-4" data-good-attributes="">
    <input type="hidden" name="productAttributes" value={serialized} /><input type="hidden" name="productAttributeDraft" value={draft} />
    <p className="text-sm text-muted-foreground">대표 카테고리의 상품속성을 사용합니다. 추가 카테고리는 속성 정의에 영향을 주지 않습니다. 기본 상품 저장으로 반영하며, 임시저장에는 미완성 입력도 보관합니다.</p>
    {loading || !ready && !loadError ? <p className="text-sm text-muted-foreground" role="status">상품속성을 불러오는 중입니다.</p> : null}
    {loadError ? <p className="text-sm text-destructive" role="alert">{loadError}</p> : null}{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <Button type="button" variant="outline" size="sm" className="self-start" onClick={refresh}><RefreshCw aria-hidden="true" />최신 속성 정의·저장값 조회</Button>
    {latest ? <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/40 p-4 text-sm"><h4 className="font-medium">최신 정의 버전 {latest.schema?.revision ?? 0} · 저장값 버전 {latest.document.revision}</h4>{latest.document.entries.map(entry=><p className="text-muted-foreground wrap-anywhere" key={entry.field.id}>{entry.field.name}: {goodsAttributeValueLabel(entry.field,entry.value)}</p>)}
      <div className="flex flex-wrap gap-2 pt-1">
      <Button type="button" variant="outline" size="sm" onClick={()=>{setSchema(latest.schema);setSchemaRevision(latest.schema?.revision??0);setDocument(latest.document);setExpectedRevision(latest.document.revision);setLatest(null);initialized.current=true;setLoaded(true);setLoading(false);}}>내 입력 유지하고 최신 버전으로 저장 준비</Button>
      <Button type="button" variant="outline" size="sm" onClick={()=>{setSchema(latest.schema);setSchemaRevision(latest.schema?.revision??0);setDocument(latest.document);setExpectedRevision(latest.document.revision);setRaw(rawDocument(latest.document));setRemoveIds([]);setLatest(null);initialized.current=true;setLoaded(true);setLoading(false);}}>최신 저장값으로 입력 교체</Button>
      </div>
    </div> : null}
    {ready && !schema?.fields.length ? <p className="text-sm text-muted-foreground">선택한 대표 카테고리에 정의된 상품속성이 없습니다.</p> : null}
    {ready ? <div className="grid min-w-0 gap-x-6 gap-y-5 empty:hidden sm:grid-cols-2">{schema?.fields.map(field=>{
      const entry=raw.find(item=>item.field.id===field.id && compatible(item,field) && !removeIds.includes(field.id));
      const value=entry?.raw ?? (field.kind==='multi'?[]:''); const id=`product-attribute-${field.id}`;
      return <div className="flex min-w-0 flex-col gap-2" key={field.id}><label className="text-sm leading-snug font-medium text-foreground" htmlFor={id}>{field.name}{field.required?' · 필수':''}{field.unit?` (${field.unit})`:''}</label>
        {field.kind==='single' ? <NativeSelect className="w-full" id={id} value={typeof value==='string'?value:''} onChange={event=>edit(field,event.target.value)}><option value="">선택 안 함</option>{field.options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</NativeSelect>
          :field.kind==='multi' ? <fieldset className="m-0 flex min-w-0 flex-wrap gap-x-4 gap-y-1 border-0 p-0" id={id}><legend className="sr-only">{field.name}</legend>{field.options.map(option=><label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm" key={option.id}><input type="checkbox" checked={Array.isArray(value)&&value.includes(option.id)} onChange={event=>edit(field,event.target.checked?[...(Array.isArray(value)?value:[]),option.id]:(Array.isArray(value)?value:[]).filter(item=>item!==option.id))}/>{option.label}</label>)}</fieldset>
          : <input className={field.kind==='number' ? `${GOOD_INPUT_CLASS} tabular-nums` : GOOD_INPUT_CLASS} data-slot="input" id={id} inputMode={field.kind==='number'?'decimal':undefined} maxLength={field.kind==='number'?40:500} value={typeof value==='string'?value:''} onChange={event=>edit(field,event.target.value)} />}
        {field.kind==='number'?<small className="text-xs text-muted-foreground">절댓값 10억 이하 · 소수점 6자리까지</small>:null}
      </div>;
    })}</div> : null}
    {unmatched.length ? <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-[color-mix(in_oklab,var(--wc-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--wc-warning)_8%,transparent)] p-4 text-sm" data-good-attributes-retained=""><h4 className="font-medium text-[var(--wc-warning)]">현재 정의와 맞지 않는 보관값 {unmatched.length}개</h4><p className="text-muted-foreground">자동으로 삭제하지 않습니다. 저장된 보관값은 유지되며 공개 상세에서 제외합니다. 아직 저장하지 않은 이전 카테고리 입력은 해당 카테고리에서 저장하거나 아래에서 명시적으로 삭제해주세요.</p>{unmatched.map(entry=><div className="flex min-w-0 flex-wrap items-center justify-between gap-2" key={entry.field.id}><span className="min-w-0 wrap-anywhere">{entry.field.name} · {Array.isArray(entry.raw)?entry.raw.map(id=>entry.field.options.find(option=>option.id===id)?.label??id).join(', '):entry.field.kind==='single'?entry.field.options.find(option=>option.id===entry.raw)?.label??entry.raw:entry.raw} {entry.field.unit}</span><Button type="button" variant="destructive" size="sm" onClick={()=>setRemoveIds(ids=>[...ids,entry.field.id])}>보관값 명시적으로 삭제</Button></div>)}</section>:null}
  </div>;
}

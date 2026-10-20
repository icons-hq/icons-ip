'use client';
import { useRef, useState } from 'react';
import { readGoodsAttributesAction, saveGoodsAttributeSchemaAction } from '@/app/admin/goods-attribute-actions';
import { categoryPath, type AdminCategoryNode } from '@/lib/admin/category';
import { GOODS_ATTRIBUTE_KIND_LABELS } from '@/lib/admin/goods-attributes';
import { GOODS_ATTRIBUTE_KINDS, type GoodsAttributeField, type GoodsAttributeSchema } from '@/lib/goods-attributes';

export function GoodsAttributeSchemaScreen({ categories }: { categories: AdminCategoryNode[] }) {
  const [category, setCategory] = useState(''); const [base, setBase] = useState<GoodsAttributeSchema | null>(null);
  const [fields, setFields] = useState<GoodsAttributeField[]>([]); const [latest, setLatest] = useState<GoodsAttributeSchema | null>(null);
  const [copyCategory, setCopyCategory] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false); const operation = useRef<string | null>(null);
  const leaves = categories.filter(row => !row.archivedAt && row.childCount === 0);
  function edit(next: GoodsAttributeField[]) { setFields(next); setDirty(true); setMessage(''); operation.current = null; }
  function update(id: string, change: Partial<GoodsAttributeField>) { edit(fields.map(field => field.id === id ? { ...field, ...change } : field)); }
  async function load(compare = false) {
    if (!category || busy) return; setBusy(true); setError(''); setMessage('');
    const result = await readGoodsAttributesAction(category); setBusy(false);
    if (!result.data?.schema) { setError(result.error ?? '정의를 불러오지 못했습니다.'); return; }
    if (compare || dirty) setLatest(result.data.schema);
    else { setBase(result.data.schema); setFields(result.data.schema.fields); setLatest(null); setDirty(false); operation.current = null; }
  }
  async function save() {
    if (!base || busy) return; setBusy(true); setError(''); setMessage('');
    operation.current ??= crypto.randomUUID();
    const normalized = fields.map(field => ({ ...field, name: field.name.trim(), unit: field.unit.trim(), options: field.options.map(option => ({ ...option, label: option.label.trim() })) }));
    const result = await saveGoodsAttributeSchemaAction(base.categoryId, normalized, base.revision, operation.current); setBusy(false);
    if (!result.data) { setError(result.error ?? '저장하지 못했습니다.'); return; }
    setBase(result.data); setFields(result.data.fields); setLatest(null); setDirty(false); operation.current = null; setMessage('상품속성 정의를 저장했습니다. 기존 상품 값은 유지됩니다.');
  }
  async function copy() {
    if (!copyCategory || busy) return; setBusy(true); const result = await readGoodsAttributesAction(copyCategory); setBusy(false);
    if (!result.data?.schema) { setError(result.error ?? '정의를 불러오지 못했습니다.'); return; }
    edit(result.data.schema.fields); setMessage('다른 카테고리의 항목 ID를 유지해 불러왔습니다. 저장 전 내용을 확인해주세요.');
  }
  return <section className="wc-admin-kit admin-attributes">
    <h2>상품속성 관리</h2><p>대표 고객 카테고리별 상품 정보를 관리합니다. 옵션·상품정보제공고시와 별도로 저장하며, 네이버의 속성 사전을 자동으로 가져오지 않습니다.</p>
    <div className="admin-attributes__toolbar"><label htmlFor="attribute-category">말단 카테고리<select id="attribute-category" value={category} disabled={busy || dirty} onChange={event => { setCategory(event.target.value); setBase(null); setLatest(null); setFields([]); }}><option value="">선택</option>{leaves.map(row => <option key={row.id} value={row.id}>{categoryPath(categories,row.id).join(' > ')}</option>)}</select></label><button className="wc-admin-kit__button" disabled={!category || busy} onClick={() => load()}>정의 조회</button>{dirty ? <button className="wc-admin-kit__button" disabled={busy} onClick={() => { setFields(base?.fields ?? []); setDirty(false); operation.current = null; setError(''); }}>내 변경 취소</button> : null}</div>
    <p>필수 항목 추가는 현재 공개 상품을 숨기거나 결제를 막지 않습니다. 상품 편집에서 저장할 때 현재 필수 조건을 확인합니다. 정의 삭제·유형·단위 변경으로 맞지 않는 값은 상품 편집에 보관하고 공개 표에서 제외합니다.</p>
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {base ? <><div className="admin-attributes__toolbar"><strong>저장 버전 {base.revision} · {fields.length}/30개</strong><button className="wc-admin-kit__button" disabled={busy || fields.length >= 30} onClick={() => edit([...fields,{id:crypto.randomUUID(),name:'',kind:'text',required:false,unit:'',options:[]}])}>항목 추가</button><button className="wc-admin-kit__button" disabled={busy} onClick={() => load(true)}>최신 정의 비교</button></div>
      <div className="admin-attributes__toolbar"><label htmlFor="attribute-copy-category">다른 카테고리 정의 불러오기<select id="attribute-copy-category" value={copyCategory} disabled={busy} onChange={event => setCopyCategory(event.target.value)}><option value="">선택</option>{leaves.filter(row => row.id !== base.categoryId).map(row => <option key={row.id} value={row.id}>{categoryPath(categories,row.id).join(' > ')}</option>)}</select></label><button className="wc-admin-kit__button" disabled={busy || !copyCategory} onClick={copy}>현재 항목을 불러온 정의로 교체</button></div>
      <fieldset disabled={busy} className="admin-attributes__fields"><legend className="sr-only">속성 정의</legend>{fields.map((field,index) => <article key={field.id} className="admin-attributes__definition"><h3>항목 {index+1}</h3><div className="admin-attributes__grid"><label>항목명<input aria-label={`항목 ${index+1} 이름`} value={field.name} maxLength={60} onChange={event => update(field.id,{name:event.target.value})} /></label><label>유형<select aria-label={`항목 ${index+1} 유형`} value={field.kind} onChange={event => { const kind=event.target.value as GoodsAttributeField['kind']; update(field.id,{kind,unit:kind==='number'?field.unit:'',options:['single','multi'].includes(kind) ? field.options : []}); }}>{GOODS_ATTRIBUTE_KINDS.map(kind => <option key={kind} value={kind}>{GOODS_ATTRIBUTE_KIND_LABELS[kind]}</option>)}</select></label><label><input type="checkbox" checked={field.required} onChange={event => update(field.id,{required:event.target.checked})} />필수 입력</label>{field.kind === 'number' ? <label>단위<input aria-label={`항목 ${index+1} 단위`} value={field.unit} maxLength={20} onChange={event => update(field.id,{unit:event.target.value})} /></label> : null}</div>
        <small>항목 ID {field.id}</small>{['single','multi'].includes(field.kind) ? <div className="admin-attributes__choices"><strong>선택값 {field.options.length}/100</strong>{field.options.map((option,n) => <div key={option.id}><input aria-label={`항목 ${index+1} 선택값 ${n+1}`} value={option.label} maxLength={80} onChange={event => update(field.id,{options:field.options.map(item=>item.id===option.id?{...item,label:event.target.value}:item)})} /><button type="button" className="wc-admin-kit__button" onClick={() => update(field.id,{options:field.options.filter(item=>item.id!==option.id)})}>선택값 삭제</button></div>)}<button type="button" className="wc-admin-kit__button" disabled={field.options.length>=100} onClick={() => update(field.id,{options:[...field.options,{id:crypto.randomUUID(),label:''}]})}>선택값 추가</button></div> : null}
        <div className="admin-attributes__toolbar"><button type="button" className="wc-admin-kit__button" disabled={index===0} onClick={() => { const next=[...fields]; [next[index-1],next[index]]=[next[index],next[index-1]]; edit(next); }}>위로</button><button type="button" className="wc-admin-kit__button" disabled={index===fields.length-1} onClick={() => { const next=[...fields]; [next[index+1],next[index]]=[next[index],next[index+1]]; edit(next); }}>아래로</button><button type="button" className="wc-admin-kit__button" onClick={() => edit(fields.filter(item=>item.id!==field.id))}>항목 삭제</button></div></article>)}</fieldset>
      <button className="wc-admin-kit__button" disabled={busy || !dirty} onClick={save}>{busy?'처리 중':'속성 정의 저장'}</button>
    </> : null}
    {latest ? <section className="admin-attributes__comparison"><h3>최신 정의 · 버전 {latest.revision}</h3>{latest.fields.map(field=><p key={field.id}>{field.name} · {GOODS_ATTRIBUTE_KIND_LABELS[field.kind]}{field.required?' · 필수':''}</p>)}<button className="wc-admin-kit__button" disabled={busy} onClick={() => {setBase(latest);setLatest(null);operation.current=null;setError('');}}>내 입력 유지하고 최신 버전으로 저장 준비</button><button className="wc-admin-kit__button" disabled={busy} onClick={() => {setBase(latest);setFields(latest.fields);setLatest(null);setDirty(false);operation.current=null;setError('');}}>최신 정의로 입력 교체</button></section> : null}
  </section>;
}

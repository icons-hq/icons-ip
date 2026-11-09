'use client';
import { useRef, useState } from 'react';
import { readGoodsAttributesAction, saveGoodsAttributeSchemaAction } from '@/app/admin/goods-attribute-actions';
import { categoryPath, type AdminCategoryNode } from '@/lib/admin/category';
import { GOODS_ATTRIBUTE_KIND_LABELS } from '@/lib/admin/goods-attributes';
import { GOODS_ATTRIBUTE_KINDS, type GoodsAttributeField, type GoodsAttributeSchema } from '@/lib/goods-attributes';
import { Plus } from 'lucide-react';
import { AdminNotice, AdminPageHeader } from '../console/AdminKit';
import { AdminSelect } from '../console/AdminSelect';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';

const TOOLBAR = 'flex flex-wrap items-end gap-2';
const FIELD = 'flex min-w-0 flex-col gap-2 text-sm font-medium';
/* 줄마다 반복되는 삭제는 outline에 빨간 글자로 낮춘다. */
const REMOVE_BUTTON = 'text-destructive hover:text-destructive';

export function GoodsAttributeSchemaScreen({ categories }: { categories: AdminCategoryNode[] }) {
  const [category, setCategory] = useState(''); const [base, setBase] = useState<GoodsAttributeSchema | null>(null);
  const [fields, setFields] = useState<GoodsAttributeField[]>([]); const [latest, setLatest] = useState<GoodsAttributeSchema | null>(null);
  const [copyCategory, setCopyCategory] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false); const operation = useRef<string | null>(null);
  const leaves = categories.filter(row => !row.archivedAt && row.childCount === 0);
  function edit(next: GoodsAttributeField[]) { setFields(next); setDirty(true); setMessage(''); operation.current = null; }
  function update(id: string, change: Partial<GoodsAttributeField>) { edit(fields.map(field => field.id === id ? { ...field, ...change } : field)); }
  async function load(compare = false) {
    if (busy) return;
    if (!category) { setError('카테고리를 먼저 골라주세요.'); return; }
    setBusy(true); setError(''); setMessage('');
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
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-attributes">
    <AdminPageHeader title="상품속성 관리" description="대표 고객 카테고리별 상품 정보를 관리합니다. 옵션·상품정보제공고시와 별도로 저장하며, 네이버의 속성 사전을 자동으로 가져오지 않습니다." />
    {/* 조회 전에는 고르고 누르는 일만 보인다. 정의를 바꿀 때 조심할 점은 불러온 뒤에 말한다. 칸을 안 골라도 버튼은 눌리고 이유를 알려 준다. */}
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4"><label className="text-sm font-medium" htmlFor="attribute-category">카테고리 (맨 아래 단계)</label><div className="flex flex-wrap items-start gap-2"><AdminSelect id="attribute-category" value={category} disabled={busy || dirty} onChange={event => { setCategory(event.target.value); setBase(null); setLatest(null); setFields([]); setError(''); }} wrapperClassName="w-full sm:w-80"><option value="">카테고리 선택</option>{leaves.map(row => <option key={row.id} value={row.id}>{categoryPath(categories,row.id).join(' > ')}</option>)}</AdminSelect><Button variant={base ? 'soft' : 'default'} type="button" disabled={busy} onClick={() => load()}>상품속성 조회</Button>{dirty ? <Button variant="ghost" type="button" disabled={busy} onClick={() => { setFields(base?.fields ?? []); setDirty(false); operation.current = null; setError(''); }}>내 변경 취소</Button> : null}</div>
      {base ? <AdminNotice tone="warning" title="저장하면 이렇게 적용됩니다"><ul className="flex list-disc flex-col gap-0.5 pl-4"><li>필수 항목을 추가해도 이미 공개한 상품은 숨겨지지 않고, 상품을 수정해 저장할 때 입력을 확인합니다.</li><li>항목을 지우거나 유형·단위를 바꾸면 맞지 않는 값은 공개 표에서 빠지고 상품 편집에만 남습니다.</li></ul></AdminNotice>
        : <ol className="grid list-none gap-2 p-0 sm:grid-cols-3" role="status">{['카테고리를 고릅니다', '상품속성 조회를 누릅니다', '입력 항목을 추가·수정하고 저장합니다'].map((step, index) => <li className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" key={step}><span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground tabular-nums">{index + 1}</span>{step}</li>)}</ol>}
    </div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}{message ? <p className="text-sm text-success" role="status">{message}</p> : null}
    {base ? <><div className={TOOLBAR}><strong className="text-sm font-medium tabular-nums">저장 버전 {base.revision} · {fields.length}/30개</strong><Button size="sm" variant="outline" type="button" disabled={busy || fields.length >= 30} onClick={() => edit([...fields,{id:crypto.randomUUID(),name:'',kind:'text',required:false,unit:'',options:[]}])}><Plus aria-hidden="true" />항목 추가</Button><Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => load(true)}>최신 정의 비교</Button></div>
      <div className="flex flex-col gap-2"><label className="text-sm font-medium" htmlFor="attribute-copy-category">다른 카테고리 정의 불러오기</label><div className="flex flex-wrap items-start gap-2"><AdminSelect id="attribute-copy-category" value={copyCategory} disabled={busy} onChange={event => setCopyCategory(event.target.value)} wrapperClassName="w-full sm:w-80"><option value="">선택</option>{leaves.filter(row => row.id !== base.categoryId).map(row => <option key={row.id} value={row.id}>{categoryPath(categories,row.id).join(' > ')}</option>)}</AdminSelect><Button variant="outline" type="button" disabled={busy || !copyCategory} onClick={copy}>현재 항목을 불러온 정의로 교체</Button></div></div>
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-3"><legend className="sr-only">속성 정의</legend>{fields.map((field,index) => <article key={field.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground"><h3 className="text-base font-medium">항목 {index+1}</h3><div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className={FIELD}>항목명<Input aria-label={`항목 ${index+1} 이름`} value={field.name} maxLength={60} onChange={event => update(field.id,{name:event.target.value})} /></label><label className={FIELD}>유형<AdminSelect aria-label={`항목 ${index+1} 유형`} value={field.kind} onChange={event => { const kind=event.target.value as GoodsAttributeField['kind']; update(field.id,{kind,unit:kind==='number'?field.unit:'',options:['single','multi'].includes(kind) ? field.options : []}); }} wrapperClassName="w-full">{GOODS_ATTRIBUTE_KINDS.map(kind => <option key={kind} value={kind}>{GOODS_ATTRIBUTE_KIND_LABELS[kind]}</option>)}</AdminSelect></label><label className="flex h-8 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={field.required} onChange={event => update(field.id,{required:event.target.checked})} />필수 입력</label>{field.kind === 'number' ? <label className={FIELD}>단위<Input aria-label={`항목 ${index+1} 단위`} value={field.unit} maxLength={20} onChange={event => update(field.id,{unit:event.target.value})} /></label> : null}</div>
        <small className="text-xs text-muted-foreground tabular-nums" title={field.id}>항목 ID {field.id.slice(0, 8)}…</small>{['single','multi'].includes(field.kind) ? <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3"><strong className="text-sm font-medium tabular-nums">선택값 {field.options.length}/100</strong>{field.options.map((option,n) => <div className="flex items-center gap-2" key={option.id}><Input className="min-w-0 flex-1" aria-label={`항목 ${index+1} 선택값 ${n+1}`} value={option.label} maxLength={80} onChange={event => update(field.id,{options:field.options.map(item=>item.id===option.id?{...item,label:event.target.value}:item)})} /><Button className={REMOVE_BUTTON} size="sm" variant="outline" type="button" onClick={() => update(field.id,{options:field.options.filter(item=>item.id!==option.id)})}>선택값 삭제</Button></div>)}<Button className="self-start" size="sm" variant="outline" type="button" disabled={field.options.length>=100} onClick={() => update(field.id,{options:[...field.options,{id:crypto.randomUUID(),label:''}]})}>선택값 추가</Button></div> : null}
        <div className="flex flex-wrap gap-1.5"><Button size="sm" variant="outline" type="button" disabled={index===0} onClick={() => { const next=[...fields]; [next[index-1],next[index]]=[next[index],next[index-1]]; edit(next); }}>위로</Button><Button size="sm" variant="outline" type="button" disabled={index===fields.length-1} onClick={() => { const next=[...fields]; [next[index+1],next[index]]=[next[index],next[index+1]]; edit(next); }}>아래로</Button><Button className={REMOVE_BUTTON} size="sm" variant="outline" type="button" onClick={() => edit(fields.filter(item=>item.id!==field.id))}>항목 삭제</Button></div></article>)}</fieldset>
      <Button className="self-start" type="button" disabled={busy || !dirty} onClick={save}>{busy?'처리 중':'속성 정의 저장'}</Button>
    </> : null}
    {latest ? <section className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/40 p-4"><h3 className="text-base font-medium">최신 정의 · 버전 {latest.revision}</h3>{latest.fields.map(field=><p className="text-sm" key={field.id}>{field.name} · {GOODS_ATTRIBUTE_KIND_LABELS[field.kind]}{field.required?' · 필수':''}</p>)}<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => {setBase(latest);setLatest(null);operation.current=null;setError('');}}>내 입력 유지하고 최신 버전으로 저장 준비</Button><Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => {setBase(latest);setFields(latest.fields);setLatest(null);setDirty(false);operation.current=null;setError('');}}>최신 정의로 입력 교체</Button></div></section> : null}
  </section>;
}

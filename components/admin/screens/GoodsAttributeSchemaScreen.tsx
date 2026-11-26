'use client';
import { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { readGoodsAttributesAction, saveGoodsAttributeSchemaAction } from '@/app/admin/goods-attribute-actions';
import { categoryPath, type AdminCategoryNode } from '@/lib/admin/category';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  GOODS_ATTRIBUTE_FIELD_LIMIT, GOODS_ATTRIBUTE_KIND_LABELS, GOODS_ATTRIBUTE_OPTION_LIMIT,
  goodsAttributeCategoryLoader, goodsAttributeChangeSummary, goodsAttributeChanges, goodsAttributeFieldIssues, goodsAttributeIssueHint,
  goodsAttributeIssuesMessage, goodsAttributeKindLoss, goodsAttributeNamedOptionCount, hasGoodsAttributeChanges, isBlankGoodsAttributeField,
  normalizeGoodsAttributeFields, type GoodsAttributeCategoryRow, type GoodsAttributeIssue,
} from '@/lib/admin/goods-attributes';
import { GOODS_ATTRIBUTE_KINDS, type GoodsAttributeField, type GoodsAttributeKind, type GoodsAttributeSchema } from '@/lib/goods-attributes';
import { AdminNotice, AdminPageHeader } from '../console/AdminKit';
import { AdminPickerDialog, type AdminPickerRowView } from '../console/AdminPickerDialog';
import { AdminSelect } from '../console/AdminSelect';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';

const FIELD = 'flex min-w-0 flex-col gap-2 text-sm font-medium';
const ERROR_TEXT = 'text-sm text-destructive';
/* 줄마다 반복되는 삭제는 outline에 빨간 글자로 낮춘다. */
const REMOVE_BUTTON = 'text-destructive hover:text-destructive';
const LOAD_FAILED = '상품속성 항목을 불러오지 못했습니다. 다시 골라주세요.';
const UNCERTAIN_LEAVE = '저장됐는지 아직 확인하지 못했습니다. 이 화면을 떠나면 입력이 사라집니다. 이동할까요?';

/** 아래쪽(저장 줄)에 보이는 결과. 저장·최신 항목 보기의 결과이고, `uncertain`은 저장됐는지 모르는 상태다. */
interface Outcome { tone: 'ok' | 'error'; text: string; uncertain?: boolean }

const categoryRowKey = (row: GoodsAttributeCategoryRow) => row.id;
/* 카테고리 코드는 엑셀의 '카테고리 코드' 열에 넣는 값이다. 상품등록의 카테고리 선택창과 같게 이름표를 붙인다. */
const categoryRowView = (row: GoodsAttributeCategoryRow): AdminPickerRowView => ({ title: row.path, meta: `카테고리 코드 ${row.code}` });
const nameId = (field: GoodsAttributeField) => `attribute-${field.id}-name`;
const optionId = (field: GoodsAttributeField, option: { id: string }) => `attribute-${field.id}-option-${option.id}`;
const addOptionId = (field: GoodsAttributeField) => `attribute-${field.id}-add-option`;
/** 확인창이 가리키는 항목: 이름을 적었으면 이름, 아니면 몇 번째인지. */
const fieldSubject = (field: GoodsAttributeField, index: number) => (field.name.trim() ? `‘${field.name.trim()}’ 항목` : `${index + 1}번째 항목`);

/** 저장하지 못한 곳 가운데 가장 위 칸으로 포커스를 옮긴다. 칸이 화면 밖이면 브라우저가 스크롤한다. */
function focusIssue(issue: GoodsAttributeIssue, list: readonly GoodsAttributeField[]) {
  if (typeof document === 'undefined') return;
  const field = list[issue.index];
  if (!field) return;
  const option = 'option' in issue ? field.options[issue.option] : undefined;
  document.getElementById(issue.code === 'options-empty' ? addOptionId(field) : option ? optionId(field, option) : nameId(field))?.focus();
}

export function GoodsAttributeSchemaScreen({ categories }: { categories: AdminCategoryNode[] }) {
  /* base = 마지막으로 저장된(불러온) 항목, fields = 고치는 중인 항목. 둘이 다르면 저장하지 않은 변경이 있는 것이다. */
  const [base, setBase] = useState<GoodsAttributeSchema | null>(null);
  const [fields, setFields] = useState<GoodsAttributeField[]>([]);
  const [latest, setLatest] = useState<GoodsAttributeSchema | null>(null);
  const [dialog, setDialog] = useState<'category' | 'copy' | null>(null);
  const [dialogNotice, setDialogNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /* 저장을 눌러 본 뒤에는 걸린 곳을 고치는 대로 바로 보인다. */
  const [checked, setChecked] = useState(false);
  const operation = useRef<string | null>(null);
  const pickLoader = useMemo(() => goodsAttributeCategoryLoader(categories), [categories]);
  const copyLoader = useMemo(() => goodsAttributeCategoryLoader(categories, base?.categoryId ?? ''), [categories, base?.categoryId]);
  const changes = base ? goodsAttributeChanges(base.fields, fields) : null;
  const dirty = Boolean(changes && hasGoodsAttributeChanges(changes));
  const summary = changes ? goodsAttributeChangeSummary(changes) : '';
  const uncertain = Boolean(outcome?.uncertain);
  const issues = checked ? goodsAttributeFieldIssues(normalizeGoodsAttributeFields(fields)) : [];
  const currentPath = base ? categoryPath(categories, base.categoryId).join(' > ') : '';
  /* 저장하는 중에는 떠나지 못하게 막고, 저장하지 않은 변경이 있으면 떠날 때 묻는다. */
  useAdminLeaveGuard({ dirty, blocked: busy && dirty, message: uncertain ? UNCERTAIN_LEAVE : undefined });

  function closeDialog() { setDialog(null); setDialogNotice(''); }
  /** 읽어 온 저장본으로 화면을 새로 채운다. */
  function adopt(schema: GoodsAttributeSchema) {
    setBase(schema); setFields(schema.fields); setLatest(null); setChecked(false); setOutcome(null); setMessage(''); operation.current = null;
  }
  /** 항목을 고친다. 고치면 이전 저장 시도와 이어지지 않도록 새 저장 번호를 쓴다. */
  function edit(change: (current: GoodsAttributeField[]) => GoodsAttributeField[]) {
    setFields(change); setMessage('');
    setOutcome(current => (current && (current.tone === 'ok' || current.uncertain) ? null : current));
    operation.current = null;
  }
  function update(id: string, patch: Partial<GoodsAttributeField>) { edit(current => current.map(field => (field.id === id ? { ...field, ...patch } : field))); }
  function addField() {
    const added: GoodsAttributeField = { id: crypto.randomUUID(), name: '', kind: 'text', required: false, unit: '', options: [] };
    edit(current => (current.length >= GOODS_ATTRIBUTE_FIELD_LIMIT ? current : [...current, added]));
  }
  function move(index: number, by: -1 | 1) {
    edit(current => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  /* 이름·선택값·단위를 적은 항목만 묻는다. 이름도 선택값도 없는 빈 항목은 지워도 잃을 것이 없다. */
  async function removeField(field: GoodsAttributeField, index: number) {
    if (!isBlankGoodsAttributeField(field)) {
      const options = goodsAttributeNamedOptionCount(field);
      const ok = await adminConfirm({
        title: '항목을 지울까요?', message: `${fieldSubject(field, index)}을 지웁니다.${options ? ` 선택값 ${options}개도 함께 지워집니다.` : ''}`, confirmLabel: '지우기', destructive: true,
      });
      if (!ok) return;
    }
    edit(current => current.filter(item => item.id !== field.id));
  }
  /* 유형을 바꾸면 그 유형에 없는 입력(선택값·단위)이 지워진다. 지워질 것이 있을 때만 묻는다. */
  async function changeKind(field: GoodsAttributeField, index: number, kind: GoodsAttributeKind) {
    if (kind === field.kind) return;
    const loss = goodsAttributeKindLoss(field, kind);
    const lost = [loss.options ? `선택값 ${loss.options}개` : '', loss.unit ? `단위 ‘${loss.unit}’` : ''].filter(Boolean);
    if (lost.length) {
      const ok = await adminConfirm({
        title: '유형을 바꿀까요?',
        message: `${fieldSubject(field, index)}의 유형을 바꾸면 입력해 둔 내용이 지워집니다.\n유형: ${GOODS_ATTRIBUTE_KIND_LABELS[field.kind]} → ${GOODS_ATTRIBUTE_KIND_LABELS[kind]}\n지워지는 것: ${lost.join(', ')}`,
        confirmLabel: '유형 바꾸기', destructive: true,
      });
      if (!ok) return;
    }
    update(field.id, { kind, unit: kind === 'number' ? field.unit : '', options: kind === 'single' || kind === 'multi' ? field.options : [] });
  }

  /** 카테고리를 고르면 바로 그 카테고리의 항목을 불러온다. 저장하지 않은 변경이 있으면 사라진다고 먼저 묻는다. */
  async function openCategory(row: GoodsAttributeCategoryRow): Promise<boolean> {
    if (busy) return false;
    setDialogNotice('');
    if (dirty && !await adminConfirm({
      title: '다른 카테고리를 열까요?', message: `‘${row.path}’의 상품속성 항목을 열면 저장하지 않은 변경이 사라집니다.\n${summary}`, confirmLabel: '열기', cancelLabel: '계속 고치기', destructive: true,
    })) return false;
    const result = await readGoodsAttributesAction(row.id);
    if (!result.data?.schema) { setDialogNotice(result.error ?? LOAD_FAILED); return false; }
    adopt(result.data.schema);
    return true;
  }
  /** 다른 카테고리의 항목을 지금 항목 대신 가져온다. 항목이 없는 카테고리는 가져오지 않고, 지금 항목이 있으면 몇 개가 바뀌는지 묻는다. */
  async function copyFrom(row: GoodsAttributeCategoryRow): Promise<boolean> {
    if (!base || busy) return false;
    setDialogNotice('');
    const result = await readGoodsAttributesAction(row.id);
    if (!result.data?.schema) { setDialogNotice(result.error ?? LOAD_FAILED); return false; }
    const source = result.data.schema.fields;
    if (!source.length) { setDialogNotice(`‘${row.path}’에는 상품속성 항목이 없습니다. 다른 카테고리를 골라주세요.`); return false; }
    if (fields.length && !await adminConfirm({
      title: '지금 항목을 바꿀까요?',
      message: `지금 항목 ${fields.length}개를 지우고 ‘${row.path}’의 항목 ${source.length}개로 바꿉니다.${dirty ? '\n저장하지 않고 고친 내용도 함께 사라집니다.' : ''}`,
      confirmLabel: '바꾸기', destructive: true,
    })) return false;
    edit(() => source);
    setMessage(`‘${row.path}’의 항목 ${source.length}개를 가져왔습니다. 저장하기 전에 이 카테고리에 맞는지 확인해주세요.`);
    return true;
  }

  async function cancelChanges() {
    if (!base || !dirty) return;
    const ok = await adminConfirm({
      title: '변경을 취소할까요?', message: `저장하지 않은 변경을 모두 버리고 마지막으로 저장한 상태로 되돌립니다.\n${summary}`, confirmLabel: '변경 취소', cancelLabel: '계속 고치기', destructive: true,
    });
    if (!ok) return;
    setFields(base.fields); setChecked(false); setOutcome(null); setMessage('저장하지 않은 변경을 취소했습니다.'); operation.current = null;
  }
  async function showLatest() {
    if (!base || busy) return;
    setBusy(true); setOutcome(null); setMessage('');
    const result = await readGoodsAttributesAction(base.categoryId); setBusy(false);
    if (!result.data?.schema) { setOutcome({ tone: 'error', text: result.error ?? LOAD_FAILED }); return; }
    setLatest(result.data.schema);
  }
  /** 내 입력은 그대로 두고, 다음 저장이 지금 저장돼 있는 항목을 기준으로 하게 한다. */
  function keepMine() {
    if (!latest) return;
    setBase(latest); setLatest(null); setOutcome(null); operation.current = null;
    setMessage('내 입력을 그대로 두었습니다. 저장하면 지금 저장돼 있는 항목이 내 입력으로 바뀝니다.');
  }
  async function takeLatest() {
    if (!latest) return;
    if (dirty && !await adminConfirm({
      title: '내 입력을 버릴까요?', message: `저장하지 않은 변경을 버리고 지금 저장돼 있는 항목 ${latest.fields.length}개로 바꿉니다.\n${summary}`, confirmLabel: '바꾸기', cancelLabel: '계속 고치기', destructive: true,
    })) return;
    adopt(latest); setMessage('지금 저장돼 있는 항목으로 바꿨습니다.');
  }
  async function save() {
    if (!base || busy || !dirty) return;
    const normalized = normalizeGoodsAttributeFields(fields);
    const found = goodsAttributeFieldIssues(normalized);
    if (found.length) { setChecked(true); focusIssue(found[0], normalized); return; }
    setBusy(true); setOutcome(null); setMessage('');
    operation.current ??= crypto.randomUUID();
    const saved = await saveGoodsAttributeSchemaAction(base.categoryId, normalized, base.revision, operation.current); setBusy(false);
    if (!saved.data) {
      setOutcome({ tone: 'error', text: saved.error ?? '상품속성 항목을 저장하지 못했습니다. 잠시 뒤 다시 저장해주세요.', uncertain: Boolean(saved.uncertain) });
      return;
    }
    adopt(saved.data);
    setOutcome({ tone: 'ok', text: '상품속성 항목을 저장했습니다. 상품에 이미 넣은 값은 그대로 남아 있습니다.' });
  }

  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-attributes">
    <AdminPageHeader title="상품속성 관리" description="대표 카테고리별로 상품마다 채울 상품속성 항목을 정합니다. 옵션·상품정보제공고시와는 따로 저장하고, 네이버 속성은 자동으로 가져오지 않습니다." />
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <label className="text-sm font-medium" htmlFor="attribute-category-display">카테고리</label>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-haspopup="dialog" className="w-full cursor-pointer sm:w-96" id="attribute-category-display" placeholder="아직 고르지 않았습니다" readOnly type="text" value={currentPath}
          onClick={() => { if (!busy) setDialog('category'); }}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') { event.preventDefault(); if (!busy) setDialog('category'); } }} />
        <Button aria-haspopup="dialog" aria-label={base ? '카테고리 바꾸기' : undefined} disabled={busy} onClick={() => setDialog('category')} type="button" variant={base ? 'outline' : 'default'}>{base ? '바꾸기' : '카테고리 고르기'}</Button>
      </div>
      {/* 저장한 뒤에 일어나는 일은 화면에 보이지 않으므로 늘 말한다. */}
      {base ? <AdminNotice tone="warning" title="저장하면 이렇게 적용됩니다"><ul className="flex list-disc flex-col gap-0.5 pl-4">
        <li>필수 항목을 만들어도 이미 공개한 상품은 그대로 보입니다. 그 상품을 다시 저장하려면 필수 값을 채워야 합니다.</li>
        <li>항목을 지우거나 유형·단위를 바꾸면 맞지 않는 값은 고객 화면에서 빠지고, 상품 수정 화면에만 남습니다.</li>
      </ul></AdminNotice> : null}
    </div>
    {base ? <>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm font-medium tabular-nums">항목 {fields.length}/{GOODS_ATTRIBUTE_FIELD_LIMIT}개</strong>
        <Button disabled={busy || fields.length >= GOODS_ATTRIBUTE_FIELD_LIMIT} onClick={addField} size="sm" type="button" variant="outline"><Plus aria-hidden="true" />항목 추가</Button>
        <Button aria-haspopup="dialog" disabled={busy} onClick={() => setDialog('copy')} size="sm" type="button" variant="outline">가져올 카테고리 고르기</Button>
      </div>
      {message ? <p className="text-sm text-foreground" role="status">{message}</p> : null}
      <fieldset className="flex min-w-0 flex-col gap-3" disabled={busy}>
        <legend className="sr-only">상품속성 항목</legend>
        {fields.map((field, index) => {
          const own = issues.filter(issue => issue.index === index);
          const nameIssue = own.find(issue => issue.code === 'name-empty' || issue.code === 'name-duplicate');
          const optionsIssue = own.find(issue => issue.code === 'options-empty');
          const choice = field.kind === 'single' || field.kind === 'multi';
          return <article className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" key={field.id}>
            <h3 className="text-base font-medium">항목 {index + 1}</h3>
            <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className={FIELD}>항목명<Input aria-describedby={nameIssue ? `${nameId(field)}-error` : undefined} aria-invalid={nameIssue ? true : undefined} aria-label={`항목 ${index + 1} 이름`} id={nameId(field)} maxLength={60} onChange={event => update(field.id, { name: event.target.value })} value={field.name} /></label>
              <label className={FIELD}>유형<AdminSelect aria-label={`항목 ${index + 1} 유형`} onChange={event => { void changeKind(field, index, event.target.value as GoodsAttributeKind); }} value={field.kind} wrapperClassName="w-full">{GOODS_ATTRIBUTE_KINDS.map(kind => <option key={kind} value={kind}>{GOODS_ATTRIBUTE_KIND_LABELS[kind]}</option>)}</AdminSelect></label>
              <label className="flex h-8 cursor-pointer items-center gap-2 text-sm"><input checked={field.required} onChange={event => update(field.id, { required: event.target.checked })} type="checkbox" />필수 입력</label>
              {field.kind === 'number' ? <label className={FIELD}>단위<Input aria-label={`항목 ${index + 1} 단위`} maxLength={20} onChange={event => update(field.id, { unit: event.target.value })} value={field.unit} /></label> : null}
            </div>
            {nameIssue ? <p className={ERROR_TEXT} id={`${nameId(field)}-error`} role="alert">{goodsAttributeIssueHint(nameIssue)}</p> : null}
            {choice ? <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              <strong className="text-sm font-medium tabular-nums">선택값 {field.options.length}/{GOODS_ATTRIBUTE_OPTION_LIMIT}</strong>
              {field.options.map((option, n) => {
                const optionIssue = own.find(issue => 'option' in issue && issue.option === n);
                return <div className="flex min-w-0 flex-col gap-1" key={option.id}>
                  <div className="flex items-center gap-2">
                    <Input aria-describedby={optionIssue ? `${optionId(field, option)}-error` : undefined} aria-invalid={optionIssue ? true : undefined} aria-label={`항목 ${index + 1} 선택값 ${n + 1}`} className="min-w-0 flex-1" id={optionId(field, option)} maxLength={80}
                      onChange={event => update(field.id, { options: field.options.map(item => (item.id === option.id ? { ...item, label: event.target.value } : item)) })} value={option.label} />
                    <Button aria-label={`선택값 삭제 (항목 ${index + 1} 선택값 ${n + 1})`} className={REMOVE_BUTTON} onClick={() => update(field.id, { options: field.options.filter(item => item.id !== option.id) })} size="sm" type="button" variant="outline">선택값 삭제</Button>
                  </div>
                  {optionIssue ? <p className={ERROR_TEXT} id={`${optionId(field, option)}-error`} role="alert">{goodsAttributeIssueHint(optionIssue)}</p> : null}
                </div>;
              })}
              <Button className="self-start" disabled={field.options.length >= GOODS_ATTRIBUTE_OPTION_LIMIT} id={addOptionId(field)} onClick={() => update(field.id, { options: [...field.options, { id: crypto.randomUUID(), label: '' }] })} size="sm" type="button" variant="outline">선택값 추가</Button>
              {optionsIssue ? <p className={ERROR_TEXT} role="alert">{goodsAttributeIssueHint(optionsIssue)}</p> : null}
            </div> : null}
            <div className="flex flex-wrap gap-1.5">
              <Button aria-label={`위로 (항목 ${index + 1})`} disabled={index === 0} onClick={() => move(index, -1)} size="sm" type="button" variant="outline">위로</Button>
              <Button aria-label={`아래로 (항목 ${index + 1})`} disabled={index === fields.length - 1} onClick={() => move(index, 1)} size="sm" type="button" variant="outline">아래로</Button>
              <Button aria-label={`항목 삭제 (항목 ${index + 1})`} className={REMOVE_BUTTON} onClick={() => { void removeField(field, index); }} size="sm" type="button" variant="outline">항목 삭제</Button>
            </div>
          </article>;
        })}
      </fieldset>
      <div className="flex min-w-0 flex-col gap-3">
        {issues.length ? <p className={ERROR_TEXT} role="alert">{goodsAttributeIssuesMessage(issues)}</p> : null}
        {outcome ? <p className={outcome.tone === 'ok' ? 'text-sm text-success' : ERROR_TEXT} role={outcome.tone === 'ok' ? 'status' : 'alert'}>{outcome.text}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || !dirty} onClick={save} type="button">{busy ? '저장하는 중' : uncertain ? '저장됐는지 확인' : '저장'}</Button>
          {dirty ? <Button disabled={busy} onClick={cancelChanges} type="button" variant="ghost">변경 취소</Button> : null}
          <Button disabled={busy} onClick={showLatest} type="button" variant="outline">최신 항목 보기</Button>
          {dirty ? <span className="text-sm text-muted-foreground">저장하지 않은 변경 · {summary}</span> : null}
        </div>
      </div>
      {latest ? <section aria-label="지금 저장돼 있는 상품속성 항목" className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/40 p-4">
        <h3 className="text-base font-medium">지금 저장돼 있는 항목</h3>
        {latest.fields.length ? latest.fields.map(field => <p className="text-sm" key={field.id}>{field.name} · {GOODS_ATTRIBUTE_KIND_LABELS[field.kind]}{field.required ? ' · 필수' : ''}</p>) : <p className="text-sm text-muted-foreground">저장된 항목이 없습니다.</p>}
        <p className="text-sm text-muted-foreground">[내 입력 유지]를 누른 뒤 저장하면 위 항목이 내 입력으로 바뀝니다.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={keepMine} size="sm" type="button" variant="outline">내 입력 유지</Button>
          <Button disabled={busy} onClick={() => { void takeLatest(); }} size="sm" type="button" variant="outline">최신 항목으로 바꾸기</Button>
        </div>
      </section> : null}
    </> : null}
    {dialog === 'category' ? <AdminPickerDialog<GoodsAttributeCategoryRow>
      emptyText="일치하는 카테고리가 없습니다."
      excludedNote="하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다."
      footer={dialogNotice ? <p className={ERROR_TEXT} role="alert">{dialogNotice}</p> : null}
      load={pickLoader}
      onClose={closeDialog}
      onSelect={openCategory}
      rowKey={categoryRowKey}
      rowView={categoryRowView}
      searchPlaceholder="카테고리명 또는 코드로 찾기"
      selectedKeys={base ? [base.categoryId] : undefined}
      title="카테고리 고르기"
    /> : null}
    {dialog === 'copy' && base ? <AdminPickerDialog<GoodsAttributeCategoryRow>
      description="고르면 지금 항목이 그 카테고리의 항목으로 바뀝니다. 저장하기 전에는 [변경 취소]로 되돌릴 수 있습니다."
      emptyText="일치하는 카테고리가 없습니다."
      excludedNote="지금 고른 카테고리와, 하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다."
      footer={dialogNotice ? <p className={ERROR_TEXT} role="alert">{dialogNotice}</p> : null}
      load={copyLoader}
      onClose={closeDialog}
      onSelect={copyFrom}
      rowKey={categoryRowKey}
      rowView={categoryRowView}
      searchPlaceholder="카테고리명 또는 코드로 찾기"
      title="가져올 카테고리 고르기"
    /> : null}
  </section>;
}

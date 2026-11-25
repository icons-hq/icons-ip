'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { listCategoryTemplatesAction, loadRegisteredCategoryTemplateIdsAction, loadUsableCategoryTemplatesAction, saveCategoryTemplatesAction, type CategoryTemplateResult } from '@/app/admin/category-template-actions';
import { CATEGORY_TEMPLATE_ALREADY_EXISTS, CATEGORY_TEMPLATE_CHECK_LABEL, CATEGORY_TEMPLATE_LIST_FAILED, CATEGORY_TEMPLATE_UNCERTAIN, categoryTemplateText, registrableTemplateCategories, type CategoryTemplate, type CategoryTemplateChange, type CategoryTemplatePage, type RegistrableTemplateCategory } from '@/lib/admin/category-templates';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { adminConfirm } from '@/lib/admin/confirm';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { adminPickerLocalPage, type AdminPickerLoader } from '@/lib/admin/picker';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminPickerDialog, type AdminPickerRowView } from '../console/AdminPickerDialog';
import { AdminSelect } from '../console/AdminSelect';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableRow } from '../kit/ui/table';

const MANAGE_DESCRIPTION = '자주 쓰는 마지막 단계 카테고리를 등록해 두면 상품 등록에서 검색 없이 목록에서 바로 고를 수 있습니다. 고른 뒤 상품을 저장해야 적용되고, 여기서 보관해도 기존 상품의 카테고리는 바뀌지 않습니다.';
/** 한 번에 등록할 수 있는 개수(저장 함수의 상한과 같다). */
const REGISTER_LIMIT = 100;

/** 저장 완료 문구. 새 등록은 저장 버전이 0이고, 보관됨 목록의 복원은 지금 버전을 그대로 보낸다. */
export function categoryTemplateSavedMessage(items: readonly CategoryTemplateChange[], archived: boolean, count: number): string {
  const verb = archived ? '보관' : items.some((item) => item.revision === 0) ? '등록' : '복원';
  return `자주 쓰는 카테고리 ${count}개를 ${verb}했습니다.`;
}

const categoryRowMeta = (code: string) => `카테고리 코드 ${code}`;

/* ───────── 상품 화면의 '자주 쓰는 카테고리 고르기' 창 ───────── */
const templateRowView = (row: CategoryTemplate): AdminPickerRowView => ({ title: row.path.join(' > '), meta: categoryRowMeta(row.code) });

/**
 * 상품의 대표 카테고리를 등록해 둔 목록에서 고르는 창(공용 선택창, docs/admin-screen-rules.md 규칙 1·2).
 * 고를 수 없는 줄(카테고리를 보관했거나 하위 카테고리가 생긴 것)은 서버가 읽을 때 빼므로 목록·개수·쪽 수에 들어오지 않는다.
 * 창을 열 때 한 번 읽고, 검색·쪽 이동은 읽어 둔 목록에서 자른다. 읽지 못했으면 [검색]을 다시 누를 때 다시 읽는다.
 */
export function CategoryTemplatePicker({ onSelect, onClose }: { onSelect: (template: CategoryTemplate) => void; onClose: () => void }) {
  const rows = useRef<CategoryTemplate[] | null>(null);
  const load: AdminPickerLoader<CategoryTemplate> = async (request) => {
    if (!rows.current) {
      try {
        const result = await loadUsableCategoryTemplatesAction();
        if (!result.ok) return { error: result.error };
        rows.current = result.value;
      } catch { return { error: CATEGORY_TEMPLATE_LIST_FAILED }; }
    }
    return adminPickerLocalPage(rows.current, request, { textOf: categoryTemplateText });
  };
  return <AdminPickerDialog<CategoryTemplate>
    description="고르면 대표 카테고리 칸에 채워집니다."
    emptyText="고를 수 있는 자주 쓰는 카테고리가 없습니다."
    excludedNote="보관했거나 하위 카테고리가 생겨 지금 고를 수 없는 카테고리는 목록에서 뺐습니다."
    load={load}
    onClose={onClose}
    onSelect={(row) => { onSelect(row); }}
    rowKey={(row) => row.categoryId}
    rowView={templateRowView}
    searchPlaceholder="카테고리 이름이나 코드로 찾기"
    title="자주 쓰는 카테고리 고르기"
  />;
}

/* ───────── 등록 창 ───────── */
const registerRowView = (row: RegistrableTemplateCategory): AdminPickerRowView => ({ title: row.path, meta: categoryRowMeta(row.code) });

/**
 * 자주 쓰는 카테고리로 등록할 카테고리를 여러 개 골라 한 번에 등록하는 창(공용 선택창). 고르는 것은 [N개 등록]을 누를 때까지 저장되지 않는다.
 * 목록에는 지금 쓸 수 있는 마지막 단계 카테고리 가운데 아직 등록하지 않은 것만 나온다(보관한 등록도 등록한 것으로 본다).
 * 저장은 화면(`CategoryTemplatesScreen`)이 하고, 성공하면 화면이 이 창을 닫는다. 저장 결과와 [저장됐는지 확인]은 `status`로 받아 창 안에 보인다.
 */
export function CategoryTemplateRegisterDialog({ categories, busy, uncertain, status, onRegister, onClose }: {
  categories: AdminCategoryNode[];
  /** 저장하는 중. 이때는 고른 것을 바꾸지 못한다. */
  busy: boolean;
  /** 저장됐는지 모르는 중. 이때도 고른 것을 바꾸지 못하고, 닫을 때 묻지 않는다(결과는 화면에서 확인한다). */
  uncertain: boolean;
  status: ReactNode;
  onRegister: (categoryIds: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<RegistrableTemplateCategory[]>([]);
  const rows = useRef<RegistrableTemplateCategory[] | null>(null);
  const footer = useRef<HTMLDivElement | null>(null);
  const frozen = busy || uncertain;
  const load: AdminPickerLoader<RegistrableTemplateCategory> = async (request) => {
    if (!rows.current) {
      try {
        const result = await loadRegisteredCategoryTemplateIdsAction();
        if (!result.ok) return { error: result.error };
        rows.current = registrableTemplateCategories(categories, new Set(result.value));
      } catch { return { error: CATEGORY_TEMPLATE_LIST_FAILED }; }
    }
    return adminPickerLocalPage(rows.current, request, { textOf: (row) => row.text });
  };
  const isPicked = (row: RegistrableTemplateCategory) => picked.some((item) => item.id === row.id);
  const add = (row: RegistrableTemplateCategory) => { if (!frozen) setPicked((current) => current.length >= REGISTER_LIMIT || current.some((item) => item.id === row.id) ? current : [...current, row]); };
  const remove = (row: RegistrableTemplateCategory) => { if (!frozen) setPicked((current) => current.filter((item) => item.id !== row.id)); };
  /* 고른 것이 있으면 닫기 전에 묻는다(화면 규칙 7). 저장하는 중·결과를 모르는 중에는 묻지 않고 닫는다 — 결과는 화면에 남는다. */
  async function close() {
    if (!picked.length || frozen) { onClose(); return; }
    /* Esc를 거듭 누르면 브라우저가 창을 먼저 닫는다. 고른 것을 보면서 답하도록 다시 띄운 뒤 묻는다(닫힌 채 두면 같은 버튼으로 다시 열 수도 없다). */
    const dialog = footer.current?.closest('dialog');
    if (dialog?.isConnected && !dialog.open) { try { dialog.showModal(); } catch { /* 문서에서 빠지는 중이면 그대로 둔다. */ } }
    if (await adminConfirm({ title: '고른 카테고리를 등록하지 않고 닫을까요?', message: `고른 ${picked.length}개는 아직 등록되지 않았습니다. [${picked.length}개 등록]을 눌러야 등록됩니다.`, confirmLabel: '등록하지 않고 닫기' })) onClose();
  }
  return <AdminPickerDialog<RegistrableTemplateCategory>
    emptyText="일치하는 카테고리가 없습니다."
    excludedNote="이미 등록한 카테고리, 하위 카테고리가 있는 카테고리, 보관한 카테고리는 목록에서 뺐습니다."
    footer={<div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/40 p-3" data-category-templates="register" ref={footer}>
      <p className="text-sm font-medium tabular-nums" role="status">고른 카테고리 {picked.length}개</p>
      {picked.length ? <ul className="m-0 flex max-h-28 min-w-0 list-none flex-wrap gap-1.5 overflow-y-auto p-0">{picked.map((row) => <li className="flex min-w-0 items-center gap-1 rounded-md border bg-card py-0.5 pr-1 pl-2 text-xs" key={row.id}>
        <span className="wrap-anywhere">{row.path}</span><Button aria-label={`${row.path} 빼기`} disabled={frozen} onClick={() => remove(row)} size="xs" type="button" variant="ghost">빼기</Button>
      </li>)}</ul> : null}
      {status}
      <div className="flex justify-end"><Button disabled={!picked.length || frozen} onClick={() => onRegister(picked.map((row) => row.id))} type="button">{busy ? '등록하는 중…' : picked.length ? `${picked.length}개 등록` : '등록'}</Button></div>
    </div>}
    load={load}
    multiple
    onClose={() => void close()}
    onDeselect={frozen ? undefined : remove}
    onSelect={add}
    rowBlocked={(row) => isPicked(row) ? null : frozen ? (busy ? '등록하는 중' : '저장됐는지 확인한 뒤 고를 수 있습니다') : picked.length >= REGISTER_LIMIT ? `최대 ${REGISTER_LIMIT}개까지` : null}
    rowKey={(row) => row.id}
    rowView={registerRowView}
    searchPlaceholder="카테고리 이름이나 코드로 찾기"
    selectedKeys={picked.map((row) => row.id)}
    title="등록할 카테고리 고르기"
  />;
}

/* ───────── 관리 화면 ───────── */
export function CategoryTemplatesScreen({ categories = [] }: { categories?: AdminCategoryNode[] }) {
  const [data, setData] = useState<CategoryTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  /* 등록은 화면 머리의 버튼에서 여는 창이다(템플릿 화면군 공통 위치). 상태 순서를 바꾸지 않게 마지막에 둔다. */
  const [registering, setRegistering] = useState(false);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0), request = useRef<{ items: CategoryTemplateChange[]; archived: boolean; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true; const sequence = ++readSequence.current;
    void listCategoryTemplatesAction('', false, 1).then(result => {
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) setData(result.value); else { setMessage(result.error); setError(true); }
    }).catch(() => { if (mounted.current && sequence === readSequence.current) { setMessage(CATEGORY_TEMPLATE_LIST_FAILED); setError(true); } });
    return () => { mounted.current = false; };
  }, []);
  async function load(page = 1, nextQuery = search, nextArchived = archived) {
    if (busy.current || uncertain) return;
    busy.current = true; setPending(true); const sequence = ++readSequence.current;
    try {
      let result = await listCategoryTemplatesAction(nextQuery, nextArchived, page);
      if (result.ok && page > Math.max(1, Math.ceil(result.value.total / 20))) result = await listCategoryTemplatesAction(nextQuery, nextArchived, Math.max(1, Math.ceil(result.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { setData(result.value); setSearch(nextQuery); setArchived(nextArchived); setSelected([]); setConflict(false); setError(false); setMessage(''); }
      else { setMessage(result.error); setError(true); }
    } catch { if (mounted.current && sequence === readSequence.current) { setMessage(`${CATEGORY_TEMPLATE_LIST_FAILED} 고른 항목은 그대로 두었습니다.`); setError(true); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function save(items: CategoryTemplateChange[], nextArchived: boolean) {
    if (busy.current || conflict) return;
    request.current ??= { items, archived: nextArchived, id: crypto.randomUUID() };
    const fixed = request.current; busy.current = true; readSequence.current++; setPending(true); setMessage('');
    let result: CategoryTemplateResult<CategoryTemplate[]>;
    try { result = await saveCategoryTemplatesAction(fixed.items, fixed.archived, fixed.id); }
    catch { result = { ok: false, uncertain: true, error: CATEGORY_TEMPLATE_UNCERTAIN }; }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (!result.ok) {
      /* 새 등록(버전 0)의 충돌은 목록이 낡았다는 뜻이 아니라 그 카테고리가 이미 있다는 뜻이다. 화면을 잠그지 않고 이유를 말해 다시 고르게 한다. */
      const alreadyExists = Boolean(result.conflict) && fixed.items.every(item => item.revision === 0);
      setMessage(alreadyExists ? CATEGORY_TEMPLATE_ALREADY_EXISTS : result.error); setError(true); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict) && !alreadyExists); if (!result.uncertain) request.current = null; return;
    }
    request.current = null; setUncertain(false); setSelected([]); setError(false); setRegistering(false);
    // Refresh with the same filters; an emptied last page returns to the preceding page.
    const nextPage = data?.page ?? 1;
    busy.current = true; setPending(true); const sequence = ++readSequence.current;
    try {
      let refreshed = await listCategoryTemplatesAction(search, archived, nextPage);
      if (refreshed.ok && nextPage > Math.max(1, Math.ceil(refreshed.value.total / 20))) refreshed = await listCategoryTemplatesAction(search, archived, Math.max(1, Math.ceil(refreshed.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (refreshed.ok) { setData(refreshed.value); setMessage(categoryTemplateSavedMessage(fixed.items, fixed.archived, result.value.length)); }
      else { setMessage('저장은 됐지만 목록을 새로 불러오지 못했습니다. [검색]을 눌러 다시 불러와주세요.'); setError(true); }
    } catch { if (mounted.current) { setMessage('저장은 됐지만 목록을 새로 불러오지 못했습니다. [검색]을 눌러 다시 불러와주세요.'); setError(true); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  const locked = pending || uncertain;
  const selectedRows = data?.rows.filter(row => selected.includes(row.categoryId)) ?? [];
  const searchFields = <>
    <div className={CONSOLE_FILTER_FIELDS_CLASS}>
      <label className={`${CONSOLE_FILTER_LABEL_CLASS} min-w-[min(100%,15rem)] flex-1`}>카테고리 이름·코드<Input type="search" value={query} maxLength={120} disabled={locked} onChange={event => setQuery(event.target.value)} /></label>
      <label className={CONSOLE_FILTER_LABEL_CLASS}>보관 상태<AdminSelect value={archived ? 'archived' : 'active'} disabled={locked} onChange={event => void load(1, search, event.target.value === 'archived')} wrapperClassName="w-40"><option value="active">사용 중</option><option value="archived">보관됨</option></AdminSelect></label>
    </div>
    <ConsoleFilterActions>
      <Button variant="ghost" type="button" disabled={locked} onClick={() => { setQuery(''); void load(1, '', false); }}>초기화</Button>
      <Button type="submit" disabled={locked} variant="soft">검색</Button>
    </ConsoleFilterActions>
  </>;
  /* 처리 결과·결과 확인 버튼. 등록 창이 열려 있으면 창 안에, 아니면 목록 위에 둔다(모달 뒤에 가려지지 않게). */
  const status = <>
    {message ? <p className={`text-sm${error ? ' text-destructive' : ''}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
    {uncertain ? <Button className="self-start" type="button" disabled={pending} onClick={() => void save(request.current?.items ?? [], request.current?.archived ?? false)}>{CATEGORY_TEMPLATE_CHECK_LABEL}</Button> : null}
  </>;
  /* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드([초기화][검색]) → 목록 카드(표·페이지 이동). */
  return <section className="flex min-w-0 flex-col gap-4" aria-busy={pending} data-admin-screen="category-templates">
    <AdminPageHeader title="자주 쓰는 카테고리 관리" description={MANAGE_DESCRIPTION}
      actions={<Button type="button" disabled={locked || conflict || !data} onClick={() => { setMessage(''); setError(false); setRegistering(true); }}><Plus aria-hidden="true" />자주 쓰는 카테고리 등록</Button>} />
    <form className={CONSOLE_FILTER_CARD_CLASS} onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>{searchFields}</form>
    {!registering ? status : null}
    {conflict ? <Button className="self-start" variant="outline" type="button" disabled={pending} onClick={() => void load(data?.page ?? 1)}>최신 목록 다시 조회</Button> : null}
    {data ? <ConsoleListCard headingLevel={3} title="조회 결과" total={data.total}
      actions={<Button size="sm" variant="outline" type="button" disabled={locked || conflict || !selectedRows.length} onClick={() => void save(selectedRows.map(row => ({ categoryId: row.categoryId, revision: row.revision })), !archived)}>{archived ? '선택 복원' : '선택 보관'} {selectedRows.length}개</Button>}>
      <div className={CONSOLE_TABLE_FRAME_CLASS} role="region" aria-label="자주 쓰는 카테고리 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[640px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">자주 쓰는 카테고리 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent">
        <TableHead className="relative w-10 min-w-10 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label="현재 페이지 모두 선택" checked={data.rows.length > 0 && data.rows.every(row => selected.includes(row.categoryId))} disabled={locked || !data.rows.length} onChange={event => setSelected(event.target.checked ? data.rows.map(row => row.categoryId) : [])} /></label></TableHead><TableHead>카테고리</TableHead><TableHead>등록일 (KST)</TableHead><TableHead>상태</TableHead>
      </TableRow></ConsoleTableHeader><TableBody>{data.rows.map(row => <TableRow key={row.categoryId} data-state={selected.includes(row.categoryId) ? 'selected' : undefined}><TableCell className="relative w-10 min-w-10 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`${row.path.join(' > ')} 선택`} checked={selected.includes(row.categoryId)} disabled={locked} onChange={event => setSelected(current => event.target.checked ? [...current, row.categoryId] : current.filter(id => id !== row.categoryId))} /></label></TableCell><TableCell className="whitespace-normal">{row.path.join(' > ')}{!row.usable ? <AdminStatusBadge className="ml-1.5" tone="warning">고를 수 없음</AdminStatusBadge> : null}<small className="block text-xs text-muted-foreground">{categoryRowMeta(row.code)}{!row.usable ? ' · 보관했거나 하위 카테고리가 있습니다.' : ''}</small></TableCell><TableCell className="tabular-nums">{kstDateTimeText(row.createdAt).replaceAll('-', '.')}</TableCell><TableCell><AdminStatusBadge tone={statusTone('setting', row.archived ? 'archived' : 'active')}>{row.archived ? '보관됨' : '사용 중'}</AdminStatusBadge></TableCell></TableRow>)}{!data.rows.length ? <ConsoleTableEmptyRow colSpan={4}>{search || archived ? '조건에 맞는 자주 쓰는 카테고리가 없습니다.' : '자주 쓰는 카테고리가 없습니다. 오른쪽 위 [자주 쓰는 카테고리 등록]을 눌러 추가해주세요.'}</ConsoleTableEmptyRow> : null}</TableBody></table></div>
      <ConsolePagination label="자주 쓰는 카테고리 페이지" page={data.page} pageSize={20} total={data.total} disabled={locked} onPageChange={page => void load(page)} />
    </ConsoleListCard> : message ? null : <p className="text-sm text-muted-foreground" role="status">자주 쓰는 카테고리를 불러오는 중…</p>}
    {registering ? <CategoryTemplateRegisterDialog busy={pending} categories={categories} onClose={() => setRegistering(false)} onRegister={ids => void save(ids.map(categoryId => ({ categoryId, revision: 0 })), false)} status={status} uncertain={uncertain} /> : null}
  </section>;
}

'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { listCategoryTemplatesAction, saveCategoryTemplatesAction, type CategoryTemplateResult } from '@/app/admin/category-template-actions';
import { CATEGORY_TEMPLATE_ALREADY_EXISTS, selectedCategoryPath, usableTemplateCategory, type CategoryTemplate, type CategoryTemplateChange, type CategoryTemplatePage } from '@/lib/admin/category-templates';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSearchSelectPanel, type AdminSearchSelectOption } from '../console/AdminSearchSelect';
import { AdminSelect } from '../console/AdminSelect';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableRow } from '../kit/ui/table';
import { CustomerServiceDialog } from './CustomerServiceDialog';

const MANAGE_DESCRIPTION = '자주 쓰는 마지막 단계 카테고리를 등록해 두면 상품 등록에서 검색 없이 목록에서 바로 고를 수 있습니다. 고른 뒤 상품을 저장해야 적용되고, 여기서 보관해도 기존 상품의 카테고리는 바뀌지 않습니다.';
const PICK_DESCRIPTION = '등록해 둔 카테고리를 고르면 대표 카테고리에 바로 채워집니다. 상품을 저장해야 적용됩니다.';

/** 저장 완료 문구. 새 등록은 저장 버전이 0이고, 보관됨 목록의 복구는 지금 버전을 그대로 보낸다. */
export function categoryTemplateSavedMessage(items: readonly CategoryTemplateChange[], archived: boolean, count: number): string {
  const verb = archived ? '보관' : items.some((item) => item.revision === 0) ? '등록' : '복구';
  return `자주 쓰는 카테고리 ${count}개를 ${verb}했습니다.`;
}

/** 등록 창의 선택지: 지금 쓸 수 있는 마지막 단계 카테고리를 경로 순으로. 코드와 붙여 쓴 경로로도 찾는다. */
export function categoryTemplateOptions(categories: AdminCategoryNode[]): AdminSearchSelectOption[] {
  const collator = new Intl.Collator('ko');
  return categories.filter((category) => usableTemplateCategory(categories, category.id)).map((category) => {
    const names = selectedCategoryPath(categories, category.id).map((row) => row.name);
    return { value: category.id, label: names.join(' > '), keywords: `${names.join('>')} ${category.code}` };
  }).sort((left, right) => collator.compare(left.label, right.label));
}

/* 등록 창은 네이티브 모달 dialog라 포털 팝업이 뒤에 깔린다. 검색창과 목록을 창 안에 바로 둔다. */
function TemplateCategoryChooser({ categories, value, onChange, disabled }: { categories: AdminCategoryNode[]; value: string; onChange: (id: string) => void; disabled: boolean }) {
  const options = useMemo(() => categoryTemplateOptions(categories), [categories]);
  return <div className="min-w-0 rounded-lg border">
    <AdminSearchSelectPanel dialogAutoFocus disabled={disabled} emptyMessage="일치하는 카테고리가 없습니다." label="등록할 카테고리" onChoose={onChange} options={options} searchPlaceholder="카테고리 이름이나 코드로 찾기" value={value} />
  </div>;
}

export function CategoryTemplateTree({ categories, value, onChange, disabled }: { categories: AdminCategoryNode[]; value: string; onChange: (id: string) => void; disabled: boolean }) {
  const path = selectedCategoryPath(categories, value);
  return <div className="grid max-w-full grid-cols-[repeat(4,minmax(10.625rem,1fr))] overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50" role="region" aria-label="카테고리 단계 선택 가로 스크롤" tabIndex={0}>
    {[0, 1, 2, 3].map(level => {
      const parent = level === 0 ? null : path[level - 1]?.id;
      const rows = parent === undefined ? [] : categories.filter(row => row.parentId === parent && !row.archivedAt);
      return <ol className="m-0 flex h-[280px] min-w-0 list-none flex-col gap-0.5 overflow-y-auto border-r p-1.5 last:border-r-0" key={level} aria-label={`${level + 1}단계 카테고리`}>{rows.length ? rows.map(row => <li key={row.id}><Button className="h-auto min-h-8 w-full justify-between py-1.5 text-left font-normal whitespace-normal aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground" variant="ghost" type="button" disabled={disabled} aria-pressed={path[level]?.id === row.id} onClick={() => onChange(row.id)}>{row.name}{row.childCount > 0 ? <ChevronRight aria-hidden="true" className="text-muted-foreground" /> : null}</Button></li>) : <li className="px-2 py-1.5 text-xs text-muted-foreground">{level === 0 ? '등록된 카테고리가 없습니다.' : '이전 단계를 선택해주세요.'}</li>}</ol>;
    })}
  </div>;
}

export function CategoryTemplatesScreen({ categories = [], onSelect, selectionHint }: { categories?: AdminCategoryNode[]; onSelect?: (template: CategoryTemplate) => void; selectionHint?: string }) {
  const [data, setData] = useState<CategoryTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]), [categoryId, setCategoryId] = useState('');
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  /* 등록은 화면 머리의 버튼에서 여는 팝업이다(템플릿 화면군 공통 위치). 상태 순서를 바꾸지 않게 마지막에 둔다. */
  const [registering, setRegistering] = useState(false);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0), request = useRef<{ items: CategoryTemplateChange[]; archived: boolean; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true; const sequence = ++readSequence.current;
    void listCategoryTemplatesAction('', false, 1).then(result => {
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) setData(result.value); else { setMessage(result.error); setError(true); }
    }).catch(() => { if (mounted.current && sequence === readSequence.current) { setMessage('자주 쓰는 카테고리를 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); } });
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
    } catch { if (mounted.current && sequence === readSequence.current) { setMessage('자주 쓰는 카테고리를 불러오지 못했습니다. 선택은 유지합니다.'); setError(true); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function save(items: CategoryTemplateChange[], nextArchived: boolean) {
    if (busy.current || conflict) return;
    request.current ??= { items, archived: nextArchived, id: crypto.randomUUID() };
    const fixed = request.current; busy.current = true; readSequence.current++; setPending(true); setMessage('');
    let result: CategoryTemplateResult<CategoryTemplate[]>;
    try { result = await saveCategoryTemplatesAction(fixed.items, fixed.archived, fixed.id); }
    catch { result = { ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }; }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (!result.ok) {
      /* 새 등록(버전 0)의 충돌은 목록이 낡았다는 뜻이 아니라 그 카테고리가 이미 있다는 뜻이다. 화면을 잠그지 않고 이유를 말해 다른 카테고리를 고르게 한다. */
      const alreadyExists = Boolean(result.conflict) && fixed.items.every(item => item.revision === 0);
      setMessage(alreadyExists ? CATEGORY_TEMPLATE_ALREADY_EXISTS : result.error); setError(true); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict) && !alreadyExists); if (!result.uncertain) request.current = null; return;
    }
    request.current = null; setUncertain(false); setSelected([]); setCategoryId(''); setError(false); setRegistering(false);
    // Refresh with the same filters; an emptied last page returns to the preceding page.
    const nextPage = data?.page ?? 1;
    busy.current = true; setPending(true); const sequence = ++readSequence.current;
    try {
      let refreshed = await listCategoryTemplatesAction(search, archived, nextPage);
      if (refreshed.ok && nextPage > Math.max(1, Math.ceil(refreshed.value.total / 20))) refreshed = await listCategoryTemplatesAction(search, archived, Math.max(1, Math.ceil(refreshed.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (refreshed.ok) { setData(refreshed.value); setMessage(categoryTemplateSavedMessage(fixed.items, fixed.archived, result.value.length)); }
      else { setMessage('저장은 완료됐지만 최신 목록을 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); }
    } catch { if (mounted.current) { setMessage('저장은 완료됐지만 최신 목록을 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  const locked = pending || uncertain;
  const selectedRows = data?.rows.filter(row => selected.includes(row.categoryId)) ?? [];
  const searchFields = <>
    <div className={CONSOLE_FILTER_FIELDS_CLASS}>
      <label className={`${CONSOLE_FILTER_LABEL_CLASS} min-w-[min(100%,15rem)] flex-1`}>카테고리 이름·코드<Input type="search" value={query} maxLength={120} disabled={locked} onChange={event => setQuery(event.target.value)} /></label>
      {!onSelect ? <label className={CONSOLE_FILTER_LABEL_CLASS}>보관 상태<AdminSelect value={archived ? 'archived' : 'active'} disabled={locked} onChange={event => void load(1, search, event.target.value === 'archived')} wrapperClassName="w-40"><option value="active">사용 중</option><option value="archived">보관됨</option></AdminSelect></label> : null}
    </div>
    <ConsoleFilterActions>
      <Button variant="ghost" type="button" disabled={locked} onClick={() => { setQuery(''); void load(1, '', false); }}>초기화</Button>
      <Button type={onSelect ? 'button' : 'submit'} disabled={locked} onClick={onSelect ? () => void load(1, query, archived) : undefined} variant="soft">검색</Button>
    </ConsoleFilterActions>
  </>;
  /* 처리 결과·재확인 버튼. 등록 팝업이 열려 있으면 팝업 안에, 아니면 목록 위에 둔다(모달 뒤에 가려지지 않게). */
  const status = <>
    {message ? <p className={`text-sm${error ? ' text-destructive' : ''}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
    {uncertain ? <Button className="self-start" type="button" disabled={pending} onClick={() => void save(request.current?.items ?? [], request.current?.archived ?? false)}>같은 요청 결과 확인</Button> : null}
  </>;
  /* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드([초기화][검색]) → 목록 카드(표·페이지 이동). 선택 팝업은 머리 없이 쓴다. */
  return <section className="flex min-w-0 flex-col gap-4" aria-busy={pending} data-admin-screen="category-templates">
    {onSelect ? <p className="max-w-prose text-sm text-muted-foreground">{selectionHint ?? PICK_DESCRIPTION}</p>
      : <AdminPageHeader title="자주 쓰는 카테고리 관리" description={selectionHint ?? MANAGE_DESCRIPTION}
        actions={<Button type="button" disabled={locked || conflict || !data} onClick={() => { setMessage(''); setError(false); setRegistering(true); }}><Plus aria-hidden="true" />자주 쓰는 카테고리 등록</Button>} />}
    {onSelect ? <div className={CONSOLE_FILTER_CARD_CLASS} role="search" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void load(1, query, archived); } }}>{searchFields}</div>
      : <form className={CONSOLE_FILTER_CARD_CLASS} onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>{searchFields}</form>}
    {!registering ? status : null}
    {conflict ? <Button className="self-start" variant="outline" type="button" disabled={pending} onClick={() => void load(data?.page ?? 1)}>최신 목록 다시 조회</Button> : null}
    {data ? <ConsoleListCard headingLevel={3} title="조회 결과" total={data.total}
      actions={!onSelect ? <Button size="sm" variant="outline" type="button" disabled={locked || conflict || !selectedRows.length} onClick={() => void save(selectedRows.map(row => ({ categoryId: row.categoryId, revision: row.revision })), !archived)}>{archived ? '선택 복구' : '선택 보관'} {selectedRows.length}개</Button> : undefined}>
      <div className={CONSOLE_TABLE_FRAME_CLASS} role="region" aria-label="자주 쓰는 카테고리 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[640px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">자주 쓰는 카테고리 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent">
        {onSelect ? <TableHead className="w-20">선택</TableHead> : <TableHead className="relative w-10 min-w-10 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label="현재 페이지 모두 선택" checked={data.rows.length > 0 && data.rows.every(row => selected.includes(row.categoryId))} disabled={locked || !data.rows.length} onChange={event => setSelected(event.target.checked ? data.rows.map(row => row.categoryId) : [])} /></label></TableHead>}<TableHead>카테고리</TableHead><TableHead>등록일</TableHead>{!onSelect ? <TableHead>상태</TableHead> : null}
      </TableRow></ConsoleTableHeader><TableBody>{data.rows.map(row => <TableRow key={row.categoryId} data-state={selected.includes(row.categoryId) ? 'selected' : undefined}>{onSelect ? <TableCell><Button size="xs" variant="outline" type="button" disabled={locked || !row.usable} onClick={() => onSelect(row)}>선택</Button></TableCell> : <TableCell className="relative w-10 min-w-10 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`${row.path.join(' > ')} 선택`} checked={selected.includes(row.categoryId)} disabled={locked} onChange={event => setSelected(current => event.target.checked ? [...current, row.categoryId] : current.filter(id => id !== row.categoryId))} /></label></TableCell>}<TableCell className="whitespace-normal">{row.path.join(' > ')}{!row.usable ? <AdminStatusBadge className="ml-1.5" tone="warning">사용 불가</AdminStatusBadge> : null}<small className="block text-xs text-muted-foreground">{row.code}{!row.usable ? ' · 보관됐거나 하위 카테고리가 있습니다.' : ''}</small></TableCell><TableCell className="tabular-nums">{kstDateTimeText(row.createdAt).replaceAll('-', '.')}</TableCell>{!onSelect ? <TableCell><AdminStatusBadge tone={statusTone('setting', row.archived ? 'archived' : 'active')}>{row.archived ? '보관됨' : '사용 중'}</AdminStatusBadge></TableCell> : null}</TableRow>)}{!data.rows.length ? <ConsoleTableEmptyRow colSpan={onSelect ? 3 : 4}>{search || archived ? '조건에 맞는 자주 쓰는 카테고리가 없습니다.' : onSelect ? '자주 쓰는 카테고리가 없습니다. 자주 쓰는 카테고리 관리 메뉴에서 등록하면 여기서 바로 고를 수 있습니다.' : '자주 쓰는 카테고리가 없습니다. 오른쪽 위 자주 쓰는 카테고리 등록으로 추가해주세요.'}</ConsoleTableEmptyRow> : null}</TableBody></table></div>
      <ConsolePagination label="자주 쓰는 카테고리 페이지" page={data.page} pageSize={20} total={data.total} disabled={locked} onPageChange={page => void load(page)} />
    </ConsoleListCard> : <p className="text-sm text-muted-foreground" role="status">{message ? '조회 후에 관리할 수 있습니다.' : '자주 쓰는 카테고리를 불러오는 중…'}</p>}
    {!onSelect && registering ? <CustomerServiceDialog title="자주 쓰는 카테고리 등록" wide busy={locked} onClose={() => setRegistering(false)}>
      <div className="flex min-w-0 flex-col gap-3" data-category-templates="register"><TemplateCategoryChooser categories={categories} value={categoryId} onChange={setCategoryId} disabled={locked || conflict} /><p className="text-sm">선택한 카테고리: <strong className="font-medium">{selectedCategoryPath(categories, categoryId).map(row => row.name).join(' > ') || '선택 안 함'}</strong></p>
        <p className="text-sm text-muted-foreground">이미 등록된 분류는 중복 등록하지 않습니다. 보관한 항목은 보관됨 목록에서 복구해주세요.</p>
        {status}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" type="button" disabled={locked} onClick={() => setRegistering(false)}>닫기</Button><Button type="button" disabled={locked || conflict || !data || !usableTemplateCategory(categories, categoryId)} onClick={() => void save([{ categoryId, revision: 0 }], false)}>등록</Button></div></div>
    </CustomerServiceDialog> : null}
  </section>;
}

export function CategoryTemplatePicker({ onSelect, onClose }: { onSelect: (template: CategoryTemplate) => void; onClose: () => void }) {
  // The picker belongs to the product form's React tree, but never its DOM form.
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-admin"><CustomerServiceDialog title="자주 쓰는 카테고리" onClose={onClose} wide><CategoryTemplatesScreen onSelect={onSelect} /></CustomerServiceDialog></div>, document.body);
}

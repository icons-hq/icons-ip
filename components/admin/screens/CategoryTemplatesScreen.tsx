'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listCategoryTemplatesAction, saveCategoryTemplatesAction, type CategoryTemplateResult } from '@/app/admin/category-template-actions';
import { selectedCategoryPath, usableTemplateCategory, type CategoryTemplate, type CategoryTemplateChange, type CategoryTemplatePage } from '@/lib/admin/category-templates';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { CustomerServiceDialog } from './CustomerServiceDialog';

export function CategoryTemplateTree({ categories, value, onChange, disabled }: { categories: AdminCategoryNode[]; value: string; onChange: (id: string) => void; disabled: boolean }) {
  const path = selectedCategoryPath(categories, value);
  return <div className="admin-category-templates__tree" role="region" aria-label="카테고리 단계 선택 가로 스크롤" tabIndex={0}>
    {[0, 1, 2, 3].map(level => {
      const parent = level === 0 ? null : path[level - 1]?.id;
      const rows = parent === undefined ? [] : categories.filter(row => row.parentId === parent && !row.archivedAt);
      return <ol key={level} aria-label={`${level + 1}단계 카테고리`}>{rows.length ? rows.map(row => <li key={row.id}><button type="button" disabled={disabled} aria-pressed={path[level]?.id === row.id} onClick={() => onChange(row.id)}>{row.name}{row.childCount > 0 ? <span aria-hidden="true">›</span> : null}</button></li>) : <li className="admin-category-templates__empty">{level === 0 ? '등록된 카테고리가 없습니다.' : '이전 단계를 선택해주세요.'}</li>}</ol>;
    })}
  </div>;
}

export function CategoryTemplatesScreen({ categories = [], onSelect, selectionHint }: { categories?: AdminCategoryNode[]; onSelect?: (template: CategoryTemplate) => void; selectionHint?: string }) {
  const [data, setData] = useState<CategoryTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]), [categoryId, setCategoryId] = useState('');
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0), request = useRef<{ items: CategoryTemplateChange[]; archived: boolean; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true; const sequence = ++readSequence.current;
    void listCategoryTemplatesAction('', false, 1).then(result => {
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) setData(result.value); else { setMessage(result.error); setError(true); }
    }).catch(() => { if (mounted.current && sequence === readSequence.current) { setMessage('템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); } });
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
    } catch { if (mounted.current && sequence === readSequence.current) { setMessage('템플릿을 불러오지 못했습니다. 선택은 유지합니다.'); setError(true); } }
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
    if (!result.ok) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict)); if (!result.uncertain) request.current = null; return; }
    request.current = null; setUncertain(false); setSelected([]); setCategoryId(''); setError(false);
    // Refresh with the same filters; an emptied last page returns to the preceding page.
    const nextPage = data?.page ?? 1;
    busy.current = true; setPending(true); const sequence = ++readSequence.current;
    try {
      let refreshed = await listCategoryTemplatesAction(search, archived, nextPage);
      if (refreshed.ok && nextPage > Math.max(1, Math.ceil(refreshed.value.total / 20))) refreshed = await listCategoryTemplatesAction(search, archived, Math.max(1, Math.ceil(refreshed.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (refreshed.ok) { setData(refreshed.value); setMessage(`${result.value.length}개 카테고리 템플릿을 ${fixed.archived ? '보관' : '등록·복구'}했습니다.`); }
      else { setMessage('저장은 완료됐지만 최신 목록을 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); }
    } catch { if (mounted.current) { setMessage('저장은 완료됐지만 최신 목록을 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  const locked = pending || uncertain;
  const selectedRows = data?.rows.filter(row => selected.includes(row.categoryId)) ?? [];
  const searchFields = <>
    <label>카테고리 이름·코드<input type="search" value={query} maxLength={120} disabled={locked} onChange={event => setQuery(event.target.value)} /></label>
    {!onSelect ? <label>보관 상태<select value={archived ? 'archived' : 'active'} disabled={locked} onChange={event => void load(1, search, event.target.value === 'archived')}><option value="active">사용 중</option><option value="archived">보관됨</option></select></label> : null}
    <button className="wc-admin-kit__button wc-admin-kit__button--primary" type={onSelect ? 'button' : 'submit'} disabled={locked} onClick={onSelect ? () => void load(1, query, archived) : undefined}>검색</button>
  </>;
  return <section className="wc-admin-kit admin-console admin-category-templates" aria-busy={pending}>
    <p>{selectionHint ?? '자주 쓰는 마지막 단계 카테고리를 저장합니다. 상품에서 불러온 뒤 기본 상품 저장을 누르면 적용됩니다. 템플릿 보관으로 기존 상품 분류가 바뀌지 않습니다.'}</p>
    {onSelect ? <div className="admin-category-templates__search" role="search" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void load(1, query, archived); } }}>{searchFields}</div>
      : <form className="admin-category-templates__search" onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>{searchFields}</form>}
    {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
    {uncertain ? <button className="wc-admin-kit__button wc-admin-kit__button--primary" type="button" disabled={pending} onClick={() => void save(request.current?.items ?? [], request.current?.archived ?? false)}>같은 요청 결과 확인</button> : null}
    {conflict ? <button className="wc-admin-kit__button" type="button" disabled={pending} onClick={() => void load(data?.page ?? 1)}>최신 목록 다시 조회</button> : null}
    {data ? <>
      <div className="admin-category-templates__toolbar"><strong>조회 결과 {data.total.toLocaleString('ko-KR')}건</strong>{!onSelect ? <button type="button" className="wc-admin-kit__button" disabled={locked || conflict || !selectedRows.length} onClick={() => void save(selectedRows.map(row => ({ categoryId: row.categoryId, revision: row.revision })), !archived)}>{archived ? '선택 복구' : '선택 보관'} {selectedRows.length}개</button> : null}</div>
      <div className="admin-category-templates__table" role="region" aria-label="카테고리 템플릿 목록 가로 스크롤" tabIndex={0}><table><caption className="wc-sr-only">카테고리 템플릿 목록</caption><thead><tr>
        <th>{onSelect ? '선택' : <input type="checkbox" aria-label="현재 페이지 모두 선택" checked={data.rows.length > 0 && data.rows.every(row => selected.includes(row.categoryId))} disabled={locked || !data.rows.length} onChange={event => setSelected(event.target.checked ? data.rows.map(row => row.categoryId) : [])} />}</th><th>카테고리</th><th>등록일</th>
      </tr></thead><tbody>{data.rows.map(row => <tr key={row.categoryId}><td>{onSelect ? <button className="wc-admin-kit__button" type="button" disabled={locked || !row.usable} onClick={() => onSelect(row)}>선택</button> : <input type="checkbox" aria-label={`${row.path.join(' > ')} 선택`} checked={selected.includes(row.categoryId)} disabled={locked} onChange={event => setSelected(current => event.target.checked ? [...current, row.categoryId] : current.filter(id => id !== row.categoryId))} />}</td><td>{row.path.join(' > ')}<small>{row.code}{!row.usable ? ' · 사용 불가: 보관됐거나 하위 카테고리가 있습니다.' : ''}</small></td><td>{kstDateTimeText(row.createdAt)}</td></tr>)}{!data.rows.length ? <tr><td colSpan={3}>등록된 카테고리 템플릿이 없습니다.</td></tr> : null}</tbody></table></div>
      <nav className="admin-category-templates__toolbar" aria-label="카테고리 템플릿 페이지"><button className="wc-admin-kit__button" type="button" disabled={locked || data.page <= 1} onClick={() => void load(data.page - 1)}>이전</button><span>{data.page} / {Math.max(1, Math.ceil(data.total / 20))} 페이지</span><button className="wc-admin-kit__button" type="button" disabled={locked || data.page * 20 >= data.total} onClick={() => void load(data.page + 1)}>다음</button></nav>
    </> : <p role="status">{message ? '조회 후에 템플릿을 관리할 수 있습니다.' : '템플릿을 불러오는 중…'}</p>}
    {!onSelect ? <section className="admin-category-templates__register"><h2>카테고리 템플릿 등록</h2><CategoryTemplateTree categories={categories} value={categoryId} onChange={setCategoryId} disabled={locked || conflict} /><p>선택한 카테고리: <strong>{selectedCategoryPath(categories, categoryId).map(row => row.name).join(' > ') || '선택 안 함'}</strong></p><button className="wc-admin-kit__button wc-admin-kit__button--primary" type="button" disabled={locked || conflict || !data || !usableTemplateCategory(categories, categoryId)} onClick={() => void save([{ categoryId, revision: 0 }], false)}>등록</button><p>이미 등록된 분류는 중복 등록하지 않습니다. 보관한 템플릿은 보관됨 목록에서 복구해주세요.</p></section> : null}
  </section>;
}

export function CategoryTemplatePicker({ onSelect, onClose }: { onSelect: (template: CategoryTemplate) => void; onClose: () => void }) {
  // The picker belongs to the product form's React tree, but never its DOM form.
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-root wc-admin"><CustomerServiceDialog title="카테고리 템플릿" onClose={onClose} wide><CategoryTemplatesScreen onSelect={onSelect} /></CustomerServiceDialog></div>, document.body);
}

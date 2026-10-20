'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadCategoryCodesAction } from '@/app/admin/category-code-actions';
import { CATEGORY_EXPORT_API_PATH, type AdminCategoryNode } from '@/lib/admin/category';
import { categoryCodeChoices } from '@/lib/admin/category-code-finder';
import { selectedCategoryPath, usableTemplateCategory } from '@/lib/admin/category-templates';
import { CategoryTemplateTree, CategoryTemplatesScreen } from './screens/CategoryTemplatesScreen';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';

export function CategoryCodeFinder({ onClose }: { onClose: () => void }) {
  const [categories, setCategories] = useState<AdminCategoryNode[] | null>(null);
  const [mode, setMode] = useState<'search' | 'tree' | 'templates'>('search');
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [selectedId, setSelectedId] = useState('');
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const mounted = useRef(true), sequence = useRef(0);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  async function load() {
    const current = ++sequence.current; setPending(true); setMessage('');
    try {
      const result = await loadCategoryCodesAction();
      if (!mounted.current || current !== sequence.current) return;
      if (result.ok) { setCategories(result.categories); setSelectedId(''); setPage(1); setError(false); }
      else { setCategories(null); setMessage(result.error); setError(true); }
    } catch {
      if (mounted.current && current === sequence.current) { setCategories(null); setMessage('카테고리 코드를 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); }
    } finally { if (mounted.current && current === sequence.current) setPending(false); }
  }
  const selected = categories?.find(row => row.id === selectedId);
  const usable = Boolean(categories && usableTemplateCategory(categories, selectedId));
  const choices = useMemo(() => categoryCodeChoices(categories ?? []), [categories]);
  const rows = choices.filter(row => `${row.path} ${row.code}`.toLocaleLowerCase('ko').includes(query.trim().toLocaleLowerCase('ko')));
  const lastPage = Math.max(1, Math.ceil(rows.length / 20));
  function select(id: string) { setSelectedId(id); setMessage(''); setError(false); }
  async function copy() {
    if (!selected || !usable || pending) return;
    try { await navigator.clipboard.writeText(selected.code); if (mounted.current) { setMessage('카테고리 코드를 복사했습니다. 엑셀의 고객 카테고리 코드 또는 추가 카테고리 코드 칸에 붙여넣으세요.'); setError(false); } }
    catch { if (mounted.current) { setMessage('자동 복사를 허용하지 않는 환경입니다. 아래 코드 입력칸을 선택해 복사해주세요.'); setError(true); } }
  }
  return <div className="admin-category-code-finder-shell"><CustomerServiceDialog title="카테고리 찾기" onClose={onClose}>
    <section className="admin-category-templates admin-category-code-finder" aria-busy={pending}>
      <div className="admin-category-templates__toolbar">
        <a className="wc-admin-kit__button" href={CATEGORY_EXPORT_API_PATH}>전체코드 CSV 다운로드</a>
        <button className="wc-admin-kit__button" type="button" disabled={pending} onClick={() => void load()}>최신 카테고리 다시 조회</button>
      </div>
      <p>ICONS 자체 양식에 사용하는 코드입니다. 새로 연결할 수 있는 사용 중 말단만 선택하며, 전체코드 CSV에는 상위·보관 분류와 상태도 포함합니다.</p>
      <div className="admin-category-code-finder__modes" role="group" aria-label="카테고리 찾기 방식">
        {([['search', '카테고리명 검색'], ['tree', '카테고리 선택'], ['templates', '카테고리 템플릿']] as const).map(([value, label]) => <button key={value} type="button" className="wc-admin-kit__button" aria-pressed={mode === value} disabled={pending || !categories} onClick={() => setMode(value)}>{label}</button>)}
      </div>
      {pending ? <p role="status">카테고리 코드를 불러오는 중…</p> : null}
      {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
      {categories && !pending ? <>
        {mode === 'search' ? <>
          <label className="admin-category-code-finder__query">카테고리명·코드<input type="search" maxLength={120} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
          <p>조회 결과 {rows.length.toLocaleString('ko-KR')}건</p>
          <div className="admin-category-templates__table" role="region" aria-label="카테고리 코드 목록 가로 스크롤" tabIndex={0}><table><caption className="wc-sr-only">사용 가능한 카테고리 코드</caption><thead><tr><th>선택</th><th>카테고리</th><th>코드</th></tr></thead><tbody>
            {rows.slice((page - 1) * 20, page * 20).map(row => <tr key={row.id}><td><button type="button" className="wc-admin-kit__button" aria-pressed={selectedId === row.id} onClick={() => select(row.id)}>선택</button></td><td>{row.path}</td><td>{row.code}</td></tr>)}
            {!rows.length ? <tr><td colSpan={3}>선택할 수 있는 카테고리가 없습니다.</td></tr> : null}
          </tbody></table></div>
          <nav className="admin-category-templates__toolbar" aria-label="카테고리 코드 페이지"><button className="wc-admin-kit__button" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button><span>{page} / {lastPage} 페이지</span><button className="wc-admin-kit__button" type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>다음</button></nav>
        </> : mode === 'tree' ? <CategoryTemplateTree categories={categories} value={selectedId} onChange={select} disabled={false} />
          : <CategoryTemplatesScreen selectionHint="템플릿을 선택하면 아래에 카테고리 코드가 표시됩니다. 코드 복사 후 ICONS 상품 엑셀에 붙여넣으세요." onSelect={template => {
            if (!template.usable || !usableTemplateCategory(categories, template.categoryId)) { setMessage('현재 사용할 수 없는 카테고리입니다. 최신 카테고리를 다시 조회해주세요.'); setError(true); return; }
            select(template.categoryId);
          }} />}
        <div className="admin-category-code-finder__selection"><p>선택한 카테고리: <strong>{selectedCategoryPath(categories, selectedId).map(row => row.name).join(' > ') || '선택 안 함'}</strong></p>
          <label>선택한 카테고리 코드<input readOnly value={usable ? selected?.code ?? '' : ''} onFocus={event => event.target.select()} /></label>
          {selected && !usable ? <p>사용 중인 마지막 단계 카테고리까지 선택해주세요.</p> : null}
          <button className="wc-admin-kit__button wc-admin-kit__button--primary" type="button" disabled={!usable} onClick={() => void copy()}>코드 복사</button>
        </div>
      </> : null}
    </section>
  </CustomerServiceDialog></div>;
}

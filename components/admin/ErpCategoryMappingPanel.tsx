'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setErpCategoryMappingAction } from '@/app/admin/erp-item-actions';
import { categoryPath, type AdminCategoryErpMapping, type AdminCategoryNode } from '@/lib/admin/category';
import {
  conflictingCategoryErpMapping,
  suggestErpCategoryTarget,
  type ErpCategoryMappingRow,
  type ErpCategorySuggestion,
} from '@/lib/admin/erp-items';

const VISIBLE_LIMIT = 200;

type CategoryOption = { id: string; label: string };

function suggestionText(basis: ErpCategorySuggestion['basis']) {
  return basis === 'erp_mapping' ? '고객 카테고리의 ERP 분류 매핑대로 연결' : '같은 이름으로 연결';
}

function MappingRow({ row, options, categories, categoryErpMappings }: {
  row: ErpCategoryMappingRow;
  options: CategoryOption[];
  categories: AdminCategoryNode[];
  categoryErpMappings: Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(row.categoryId ?? '');
  const [selected, setSelected] = useState(row.categoryId ?? '');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  /* 새 연결이 없으면 DB가 고객 카테고리의 정본 ERP 분류 매핑으로 제안하는 말단(이름·코드 정확히 일치, 하나뿐). */
  const fallback = !saved && row.fallbackCategoryId ? row.fallbackCategoryId : null;
  const suggestion = useMemo(() => saved || fallback ? null : suggestErpCategoryTarget(row.erpCategory, categories, categoryErpMappings), [saved, fallback, row.erpCategory, categories, categoryErpMappings]);
  const conflict = selected ? conflictingCategoryErpMapping(row.erpCategory, selected, categoryErpMappings) : null;
  const pathOf = (id: string) => categories.some((category) => category.id === id) ? categoryPath(categories, id).join(' > ') : '삭제된 카테고리';
  /* 현재 연결이 보관됐거나 하위가 생긴 분류여도 select가 엉뚱한 값을 보여 주지 않게 따로 표시한다. */
  const stale = saved && !options.some((option) => option.id === saved)
    ? { id: saved, label: `${pathOf(saved)} · 지금은 연결할 수 없음` }
    : null;

  const save = (categoryId: string) => {
    setStatus(null);
    startTransition(async () => {
      const result = await setErpCategoryMappingAction({ erpCategory: row.erpCategory, categoryId: categoryId || null });
      if (!result.ok) { setStatus({ tone: 'error', text: result.error }); return; }
      setSaved(result.categoryId ?? '');
      setSelected(result.categoryId ?? '');
      setStatus({ tone: 'ok', text: result.message });
      if (result.changed) router.refresh();
    });
  };

  return <tr>
    <th scope="row">{row.erpCategory}</th>
    <td className="admin-erp-items__number">{row.itemCount.toLocaleString('ko-KR')}</td>
    <td>
      <select aria-label={`${row.erpCategory} 고객 카테고리`} value={selected} disabled={pending}
        onChange={(event) => setSelected(event.target.value)}>
        <option value="">연결 안 함</option>
        {stale ? <option value={stale.id}>{stale.label}</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {fallback && !selected ? <p className="wc-admin-kit__hint admin-erp-items__mapping-note">
        고객 카테고리의 ERP 분류 매핑에 따라 ‘{pathOf(fallback)}’ 카테고리를 제안합니다. 다른 카테고리를 쓰려면 골라 저장해주세요.
      </p> : null}
      {conflict ? <p className="admin-erp-items__mapping-warning" role="status">
        고른 카테고리는 고객 카테고리 화면에서 다른 ERP 분류(‘{conflict.erpName}’, {conflict.erpCode})에 매핑돼 있습니다. 맞는 카테고리인지 확인해주세요.
      </p> : null}
      {suggestion ? <button className="btn btn-sm btn-ghost admin-erp-items__suggestion" type="button" disabled={pending}
        aria-label={`${row.erpCategory}: ${suggestionText(suggestion.basis)} · ${suggestion.label}`}
        onClick={() => save(suggestion.categoryId)}>
        {suggestionText(suggestion.basis)} · {suggestion.label}
      </button> : null}
    </td>
    <td>
      <div className="admin-erp-items__save">
        <button className="wc-admin-kit__button" type="button" disabled={pending || selected === saved} onClick={() => save(selected)}>
          {pending ? '저장 중' : selected ? '연결 저장' : '연결 해제'}
        </button>
        <span aria-live="polite" className={status?.tone === 'error' ? 'wc-admin-kit__error' : 'wc-admin-kit__hint'}>{status?.text ?? ''}</span>
      </div>
    </td>
  </tr>;
}

/** ERP 분류 ↔ 고객 카테고리 활성 말단 연결 표. 연결해 두면 옵션에서 ERP 품목을 고를 때 카테고리를 제안한다. */
export function ErpCategoryMappingPanel({ rows, categories, categoryErpMappings }: {
  rows: ErpCategoryMappingRow[];
  categories: AdminCategoryNode[];
  categoryErpMappings: Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>[];
}) {
  const [query, setQuery] = useState('');
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const options = useMemo<CategoryOption[]>(() => categories
    .filter((category) => !category.archivedAt && category.childCount === 0)
    .map((category) => ({ id: category.id, label: categoryPath(categories, category.id).join(' > ') }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ko')), [categories]);
  const needle = query.trim().toLowerCase();
  const isLinked = (row: ErpCategoryMappingRow) => Boolean(row.categoryId || row.fallbackCategoryId);
  const filtered = rows.filter((row) => (!needle || row.erpCategory.toLowerCase().includes(needle)) && (!unlinkedOnly || !isLinked(row)));
  const linked = rows.filter(isLinked).length;

  if (!rows.length) {
    return <p className="wc-admin-kit__hint">반입한 품목에 ERP 분류가 없습니다. 반입할 때 ERP 분류 열을 골라주세요.</p>;
  }
  return <div className="admin-erp-items__mapping">
    <p className="wc-admin-kit__hint">ERP 분류 {rows.length.toLocaleString('ko-KR')}개 중 {linked.toLocaleString('ko-KR')}개 연결됨. 연결은 상품에 바로 적용되지 않고, 옵션에서 ERP 품목을 고를 때 카테고리 제안으로만 쓰입니다.</p>
    <p className="wc-admin-kit__hint">여기서 연결하지 않은 분류는 고객 카테고리 화면의 ERP 분류 매핑에서 이름이나 코드가 똑같은 말단이 하나뿐이면 그 말단을 제안합니다. 여기서 연결하면 이 연결이 먼저입니다.</p>
    {!options.length ? <p className="wc-admin-kit__error" role="alert">연결할 고객 카테고리 말단이 없습니다. 고객 카테고리 화면에서 먼저 만들어주세요.</p> : null}
    <div className="admin-erp-items__mapping-filters">
      <label htmlFor="erp-category-filter">ERP 분류 찾기</label>
      <input id="erp-category-filter" type="search" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
      <label className="admin-erp-items__check"><input type="checkbox" checked={unlinkedOnly} onChange={(event) => setUnlinkedOnly(event.target.checked)} /> 연결 안 된 분류만</label>
    </div>
    <div className="admin-erp-items__table-scroll" role="region" aria-label="ERP 분류 연결" tabIndex={0}>
      <table className="admin-erp-items__table">
        <caption>ERP 분류별 고객 카테고리{filtered.length > VISIBLE_LIMIT ? ` · 앞 ${VISIBLE_LIMIT}개만 표시, 검색으로 좁혀주세요` : ''}</caption>
        <thead><tr><th scope="col">ERP 분류</th><th scope="col">품목 수</th><th scope="col">고객 카테고리</th><th scope="col">저장</th></tr></thead>
        <tbody>
          {filtered.slice(0, VISIBLE_LIMIT).map((row) => <MappingRow key={row.erpCategory} row={row} options={options} categories={categories} categoryErpMappings={categoryErpMappings} />)}
          {!filtered.length ? <tr><td colSpan={4}>조건에 맞는 ERP 분류가 없습니다.</td></tr> : null}
        </tbody>
      </table>
    </div>
  </div>;
}

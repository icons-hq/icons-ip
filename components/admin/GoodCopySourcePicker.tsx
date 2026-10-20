/* eslint-disable @next/next/no-img-element -- Uses the catalog's existing public media URLs. */
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { searchGoodsOptionImportAction } from '@/app/admin/goods-option-import-actions';
import type { GoodsOptionImportFilters, GoodsOptionImportPage } from '@/lib/admin/goods-option-import';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import '@/app/styles/admin-good-copy-picker.css';

const initial: GoodsOptionImportFilters = { query: '', field: 'name', categoryId: '', page: 1 };

export function GoodCopySourcePicker({ accountId, disabledReason = '' }: { accountId: string; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  return <section className="admin-good-copy-picker__entry" aria-label="기존 상품으로 복사등록">
    <div><strong>기존 상품으로 복사등록</strong><p>최근 등록 상품이나 검색한 상품의 복사 설정을 열어 새 초안을 만듭니다. 재고는 0으로 시작하며 KC를 다시 검토합니다.</p>{disabledReason ? <p role="status">{disabledReason}</p> : null}</div>
    <button type="button" className="wc-admin-kit__button" disabled={Boolean(disabledReason)} onClick={() => setOpen(true)}>복사할 상품 선택</button>
    {open ? <GoodCopySourceDialog accountId={accountId} blocked={Boolean(disabledReason)} onClose={() => setOpen(false)} /> : null}
  </section>;
}

export function GoodCopySourceDialog({ accountId, blocked, onClose }: { accountId: string; blocked: boolean; onClose: () => void }) {
  const [filters, setFilters] = useState(initial), [applied, setApplied] = useState(initial);
  const [data, setData] = useState<GoodsOptionImportPage | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [authChanged, setAuthChanged] = useState(false);
  const sequence = useRef(0), mounted = useRef(false), lane = useRef(false);
  useEffect(() => {
    mounted.current = true; const version = ++sequence.current;
    searchGoodsOptionImportAction(initial).then(result => {
      if (!mounted.current || sequence.current !== version) return;
      if (!result.ok) setError(result.error);
      else if (result.accountId !== accountId) { setAuthChanged(true); setError('로그인 계정이 바뀌었습니다. 현재 계정으로 상품 등록을 다시 열어주세요.'); }
      else setData(result.data);
    }).catch(() => { if (mounted.current && sequence.current === version) setError('최근 상품을 불러오지 못했습니다. 다시 검색해주세요.'); })
      .finally(() => { if (mounted.current && sequence.current === version) setBusy(false); });
    return () => { mounted.current = false; };
  }, [accountId]);
  async function search(next: GoodsOptionImportFilters) {
    if (lane.current || busy || blocked || authChanged) return;
    lane.current = true; setBusy(true); setError(''); const version = ++sequence.current;
    try {
      const result = await searchGoodsOptionImportAction(next);
      if (!mounted.current || sequence.current !== version) return;
      if (!result.ok) setError(result.error);
      else if (result.accountId !== accountId) { setAuthChanged(true); setError('로그인 계정이 바뀌었습니다. 현재 계정으로 상품 등록을 다시 열어주세요.'); }
      else { setData(result.data); setApplied({ ...next, page: result.data.page }); }
    } catch { if (mounted.current && sequence.current === version) setError('상품을 불러오지 못했습니다. 현재 목록은 유지됩니다.'); }
    finally { lane.current = false; if (mounted.current && sequence.current === version) setBusy(false); }
  }
  const locked = busy || blocked || authChanged, pages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));
  return <CustomerServiceDialog title="복사할 상품 선택" onClose={onClose} wide>
    <div className="admin-good-copy-picker">
      <p>보관하지 않은 상품을 등록일 최신순으로 20개씩 조회합니다. 선택하면 해당 상품의 복사 설정으로 이동하며, ‘새 초안으로 복사’를 눌러야 새 상품이 생성됩니다.</p>
      <form className="admin-good-copy-picker__search" onSubmit={e => { e.preventDefault(); void search({ ...filters, page: 1 }); }}>
        <label htmlFor="good-copy-field">검색 항목<select id="good-copy-field" value={filters.field} disabled={locked} onChange={e => setFilters({ ...filters, field: e.target.value as typeof filters.field })}><option value="name">상품명</option><option value="code">판매자상품코드·옵션코드</option><option value="id">상품번호</option></select></label>
        <label htmlFor="good-copy-query">검색어<input id="good-copy-query" type="search" maxLength={100} value={filters.query} disabled={locked} onChange={e => setFilters({ ...filters, query: e.target.value })} /></label>
        <button type="submit" className="wc-admin-kit__button" disabled={locked}>상품 검색</button>
      </form>
      <p>조회 {data?.total.toLocaleString('ko-KR') ?? '—'}개 · 등록일 최신순</p>
      <ul className="admin-good-copy-picker__list">{data?.rows.map(good => <li key={good.id}>
        {good.imageUrl ? <img src={good.imageUrl} width={48} height={48} alt="" /> : <span className="admin-good-copy-picker__image" aria-hidden="true" />}
        <div><strong>{good.name}</strong><small>{good.code} · {good.id}</small><small>{good.categoryName ?? '미분류'} · {good.published ? '공개' : '초안'}</small></div>
        {locked ? <span>{busy ? '조회 중' : '선택 불가'}</span> : <Link className="wc-admin-kit__button" prefetch={false} href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.id)}#good-operation-clone`} onClick={onClose} aria-label={`${good.name} 복사 설정 열기`}>복사 설정</Link>}
      </li>)}</ul>
      {!busy && data?.total === 0 ? <p>조건에 맞는 상품이 없습니다.</p> : null}
      {error ? <p role="alert">{error}</p> : null}{busy ? <p role="status">상품을 불러오고 있습니다.</p> : null}
      <nav className="admin-good-copy-picker__pages" aria-label="복사 상품 페이지"><button type="button" className="wc-admin-kit__button" disabled={locked || !data || data.page <= 1} onClick={() => void search({ ...applied, page: (data?.page ?? 1) - 1 })}>이전</button><span>{data?.page ?? 1} / {pages}</span><button type="button" className="wc-admin-kit__button" disabled={locked || !data || data.page >= pages} onClick={() => void search({ ...applied, page: (data?.page ?? 1) + 1 })}>다음</button></nav>
    </div>
  </CustomerServiceDialog>;
}

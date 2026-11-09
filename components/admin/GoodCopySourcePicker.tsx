/* eslint-disable @next/next/no-img-element -- Uses the catalog's existing public media URLs. */
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Copy, Search } from 'lucide-react';
import { searchGoodsOptionImportAction } from '@/app/admin/goods-option-import-actions';
import type { GoodsOptionImportFilters, GoodsOptionImportPage } from '@/lib/admin/goods-option-import';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

const initial: GoodsOptionImportFilters = { query: '', field: 'name', categoryId: '', page: 1 };
const LABEL_CLASS = 'text-sm leading-snug font-medium text-foreground';

export function GoodCopySourcePicker({ accountId, disabledReason = '' }: { accountId: string; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  /* 첫 화면을 필수 입력에 돌리려고 카드 대신 머리 줄의 버튼 하나로 둔다. 재고 0·KC 재검토 안내는 복사 팝업이 보여 준다. */
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm" aria-label="기존 상품으로 복사등록" data-good-copy-entry="" role="group">
    <Button type="button" variant="outline" size="sm" disabled={Boolean(disabledReason)} onClick={() => setOpen(true)}><Copy aria-hidden="true" />기존 상품으로 복사등록</Button>
    {disabledReason ? <p className="text-xs text-muted-foreground" role="status">{disabledReason}</p> : null}
    {open ? <GoodCopySourceDialog accountId={accountId} blocked={Boolean(disabledReason)} onClose={() => setOpen(false)} /> : null}
  </div>;
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
  const locked = busy || blocked || authChanged;
  return <CustomerServiceDialog title="복사할 상품 선택" onClose={onClose} wide>
    <div className="flex min-w-0 flex-col gap-4 text-sm" data-good-copy-picker="">
      <p className="text-muted-foreground">보관하지 않은 상품을 등록일 최신순으로 20개씩 조회합니다. 선택하면 해당 상품의 복사 설정으로 이동하며, ‘새 초안으로 복사’를 눌러야 새 상품이 생성됩니다. 재고는 0으로 시작하며 KC를 다시 검토합니다.</p>
      <form className="grid min-w-0 items-end gap-3 sm:grid-cols-[13rem_minmax(0,1fr)_auto]" onSubmit={e => { e.preventDefault(); void search({ ...filters, page: 1 }); }}>
        <div className="flex min-w-0 flex-col gap-2"><label className={LABEL_CLASS} htmlFor="good-copy-field">검색 항목</label><NativeSelect className="w-full" id="good-copy-field" value={filters.field} disabled={locked} onChange={e => setFilters({ ...filters, field: e.target.value as typeof filters.field })}><option value="name">상품명</option><option value="code">판매자상품코드·옵션코드</option><option value="id">상품번호</option></NativeSelect></div>
        <div className="flex min-w-0 flex-col gap-2"><label className={LABEL_CLASS} htmlFor="good-copy-query">검색어</label><input className={GOOD_INPUT_CLASS} data-slot="input" id="good-copy-query" type="search" maxLength={100} value={filters.query} disabled={locked} onChange={e => setFilters({ ...filters, query: e.target.value })} /></div>
        <Button type="submit" disabled={locked}><Search aria-hidden="true" />상품 검색</Button>
      </form>
      <p className="text-muted-foreground tabular-nums">조회 {data?.total.toLocaleString('ko-KR') ?? '—'}개 · 등록일 최신순</p>
      <ul className="m-0 flex max-h-[440px] min-w-0 list-none flex-col overflow-auto rounded-lg border p-0 empty:hidden">{data?.rows.map(good => <li className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-b p-3 last:border-b-0" key={good.id}>
        {good.imageUrl ? <img className="size-12 rounded-md bg-muted object-contain" src={good.imageUrl} width={48} height={48} alt="" /> : <span className="size-12 rounded-md bg-muted" aria-hidden="true" />}
        <div className="flex min-w-0 flex-col gap-0.5 wrap-anywhere"><strong className="font-medium">{good.name}</strong><small className="text-xs text-muted-foreground">{good.code} · {good.id}</small><small className="text-xs text-muted-foreground">{good.categoryName ?? '미분류'} · {good.published ? '공개' : '초안'}</small></div>
        {locked ? <span className="text-xs text-muted-foreground">{busy ? '조회 중' : '선택 불가'}</span> : <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" prefetch={false} href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.id)}#good-operation-clone`} onClick={onClose} aria-label={`${good.name} 복사 설정 열기`}>복사 설정</Link>}
      </li>)}</ul>
      {!busy && data?.total === 0 ? <p className="py-6 text-center text-muted-foreground">조건에 맞는 상품이 없습니다.</p> : null}
      {error ? <p className="text-destructive" role="alert">{error}</p> : null}{busy ? <p className="text-muted-foreground" role="status">상품을 불러오고 있습니다.</p> : null}
      <ConsolePagination label="복사 상품 페이지" page={data?.page ?? 1} pageSize={20} total={data?.total ?? 0} unit="개" disabled={locked || !data} onPageChange={page => void search({ ...applied, page })} />
    </div>
  </CustomerServiceDialog>;
}

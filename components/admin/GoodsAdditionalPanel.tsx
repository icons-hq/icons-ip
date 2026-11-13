'use client';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { readGoodsAdditionalAction, saveGoodsAdditionalAction, searchGoodsAdditionalAction } from '@/app/admin/goods-additional-actions';
import { MAX_ADDITIONAL_GOODS, type AdminAdditionalGood, type AdminAdditionalGoods } from '@/lib/admin/goods-additional';
import { Button } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

function AdditionalEditor({ goodId, configuration, onSaved }: {
  goodId: string; configuration: AdminAdditionalGoods; onSaved: (message: string) => void;
}) {
  const [items, setItems] = useState(configuration.items);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminAdditionalGood[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    startTransition(async () => {
      const result = await searchGoodsAdditionalAction(goodId, query);
      if (result.ok) setResults(result.items); else setError(result.error);
    });
  }
  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveGoodsAdditionalAction(goodId, items.map((item) => item.goodId), configuration.revision);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= items.length) return;
    setItems((current) => { const next = [...current]; [next[index], next[destination]] = [next[destination], next[index]]; return next; });
  }
  return <div className="flex min-w-0 flex-col gap-4">
    <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={search}>
      <label className="flex min-w-0 flex-[1_1_12.5rem] flex-col gap-1.5 text-sm font-medium text-foreground">추가할 상품 검색
        <input className={GOOD_INPUT_CLASS} data-slot="input" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} required disabled={pending} placeholder="상품명 또는 판매자상품코드" />
      </label>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? '처리 중…' : '검색'}</Button>
    </form>
    {results && <div className="flex min-w-0 flex-col gap-2">
      {results.length === 0 ? <p className="text-sm text-muted-foreground">일치하는 판매 중 상품이 없습니다.</p> : results.map((item) => <div key={item.goodId} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <span className="min-w-0 wrap-anywhere">{item.name} <small className="text-xs text-muted-foreground">{item.goodId}</small></span>
        <Button size="sm" type="button" variant="outline" disabled={pending || items.length >= MAX_ADDITIONAL_GOODS || items.some((selected) => selected.goodId === item.goodId)}
          onClick={() => setItems((current) => [...current, item])}>{items.some((selected) => selected.goodId === item.goodId) ? '선택됨' : '추가'}</Button>
      </div>)}
      {results.length === MAX_ADDITIONAL_GOODS && <small className="text-xs text-muted-foreground">검색 결과 50개까지 표시합니다. 검색어를 더 구체적으로 입력해주세요.</small>}
    </div>}
    <div className="flex min-w-0 flex-col gap-2">
      <strong className="font-medium tabular-nums">연결 순서 · {items.length}/{MAX_ADDITIONAL_GOODS}</strong>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{adminGoodsCopy("연결된 추가상품이 없습니다.")}</p> : <ol className="flex list-decimal flex-col gap-3 pl-6">
        {items.map((item, index) => <li key={item.goodId}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 wrap-anywhere"><span>{item.name}</span><small className={`block text-xs ${item.available ? 'text-muted-foreground' : 'text-[var(--wc-warning)]'}`}>{item.goodId}{item.available ? '' : ' · 현재 공개 구매 불가'}</small></div>
            <div className="flex gap-1">
              <Button size="sm" type="button" variant="outline" aria-label={`${item.name} 위로 이동`} disabled={pending || index === 0} onClick={() => move(index, -1)}>위로</Button>
              <Button size="sm" type="button" variant="outline" aria-label={`${item.name} 아래로 이동`} disabled={pending || index === items.length - 1} onClick={() => move(index, 1)}>아래로</Button>
              <Button size="sm" type="button" variant="ghost" aria-label={`${item.name} 연결 해제`} disabled={pending} onClick={() => setItems((current) => current.filter((entry) => entry.goodId !== item.goodId))}>해제</Button>
            </div>
          </div>
        </li>)}
      </ol>}
    </div>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Button className="self-start" type="button" onClick={save} disabled={pending}>{pending ? '처리 중…' : adminGoodsCopy('추가상품 설정 저장')}</Button>
  </div>;
}

/** Mount outside the main goods editor form. */
export function GoodsAdditionalPanel({ goodId }: { goodId: string }) {
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<{ goodId: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<{ goodId: string; configuration?: AdminAdditionalGoods; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void readGoodsAdditionalAction(goodId).then((result) => {
      if (!canceled) setLoaded(result.ok ? { goodId, configuration: result.configuration } : { goodId, error: result.error });
    }).catch(() => { if (!canceled) setLoaded({ goodId, error: adminGoodsCopy('추가상품 설정을 불러오지 못했습니다.') }); });
    return () => { canceled = true; };
  }, [goodId, refresh]);
  const visible = loaded?.goodId === goodId ? loaded : null;
  const reload = () => { setLoaded(null); setRefresh((value) => value + 1); };
  return <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-4 text-sm" aria-labelledby={`additional-goods-${goodId}`} data-good-additional="">
    <div className="flex flex-col gap-1"><h2 id={`additional-goods-${goodId}`} className="text-base leading-snug font-medium">{adminGoodsCopy("추가상품")}</h2>
      <p className="text-sm text-muted-foreground">{adminGoodsCopy("상세 화면에서 함께 고를 상품을 연결합니다. 각 상품은 자체 옵션 가격과 수량으로 구매하며, 품절·판매 중지 상품은 구매 화면에 표시하지 않습니다. 연결된 상품의 추가상품까지 펼치지는 않습니다.")}</p>
    </div>
    {notice?.goodId === goodId && <p className="text-sm text-[var(--wc-success)]" role="status">{notice.message}</p>}
    {!visible ? <p className="text-sm text-muted-foreground" role="status">{adminGoodsCopy("추가상품 설정을 불러오는 중입니다…")}</p> : visible.error ? <p className="text-sm text-destructive" role="alert">{visible.error}</p>
      : visible.configuration ? <AdditionalEditor key={`${goodId}:${refresh}`} goodId={goodId} configuration={visible.configuration}
        onSaved={(message) => { setNotice({ goodId, message }); reload(); }} /> : null}
    <Button className="self-start" type="button" variant="outline" onClick={reload}>{adminGoodsCopy("저장된 추가상품 새로고침")}</Button>
  </section>;
}

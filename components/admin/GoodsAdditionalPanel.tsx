'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { readGoodsAdditionalAction, saveGoodsAdditionalAction, searchGoodsAdditionalAction } from '@/app/admin/goods-additional-actions';
import { MAX_ADDITIONAL_GOODS, type AdminAdditionalGood, type AdminAdditionalGoods } from '@/lib/admin/goods-additional';

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
  return <div className="col" style={{ gap: 14 }}>
    <form className="row" onSubmit={search} style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ flex: '1 1 200px' }}>추가할 상품 검색
        <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} required disabled={pending} placeholder="상품명 또는 상품코드" />
      </label>
      <button type="submit" className="btn btn-ghost" disabled={pending}>{pending ? '처리 중…' : '검색'}</button>
    </form>
    {results && <div className="col" style={{ gap: 8 }}>
      {results.length === 0 ? <p className="muted">일치하는 판매 중 상품이 없습니다.</p> : results.map((item) => <div key={item.goodId} className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
        <span>{item.name} <small className="muted">{item.goodId}</small></span>
        <button className="btn btn-ghost" type="button" disabled={pending || items.length >= MAX_ADDITIONAL_GOODS || items.some((selected) => selected.goodId === item.goodId)}
          onClick={() => setItems((current) => [...current, item])}>{items.some((selected) => selected.goodId === item.goodId) ? '선택됨' : '추가'}</button>
      </div>)}
      {results.length === MAX_ADDITIONAL_GOODS && <small className="muted">검색 결과 50개까지 표시합니다. 검색어를 더 구체적으로 입력해주세요.</small>}
    </div>}
    <div>
      <strong>연결 순서 · {items.length}/{MAX_ADDITIONAL_GOODS}</strong>
      {items.length === 0 ? <p className="muted">연결된 추가상품이 없습니다.</p> : <ol style={{ paddingLeft: 24, display: 'grid', gap: 12 }}>
        {items.map((item, index) => <li key={item.goodId}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div><span>{item.name}</span><small className="muted" style={{ display: 'block' }}>{item.goodId}{item.available ? '' : ' · 현재 공개 구매 불가'}</small></div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn btn-ghost" type="button" aria-label={`${item.name} 위로 이동`} disabled={pending || index === 0} onClick={() => move(index, -1)}>위로</button>
              <button className="btn btn-ghost" type="button" aria-label={`${item.name} 아래로 이동`} disabled={pending || index === items.length - 1} onClick={() => move(index, 1)}>아래로</button>
              <button className="btn btn-ghost" type="button" aria-label={`${item.name} 연결 해제`} disabled={pending} onClick={() => setItems((current) => current.filter((entry) => entry.goodId !== item.goodId))}>해제</button>
            </div>
          </div>
        </li>)}
      </ol>}
    </div>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="btn" onClick={save} disabled={pending}>{pending ? '처리 중…' : '추가상품 설정 저장'}</button>
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
    }).catch(() => { if (!canceled) setLoaded({ goodId, error: '추가상품 설정을 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [goodId, refresh]);
  const visible = loaded?.goodId === goodId ? loaded : null;
  const reload = () => { setLoaded(null); setRefresh((value) => value + 1); };
  return <section className="card col wc-admin-kit" aria-labelledby={`additional-goods-${goodId}`} style={{ borderRadius: 10, gap: 16, padding: 18 }}>
    <div><h2 id={`additional-goods-${goodId}`} style={{ fontSize: 18, margin: 0 }}>추가상품</h2>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>상세 화면에서 함께 고를 상품을 연결합니다. 각 상품은 자체 옵션 가격과 수량으로 구매하며, 품절·판매 중지 상품은 구매 화면에 표시하지 않습니다.
        연결된 상품의 추가상품까지 펼치지는 않습니다.</p>
    </div>
    {notice?.goodId === goodId && <p role="status">{notice.message}</p>}
    {!visible ? <p role="status">추가상품 설정을 불러오는 중입니다…</p> : visible.error ? <p role="alert">{visible.error}</p>
      : visible.configuration ? <AdditionalEditor key={`${goodId}:${refresh}`} goodId={goodId} configuration={visible.configuration}
        onSaved={(message) => { setNotice({ goodId, message }); reload(); }} /> : null}
    <button type="button" className="btn btn-ghost" onClick={reload}>저장된 추가상품 새로고침</button>
  </section>;
}

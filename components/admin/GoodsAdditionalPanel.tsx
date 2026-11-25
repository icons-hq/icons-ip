'use client';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { useEffect, useState, useTransition } from 'react';
import { readGoodsAdditionalAction, saveGoodsAdditionalAction } from '@/app/admin/goods-additional-actions';
import type { AdminAdditionalGoods } from '@/lib/admin/goods-additional';
import { Button } from '@/components/admin/kit/ui/button';
import { GOODS_ADDITIONAL_INTRO, GoodsAdditionalLinks } from './GoodsAdditionalLinks';

/** 저장된 연결을 고치고 이 영역에서 따로 저장한다(기본 상품 저장과 별개). */
export function AdditionalEditor({ goodId, configuration, onSaved }: {
  goodId: string; configuration: AdminAdditionalGoods; onSaved: (message: string) => void;
}) {
  const [items, setItems] = useState(configuration.items);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveGoodsAdditionalAction(goodId, items.map((item) => item.goodId), configuration.revision);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  return <div className="flex min-w-0 flex-col gap-4">
    <GoodsAdditionalLinks baseGoodId={goodId} items={items} onChange={setItems} disabled={pending} />
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
    {/* 제목은 섹션 머리(이어서 설정)가 이미 말한다 — 다른 저장 패널과 같이 화면에는 두지 않는다. */}
    <h2 id={`additional-goods-${goodId}`} className="sr-only">{adminGoodsCopy("추가상품")}</h2>
    <p className="text-sm text-muted-foreground">{GOODS_ADDITIONAL_INTRO}</p>
    {notice?.goodId === goodId && <p className="text-sm text-[var(--wc-success)]" role="status">{notice.message}</p>}
    {!visible ? <p className="text-sm text-muted-foreground" role="status">{adminGoodsCopy("추가상품 설정을 불러오는 중입니다…")}</p> : visible.error ? <p className="text-sm text-destructive" role="alert">{visible.error}</p>
      : visible.configuration ? <AdditionalEditor key={`${goodId}:${refresh}`} goodId={goodId} configuration={visible.configuration}
        onSaved={(message) => { setNotice({ goodId, message }); reload(); }} /> : null}
    <Button className="self-start" type="button" variant="outline" onClick={reload}>{adminGoodsCopy("저장된 추가상품 새로고침")}</Button>
  </section>;
}

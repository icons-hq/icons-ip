'use client';
import Link from 'next/link';
import { useState } from 'react';
import { publicMediaUrl } from '@/lib/media';
import type { Good } from '@/lib/data';
import type { GoodsRelationVisual } from '@/lib/good-relation-visual';
import { goodsSaleUnavailableLabel } from '@/lib/goods-sale-period';
import { RelationImageMap } from './RelationImageMap';

export function GoodRelationVisual({ value, goods, currentGoodId, kind }: { value: GoodsRelationVisual; goods: Good[]; currentGoodId?: string; kind: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = goods.find(good => good.id === selectedId), imageUrl = publicMediaUrl(value.imagePath);
  const points = value.hotspots.flatMap(point => { const good = goods.find(item => item.id === point.goodId); return good ? [{ ...point, name: good.name }] : []; });
  if (!imageUrl) return null;
  return <div className="wc-good-relation-visual" data-kind={kind}>
    <div className="wc-good-relation-visual__image"><RelationImageMap key={value.imagePath} src={imageUrl} alt={value.alt} points={points} selectedId={selectedId} onSelect={id => setSelectedId(id === selectedId ? null : id)} /></div>
    <div className="wc-good-relation-visual__info">{value.description ? <p className="wc-good-relation-visual__description">{value.description}</p> : null}
      {points.length ? <><p className="wc-good-relation-visual__hint">이미지의 번호를 눌러 굿즈를 살펴보세요.</p><div className="wc-good-relation-visual__tags" aria-label="이미지에 연결된 굿즈">{points.map((point, index) => <button type="button" key={point.goodId} aria-pressed={selectedId === point.goodId} onClick={() => setSelectedId(point.goodId)}>{index + 1}. {point.name}</button>)}</div></> : null}
      {selected ? <section className="wc-good-relation-visual__selection" aria-label="선택한 이미지 굿즈" aria-live="polite">
        <strong>{selected.name}</strong><span>{selected.price.toLocaleString('ko-KR')}원{selected.priceMax && selected.priceMax > selected.price ? '~' : ''}{goodsSaleUnavailableLabel(selected.salePeriod) ? ` · ${goodsSaleUnavailableLabel(selected.salePeriod)}` : selected.stock === 'soldout' ? ' · 품절' : ''}</span>
        {selected.id === currentGoodId ? <small>현재 보고 있는 굿즈입니다.</small> : <Link href={`/shop/${selected.id}`}>굿즈 자세히 보기 →</Link>}
        <button type="button" aria-label="선택한 이미지 굿즈 닫기" onClick={() => setSelectedId(null)}>닫기</button>
      </section> : null}
    </div>
  </div>;
}

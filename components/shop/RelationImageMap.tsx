/* eslint-disable @next/next/no-img-element -- Image coordinates use the verified uncropped source. */
'use client';
import { useRef, useState, type KeyboardEvent, type CSSProperties } from 'react';
import { relationCoordinate, relationPointerCoordinate, type GoodsRelationHotspot } from '@/lib/good-relation-visual';

export function RelationImageMap({ src, alt, points, selectedId, onSelect, onMove, disabled = false }: {
  src: string; alt: string; points: (GoodsRelationHotspot & { name: string })[]; selectedId?: string | null;
  onSelect: (id: string) => void; onMove?: (id: string, x: number, y: number) => void; disabled?: boolean;
}) {
  const bounds = useRef<HTMLDivElement>(null), drag = useRef<{ id: string; pointerId: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const selected = points.find(point => point.goodId === selectedId);
  function place(id: string, clientX: number, clientY: number) {
    const rect = bounds.current?.getBoundingClientRect();
    if (!rect || !onMove || disabled) return;
    onMove(id, relationPointerCoordinate(clientX, rect.left, rect.width), relationPointerCoordinate(clientY, rect.top, rect.height));
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, point: GoodsRelationHotspot | undefined) {
    if (!point || !onMove || disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const step = event.shiftKey ? 1000 : 100;
    onMove(point.goodId, relationCoordinate(point.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)),
      relationCoordinate(point.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)));
  }
  if (failed) return <p className="relation-image-map__error" role="status">이미지를 불러오지 못했습니다. 연결된 굿즈는 아래 목록에서 확인할 수 있습니다.</p>;
  const picture = <img src={src} alt={alt} draggable={false} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return <div className="relation-image-map" ref={bounds} data-editable={Boolean(onMove)}>
    {onMove ? <button className="relation-image-map__surface" type="button" disabled={disabled || !selected} aria-label="선택한 굿즈 태그의 이미지 위치 지정"
      onClick={event => { if (selected && event.detail) place(selected.goodId, event.clientX, event.clientY); }} onKeyDown={event => keyboard(event, selected)}>{picture}</button> : picture}
    {points.map((point, index) => <button key={point.goodId} type="button" className="relation-image-map__point" disabled={disabled}
      aria-label={`${index + 1}. ${point.name} 굿즈 태그${onMove ? `, 가로 ${point.x / 100}%, 세로 ${point.y / 100}%` : ''}`}
      aria-pressed={selectedId === point.goodId} style={{ '--relation-x': `${point.x / 100}%`, '--relation-y': `${point.y / 100}%` } as CSSProperties}
      onClick={() => onSelect(point.goodId)} onFocus={() => { if (onMove) onSelect(point.goodId); }} onKeyDown={event => keyboard(event, point)}
      onPointerDown={event => { if (!onMove || disabled) return; drag.current = { id: point.goodId, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); onSelect(point.goodId); }}
      onPointerMove={event => { if (drag.current?.id === point.goodId && drag.current.pointerId === event.pointerId) place(point.goodId, event.clientX, event.clientY); }}
      onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={() => { drag.current = null; }}><span aria-hidden="true">{index + 1}</span></button>)}
  </div>;
}

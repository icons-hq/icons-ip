'use client';
import { useState, type ChangeEvent } from 'react';
import { ADMIN_ARTWORK_ACCEPT, normalizeAdminArtworkMetadata } from '@/lib/admin/artwork';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { publicMediaUrl } from '@/lib/media';
import { relationCoordinate, type GoodsRelationVisual } from '@/lib/good-relation-visual';
import type { GoodsRelationGood, GoodsRelationKind } from '@/lib/admin/goods-relations';
import { RelationImageMap } from '@/components/shop/RelationImageMap';

export function GoodsRelationVisualEditor({ value, goods, kind, disabled, onChange, onBusyChange }: {
  value: GoodsRelationVisual; goods: GoodsRelationGood[]; kind: GoodsRelationKind; disabled: boolean;
  onChange: (value: GoodsRelationVisual) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const imageUrl = value.imagePath ? publicMediaUrl(value.imagePath) : null;
  const points = value.hotspots.flatMap(point => { const good = goods.find(item => item.id === point.goodId); return good ? [{ ...point, name: good.name }] : []; });
  function move(id: string, x: number, y: number) { onChange({ ...value, hotspots: value.hotspots.map(point => point.goodId === id ? { ...point, x, y } : point) }); }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || disabled || uploading) return;
    const valid = normalizeAdminArtworkMetadata({ kind: 'curation', mimeType: file.type, size: file.size });
    if (!valid.ok) { setError(valid.error); return; }
    setUploading(true); onBusyChange(true); setError('');
    try {
      const result = await uploadAdminArtwork({ kind: 'curation', file });
      if (!result.ok) { setError(result.error); return; }
      onChange({ ...value, imagePath: result.imagePath, hotspots: [] }); setSelectedId(null);
    } catch { setError('이미지를 업로드하지 못했습니다. 기존 이미지와 좌표를 유지했습니다. 다시 시도해주세요.'); }
    finally { setUploading(false); onBusyChange(false); }
  }
  return <div className="admin-relation-visual-editor">
    <label className="admin-relation-upload">{kind === 'codi' ? '코디 이미지' : '함께 구매 이미지'}<input type="file" accept={ADMIN_ARTWORK_ACCEPT} disabled={disabled || uploading} onChange={upload} /></label>
    <p>{kind === 'codi' ? '세로 이미지 750×1000px' : '정사각 이미지 750×750px'}를 권장합니다. 원본 비율 그대로 표시합니다. JPEG·PNG·WebP, 최대 5MB·8192px입니다. 새 이미지로 바꾸면 기존 상품 태그 위치가 초기화됩니다.</p>
    {uploading ? <p role="status">이미지를 업로드하고 확인하고 있습니다.</p> : null}{error ? <p role="alert">{error}</p> : null}
    <label>이미지 대체 설명<input value={value.alt} maxLength={120} required disabled={disabled} onChange={event => onChange({ ...value, alt: event.target.value })} placeholder="이미지의 구성을 설명해주세요" /></label>
    <label>편성 설명<textarea value={value.description} maxLength={90} rows={3} disabled={disabled} onChange={event => onChange({ ...value, description: event.target.value })} placeholder="함께 연출한 상품을 소개해주세요" /><small>{[...value.description].length} / 90자</small></label>
    {imageUrl ? <div className="admin-relation-visual-editor__workspace"><div className="admin-relation-visual-editor__image" data-kind={kind}>
      <RelationImageMap key={value.imagePath} src={imageUrl} alt={value.alt || '편성 이미지'} points={points} selectedId={selectedId} onSelect={setSelectedId} onMove={move} disabled={disabled} />
    </div><div className="admin-relation-visual-editor__points"><h3>이미지 상품 태그</h3><p>상품의 태그 추가를 누른 뒤 이미지 위치를 클릭하거나 터치하세요. 태그를 끌거나 방향키로 1%, Shift+방향키로 10%씩 옮길 수 있습니다. 수치 입력으로도 조정할 수 있습니다.</p>
      {!goods.length ? <p>먼저 구성 상품을 선택해주세요.</p> : goods.map((good, index) => {
        const point = value.hotspots.find(item => item.goodId === good.id);
        return <section className="admin-relation-point-row" key={good.id} data-selected={selectedId === good.id} aria-label={`${good.name} 태그 설정`}>
          <strong>{index + 1}. {good.name}</strong>
          {point ? <><div className="admin-relation-point-row__coordinates"><label>가로 (%)<input type="number" min={0} max={100} step={0.01} value={point.x / 100} disabled={disabled} onChange={event => move(good.id, relationCoordinate(Number(event.target.value) * 100), point.y)} /></label><label>세로 (%)<input type="number" min={0} max={100} step={0.01} value={point.y / 100} disabled={disabled} onChange={event => move(good.id, point.x, relationCoordinate(Number(event.target.value) * 100))} /></label></div>
            <div className="admin-relation-row-actions"><button type="button" disabled={disabled} onClick={() => setSelectedId(good.id)}>{selectedId === good.id ? '위치 지정 중' : '위치 지정'}</button><button type="button" disabled={disabled} onClick={() => { onChange({ ...value, hotspots: value.hotspots.filter(item => item.goodId !== good.id) }); if (selectedId === good.id) setSelectedId(null); }}>태그 제거</button></div></>
            : <button type="button" disabled={disabled} onClick={() => { onChange({ ...value, hotspots: [...value.hotspots, { goodId: good.id, x: 5000, y: 5000 }] }); setSelectedId(good.id); }}>태그 추가</button>}
        </section>;
      })}<p>태그는 상품마다 1개입니다. 태그가 없는 상품도 아래 상품 목록에 표시됩니다. 비공개 상품의 태그는 공개 화면에서 제외됩니다.</p></div></div> : <p className="admin-relation-visual-editor__empty">이미지를 업로드하면 상품 태그를 배치할 수 있습니다.</p>}
  </div>;
}

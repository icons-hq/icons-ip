'use client';
import { useState, type ChangeEvent } from 'react';
import { ADMIN_ARTWORK_ACCEPT, normalizeAdminArtworkMetadata } from '@/lib/admin/artwork';
import { adminConfirm } from '@/lib/admin/confirm';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { publicMediaUrl } from '@/lib/media';
import { relationCoordinate, type GoodsRelationVisual } from '@/lib/good-relation-visual';
import { relationLossText, type GoodsRelationGood, type GoodsRelationKind } from '@/lib/admin/goods-relations';
import { RelationImageMap } from '@/components/shop/RelationImageMap';
import { Button } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { Textarea } from './kit/ui/textarea';

const NOTE = 'text-sm text-muted-foreground';

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
    /* 새 이미지에는 예전 태그 위치가 맞지 않아 태그를 모두 지운다. 다시 붙여야 하니 올리기 전에 묻는다(화면 규칙 7). */
    const lost = relationLossText({ tags: value.hotspots.length });
    if (lost && !await adminConfirm({ title: '이미지를 바꿀까요?', message: `${lost} 새 이미지에 태그를 다시 붙여야 합니다.`, confirmLabel: '바꾸기' })) return;
    setUploading(true); onBusyChange(true); setError('');
    try {
      const result = await uploadAdminArtwork({ kind: 'curation', file });
      if (!result.ok) { setError(result.error); return; }
      onChange({ ...value, imagePath: result.imagePath, hotspots: [] }); setSelectedId(null);
    } catch { setError('이미지를 올리지 못했습니다. 원래 이미지와 태그 위치는 그대로입니다. 다시 올려 주세요.'); }
    finally { setUploading(false); onBusyChange(false); }
  }
  return <div className="flex min-w-0 flex-col gap-3.5" data-relation-visual-editor="">
    <label className="flex flex-col gap-2 text-sm font-medium">{kind === 'codi' ? '코디 이미지 (필수)' : '이미지 (필수)'}<Input className="sm:max-w-md" type="file" accept={ADMIN_ARTWORK_ACCEPT} disabled={disabled || uploading} onChange={upload} /></label>
    <p className={NOTE}>{kind === 'codi' ? '권장 750×1000px(세로)' : '권장 750×750px(정사각)'}. JPEG·PNG·WebP, 5MB·한 변 8192px까지 올릴 수 있습니다.</p>
    {uploading ? <p className={NOTE} role="status">이미지를 올리고 있습니다.</p> : null}{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <label className="flex flex-col gap-2 text-sm font-medium">이미지 설명 (필수)<Input className="sm:max-w-xl" value={value.alt} maxLength={120} required disabled={disabled} onChange={event => onChange({ ...value, alt: event.target.value })} placeholder="이미지를 볼 수 없는 고객에게 읽어 줄 설명" /></label>
    <label className="flex flex-col gap-2 text-sm font-medium">소개 글<Textarea className="max-w-2xl resize-y" value={value.description} maxLength={90} rows={3} disabled={disabled} onChange={event => onChange({ ...value, description: event.target.value })} placeholder="이미지 아래에 보이는 글" /><small className="text-xs font-normal text-muted-foreground tabular-nums">{[...value.description].length} / 90자</small></label>
    {imageUrl ? <div className="grid items-start gap-5 min-[1051px]:grid-cols-[minmax(0,1.3fr)_minmax(15rem,1fr)]"><div className="mx-auto w-full max-w-[640px] data-[kind=codi]:max-w-[420px]" data-kind={kind}>
      <RelationImageMap key={value.imagePath} src={imageUrl} alt={value.alt || '연관상품 이미지'} points={points} selectedId={selectedId} onSelect={setSelectedId} onMove={move} disabled={disabled} />
    </div><div className="flex min-w-0 flex-col gap-3"><h3 className="text-base font-medium">상품 태그</h3>
      {/* 조작법은 처음 한 번만 읽으면 돼서 접어 둔다('글보다 화면' — 늘 보이는 글을 줄인다). */}
      <details className="text-sm text-muted-foreground"><summary className="w-fit cursor-pointer">태그 붙이는 방법</summary><p className="mt-1.5">[태그 추가]를 누른 뒤 이미지에서 붙일 자리를 누릅니다. 태그는 끌어서 옮기거나 방향키로 1%, Shift+방향키로 10%씩 옮깁니다. 가로·세로 칸에 숫자를 적어도 됩니다. 태그는 상품마다 하나이고, 태그가 없는 상품도 이미지 아래 상품 목록에는 나옵니다. 공개하지 않은 상품의 태그는 고객 화면에 나오지 않습니다.</p></details>
      {!goods.length ? <p className={NOTE}>먼저 상품을 담아 주세요.</p> : goods.map((good, index) => {
        const point = value.hotspots.find(item => item.goodId === good.id);
        return <section className="flex flex-col gap-2.5 rounded-lg border bg-card p-3 data-[selected=true]:border-primary data-[selected=true]:bg-primary-soft" key={good.id} data-selected={selectedId === good.id} aria-label={`${good.name} 태그 설정`}>
          <strong className="text-sm font-medium">{index + 1}. {good.name}</strong>
          {point ? <><div className="grid grid-cols-2 gap-3"><label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">가로 (%)<Input className="text-right tabular-nums" type="number" min={0} max={100} step={0.01} value={point.x / 100} disabled={disabled} onChange={event => move(good.id, relationCoordinate(Number(event.target.value) * 100), point.y)} /></label><label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">세로 (%)<Input className="text-right tabular-nums" type="number" min={0} max={100} step={0.01} value={point.y / 100} disabled={disabled} onChange={event => move(good.id, point.x, relationCoordinate(Number(event.target.value) * 100))} /></label></div>
            <div className="flex flex-wrap gap-1.5"><Button size="sm" variant="outline" type="button" disabled={disabled} onClick={() => setSelectedId(good.id)}>{selectedId === good.id ? '위치 지정 중' : '위치 지정'}</Button><Button size="sm" variant="outline" type="button" disabled={disabled} onClick={() => { onChange({ ...value, hotspots: value.hotspots.filter(item => item.goodId !== good.id) }); if (selectedId === good.id) setSelectedId(null); }}>태그 지우기</Button></div></>
            : <Button className="self-start" size="sm" variant="outline" type="button" disabled={disabled} onClick={() => { onChange({ ...value, hotspots: [...value.hotspots, { goodId: good.id, x: 5000, y: 5000 }] }); setSelectedId(good.id); }}>태그 추가</Button>}
        </section>;
      })}</div></div> : <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">이미지를 올리면 상품 태그를 붙일 수 있습니다.</p>}
  </div>;
}

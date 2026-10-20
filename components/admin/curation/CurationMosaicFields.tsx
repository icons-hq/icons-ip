'use client';
import { useEffect, useRef, useState } from 'react';
import { ArtworkUploadField } from '@/components/admin/ArtworkUploadField';
import { ErrorText } from '@/components/admin/fields';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import type { HomeGoodsCard } from '@/lib/home-catalog';
import { HOME_MOSAIC_IMAGE_MAX_BYTES, type HomeMosaicSlot } from '@/lib/home-mosaic';
import { CurationProductPicker } from './CurationProductPicker';

export function CurationMosaicFields({ title, subtitle, slots, imageUrls, options, goods, error, onTitle, onSubtitle, onSlots, onImages }: {
  title: string; subtitle: string; slots: HomeMosaicSlot[]; imageUrls: (string | null)[];
  options: AdminCurationTargetRecord[]; goods: HomeGoodsCard[]; error?: string;
  onTitle: (value: string) => void; onSubtitle: (value: string) => void;
  onSlots: (value: HomeMosaicSlot[]) => void; onImages: (value: (string | null)[]) => void;
}) {
  const [picker, setPicker] = useState<number | null>(null);
  const [keys, setKeys] = useState(() => slots.map((_, index) => index));
  const current = useRef({ slots, imageUrls, keys });
  useEffect(() => { current.current = { slots, imageUrls, keys }; }, [slots, imageUrls, keys]);
  const names = new Map(options.map(option => [option.id, option.title]));
  const visibleIds = new Set(goods.map(good => good.id));
  function patch(key: number, value: Partial<HomeMosaicSlot>) {
    const index = current.current.keys.indexOf(key);
    onSlots(current.current.slots.map((slot, position) => position === index ? { ...slot, ...value } : slot));
  }
  function image(key: number, url: string | null) {
    const index = current.current.keys.indexOf(key);
    onImages(current.current.imageUrls.map((value, position) => position === index ? url : value));
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= slots.length) return;
    const nextSlots = [...slots]; const nextImages = [...imageUrls]; const nextKeys = [...keys];
    [nextSlots[index], nextSlots[target]] = [nextSlots[target], nextSlots[index]];
    [nextImages[index], nextImages[target]] = [nextImages[target], nextImages[index]];
    [nextKeys[index], nextKeys[target]] = [nextKeys[target], nextKeys[index]];
    onSlots(nextSlots); onImages(nextImages); setKeys(nextKeys);
  }
  return <section className="admin-store-editor__form-section admin-store-mosaic">
    <h4>모자이크 제목과 상품</h4>
    <label>모자이크 제목<input value={title} onChange={event => onTitle(event.target.value)} /><small>{[...title].length} / 10자</small></label>
    <label>모자이크 부제목<input value={subtitle} onChange={event => onSubtitle(event.target.value)} /><small>{[...subtitle].length} / 20자</small></label>
    <input name="mosaic" type="hidden" value={JSON.stringify({ mosaic_title: title.trim(), mosaic_subtitle: subtitle.trim(), slots })} />
    <p>8개 위치에 상품과 대표이미지를 등록합니다. 1·6번은 크게 표시하며 모바일에서는 가로로 넘겨 봅니다. 구성은 최대 5개까지 등록할 수 있습니다.</p>
    <p>상품 또는 이미지가 없거나 상품이 비노출이면 해당 위치를 비워 둡니다. 표시할 상품이 하나도 없으면 전체 영역을 숨깁니다.</p>
    <ErrorText>{error}</ErrorText>
    <ol>{slots.map((slot, index) => <li key={keys[index]}>
      <header><strong>{index + 1}번 상품{index === 0 || index === 5 ? ' · 큰 이미지' : ''}</strong><span>
        <button type="button" aria-label={`${index + 1}번 상품 앞으로`} disabled={index === 0} onClick={() => move(index, -1)}>앞으로</button>
        <button type="button" aria-label={`${index + 1}번 상품 뒤로`} disabled={index === 7} onClick={() => move(index, 1)}>뒤로</button>
      </span></header>
      <p>{slot.good_id ? names.get(slot.good_id) ?? '현재 상품을 찾을 수 없습니다.' : '선택한 상품이 없습니다.'}</p>
      {slot.good_id && !visibleIds.has(slot.good_id) ? <p className="muted">비노출 또는 없는 상품입니다. 공개 모자이크에는 표시되지 않습니다.</p> : null}
      <div className="wc-admin-kit__actions"><button type="button" onClick={() => setPicker(index)}>{slot.good_id ? '상품 변경' : '상품 선택'}</button>
        <button type="button" disabled={!slot.good_id} onClick={() => patch(keys[index], { good_id: null })}>상품 해제</button></div>
      <ArtworkUploadField allowRemove currentPath={slot.image_path} currentUrl={imageUrls[index]} fieldId={`mosaic-image-${keys[index]}`}
        kind="curation" label={`${index + 1}번 대표이미지`} name={`mosaic-image-${keys[index]}`}
        maxFileSizeBytes={HOME_MOSAIC_IMAGE_MAX_BYTES} showGuidance={false} showCropGuide={false} showPath={false}
        helpText="620 × 620px 권장 · JPEG, PNG, WebP · 원본과 저장 이미지 각각 최대 900KB · 애니메이션 제외"
        onPathChange={path => patch(keys[index], { image_path: path || null })}
        onPreviewChange={url => image(keys[index], url)} />
    </li>)}</ol>
    {picker !== null ? <CurationProductPicker options={options} goods={goods} limit={1} selectedIds={slots[picker].good_id ? [slots[picker].good_id!] : []}
      onClose={() => setPicker(null)} onApply={ids => { patch(keys[picker], { good_id: ids[0] ?? null }); setPicker(null); }} /> : null}
  </section>;
}

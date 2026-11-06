'use client';
import { useEffect, useRef, useState } from 'react';
import { loadGoodsListingColorsAction, saveGoodsListingColorsAction, type GoodsListingColorsResult } from '@/app/admin/store-presentation-actions';
import { parseGoodsColorChips, type GoodsColorChip } from '@/lib/store-presentation';
import { buttonVariants } from './kit/ui/button';
import { Input } from './kit/ui/input';
export function GoodsListingColorsPanel({ goodId }: { goodId: string }) {
  const [colors, setColors] = useState<GoodsColorChip[]>([]), [revision, setRevision] = useState<number | null>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const request = useRef<{ colors: GoodsColorChip[]; revision: number; id: string } | null>(null);
  useEffect(() => { let disposed = false; void loadGoodsListingColorsAction(goodId).then(result => {
    if (disposed) return;
    if ('error' in result) { setError(true); setMessage(result.error); }
    else { setColors(result.colors); setRevision(result.revision); }
  }).catch(() => { if (!disposed) { setError(true); setMessage('저장된 색상칩을 불러오지 못했습니다. 다시 조회해주세요.'); } }); return () => { disposed = true; }; }, [goodId]);
  async function save() {
    if (pending || revision === null) return;
    const parsed = parseGoodsColorChips(colors.map(chip => ({ label: chip.label.trim(), hex: chip.hex.toLowerCase() })));
    if (!parsed) { setError(true); setMessage('서로 다른 색상 이름(1~30자)과 6자리 색상값을 최대 20개까지 입력해주세요.'); return; }
    request.current ??= { colors: parsed, revision, id: crypto.randomUUID() }; setPending(true);
    let result: GoodsListingColorsResult;
    try { result = await saveGoodsListingColorsAction(goodId, request.current.colors, request.current.revision, request.current.id); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    setPending(false);
    if ('error' in result) { setError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; }
    else { setColors(result.colors); setRevision(result.revision); setError(false); setMessage('목록 색상칩을 저장했습니다.'); setUncertain(false); request.current = null; }
  }
  /* 버튼은 네이티브 button에 kit 버튼 모양을 입힌다 — 화면 전송 실패 재시도 테스트(PresentationTransportFailure)가
     전시 설정 화면들과 함께 네이티브 버튼을 찾는다. 모양·동작은 kit Button과 같다. */
  return <div className="flex min-w-0 flex-col gap-3" data-goods-listing-colors="">
    <p className="text-sm text-muted-foreground">실제 상품에 제공하는 색만 등록하세요. 표시 여부는 스토어 전시 설정에서 정하며, 옵션·재고는 바뀌지 않습니다.</p>
    <fieldset className="flex min-w-0 flex-col gap-3" disabled={pending || uncertain || revision === null}><legend className="sr-only">상품 색상칩</legend>
      {colors.map((chip, index) => <div key={index} className="flex flex-wrap items-end gap-3"><label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">색상 이름 {index + 1}<Input className="w-48" value={chip.label} maxLength={30} onChange={event => setColors(current => current.map((value, i) => i === index ? { ...value, label: event.target.value } : value))} /></label><label className="flex flex-col gap-1.5 text-sm font-medium">색상값 {index + 1}<input className="h-8 w-16 cursor-pointer rounded-lg border border-input bg-transparent p-1 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" data-slot="input" type="color" value={chip.hex} onChange={event => setColors(current => current.map((value, i) => i === index ? { ...value, hex: event.target.value } : value))} /></label><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setColors(current => current.filter((_, i) => i !== index))}>삭제</button></div>)}
      <button className={`${buttonVariants({ size: 'sm', variant: 'outline' })} self-start`} data-slot="button" type="button" disabled={colors.length >= 20} onClick={() => setColors(current => [...current, { label: '', hex: '#000000' }])}>색상 추가 ({colors.length}/20)</button>
    </fieldset>
    {message ? <p className={`text-sm${error ? ' text-destructive' : ' text-[var(--wc-success)]'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}<button className={`${buttonVariants()} self-start`} data-slot="button" type="button" disabled={pending || revision === null} onClick={() => void save()}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '색상칩 저장'}</button>
  </div>;
}

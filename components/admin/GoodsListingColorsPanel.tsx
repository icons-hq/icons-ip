'use client';
import { useEffect, useRef, useState } from 'react';
import { loadGoodsListingColorsAction, saveGoodsListingColorsAction, type GoodsListingColorsResult } from '@/app/admin/store-presentation-actions';
import { STORE_PRESENTATION_PATH, parseGoodsColorChips, type GoodsColorChip } from '@/lib/store-presentation';
import { buttonVariants } from './kit/ui/button';
import { Input } from './kit/ui/input';
const COLOR_INPUT_CLASS = 'h-8 w-16 cursor-pointer rounded-lg border border-input bg-transparent p-1 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0';
/**
 * 목록 색상칩 입력(저장된 상품 패널과 등록 화면의 '상품과 함께 저장'이 같이 쓴다 — T15b). 저장은 부르는 쪽이 한다.
 * 이름을 적은 색은 고객 상품 카드의 색 점(components/wc/ProductCard)과 같은 모양으로 바로 보인다. 고객 목록에는 전시 설정의
 * '컬러칩 표시'(기본 꺼짐, lib/store-presentation)를 켠 경우에만 보인다 — 이 입력 부품은 그 설정을 읽지 못해 이동 링크와 한 줄만 둔다.
 */
export function GoodsListingColorFields({ colors, onChange }: { colors: GoodsColorChip[]; onChange: (update: (current: GoodsColorChip[]) => GoodsColorChip[]) => void }) {
  const named = colors.filter(chip => chip.label.trim());
  return <>
    {colors.map((chip, index) => <div key={index} className="flex flex-wrap items-end gap-3"><label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">색 이름<span className="sr-only"> {index + 1}</span><Input className="w-48" value={chip.label} maxLength={30} placeholder="예: 블랙" onChange={event => { const label = event.target.value; onChange(current => current.map((value, i) => i === index ? { ...value, label } : value)); }} /></label><label className="flex flex-col gap-1.5 text-sm font-medium">색<span className="sr-only"> {index + 1}</span><input className={COLOR_INPUT_CLASS} data-slot="input" type="color" value={chip.hex} onChange={event => { const hex = event.target.value; onChange(current => current.map((value, i) => i === index ? { ...value, hex } : value)); }} /></label><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" aria-label={`색 ${index + 1} 삭제`} onClick={() => onChange(current => current.filter((_, i) => i !== index))}>삭제</button></div>)}
    <button className={`${buttonVariants({ size: 'sm', variant: 'outline' })} self-start`} data-slot="button" type="button" disabled={colors.length >= 20} onClick={() => onChange(current => [...current, { label: '', hex: '#000000' }])}>색상 추가 ({colors.length}/20)</button>
    {named.length ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/40 px-3 py-2" data-good-listing-color-preview="">
      <span className="text-xs text-muted-foreground">상품 카드 모습</span>
      <ul aria-label="상품 색상" className="m-0 flex list-none flex-wrap gap-1.5 p-0">{named.map((chip, index) => <li key={`${chip.label}:${index}`} title={chip.label}><span aria-hidden="true" className="block size-3.5 rounded-full border border-input" style={{ backgroundColor: chip.hex }} /><span className="sr-only">{chip.label}</span></li>)}</ul>
    </div> : null}
    <p className="text-xs text-muted-foreground" data-good-listing-color-display="">고객 목록에는 전시 설정에서 &lsquo;컬러칩 표시&rsquo;를 켜야 보입니다. <a className="underline underline-offset-4" href={STORE_PRESENTATION_PATH} target="_blank" rel="noreferrer">전시 설정 열기 ↗</a></p>
  </>;
}
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
    if (!parsed) { setError(true); setMessage('색 이름은 서로 다르게 1~30자로 적고, 색은 최대 20개까지 등록해주세요.'); return; }
    request.current ??= { colors: parsed, revision, id: crypto.randomUUID() }; setPending(true);
    let result: GoodsListingColorsResult;
    try { result = await saveGoodsListingColorsAction(goodId, request.current.colors, request.current.revision, request.current.id); }
    catch { result = { error: '저장됐는지 확인하지 못했습니다. 입력을 바꾸지 말고 \'같은 요청 결과 확인\'을 눌러주세요. 같은 요청은 두 번 저장되지 않습니다.', uncertain: true }; }
    setPending(false);
    if ('error' in result) { setError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; }
    else { setColors(result.colors); setRevision(result.revision); setError(false); setMessage('목록 색상칩을 저장했습니다.'); setUncertain(false); request.current = null; }
  }
  /* 버튼은 네이티브 button에 kit 버튼 모양을 입힌다 — 화면 전송 실패 재시도 테스트(PresentationTransportFailure)가
     전시 설정 화면들과 함께 네이티브 버튼을 찾는다. 모양·동작은 kit Button과 같다. */
  return <div className="flex min-w-0 flex-col gap-3" data-goods-listing-colors="">
    <fieldset className="flex min-w-0 flex-col gap-3" disabled={pending || uncertain || revision === null}><legend className="sr-only">상품 색상칩</legend>
      <GoodsListingColorFields colors={colors} onChange={setColors} />
    </fieldset>
    {message ? <p className={`text-sm${error ? ' text-destructive' : ' text-[var(--wc-success)]'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}<button className={`${buttonVariants()} self-start`} data-slot="button" type="button" disabled={pending || revision === null} onClick={() => void save()}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '색상칩 저장'}</button>
  </div>;
}

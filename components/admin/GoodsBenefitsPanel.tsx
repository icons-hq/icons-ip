'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadGoodsBenefitsAction, saveGoodsBenefitsAction, type GoodsBenefitsResult } from '@/app/admin/goods-benefit-actions';
import { GOODS_EVENT_TEMPLATES_PATH, parseGoodsBenefitValues, type GoodsBenefitSnapshot, type GoodsBenefitValues } from '@/lib/goods-benefits';
import { publicMediaUrl } from '@/lib/media';
import { ArtworkUploadField } from './ArtworkUploadField';
import { GoodsPhotoPicker } from './screens/GoodsPhotoLibraryScreen';
import { GoodsEventTemplatePicker } from './screens/GoodsEventTemplatesScreen';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 글자 수 칸은 라벨 안 입력 아래 오른쪽에 둔다(입력과 같은 라벨에 묶인다). */
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';
const COUNT_CLASS = 'self-end text-xs text-muted-foreground tabular-nums';

/** 사은품 사진 칸 하나를 바꾼 값(빈 칸은 ''로 둔다 — 저장 전에 걸러낸다). */
export function withGiftImage(values: GoodsBenefitValues, index: number, path: string | null): GoodsBenefitValues {
  const paths = [...values.giftImagePaths]; paths[index] = path ?? ''; return { ...values, giftImagePaths: paths };
}

/**
 * 사은품·이벤트 입력(저장된 상품 패널과 등록 화면의 '상품과 함께 저장'이 같이 쓴다 — T15b). 사진 보관함·템플릿 대화상자와 저장은 부르는 쪽이 둔다.
 * `fieldPrefix`는 한 화면에 두 벌이 그려질 때 업로드 칸 id가 겹치지 않게 한다.
 */
export function GoodsBenefitFields({ values, onChange, onPickPhoto, onOpenTemplates, fieldPrefix = 'goods-benefit-image' }: {
  values: GoodsBenefitValues; onChange: (update: (current: GoodsBenefitValues) => GoodsBenefitValues) => void;
  onPickPhoto: (index: number) => void; onOpenTemplates: () => void; fieldPrefix?: string;
}) {
  return <>
    <label className={FIELD_CLASS}><span className="font-medium">사은품</span><input className={GOOD_INPUT_CLASS} data-slot="input" value={values.giftText} maxLength={100} onChange={event => { const giftText = event.target.value; onChange(current => ({ ...current, giftText })); }} /><small className={COUNT_CLASS}>{Array.from(values.giftText).length}/100</small></label>
    <div className="grid min-w-0 gap-4 md:grid-cols-3" role="group" aria-label="사은품 이미지">
      {[0, 1, 2].map(index => <div className="flex min-w-0 flex-col gap-2" key={`${index}:${values.giftImagePaths[index] ?? ''}`}>
        <ArtworkUploadField kind="good" name={`giftImage${index}`} fieldId={`${fieldPrefix}-${index}`} label={`사은품 이미지 ${index + 1}`} currentPath={values.giftImagePaths[index] || null} currentUrl={values.giftImagePaths[index] ? publicMediaUrl(values.giftImagePaths[index]) : null} onPathChange={path => onChange(current => withGiftImage(current, index, path))} autoUpload allowRemove compact showCropGuide={false} showPath={false} showGuidance={index === 0} />
        <button type="button" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} self-start whitespace-normal`} data-slot="button" onClick={() => onPickPhoto(index)}>사진 보관함에서 선택</button>
      </div>)}
    </div>
    <p className="text-muted-foreground">500×500 이미지를 권장합니다. 최대 3장까지 등록하며 이미지가 있으면 사은품 설명도 입력합니다.</p>
    <label className={FIELD_CLASS}><span className="font-medium">이벤트 문구</span><input className={GOOD_INPUT_CLASS} data-slot="input" value={values.eventText} maxLength={40} onChange={event => { const eventText = event.target.value; onChange(current => ({ ...current, eventText })); }} /><small className={COUNT_CLASS}>{Array.from(values.eventText).length}/40</small></label>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={onOpenTemplates}>이벤트 템플릿</button><Link className="text-sm underline underline-offset-4" href={GOODS_EVENT_TEMPLATES_PATH} target="_blank" rel="noreferrer">이벤트 템플릿 관리 ↗</Link></div>
    <p className="text-muted-foreground">이벤트 문구는 상품 검색에 포함하지 않습니다. 상품에 실제 적용되는 혜택만 안내해주세요.</p>
  </>;
}

export function GoodsBenefitsPanel({ goodId }: { goodId: string }) {
  const [snapshot, setSnapshot] = useState<GoodsBenefitSnapshot | null>(null), [values, setValues] = useState<GoodsBenefitValues>({ eventText: '', giftText: '', giftImagePaths: [] });
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false), [conflict, setConflict] = useState(false);
  const [picker, setPicker] = useState<number | null>(null), [templates, setTemplates] = useState(false);
  const busy = useRef(false), mounted = useRef(true), request = useRef<{ values: GoodsBenefitValues; revision: number; id: string } | null>(null);
  const readSequence = useRef(0);
  const accept = (value: GoodsBenefitSnapshot) => { setSnapshot(value); setValues(value); setConflict(false); setUncertain(false); request.current = null; };
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void loadGoodsBenefitsAction(goodId).then(result => { if (!active || sequence !== readSequence.current) return; if (result.ok) accept(result.value); else { setError(true); setMessage(result.error); } })
      .catch(() => { if (active && sequence === readSequence.current) { setError(true); setMessage('상품 안내를 불러오지 못했습니다. 다시 조회해주세요.'); } });
    return () => { active = false; mounted.current = false; };
  }, [goodId]);
  async function reload() {
    if (busy.current || uncertain) return;
    const sequence = ++readSequence.current;
    busy.current = true; setPending(true);
    try {
      const result = await loadGoodsBenefitsAction(goodId); if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { accept(result.value); setError(false); setMessage('저장된 내용으로 다시 불러왔습니다.'); }
      else { setError(true); setMessage(result.error); }
    } catch { if (mounted.current && sequence === readSequence.current) { setError(true); setMessage('상품 안내를 불러오지 못했습니다. 입력은 유지합니다.'); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function save() {
    if (busy.current || !snapshot || conflict) return;
    const parsed = parseGoodsBenefitValues({ ...values, giftImagePaths: values.giftImagePaths.filter(Boolean) });
    if (!parsed) { setError(true); setMessage('사은품 사진에는 설명이 필요합니다. 설명 100자·이벤트 40자와 서로 다른 사진 3장까지 확인해주세요.'); return; }
    request.current ??= { values: parsed, revision: snapshot.revision, id: crypto.randomUUID() };
    ++readSequence.current;
    busy.current = true; setPending(true); setMessage('');
    const fixed = request.current;
    let result: GoodsBenefitsResult<GoodsBenefitSnapshot>;
    try { result = await saveGoodsBenefitsAction(goodId, fixed.values, fixed.revision, fixed.id); }
    catch { result = { ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }; }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (result.ok) { accept(result.value); setError(false); setMessage('사은품 안내와 이벤트 문구를 저장했습니다.'); }
    else { setError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; if (result.conflict) setConflict(true); }
  }
  const setImage = (index: number, path: string | null) => setValues(current => withGiftImage(current, index, path));
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-goods-benefits="">
    <p className="text-muted-foreground">상품 상세에 표시할 안내입니다. 실제 사은품 제공 조건을 설명에 적고 재고·출고는 별도로 준비해주세요.</p>
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={!snapshot || pending || uncertain || conflict}>
        <GoodsBenefitFields values={values} onChange={setValues} onPickPhoto={setPicker} onOpenTemplates={() => setTemplates(true)} />
      </fieldset>
      {message ? <p className={error ? 'text-sm text-destructive' : 'text-sm text-[var(--wc-success)]'} role={error ? 'alert' : 'status'}>{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {uncertain ? <button className={buttonVariants()} data-slot="button" type="button" disabled={pending} onClick={() => void save()}>같은 요청 결과 확인</button> : <button className={buttonVariants()} data-slot="button" disabled={!snapshot || pending || conflict}>안내 저장</button>}
        <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={pending || uncertain} onClick={() => void reload()}>저장된 내용으로 다시 불러오기</button>
      </div>
    </form>
    {picker !== null ? <GoodsPhotoPicker onClose={() => setPicker(null)} onSelect={photo => { setImage(picker, photo.imagePath); setPicker(null); }} /> : null}
    {templates ? <GoodsEventTemplatePicker onClose={() => setTemplates(false)} onSelect={template => { setValues(current => ({ ...current, eventText: template.eventText })); setTemplates(false); }} /> : null}
  </div>;
}

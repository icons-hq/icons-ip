'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadGoodsBenefitsAction, saveGoodsBenefitsAction, type GoodsBenefitsResult } from '@/app/admin/goods-benefit-actions';
import { GOODS_EVENT_TEMPLATES_PATH, parseGoodsBenefitValues, type GoodsBenefitSnapshot, type GoodsBenefitValues } from '@/lib/goods-benefits';
import { publicMediaUrl } from '@/lib/media';
import { ArtworkUploadField } from './ArtworkUploadField';
import { adminConfirm } from '@/lib/admin/confirm';
import { goodsBenefitsProblem, otherGiftImagePaths, sameGoodsBenefits } from '@/lib/admin/goods-benefits-messages';
import { RELOAD_SAVED_CONFIRM, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { GoodsPhotoPicker } from './screens/GoodsPhotoLibraryScreen';
import { GoodsEventTemplatePicker } from './GoodsEventTemplatePicker';
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
 * 사은품·이벤트 입력(저장된 상품 패널과 등록 화면의 '상품과 함께 저장'이 같이 쓴다 — T15b). 사진 보관함·템플릿 선택창과 저장은 부르는 쪽이 둔다.
 * `fieldPrefix`는 한 화면에 두 벌이 그려질 때 업로드 칸 id가 겹치지 않게 한다.
 * `readOnly`면 고칠 수는 없지만 글자를 긁어 복사할 수 있다(다른 사람이 먼저 바꿔 저장이 멈춘 동안). 사진과 버튼은 잠근다.
 */
export function GoodsBenefitFields({ values, onChange, onPickPhoto, onOpenTemplates, fieldPrefix = 'goods-benefit-image', readOnly = false }: {
  values: GoodsBenefitValues; onChange: (update: (current: GoodsBenefitValues) => GoodsBenefitValues) => void;
  onPickPhoto: (index: number) => void; onOpenTemplates: () => void; fieldPrefix?: string; readOnly?: boolean;
}) {
  /* 사진을 올리면 설명이 필요하다(저장 규칙, parseGoodsBenefitValues). 어긋난 순간에만 그 자리에서 알린다. */
  const photoWithoutText = values.giftImagePaths.some(Boolean) && !values.giftText.trim();
  return <>
    <label className={FIELD_CLASS}><span className="font-medium">사은품 설명</span><input className={GOOD_INPUT_CLASS} data-slot="input" value={values.giftText} maxLength={100} readOnly={readOnly} placeholder="예: 아크릴 키링 1개" onChange={event => { const giftText = event.target.value; onChange(current => ({ ...current, giftText })); }} /><small className={COUNT_CLASS}>{Array.from(values.giftText).length}/100</small></label>
    <fieldset className="m-0 grid min-w-0 gap-4 border-0 p-0 md:grid-cols-3" aria-label="사은품 이미지" disabled={readOnly}>
      {[0, 1, 2].map(index => <div className="flex min-w-0 flex-col gap-2" key={`${index}:${values.giftImagePaths[index] ?? ''}`}>
        <ArtworkUploadField kind="good" name={`giftImage${index}`} fieldId={`${fieldPrefix}-${index}`} label={`사은품 이미지 ${index + 1}`} currentPath={values.giftImagePaths[index] || null} currentUrl={values.giftImagePaths[index] ? publicMediaUrl(values.giftImagePaths[index]) : null} onPathChange={path => onChange(current => withGiftImage(current, index, path))} autoUpload allowRemove compact showCropGuide={false} showPath={false} showGuidance={index === 0} />
        <button type="button" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} self-start whitespace-normal`} data-slot="button" onClick={() => onPickPhoto(index)}>사진 보관함에서 고르기</button>
      </div>)}
    </fieldset>
    <p className={photoWithoutText ? 'text-xs text-warning' : 'text-xs text-muted-foreground'} data-good-benefit-photo-note={photoWithoutText ? 'needs-text' : undefined}>{photoWithoutText ? '사진을 올렸으니 사은품 설명도 적어 주세요.' : '사진은 최대 3장, 500×500 크기를 권장합니다.'}</p>
    <label className={FIELD_CLASS}><span className="font-medium">이벤트 문구</span><input className={GOOD_INPUT_CLASS} data-slot="input" value={values.eventText} maxLength={40} readOnly={readOnly} placeholder="예: 연말 한정 증정" onChange={event => { const eventText = event.target.value; onChange(current => ({ ...current, eventText })); }} /><span className="flex justify-between gap-2 text-xs text-muted-foreground"><span>상품 검색에는 쓰이지 않습니다.</span><span className="tabular-nums">{Array.from(values.eventText).length}/40</span></span></label>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={readOnly} onClick={onOpenTemplates}>이벤트 템플릿 고르기</button><Link className="text-sm underline underline-offset-4" href={GOODS_EVENT_TEMPLATES_PATH} target="_blank" rel="noreferrer">이벤트 템플릿 관리 ↗</Link></div>
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
    /* 적은 내용이 저장된 것과 다르면 사라진다고 먼저 묻는다(화면 규칙 7). */
    if (snapshot && !sameGoodsBenefits(values, snapshot) && !await adminConfirm(RELOAD_SAVED_CONFIRM)) return;
    if (busy.current) return;
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
    if (!parsed) { setError(true); setMessage(goodsBenefitsProblem(values) ?? '사은품 안내를 저장할 수 없습니다. 적은 내용을 확인한 뒤 다시 저장해 주세요.'); return; }
    request.current ??= { values: parsed, revision: snapshot.revision, id: crypto.randomUUID() };
    ++readSequence.current;
    busy.current = true; setPending(true); setMessage('');
    const fixed = request.current;
    let result: GoodsBenefitsResult<GoodsBenefitSnapshot>;
    try { result = await saveGoodsBenefitsAction(goodId, fixed.values, fixed.revision, fixed.id); }
    catch { result = { ok: false, uncertain: true, error: SAVE_UNKNOWN_MESSAGE }; }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (result.ok) { accept(result.value); setError(false); setMessage('사은품 안내와 이벤트 문구를 저장했습니다.'); }
    else { setError(true); setMessage(result.uncertain ? SAVE_UNKNOWN_MESSAGE : result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; if (result.conflict) setConflict(true); }
  }
  const setImage = (index: number, path: string | null) => setValues(current => withGiftImage(current, index, path));
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-goods-benefits="">
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      {/* 다른 사람이 먼저 바꿔 저장이 멈춘 동안에는 글자 칸을 잠그지 않고 읽기 전용으로 둔다 — 적어 둔 내용을 긁어 복사해 둘 수 있어야 한다. */}
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={!snapshot || pending || uncertain}>
        <GoodsBenefitFields values={values} onChange={setValues} onPickPhoto={setPicker} onOpenTemplates={() => setTemplates(true)} readOnly={conflict} />
      </fieldset>
      {message ? <p className={error ? 'text-sm text-destructive' : 'text-sm text-[var(--wc-success)]'} role={error ? 'alert' : 'status'}>{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {uncertain ? <button className={buttonVariants()} data-slot="button" type="button" disabled={pending} onClick={() => void save()}>{SAVE_CHECK_LABEL}</button> : <button className={buttonVariants()} data-slot="button" type="submit" disabled={!snapshot || pending || conflict}>안내 저장</button>}
        <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={pending || uncertain} onClick={() => void reload()}>저장된 내용으로 다시 불러오기</button>
      </div>
    </form>
    {/* 다른 칸에 이미 넣은 사진은 선택창에서 '선택됨'으로 보여 다시 고를 수 없다(같은 사진을 두 칸에 넣으면 저장이 막힌다 — 규칙 2·5). */}
    {picker !== null ? <GoodsPhotoPicker pickedPaths={otherGiftImagePaths(values, picker)} onClose={() => setPicker(null)} onSelect={photo => { setImage(picker, photo.imagePath); setPicker(null); }} /> : null}
    {/* 다른 문구가 적혀 있으면 선택창이 바꾸기 전에 묻는다. */}
    {templates ? <GoodsEventTemplatePicker current={values.eventText} onClose={() => setTemplates(false)} onSelect={template => setValues(current => ({ ...current, eventText: template.eventText }))} /> : null}
  </div>;
}

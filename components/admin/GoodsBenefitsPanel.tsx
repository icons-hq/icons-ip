'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadGoodsBenefitsAction, saveGoodsBenefitsAction, type GoodsBenefitsResult } from '@/app/admin/goods-benefit-actions';
import { GOODS_EVENT_TEMPLATES_PATH, parseGoodsBenefitValues, type GoodsBenefitSnapshot, type GoodsBenefitValues } from '@/lib/goods-benefits';
import { publicMediaUrl } from '@/lib/media';
import { ArtworkUploadField } from './ArtworkUploadField';
import { GoodsPhotoPicker } from './screens/GoodsPhotoLibraryScreen';
import { GoodsEventTemplatePicker } from './screens/GoodsEventTemplatesScreen';

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
  const setImage = (index: number, path: string | null) => setValues(current => { const paths = [...current.giftImagePaths]; paths[index] = path ?? ''; return { ...current, giftImagePaths: paths }; });
  return <div className="admin-goods-benefits">
    <p>상품 상세에 표시할 안내입니다. 실제 사은품 제공 조건을 설명에 적고 재고·출고는 별도로 준비해주세요.</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={!snapshot || pending || uncertain || conflict}>
        <label className="admin-goods-benefits__field">사은품<input value={values.giftText} maxLength={100} onChange={event => setValues(current => ({ ...current, giftText: event.target.value }))} /><small>{Array.from(values.giftText).length}/100</small></label>
        <div className="admin-goods-benefits__images" aria-label="사은품 이미지">
          {[0, 1, 2].map(index => <div key={`${index}:${values.giftImagePaths[index] ?? ''}`}>
            <ArtworkUploadField kind="good" name={`giftImage${index}`} fieldId={`goods-benefit-image-${index}`} label={`사은품 이미지 ${index + 1}`} currentPath={values.giftImagePaths[index] || null} currentUrl={values.giftImagePaths[index] ? publicMediaUrl(values.giftImagePaths[index]) : null} onPathChange={path => setImage(index, path)} autoUpload allowRemove compact showCropGuide={false} showPath={false} showGuidance={index === 0} />
            <button type="button" className="btn" onClick={() => setPicker(index)}>사진 보관함에서 선택</button>
          </div>)}
        </div>
        <p>500×500 이미지를 권장합니다. 최대 3장까지 등록하며 이미지가 있으면 사은품 설명도 입력합니다.</p>
        <label className="admin-goods-benefits__field">이벤트 문구<input value={values.eventText} maxLength={40} onChange={event => setValues(current => ({ ...current, eventText: event.target.value }))} /><small>{Array.from(values.eventText).length}/40</small></label>
        <div className="admin-goods-benefits__actions"><button className="btn" type="button" onClick={() => setTemplates(true)}>이벤트 템플릿</button><Link href={GOODS_EVENT_TEMPLATES_PATH} target="_blank" rel="noreferrer">이벤트 템플릿 관리 ↗</Link></div>
        <p>이벤트 문구는 상품 검색에 포함하지 않습니다. 상품에 실제 적용되는 혜택만 안내해주세요.</p>
      </fieldset>
      {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
      <div className="admin-goods-benefits__actions">
        {uncertain ? <button className="btn btn-primary" type="button" disabled={pending} onClick={() => void save()}>같은 요청 결과 확인</button> : <button className="btn btn-primary" disabled={!snapshot || pending || conflict}>안내 저장</button>}
        <button className="btn" type="button" disabled={pending || uncertain} onClick={() => void reload()}>저장된 내용으로 다시 불러오기</button>
      </div>
    </form>
    {picker !== null ? <GoodsPhotoPicker onClose={() => setPicker(null)} onSelect={photo => { setImage(picker, photo.imagePath); setPicker(null); }} /> : null}
    {templates ? <GoodsEventTemplatePicker onClose={() => setTemplates(false)} onSelect={template => { setValues(current => ({ ...current, eventText: template.eventText })); setTemplates(false); }} /> : null}
  </div>;
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadGoodsAfterSalesAction, saveGoodsAfterSalesAction, type GoodsAfterSalesResult } from '@/app/admin/goods-after-sales-actions';
import { GOODS_AFTER_SALES_TEMPLATES_PATH, parseGoodsAfterSalesValues, type GoodsAfterSalesSnapshot, type GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { GoodsAfterSalesFields } from './GoodsAfterSalesFields';
import { GoodsAfterSalesTemplatePicker } from './screens/GoodsAfterSalesTemplatesScreen';
import { buttonVariants } from '@/components/admin/kit/ui/button';

export function GoodsAfterSalesPanel({ goodId }: { goodId: string }) {
  const [snapshot, setSnapshot] = useState<GoodsAfterSalesSnapshot | null>(null), [values, setValues] = useState<GoodsAfterSalesValues>({ phone: '', guide: '', sellerSpecialNotes: '' });
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false), [conflict, setConflict] = useState(false);
  const [templates, setTemplates] = useState(false);
  const busy = useRef(false), mounted = useRef(true), request = useRef<{ values: GoodsAfterSalesValues; revision: number; id: string } | null>(null);
  const readSequence = useRef(0);
  const accept = (value: GoodsAfterSalesSnapshot) => { setSnapshot(value); setValues(value); setConflict(false); setUncertain(false); request.current = null; };
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void loadGoodsAfterSalesAction(goodId).then(result => { if (!active || sequence !== readSequence.current) return; if (result.ok) accept(result.value); else { setError(true); setMessage(result.error); } })
      .catch(() => { if (active && sequence === readSequence.current) { setError(true); setMessage('상품 안내를 불러오지 못했습니다. 다시 조회해주세요.'); } });
    return () => { active = false; mounted.current = false; };
  }, [goodId]);
  async function reload() {
    if (busy.current || uncertain) return;
    const sequence = ++readSequence.current;
    busy.current = true; setPending(true);
    try {
      const result = await loadGoodsAfterSalesAction(goodId); if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { accept(result.value); setError(false); setMessage('저장된 내용으로 다시 불러왔습니다.'); }
      else { setError(true); setMessage(result.error); }
    } catch { if (mounted.current && sequence === readSequence.current) { setError(true); setMessage('상품 안내를 불러오지 못했습니다. 입력은 유지합니다.'); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function save(clear = false) {
    if (busy.current || !snapshot || conflict) return;
    const parsed = request.current?.values ?? parseGoodsAfterSalesValues(clear ? { phone: '', guide: '', sellerSpecialNotes: '' } : values, clear || uncertain);
    if (!parsed) { setError(true); setMessage('전화번호와 A/S 안내를 입력하고 글자 수를 확인해주세요.'); return; }
    request.current ??= { values: parsed, revision: snapshot.revision, id: crypto.randomUUID() };
    ++readSequence.current;
    busy.current = true; setPending(true); setMessage('');
    const fixed = request.current;
    let result: GoodsAfterSalesResult<GoodsAfterSalesSnapshot>;
    try { result = await saveGoodsAfterSalesAction(goodId, fixed.values, fixed.revision, fixed.id); }
    catch { result = { ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }; }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (result.ok) { accept(result.value); setError(false); setMessage(result.value.phone ? 'A/S 안내와 판매자 특이사항을 저장했습니다.' : '상품 상세의 A/S 안내와 판매자 특이사항을 해제했습니다.'); }
    else { setError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; if (result.conflict) setConflict(true); }
  }
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-goods-after-sales="">
    <p className="text-muted-foreground">상품별 A/S 안내입니다. 전화번호와 안내를 입력하고 상품에 맞는 템플릿을 불러올 수 있습니다.</p>
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={!snapshot || pending || uncertain || conflict}>
        <GoodsAfterSalesFields values={values} onChange={setValues} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setTemplates(true)}>A/S 템플릿</button><Link className="text-sm underline underline-offset-4" href={GOODS_AFTER_SALES_TEMPLATES_PATH} target="_blank" rel="noreferrer">A/S 템플릿 관리 ↗</Link></div>
      </fieldset>
      {message ? <p className={error ? 'text-sm text-destructive' : 'text-sm text-[var(--wc-success)]'} role={error ? 'alert' : 'status'}>{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {uncertain ? <button className={buttonVariants()} data-slot="button" type="button" disabled={pending} onClick={() => void save()}>같은 요청 결과 확인</button> : <button className={buttonVariants()} data-slot="button" disabled={!snapshot || pending || conflict}>안내 저장</button>}
        <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={!snapshot || !snapshot.phone || pending || uncertain || conflict} onClick={() => void save(true)}>안내 해제</button>
        <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={pending || uncertain} onClick={() => void reload()}>저장된 내용으로 다시 불러오기</button>
      </div>
    </form>
    {templates ? <GoodsAfterSalesTemplatePicker onClose={() => setTemplates(false)} onSelect={template => { setValues({ phone: template.phone, guide: template.guide, sellerSpecialNotes: template.sellerSpecialNotes }); setTemplates(false); }} /> : null}
  </div>;
}

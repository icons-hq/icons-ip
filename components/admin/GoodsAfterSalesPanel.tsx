'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadGoodsAfterSalesAction, saveGoodsAfterSalesAction, type GoodsAfterSalesResult } from '@/app/admin/goods-after-sales-actions';
import { GOODS_AFTER_SALES_TEMPLATES_PATH, parseGoodsAfterSalesValues, type GoodsAfterSalesSnapshot, type GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { adminConfirm } from '@/lib/admin/confirm';
import { GOODS_AFTER_SALES_CLEAR_CONFIRM, GOODS_AFTER_SALES_LEAVE_MESSAGE, goodsAfterSalesError, goodsAfterSalesProblem, goodsAfterSalesUnsaved, sameGoodsAfterSales } from '@/lib/admin/goods-after-sales-messages';
import { RELOAD_SAVED_CONFIRM, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { GoodsAfterSalesFields } from './GoodsAfterSalesFields';
import { GoodsAfterSalesTemplatePicker } from './GoodsAfterSalesTemplatePicker';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';

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
  /* 따로 저장하는 영역이다. 고친 내용(또는 결과를 모르는 저장)을 두고 화면을 떠나면 묻는다 — 맨 아래 저장 막대는 이 영역을 저장하지 않는다. */
  useAdminLeaveGuard({ dirty: Boolean(snapshot) && (uncertain || goodsAfterSalesUnsaved(values, snapshot!)), blocked: pending, message: GOODS_AFTER_SALES_LEAVE_MESSAGE });
  async function reload() {
    if (busy.current || uncertain) return;
    /* 적은 내용이 저장된 것과 다르면 사라진다고 먼저 묻는다(화면 규칙 7). */
    if (snapshot && !sameGoodsAfterSales(values, snapshot) && !await adminConfirm(RELOAD_SAVED_CONFIRM)) return;
    if (busy.current) return;
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
    if (!parsed) { setError(true); setMessage(goodsAfterSalesProblem(values) ?? goodsAfterSalesError('invalid_goods_after_sales')); return; }
    request.current ??= { values: parsed, revision: snapshot.revision, id: crypto.randomUUID() };
    ++readSequence.current;
    busy.current = true; setPending(true); setMessage('');
    const fixed = request.current;
    let result: GoodsAfterSalesResult<GoodsAfterSalesSnapshot>;
    try { result = await saveGoodsAfterSalesAction(goodId, fixed.values, fixed.revision, fixed.id); }
    catch { result = { ok: false, uncertain: true, error: SAVE_UNKNOWN_MESSAGE }; }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (result.ok) { accept(result.value); setError(false); setMessage(result.value.phone ? 'A/S 안내와 판매자 특이사항을 저장했습니다.' : '상품 상세의 A/S 안내와 판매자 특이사항을 해제했습니다.'); }
    else { setError(true); setMessage(result.uncertain ? SAVE_UNKNOWN_MESSAGE : result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) request.current = null; if (result.conflict) setConflict(true); }
  }
  /** [안내 해제]는 누르는 즉시 빈 값으로 저장해 상품 상세의 안내를 내린다. 무엇이 사라지는지 말하고 확인받는다. */
  async function clear() {
    if (busy.current || !snapshot || conflict || !await adminConfirm(GOODS_AFTER_SALES_CLEAR_CONFIRM)) return;
    void save(true);
  }
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-goods-after-sales="">
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      {/* 다른 사람이 먼저 바꿔 저장이 멈춘 동안에는 칸을 잠그지 않고 읽기 전용으로 둔다 — 적어 둔 내용을 긁어 복사해 둘 수 있어야 한다. */}
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={!snapshot || pending || uncertain}>
        <GoodsAfterSalesFields values={values} onChange={setValues} readOnly={conflict} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={conflict} onClick={() => setTemplates(true)}>A/S 템플릿 고르기</button><Link className="text-sm underline underline-offset-4" href={GOODS_AFTER_SALES_TEMPLATES_PATH} target="_blank" rel="noreferrer">A/S 템플릿 관리 ↗</Link></div>
      </fieldset>
      {message ? <p className={error ? 'text-sm text-destructive' : 'text-sm text-[var(--wc-success)]'} role={error ? 'alert' : 'status'}>{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {uncertain ? <button className={buttonVariants()} data-slot="button" type="button" disabled={pending} onClick={() => void save()}>{SAVE_CHECK_LABEL}</button> : <button className={buttonVariants()} data-slot="button" type="submit" disabled={!snapshot || pending || conflict}>안내 저장</button>}
        <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={!snapshot || !snapshot.phone || pending || uncertain || conflict} onClick={() => void clear()}>안내 해제</button>
        <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={pending || uncertain} onClick={() => void reload()}>저장된 내용으로 다시 불러오기</button>
      </div>
    </form>
    {/* 적어 둔 안내가 있으면 선택창이 바꾸기 전에 묻는다. 고른 내용은 [안내 저장]을 눌러야 상품에 저장된다. */}
    {templates ? <GoodsAfterSalesTemplatePicker current={values} onClose={() => setTemplates(false)} onSelect={template => setValues({ phone: template.phone, guide: template.guide, sellerSpecialNotes: template.sellerSpecialNotes })} /> : null}
  </div>;
}

'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { listGoodsPricePeriodsAction, saveGoodsPricePeriodAction } from '@/app/admin/goods-price-period-actions';
import { toKstDateTimeInput, type AdminGoodsPricePeriod } from '@/lib/admin/goods-price-periods';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';

function PeriodEditor({ goodId, variants, period, onSaved }: {
  goodId: string;
  variants: AdminGoodsVariant[];
  period?: AdminGoodsPricePeriod;
  onSaved: (message: string) => void;
}) {
  const [variantId, setVariantId] = useState(period?.variantId ?? variants[0]?.id ?? '');
  const [discountPrice, setDiscountPrice] = useState(String(period?.discountPrice ?? ''));
  const [startsAt, setStartsAt] = useState(toKstDateTimeInput(period?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toKstDateTimeInput(period?.endsAt ?? null));
  const [state, setState] = useState<'draft' | 'active'>('draft');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const variant = variants.find((item) => item.id === variantId);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveGoodsPricePeriodAction(data);
      if (result.ok) { setError(null); onSaved(result.message); } else setError(result.error);
    });
  }
  return <form className="wc-admin-kit col" onSubmit={save} style={{ gap: 12 }}>
    <input type="hidden" name="goodId" value={goodId} />
    <input type="hidden" name="variantId" value={variantId} />
    <input type="hidden" name="periodId" value={period?.id ?? ''} />
    <input type="hidden" name="revision" value={period?.revision ?? ''} />
    <input type="hidden" name="period" value={JSON.stringify({ state, discountPrice, startsAt, endsAt })} />
    <label>대상 옵션
      <select value={variantId} onChange={(event) => setVariantId(event.target.value)} disabled={Boolean(period) || pending} required>
        {variants.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.code}{option.archivedAt ? ' (사용 중지)' : ''}</option>)}
      </select>
    </label>
    <p className="muted" style={{ margin: 0 }}>현재 옵션 판매가: {variant ? `${variant.price.toLocaleString('ko-KR')}원` : '옵션 선택 필요'}</p>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
      <label>기간 할인가 (원)
        <input type="number" min={1} max={variant ? variant.price - 1 : 2147483647} step={1} value={discountPrice}
          onChange={(event) => setDiscountPrice(event.target.value)} required={state === 'active'} disabled={pending} />
      </label>
      <label>시작 (한국 시간)
        <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required={state === 'active'} disabled={pending} />
      </label>
      <label>종료 (한국 시간)
        <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required={state === 'active'} disabled={pending} />
      </label>
    </div>
    <label>사용 상태
      <select value={state} onChange={(event) => setState(event.target.value as 'draft' | 'active')} disabled={pending}>
        <option value="draft">초안 — 가격에 반영하지 않음</option>
        <option value="active">활성화 — 입력한 기간에 할인 적용</option>
      </select>
    </label>
    <p className="muted" style={{ fontSize: 12, margin: 0 }}>종료 시각부터 현재 옵션 판매가로 돌아갑니다. 같은 옵션의 활성 기간은 겹칠 수 없습니다.</p>
    {error && <p role="alert">{error}</p>}
    <button className="btn" type="submit" disabled={pending || !variantId}>{pending ? '저장 중…' : period ? '할인 초안 저장' : '기간 할인 추가'}</button>
  </form>;
}

function PeriodReceipt({ period, variant, onSaved }: { period: AdminGoodsPricePeriod; variant?: AdminGoodsVariant; onSaved: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function stop() {
    const data = new FormData();
    data.set('goodId', period.goodId); data.set('variantId', period.variantId);
    data.set('periodId', period.id); data.set('revision', String(period.revision));
    data.set('period', JSON.stringify({ state: 'disabled', discountPrice: period.discountPrice,
      startsAt: period.startsAt, endsAt: period.endsAt }));
    startTransition(async () => {
      const result = await saveGoodsPricePeriodAction(data);
      if (result.ok) { setError(null); onSaved(result.message); } else setError(result.error);
    });
  }
  const at = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미설정';
  return <div className="col" style={{ gap: 8 }}>
    <strong>{variant?.name ?? '이전 옵션'} · {period.state === 'active' ? '활성' : '중지'}</strong>
    <span>{period.regularPrice.toLocaleString('ko-KR')}원 → {period.discountPrice?.toLocaleString('ko-KR') ?? '미설정'}원</span>
    <span className="muted">{at(period.startsAt)} ~ {at(period.endsAt)} (한국 시간)</span>
    {period.state === 'active' && <button className="btn btn-ghost" type="button" onClick={stop} disabled={pending}>
      {pending ? '중지 중…' : '기간 할인 중지'}
    </button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

/** Independent saved-product panel. Put beside GoodVariantsPanel, outside the
 * product editor's form so schedule submissions do not submit unsaved product data. */
export function GoodsPricePeriodsPanel({ goodId, variants }: { goodId: string; variants: AdminGoodsVariant[] }) {
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<{ goodId: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<{ goodId: string; periods?: AdminGoodsPricePeriod[]; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void listGoodsPricePeriodsAction(goodId).then((result) => {
      if (!canceled) setLoaded(result.ok ? { goodId, periods: result.periods } : { goodId, error: result.error });
    }).catch(() => {
      if (!canceled) setLoaded({ goodId, error: '기간 할인을 불러오지 못했습니다. 다시 시도해주세요.' });
    });
    return () => { canceled = true; };
  }, [goodId, refresh]);
  const selectedVariants = variants.filter((variant) => variant.goodId === goodId);
  const visible = loaded?.goodId === goodId ? loaded : null;
  const reload = () => setRefresh((value) => value + 1);
  const saved = (message: string) => { setNotice({ goodId, message }); reload(); };
  return <section className="card col wc-admin-kit" aria-labelledby={`price-periods-${goodId}`} style={{ borderRadius: 10, gap: 18, padding: 18 }}>
    <div>
      <h2 id={`price-periods-${goodId}`} style={{ fontSize: 18, margin: 0 }}>기간 할인</h2>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>저장된 옵션에 기간 할인을 설정합니다. 미설정 초안은 가격에 반영되지 않습니다.
        활성화한 할인은 중지 후 새로 등록해 변경합니다. 옵션 판매가 변경 전에도 남은 활성 기간을 먼저 중지해주세요.</p>
    </div>
    {notice?.goodId === goodId && <p role="status">{notice.message}</p>}
    {!visible ? <p role="status">기간 할인을 불러오는 중입니다…</p> : visible.error ? <div>
      <p role="alert">{visible.error}</p><button className="btn btn-ghost" type="button" onClick={reload}>다시 불러오기</button>
    </div> : <>
      {visible.periods?.map((period) => <div key={`${period.id}:${period.revision}`} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 18 }}>
        {period.state === 'draft'
          ? <details><summary>할인 초안 · {selectedVariants.find((variant) => variant.id === period.variantId)?.name ?? '옵션'}</summary>
            <PeriodEditor goodId={goodId} variants={selectedVariants} period={period} onSaved={saved} /></details>
          : <PeriodReceipt period={period} variant={selectedVariants.find((variant) => variant.id === period.variantId)} onSaved={saved} />}
      </div>)}
      {!visible.periods?.length && <p className="muted" style={{ margin: 0 }}>등록된 기간 할인이 없습니다.</p>}
      <details><summary>새 기간 할인</summary>
        <PeriodEditor key={`${goodId}:${refresh}`} goodId={goodId} variants={selectedVariants} onSaved={saved} />
      </details>
      <button type="button" className="btn btn-ghost" onClick={reload}>기간 할인 목록 새로고침</button>
    </>}
  </section>;
}

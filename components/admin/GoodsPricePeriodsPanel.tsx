'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { listGoodsPricePeriodsAction, saveGoodsPricePeriodAction } from '@/app/admin/goods-price-period-actions';
import { toKstDateTimeInput, type AdminGoodsPricePeriod } from '@/lib/admin/goods-price-periods';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 초안·새 기간 할인은 접는 묶음(details)이라 펼치기 전에는 입력을 그리지 않은 것처럼 보인다. */
const FIELD_LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium text-foreground';
const DISCLOSURE_CLASS = 'group/period min-w-0 rounded-lg border';
const DISCLOSURE_SUMMARY_CLASS = 'flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none group-open/period:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden';
const DISCLOSURE_CHEVRON = <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/period:rotate-90 motion-reduce:transition-none" />;

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
  const idPrefix = `price-period-${goodId}-${period?.id ?? 'new'}`;
  return <form className="flex min-w-0 flex-col gap-3" onSubmit={save}>
    <input type="hidden" name="goodId" value={goodId} />
    <input type="hidden" name="variantId" value={variantId} />
    <input type="hidden" name="periodId" value={period?.id ?? ''} />
    <input type="hidden" name="revision" value={period?.revision ?? ''} />
    <input type="hidden" name="period" value={JSON.stringify({ state, discountPrice, startsAt, endsAt })} />
    <div className={FIELD_LABEL_CLASS}>
      <label htmlFor={`${idPrefix}-variant`}>대상 옵션</label>
      <NativeSelect className="w-full" id={`${idPrefix}-variant`} value={variantId} onChange={(event) => setVariantId(event.target.value)} disabled={Boolean(period) || pending} required>
        {variants.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.code}{option.archivedAt ? ' (사용 중지)' : ''}</option>)}
      </NativeSelect>
    </div>
    <p className="text-sm text-muted-foreground tabular-nums">현재 옵션 판매가: {variant ? `${variant.price.toLocaleString('ko-KR')}원` : '옵션 선택 필요'}</p>
    <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.25rem),1fr))]">
      <label className={FIELD_LABEL_CLASS}>기간 할인가 (원)
        <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" type="number" min={1} max={variant ? variant.price - 1 : 2147483647} step={1} value={discountPrice}
          onChange={(event) => setDiscountPrice(event.target.value)} required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_LABEL_CLASS}>시작 (한국 시간)
        <input className={GOOD_INPUT_CLASS} data-slot="input" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_LABEL_CLASS}>종료 (한국 시간)
        <input className={GOOD_INPUT_CLASS} data-slot="input" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required={state === 'active'} disabled={pending} />
      </label>
    </div>
    <div className={FIELD_LABEL_CLASS}>
      <label htmlFor={`${idPrefix}-state`}>사용 상태</label>
      <NativeSelect className="w-full sm:w-fit" id={`${idPrefix}-state`} value={state} onChange={(event) => setState(event.target.value as 'draft' | 'active')} disabled={pending}>
        <option value="draft">초안 · 가격 미반영</option>
        <option value="active">활성 · 기간 할인 적용</option>
      </NativeSelect>
    </div>
    <p className="text-xs text-muted-foreground">종료 시각부터 현재 옵션 판매가로 돌아갑니다. 같은 옵션의 활성 기간은 겹칠 수 없습니다.</p>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Button className="self-start" type="submit" disabled={pending || !variantId}>{pending ? '저장 중…' : period ? '할인 초안 저장' : '기간 할인 추가'}</Button>
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
  return <div className="flex min-w-0 flex-col items-start gap-1.5">
    <strong className="font-medium">{variant?.name ?? '이전 옵션'} · <span className={period.state === 'active' ? 'text-[var(--wc-success)]' : 'text-muted-foreground'}>{period.state === 'active' ? '활성' : '중지'}</span></strong>
    <span className="tabular-nums">{period.regularPrice.toLocaleString('ko-KR')}원 → {period.discountPrice?.toLocaleString('ko-KR') ?? '미설정'}원</span>
    <span className="text-xs text-muted-foreground">{at(period.startsAt)} ~ {at(period.endsAt)} (한국 시간)</span>
    {period.state === 'active' && <Button className="mt-1" size="sm" type="button" variant="outline" onClick={stop} disabled={pending}>
      {pending ? '중지 중…' : '기간 할인 중지'}
    </Button>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
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
  return <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-4 text-sm" aria-labelledby={`price-periods-${goodId}`} data-good-price-periods="">
    <div className="flex flex-col gap-1">
      <h2 id={`price-periods-${goodId}`} className="text-base leading-snug font-medium">기간 할인</h2>
      <p className="text-sm text-muted-foreground">저장된 옵션에 기간 할인을 설정합니다. 미설정 초안은 가격에 반영되지 않습니다.
        활성화한 할인은 중지 후 새로 등록해 변경합니다. 옵션 판매가 변경 전에도 남은 활성 기간을 먼저 중지해주세요.</p>
    </div>
    {notice?.goodId === goodId && <p className="text-sm text-[var(--wc-success)]" role="status">{notice.message}</p>}
    {!visible ? <p className="text-sm text-muted-foreground" role="status">기간 할인을 불러오는 중입니다…</p> : visible.error ? <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-destructive" role="alert">{visible.error}</p><Button size="sm" type="button" variant="outline" onClick={reload}>다시 불러오기</Button>
    </div> : <>
      {visible.periods?.map((period) => <div key={`${period.id}:${period.revision}`} className="min-w-0 border-b pb-4">
        {period.state === 'draft'
          ? <details className={DISCLOSURE_CLASS}><summary className={DISCLOSURE_SUMMARY_CLASS}>{DISCLOSURE_CHEVRON}할인 초안 · {selectedVariants.find((variant) => variant.id === period.variantId)?.name ?? '옵션'}</summary>
            <div className="border-t p-3"><PeriodEditor goodId={goodId} variants={selectedVariants} period={period} onSaved={saved} /></div></details>
          : <PeriodReceipt period={period} variant={selectedVariants.find((variant) => variant.id === period.variantId)} onSaved={saved} />}
      </div>)}
      {!visible.periods?.length && <p className="text-sm text-muted-foreground">등록된 기간 할인이 없습니다.</p>}
      <details className={DISCLOSURE_CLASS}><summary className={DISCLOSURE_SUMMARY_CLASS}>{DISCLOSURE_CHEVRON}새 기간 할인</summary>
        <div className="border-t p-3"><PeriodEditor key={`${goodId}:${refresh}`} goodId={goodId} variants={selectedVariants} onSaved={saved} /></div>
      </details>
      <Button className="self-start" type="button" variant="outline" onClick={reload}>기간 할인 목록 새로고침</Button>
    </>}
  </section>;
}

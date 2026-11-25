'use client';

import { GOODS_SALE_PERIOD_PRESETS, goodsSalePeriodPreset, goodsSalePeriodReadback } from '@/lib/admin/goods-sale-period';
import { AdminField } from './console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS, GoodReadback } from './GoodEditorParts';

/**
 * 판매 시기에서 '기간을 정해 판매'를 골랐을 때의 입력(GoodSaleTiming이 그때만 그린다). 판매 시작·종료는 상품 폼이 제출한다.
 * 일수 버튼은 오늘 00:00부터 마지막 판매일 다음 날 00:00까지를 채우고, 아래 한 줄이 지금 값을 되읽어 준다(설명 문단 대신 — '글보다 화면' 3).
 */
export function GoodsSalePeriodFields({ values, onChange, error }: {
  values: Record<string, string>; onChange: (values: Record<string, string>) => void; error?: string;
}) {
  const readback = goodsSalePeriodReadback(values);
  return <div className="flex min-w-0 flex-col gap-4" data-good-sale-period="">
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="판매기간 빠른 선택">
      <span className="text-xs text-muted-foreground">오늘부터</span>
      {GOODS_SALE_PERIOD_PRESETS.map(days =>
        <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" key={days} type="button" onClick={() => onChange(goodsSalePeriodPreset(days))}>{days}일</button>)}
    </div>
    <div className="grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2">
      <AdminField inputId="goods-sale-start" label="판매 시작 (KST)" error={error}>
        <input className={GOOD_INPUT_CLASS} data-slot="input" id="goods-sale-start" name="saleStartsAt" type="datetime-local" value={values.saleStartsAt ?? ''} required aria-invalid={error ? 'true' : undefined} onChange={event => onChange({ saleStartsAt: event.target.value })} />
      </AdminField>
      <AdminField inputId="goods-sale-end" label="판매 종료 (KST)">
        <input className={GOOD_INPUT_CLASS} data-slot="input" id="goods-sale-end" name="saleEndsAt" type="datetime-local" value={values.saleEndsAt ?? ''} required onChange={event => onChange({ saleEndsAt: event.target.value })} />
      </AdminField>
    </div>
    {readback ? <GoodReadback>{readback.problem ? <span className="font-medium text-warning">{readback.text}</span> : readback.text}</GoodReadback> : null}
  </div>;
}

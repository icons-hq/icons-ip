'use client';

import { GOODS_SALE_PERIOD_PRESETS, goodsSalePeriodPreset } from '@/lib/admin/goods-sale-period';
import { AdminField } from './console/AdminKit';
export function GoodsSalePeriodFields({ values, onChange, error }: {
  values: Record<string, string>; onChange: (values: Record<string, string>) => void; error?: string;
}) {
  const enabled = values.salePeriodEnabled === 'true';
  return <div className="goods-price-editor">
    <input type="hidden" name="salePeriodRevision" value={values.salePeriodRevision || '0'} />
    <fieldset className="goods-choice">
      <legend>판매기간 설정</legend>
      <label><input type="radio" name="salePeriodEnabled" value="true" checked={enabled} onChange={() => onChange({ salePeriodEnabled: 'true' })} />설정함</label>
      <label><input type="radio" name="salePeriodEnabled" value="false" checked={!enabled} onChange={() => onChange({ salePeriodEnabled: 'false' })} />설정안함</label>
    </fieldset>
    {enabled ? <>
      <div className="row" role="group" aria-label="판매기간 빠른 선택" style={{ gap: 6, flexWrap: 'wrap' }}>{GOODS_SALE_PERIOD_PRESETS.map(days =>
        <button className="btn btn-sm btn-ghost" key={days} type="button" onClick={() => onChange(goodsSalePeriodPreset(days))}>{days}일</button>)}</div>
      <AdminField inputId="goods-sale-start" label="판매 시작 · 한국시간" error={error}>
        <input id="goods-sale-start" name="saleStartsAt" type="datetime-local" value={values.saleStartsAt ?? ''} required aria-invalid={error ? 'true' : undefined} onChange={event => onChange({ saleStartsAt: event.target.value })} />
      </AdminField>
      <AdminField inputId="goods-sale-end" label="판매 종료 · 한국시간">
        <input id="goods-sale-end" name="saleEndsAt" type="datetime-local" value={values.saleEndsAt ?? ''} required onChange={event => onChange({ saleEndsAt: event.target.value })} />
      </AdminField>
    </> : <><input type="hidden" name="saleStartsAt" value={values.saleStartsAt ?? ''} /><input type="hidden" name="saleEndsAt" value={values.saleEndsAt ?? ''} /></>}
    <p className="muted">시작 시각부터 판매하고 종료 시각부터 신규 구매를 받지 않습니다. 일수 버튼은 오늘을 포함하며 마지막 판매일 다음 날 00:00에 종료합니다. 기간 밖에도 공개 상품을 둘러볼 수 있습니다.</p>
    <p className="muted">할인 기간과 별개입니다. 예약판매 옵션은 예약 접수 기간을 사용하므로 일반 판매기간과 함께 설정할 수 없습니다.</p>
    {error && !enabled ? <p role="alert">{error}</p> : null}
  </div>;
}

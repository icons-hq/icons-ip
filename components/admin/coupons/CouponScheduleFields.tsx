'use client';

import { useState } from 'react';
import { Field } from '../fields';

export function CouponScheduleFields({ values, errors }: { values: Record<string, string>; errors?: Record<string, string> }) {
  const [mode, setMode] = useState(values.validityMode || 'period');
  return <>
    <Field label="혜택 발급 시작일" name="issueStartsAt" required type="datetime-local" defaultValue={values.issueStartsAt} error={errors?.issueStartsAt} />
    <Field label={mode === 'relative' ? '혜택 발급 종료일 (비우면 무기한)' : '혜택 발급 종료일 (비우면 사용 종료일까지)'} name="issueEndsAt" type="datetime-local" defaultValue={values.issueEndsAt} error={errors?.issueEndsAt} />
    <fieldset className="admin-coupon-validity">
      <legend>쿠폰 유효기간</legend>
      <div>
        <div className="admin-coupon-validity-modes">
          <label data-selected={mode === 'period' || undefined}><input type="radio" name="validityMode" value="period" checked={mode === 'period'} onChange={() => setMode('period')} />기간으로 설정</label>
          <label data-selected={mode === 'relative' || undefined}><input type="radio" name="validityMode" value="relative" checked={mode === 'relative'} onChange={() => setMode('relative')} />발급일 기준으로 설정</label>
        </div>
        {errors?.validityMode ? <p role="alert">{errors.validityMode}</p> : null}
        <p>발급기간이 끝나도 보유한 쿠폰은 유효기간까지 사용할 수 있습니다. 발급일 기준 만료일은 발급 시 저장되며 기간 설정을 바꿔도 기존 쿠폰의 만료일은 바뀌지 않습니다.</p>
        {mode === 'relative' ? <p>발급일에서 N일이 지난 날의 23:59:59까지 사용합니다. 예: 10월 1일 발급·3일 설정 → 10월 4일 종료.</p> : null}
      </div>
    </fieldset>
    <fieldset className="admin-coupon-period-fields" hidden={mode !== 'relative'} disabled={mode !== 'relative'}>
      <Field label="발급일로부터 (일)" name="validDays" min={1} max={365} required type="number" defaultValue={values.validDays || '7'} error={errors?.validDays} />
    </fieldset>
    <fieldset className="admin-coupon-period-fields" hidden={mode !== 'period'} disabled={mode !== 'period'}>
      <Field label="사용 시작일" name="startsAt" required type="datetime-local" defaultValue={values.startsAt} error={errors?.startsAt} />
      <Field label="사용 종료일 (비우면 무기한)" name="endsAt" type="datetime-local" defaultValue={values.endsAt} error={errors?.endsAt} />
    </fieldset>
  </>;
}

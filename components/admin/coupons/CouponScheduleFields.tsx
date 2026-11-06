'use client';

import { useState } from 'react';
import { Field } from '../fields';

/* 쿠폰 발급·유효기간 입력(템플릿 룩, ADR-0028). 유효기간 방식은 숨긴 라디오 + 구분 선택 모양이고, 고르지 않은 방식의 칸은 숨기고 잠가서 보내지 않는다. */
const MODE = 'relative inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-selected:bg-background data-selected:text-foreground data-selected:shadow-sm';
const PERIOD = 'grid min-w-0 gap-x-6 gap-y-5 [grid-column:1/-1] sm:grid-cols-2';

export function CouponScheduleFields({ values, errors }: { values: Record<string, string>; errors?: Record<string, string> }) {
  const [mode, setMode] = useState(values.validityMode || 'period');
  return <>
    <Field label="혜택 발급 시작일" name="issueStartsAt" required type="datetime-local" defaultValue={values.issueStartsAt} error={errors?.issueStartsAt} />
    <Field label={mode === 'relative' ? '혜택 발급 종료일 (비우면 무기한)' : '혜택 발급 종료일 (비우면 사용 종료일까지)'} name="issueEndsAt" type="datetime-local" defaultValue={values.issueEndsAt} error={errors?.issueEndsAt} />
    <fieldset className="min-w-0 [grid-column:1/-1]">
      <legend className="mb-2 text-sm font-medium">쿠폰 유효기간</legend>
      <div className="flex flex-col gap-2">
        <div className="inline-flex max-w-full flex-wrap self-start rounded-lg bg-muted p-0.5">
          <label className={MODE} data-selected={mode === 'period' || undefined}><input className="sr-only" type="radio" name="validityMode" value="period" checked={mode === 'period'} onChange={() => setMode('period')} />기간으로 설정</label>
          <label className={MODE} data-selected={mode === 'relative' || undefined}><input className="sr-only" type="radio" name="validityMode" value="relative" checked={mode === 'relative'} onChange={() => setMode('relative')} />발급일 기준으로 설정</label>
        </div>
        {errors?.validityMode ? <p className="text-sm text-destructive" role="alert">{errors.validityMode}</p> : null}
        <p className="text-xs leading-relaxed text-muted-foreground">발급기간이 끝나도 보유한 쿠폰은 유효기간까지 사용할 수 있습니다. 발급일 기준 만료일은 발급 시 저장되며 기간 설정을 바꿔도 기존 쿠폰의 만료일은 바뀌지 않습니다.</p>
        {mode === 'relative' ? <p className="text-xs leading-relaxed text-muted-foreground">발급일에서 N일이 지난 날의 23:59:59까지 사용합니다. 예: 10월 1일 발급·3일 설정 → 10월 4일 종료.</p> : null}
      </div>
    </fieldset>
    <fieldset className={PERIOD} hidden={mode !== 'relative'} disabled={mode !== 'relative'}>
      <Field label="발급일로부터 (일)" name="validDays" min={1} max={365} required type="number" defaultValue={values.validDays || '7'} error={errors?.validDays} />
    </fieldset>
    <fieldset className={PERIOD} hidden={mode !== 'period'} disabled={mode !== 'period'}>
      <Field label="사용 시작일" name="startsAt" required type="datetime-local" defaultValue={values.startsAt} error={errors?.startsAt} />
      <Field label="사용 종료일 (비우면 무기한)" name="endsAt" type="datetime-local" defaultValue={values.endsAt} error={errors?.endsAt} />
    </fieldset>
  </>;
}

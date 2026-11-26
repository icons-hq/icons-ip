'use client';

import { useState } from 'react';
import { Input } from '@/components/admin/kit/ui/input';
import { PG_SETTLEMENT_MAX_SPAN_DAYS, addSettlementDays, pgSettlementPeriodProblem } from '@/lib/settlements/console';

/**
 * 정산 내역의 조회기간(시작일 ~ 종료일, 폼 이름 from·to).
 * 종료일은 시작일부터 31일 안에서만 고를 수 있다(화면 규칙 5) — 검색한 뒤에 '최대 31일' 오류를 만나지 않는다.
 * 시작일은 막지 않는다: 기간을 뒤로 옮길 때 시작일을 먼저 바꾸고 종료일을 다시 고르면 되고, 시작일에 제약을 걸면 어느 쪽도 먼저 못 바꾸는 순간이 생긴다.
 */
export function PgSettlementPeriodFields({ from, to }: { from: string; to: string }) {
  const [range, setRange] = useState({ from, to });
  const problem = pgSettlementPeriodProblem(range.from, range.to);
  const errorId = 'pg-settlement-period-error';
  const lastEnd = addSettlementDays(range.from, PG_SETTLEMENT_MAX_SPAN_DAYS);
  return <>
    <div className="flex flex-wrap items-center gap-1.5">
      <Input aria-label="조회 시작일" className="w-36" name="from" onChange={event => setRange({ ...range, from: event.target.value })} required type="date" value={range.from} />
      <span aria-hidden="true" className="text-muted-foreground">~</span>
      <Input aria-describedby={problem ? errorId : undefined} aria-invalid={problem ? true : undefined} aria-label="조회 종료일" className="w-36"
        max={lastEnd || undefined} min={range.from || undefined} name="to" onChange={event => setRange({ ...range, to: event.target.value })} required type="date" value={range.to} />
    </div>
    <span className="text-xs leading-relaxed text-muted-foreground">최대 31일</span>
    {problem ? <small className="basis-full text-xs text-destructive" id={errorId} role="alert">{problem}</small> : null}
  </>;
}

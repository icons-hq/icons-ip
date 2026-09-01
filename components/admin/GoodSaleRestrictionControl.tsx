'use client';

import { useActionState } from 'react';
import {
  setGoodSaleRestrictionAction,
  type AdminGoodSaleRestrictionActionState,
} from '../../app/admin/good-sale-restriction-actions';
import type { AdminGoodSaleRestriction } from '../../lib/admin/catalog.server';
import { SelectField } from './fields';

const saleRestrictionInitialState: AdminGoodSaleRestrictionActionState = {};

/* 값이 늘어날 자리다(random_box). 라벨 목록을 여기 한 곳에 두어야 선택지가
   늘 때 컨트롤 마크업을 다시 짜지 않는다. */
const SALE_RESTRICTION_OPTIONS: { label: string; value: AdminGoodSaleRestriction }[] = [
  { label: '없음', value: 'none' },
  { label: '성인(19금)', value: 'adult' },
];

/**
 * 굿즈 판매 제한 유형 (#392).
 *
 * 무통장 토글과 같은 자리의 행 단위 컨트롤이지만 2택 이상이라 토글이 아니라
 * select 다 — 앞으로 값이 늘어도 같은 컨트롤을 그대로 쓴다. 고른 즉시 저장하지
 * 않고 버튼으로 확정하는 것은, 성인 상품 전환이 스토어 노출과 결제 경로를 동시에
 * 바꾸는 판단이라 선택 실수를 되돌릴 틈을 남기기 위해서다.
 */
export function GoodSaleRestrictionControl({
  saleRestriction,
  id,
}: {
  saleRestriction: AdminGoodSaleRestriction;
  id: string;
}) {
  const [state, action, pending] = useActionState(
    setGoodSaleRestrictionAction,
    saleRestrictionInitialState,
  );

  return (
    <form action={action} className="admin-panel col" style={{ gap: 10 }}>
      <div>
        <strong>판매 제한 유형</strong>
        <p className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
          성인(19금) 상품은 성인인증 도입 전까지 스토어에 노출되지 않고 구매가 차단됩니다. 결제는 전용 PG(코페이)로 분기됩니다.
        </p>
      </div>
      <input name="id" type="hidden" value={id} />
      <SelectField defaultValue={saleRestriction} label="판매 제한" name="restriction">
        {SALE_RESTRICTION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </SelectField>
      <button className="btn btn-ghost" disabled={pending}>
        {pending ? '변경하는 중' : '판매 제한 저장'}
      </button>
      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {state.message && <p className="admin-note" role="status">{state.message}</p>}
    </form>
  );
}

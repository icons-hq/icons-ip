'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useActionState } from 'react';
import { upsertAdminCouponAction, type AdminCouponActionState } from '@/app/admin/coupon-actions';
import { CouponSection } from '@/components/admin/sections/CouponSection';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import { useSelectedRecord } from './record-selection';

const emptyState: AdminCouponActionState = {};

export function CouponScreen({ records }: { records: AdminCouponRecord[] }) {
  const [state, action, pending] = useActionState(upsertAdminCouponAction, emptyState);
  const { selected, select } = useSelectedRecord(records);

  return (
    <><AdminPageHeader title="쿠폰 관리" description="쿠폰 발급 조건과 사용 기간을 관리합니다." />
    <CouponSection
      action={action}
      onSelect={select}
      pending={pending}
      records={records}
      selected={selected}
      state={state}
    /></>
  );
}

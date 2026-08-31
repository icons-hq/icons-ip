'use client';

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
    <CouponSection
      action={action}
      onSelect={select}
      pending={pending}
      records={records}
      selected={selected}
      state={state}
    />
  );
}

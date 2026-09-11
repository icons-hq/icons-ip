'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { preservedFormValues } from '@/lib/admin/form-state';
import { upsertAdminCouponAction, type AdminCouponActionState } from '@/app/admin/coupon-actions';
import { CouponSection } from '@/components/admin/sections/CouponSection';
import {
  adminCouponListHref,
  type AdminCouponListData,
} from '@/lib/admin/coupons';

const emptyState: AdminCouponActionState = {};

export function CouponScreen({ data }: { data: AdminCouponListData }) {
  const [state, action, pending] = useActionState(upsertAdminCouponAction, emptyState);
  const router = useRouter();
  const [selecting, startSelect] = useTransition();
  const selectedCode = data.filters.selectedCode;
  const selected = data.records.find((record) => record.id === selectedCode)
    ?? (data.selectedRecord?.id === selectedCode ? data.selectedRecord : null);

  function select(record: { id: string } | null) {
    const nextCode = record?.id ?? null;
    startSelect(() => router.replace(adminCouponListHref(data.filters, { selectedCode: nextCode }), { scroll: false }));
  }

  const draft = preservedFormValues(state, selected?.code, { scopeKey: 'previousCode' });
  const scopedState = state.values && !draft ? emptyState : state;

  return (
    <><AdminPageHeader title="쿠폰 관리" description="쿠폰 발급 조건과 사용 기간을 관리합니다." />
    <CouponSection
      action={action}
      onSelect={select}
      pending={pending || selecting}
      records={data.records}
      selected={selected}
      filters={data.filters}
      pageSize={data.pageSize}
      total={data.total}
      draft={draft}
      state={scopedState}
    /></>
  );
}

'use client';

import { useActionState, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { preservedFormValues } from '@/lib/admin/form-state';
import { upsertAdminCouponAction, type AdminCouponActionState } from '@/app/admin/coupon-actions';
import { CouponSection } from '@/components/admin/sections/CouponSection';
import type { ConfigurableGrade } from '@/lib/loyalty-policy';
import {
  adminCouponListHref,
  type AdminCouponListData,
} from '@/lib/admin/coupons';

const emptyState: AdminCouponActionState = {};

export function CouponScreen({ data, mode = 'list', initialGrade }: { data: AdminCouponListData; mode?: 'list' | 'create'; initialGrade?: ConfigurableGrade }) {
  const [state, action, pending] = useActionState(upsertAdminCouponAction, emptyState);
  const router = useRouter();
  const [selecting, startSelect] = useTransition();
  const selectedCode = data.filters.selectedCode;
  const navigatedSave = useRef<string | null>(null);
  useEffect(() => {
    if (!state.savedCode || navigatedSave.current === state.savedCode) return;
    navigatedSave.current = state.savedCode;
    router.replace(state.openTargetIssuance ? `/admin/sales/coupons/issue?couponCode=${encodeURIComponent(state.savedCode)}` : adminCouponListHref(data.filters, { selectedCode: state.savedCode }), { scroll: false });
  }, [state.savedCode, state.openTargetIssuance, router, data.filters]);
  const source = data.records.find((record) => record.id === selectedCode)
    ?? (data.selectedRecord?.id === selectedCode ? data.selectedRecord : null);

  const selected = mode === 'create' ? null : source;

  function select(record: { id: string } | null) {
    const nextCode = record?.id ?? null;
    startSelect(() => router.replace(adminCouponListHref(data.filters, { selectedCode: nextCode }), { scroll: false }));
  }

  const draft = preservedFormValues(state, selected?.code, { scopeKey: 'previousCode' });
  const scopedState = state.values && !draft ? emptyState : state;

  return (
    <CouponSection
      action={action}
      mode={mode}
      copySource={mode === 'create' ? source : null}
      initialGrade={initialGrade}
      onSelect={select}
      pending={pending || selecting}
      records={data.records}
      selected={selected}
      filters={data.filters}
      pageSize={data.pageSize}
      total={data.total}
      draft={draft}
      state={scopedState}
    />
  );
}

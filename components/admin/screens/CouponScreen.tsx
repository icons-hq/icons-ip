'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { preservedFormValues } from '@/lib/admin/form-state';
import { upsertAdminCouponAction, type AdminCouponActionState } from '@/app/admin/coupon-actions';
import { CouponSection } from '@/components/admin/sections/CouponSection';
import type { ConfigurableGrade } from '@/lib/loyalty-policy';
import {
  adminCouponListHref,
  type AdminCouponListData,
} from '@/lib/admin/coupons';
import { withAdminSavedFlag, withoutAdminSavedFlag } from '@/lib/admin/saved-flag';

const emptyState: AdminCouponActionState = {};

export function CouponScreen({ data, mode = 'list', initialGrade, justSaved = false }: {
  data: AdminCouponListData; mode?: 'list' | 'create'; initialGrade?: ConfigurableGrade;
  /** 새 혜택 저장 뒤 이 화면으로 옮겨 왔다(주소의 한 번용 saved 표시). */
  justSaved?: boolean;
}) {
  const [state, action, pending] = useActionState(upsertAdminCouponAction, emptyState);
  const router = useRouter();
  const [selecting, startSelect] = useTransition();
  const selectedCode = data.filters.selectedCode;
  const navigatedSave = useRef<string | null>(null);
  /*
   * 1027T-026: 새 혜택은 저장 뒤 다른 화면(수정·고객 발급)으로 옮겨 가 저장 결과 문장이 사라졌다. 옮겨 갈 주소에 한 번용
   * saved 표시를 붙이고, 받은 화면은 그 문장을 상태로 들고 주소에서 표시를 지운다(새로고침·뒤로 가기에 다시 뜨지 않게).
   */
  const [savedCode] = useState(justSaved ? selectedCode : null);
  useEffect(() => {
    if (justSaved) window.history.replaceState(null, '', withoutAdminSavedFlag(`${window.location.pathname}${window.location.search}`));
  }, [justSaved]);
  /* ①: 목록 줄의 중지·재개 결과. 줄은 상태가 바뀌면 새로 그려져 확인 창 안 문장이 함께 사라지므로 목록 위 결과 자리로 올린다. */
  const [statusResult, setStatusResult] = useState<{ id: number; message: string } | null>(null);
  const reportStatus = (message: string) => setStatusResult(current => ({ id: (current?.id ?? 0) + 1, message }));
  useEffect(() => {
    if (!state.savedCode || navigatedSave.current === state.savedCode) return;
    navigatedSave.current = state.savedCode;
    const target = state.openTargetIssuance ? `/admin/sales/coupons/issue?couponCode=${encodeURIComponent(state.savedCode)}` : adminCouponListHref(data.filters, { selectedCode: state.savedCode });
    /* 같은 화면에서 고친 저장은 이 화면의 결과 문장이 그대로 남는다. 등록 화면에서 처음 저장할 때만 표시를 붙이고,
       결과 문장이 있는 맨 위에서 시작한다. */
    if (mode === 'create') router.replace(withAdminSavedFlag(target));
    else router.replace(target, { scroll: false });
  }, [state.savedCode, state.openTargetIssuance, router, data.filters, mode]);
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
      savedCode={savedCode && selected?.code === savedCode && !state.message && !state.errors ? savedCode : null}
      statusResult={statusResult}
      onStatusResult={reportStatus}
    />
  );
}

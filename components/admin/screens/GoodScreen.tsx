'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upsertAdminGoodAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { GoodSection } from '@/components/admin/sections/GoodSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodNoticeDefaults } from '@/lib/admin/good-editor';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import type { CatalogSnapshot } from '@/lib/catalog';
import { adminGoodsNotice } from '@/lib/admin/vocabulary';
import { toRecordOptions } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/*
 * 굿즈 화면 래퍼.
 *
 * `adjustmentId`는 실재고 조정의 멱등 키다. 여기서 만들면 리렌더마다 값이 바뀌어
 * 같은 조정이 두 번 먹힐 수 있어서, 서버 컴포넌트인 page가 만들어 내려준다.
 */
export function GoodScreen({
  adjustmentId,
  catalogIps,
  ips,
  records,
  variants,
  initialIpId,
  initialQuery,
  initialSelectedId,
  hideRecordList=false,
  listHref='/admin/catalog/goods',
  accountId='', origins=[], noticeDefaults,
}: {
  adjustmentId: string;
  catalogIps: CatalogSnapshot['ips'];
  ips: AdminCatalogRecords['ips'];
  records: AdminCatalogRecords['goods'];
  variants: AdminGoodsVariant[];
  initialIpId?: string;
  initialQuery?: string;
  initialSelectedId?: string;
  hideRecordList?: boolean;
  listHref?: string;
  accountId?: string; origins?: FulfillmentOrigin[]; noticeDefaults?: GoodNoticeDefaults;
}) {
  const [state, action, pending] = useActionState(upsertAdminGoodAction, emptyState);
  const noticeState = useMemo(() => adminGoodsNotice(state), [state]);
  const ipOptions = useMemo(() => toRecordOptions(ips), [ips]);
  const router=useRouter();
  const [selection,setSelection]=useState<{id:string|null;savedId?:string}>({id:initialSelectedId??null});
  const selectedId=state.savedGoodId && selection.savedId!==state.savedGoodId?state.savedGoodId:selection.id;
  const selected=records.find((record)=>record.id===selectedId)??null;
  useEffect(()=>{
    if (!hideRecordList || !state.savedGoodId) return;
    const url=new URL(listHref,'https://admin.invalid');
    url.searchParams.delete('create');
    url.searchParams.set('goodId',state.savedGoodId);
    router.replace(`${url.pathname}?${url.searchParams}`,{scroll:false});
  },[hideRecordList,listHref,router,state.savedGoodId]);

  return (
    <GoodSection
      accountId={accountId} origins={origins} noticeDefaults={noticeDefaults}
      action={action}
      adjustmentId={adjustmentId}
      catalogIps={catalogIps}
      ipOptions={ipOptions}
      onSelect={(record)=>setSelection({id:record?.id??null,savedId:state.savedGoodId})}
      pending={pending}
      records={records}
      selected={selected}
      state={noticeState}
      variants={variants}
      initialIpId={initialIpId}
      initialQuery={initialQuery}
      hideRecordList={hideRecordList}
    />
  );
}

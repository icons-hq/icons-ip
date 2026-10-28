'use client';
import type { GoodsEditorOwnership } from '@/lib/admin/goods-group-common';

import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { GoodsShippingNoticeOption } from '@/components/admin/GoodsShippingNoticeField';

import { useActionState, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upsertAdminGoodAction, type AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { GoodSection } from '@/components/admin/sections/GoodSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodNoticeDefaults } from '@/lib/admin/good-editor';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import type { CatalogSnapshot } from '@/lib/catalog';
import { adminGoodsNotice } from '@/lib/admin/vocabulary';
import { toRecordOptions } from './record-selection';
import { GoodsKcTemplateProvider, useGoodsKcTemplate } from '../useGoodsKcTemplate';

const emptyState: AdminCatalogActionState = {};

/*
 * 굿즈 화면 래퍼.
 *
 * `adjustmentId`는 실재고 조정의 멱등 키다. 여기서 만들면 리렌더마다 값이 바뀌어
 * 같은 조정이 두 번 먹힐 수 있어서, 서버 컴포넌트인 page가 만들어 내려준다.
 */
export function GoodScreen(props: Omit<Parameters<typeof GoodScreenForm>[0], 'onCreated'>) {
  const selectionKey = props.initialSelectedId ? `good:${props.initialSelectedId}` : `create:${props.initialIpId ?? 'any'}`;
  /*
   * 등록 화면에서 저장하면 주소만 ?goodId=로 바뀐다(R13·D6②). 같은 화면을 유지해야 스크롤·펼침·운영 섹션 자리가
   * 그대로 남으므로, 방금 등록한 상품으로 주소가 바뀔 때는 등록 화면의 key를 이어 쓴다. 다른 상품이나 새 등록으로
   * 옮기면 그때 key를 바꿔 새 화면으로 시작한다(같은 등록 key를 다시 쓰지 않게 회차를 붙인다).
   */
  const [adopted, setAdopted] = useState<{ key: string; goodId: string; seen: boolean } | null>(null);
  const [round, setRound] = useState(0);
  if (adopted) {
    if (props.initialSelectedId === adopted.goodId) { if (!adopted.seen) setAdopted({ ...adopted, seen: true }); }
    else if (adopted.seen || props.initialSelectedId) { setAdopted(null); setRound((value) => value + 1); }
  }
  const formKey = adopted ? adopted.key : `${selectionKey}:${round}`;
  const onCreated = useCallback((goodId: string) => setAdopted((current) => current ?? { key: formKey, goodId, seen: false }), [formKey]);
  return <GoodsKcTemplateProvider key={props.accountId} selectionKey={selectionKey}>
    <GoodScreenForm {...props} onCreated={onCreated} key={formKey}/>
  </GoodsKcTemplateProvider>;
}

function GoodScreenForm({
  adjustmentId, ownership,
  catalogIps,
  ips,
  records,
  variants,
  initialIpId,
  initialQuery,
  initialSelectedId,
  hideRecordList=false,
  listHref='/admin/catalog/goods',
  accountId='', origins=[], noticeDefaults, categories=[], shippingNoticeOptions=[], canManageCosts=false, canReadOrders=true, canManageSales=true, canSearchErp=true, cloneOperationId, readiness, regionSummaries = [],
  onCreated,
}: {
  /** 등록 화면에서 상품을 처음 저장했다. 주소를 바꾼 뒤에도 같은 화면을 유지하도록 GoodScreen이 key를 넘겨받는다. */
  onCreated?: (goodId: string) => void;
  adjustmentId: string; ownership?: GoodsEditorOwnership | null;
  catalogIps: CatalogSnapshot['ips'];
  ips: AdminCatalogRecords['ips'];
  records: AdminCatalogRecords['goods'];
  variants: AdminGoodsVariant[];
  initialIpId?: string;
  initialQuery?: string;
  initialSelectedId?: string;
  hideRecordList?: boolean;
  listHref?: string;
  accountId?: string; origins?: GoodsFulfillmentOrigin[]; noticeDefaults?: GoodNoticeDefaults;
  categories?: AdminCategoryNode[]; shippingNoticeOptions?: GoodsShippingNoticeOption[]; canManageCosts?: boolean; canReadOrders?: boolean; canManageSales?: boolean; canSearchErp?: boolean; cloneOperationId?: string; readiness?: AdminGoodsReadiness | null; regionSummaries?: GoodShippingRegionSummary[];
}) {
  const [state, action, pending] = useActionState(upsertAdminGoodAction, emptyState);
  const noticeState = useMemo(() => adminGoodsNotice(state), [state]);
  const ipOptions = useMemo(() => toRecordOptions(ips), [ips]);
  const router=useRouter();
  const { bindSavedGood, discard: discardKcTemplate } = useGoodsKcTemplate();
  const [selection,setSelection]=useState<{id:string|null;savedId?:string}>({id:initialSelectedId??null});
  const selectedId=state.savedGoodId && selection.savedId!==state.savedGoodId?state.savedGoodId:selection.id;
  const selected=records.find((record)=>record.id===selectedId)??null;
  useEffect(()=>{
    if (!hideRecordList || !state.savedGoodId || initialSelectedId === state.savedGoodId) return;
    // 등록 화면에서 KC를 함께 저장했으면 고시 프리셋의 KC 유형 틀을 저장된 KC 위에 다시 얹지 않는다.
    if (state.workspaceKcSaved) discardKcTemplate(); else bindSavedGood(state.savedGoodId);
    if (!initialSelectedId) onCreated?.(state.savedGoodId);
    const url=new URL(listHref,'https://admin.invalid');
    url.searchParams.delete('create');
    url.searchParams.set('goodId',state.savedGoodId);
    // 같은 자리에서 이어 입력하도록 KC로 점프하지 않고 스크롤을 유지한다(R13).
    router.replace(`${url.pathname}?${url.searchParams}`,{scroll:false});
  },[hideRecordList,initialSelectedId,listHref,router,state.savedGoodId,state.workspaceKcSaved,bindSavedGood,discardKcTemplate,onCreated]);

  return (
    <GoodSection
      ownership={ownership}
      readiness={readiness} regionSummaries={regionSummaries}
      accountId={accountId} origins={origins} noticeDefaults={noticeDefaults}
      categories={categories} shippingNoticeOptions={shippingNoticeOptions} canManageCosts={canManageCosts} canReadOrders={canReadOrders} canManageSales={canManageSales} canSearchErp={canSearchErp} cloneOperationId={cloneOperationId}
      action={action}
      adjustmentId={adjustmentId}
      catalogIps={catalogIps}
      ipOptions={ipOptions}
      onSelect={(record)=>{ discardKcTemplate(); setSelection({id:record?.id??null,savedId:state.savedGoodId}); }}
      pending={pending || Boolean(state.savedGoodId && !selected)}
      records={records}
      selected={selected}
      state={noticeState}
      variants={variants}
      initialIpId={initialIpId}
      initialQuery={initialQuery}
      hideRecordList={hideRecordList} listHref={listHref}
    />
  );
}

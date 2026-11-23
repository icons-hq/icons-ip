import { AdminNotice, AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { CollectibleFeaturesForm } from '@/components/admin/screens/CollectibleFeaturesForm';
import { AdultGoodsVisibilityForm } from '@/components/admin/screens/AdultGoodsVisibilityForm';
import { getAdultGoodsVisibility } from '@/lib/adult-goods-access.server';
import { COLLECTIBLE_FEATURES_PATH } from '@/lib/admin/collectible-features';
import { loadAdminCollectibleFeatures } from '@/lib/admin/collectible-features.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { formatOrderDateTime } from '@/lib/orders';

export default async function Page() {
  await requireAdminScreenAccess(COLLECTIBLE_FEATURES_PATH, { adminOnly: true });
  const [state, adultGoods] = await Promise.all([loadAdminCollectibleFeatures(), getAdultGoodsVisibility()]);
  return <div className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="기능 공개 관리" description="고객에게 보여줄 성인 상품과 수집·거래 기능을 설정합니다." />
    {adultGoods ? <AdminSectionCard title="성인(19금) 상품 공개 설정"
      summary="19 표시로 노출하면 성인 인증을 마친 고객만 상품을 볼 수 있습니다. 모든 고객에게 숨기면 인증한 고객도 목록·검색에서 상품을 보거나 상세 주소로 열 수 없습니다.">
      <AdultGoodsVisibilityForm settings={adultGoods} />
    </AdminSectionCard> : <AdminNotice role="alert" title="성인(19금) 상품 공개 설정" tone="danger">성인 상품 공개 설정을 불러오지 못했습니다. 새로고침해 주세요.</AdminNotice>}
    {state ? <AdminSectionCard title="고객 화면 공개 여부"
      summary={state.updatedBy ? `마지막 변경 ${formatOrderDateTime(state.updatedAt)} · ${state.updatedBy}` : '아직 바꾼 적이 없습니다. 처음에는 세 기능 모두 숨김입니다.'}>
      {/* 저장 뒤 서버가 새 설정으로 다시 그려도 폼을 다시 마운트하지 않는다 — 폼은 저장 결과로 자기 상태를 맞추고 결과 문구·포커스를 남긴다. */}
      <CollectibleFeaturesForm initial={state} />
    </AdminSectionCard>
      : <AdminNotice role="alert" title="기능 공개 관리" tone="danger">현재 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요. 설정을 읽지 못하는 동안 고객 화면은 세 기능을 모두 숨깁니다.</AdminNotice>}
  </div>;
}

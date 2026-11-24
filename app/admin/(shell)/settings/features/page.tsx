import { AdminNotice, AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { AdultGoodsVisibilityForm } from '@/components/admin/screens/AdultGoodsVisibilityForm';
import { ADULT_GOODS_VISIBILITY_PATH } from '@/lib/adult-goods';
import { getAdultGoodsVisibility } from '@/lib/adult-goods-access.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/* 기능 공개 관리 — 성인(19금) 상품 공개 설정. 카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치는
   2026-11-24 일반 쇼핑몰 전환으로 화면과 함께 지웠다(ADR-0052, DB 표는 보존). */
export default async function Page() {
  await requireAdminScreenAccess(ADULT_GOODS_VISIBILITY_PATH, { adminOnly: true });
  const adultGoods = await getAdultGoodsVisibility();
  return <div className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="기능 공개 관리" description="고객에게 보여줄 성인(19금) 상품을 설정합니다." />
    {adultGoods ? <AdminSectionCard title="성인(19금) 상품 공개 설정"
      summary="19 표시로 노출하면 성인 인증을 마친 고객만 상품을 볼 수 있습니다. 모든 고객에게 숨기면 인증한 고객도 목록·검색에서 상품을 보거나 상세 주소로 열 수 없습니다.">
      <AdultGoodsVisibilityForm settings={adultGoods} />
    </AdminSectionCard> : <AdminNotice role="alert" title="성인(19금) 상품 공개 설정" tone="danger">성인 상품 공개 설정을 불러오지 못했습니다. 새로고침해 주세요.</AdminNotice>}
  </div>;
}

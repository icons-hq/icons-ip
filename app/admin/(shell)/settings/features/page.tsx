import { AdminNotice, AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { CollectibleFeaturesForm } from '@/components/admin/screens/CollectibleFeaturesForm';
import { COLLECTIBLE_FEATURES_PATH } from '@/lib/admin/collectible-features';
import { loadAdminCollectibleFeatures } from '@/lib/admin/collectible-features.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { formatOrderDateTime } from '@/lib/orders';

export default async function Page() {
  await requireAdminScreenAccess(COLLECTIBLE_FEATURES_PATH, { adminOnly: true });
  const state = await loadAdminCollectibleFeatures();
  return <div className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="기능 공개 관리" description="운영하지 않는 카드 바인더·굿즈 마켓·카드 트레이드를 고객 화면에서 숨기고 막습니다. 숨긴 기능은 메뉴·화면 링크가 사라지고 주소로 열어도 '페이지를 찾을 수 없습니다'가 나옵니다. 스태프·관리자도 같습니다." />
    {state ? <AdminSectionCard title="고객 화면 공개 여부"
      summary={state.updatedBy ? `마지막 변경 ${formatOrderDateTime(state.updatedAt)} · ${state.updatedBy}` : '아직 바꾼 적이 없습니다. 처음에는 세 기능 모두 숨김입니다.'}>
      {/* 저장 뒤 서버가 새 설정으로 다시 그려도 폼을 다시 마운트하지 않는다 — 폼은 저장 결과로 자기 상태를 맞추고 결과 문구·포커스를 남긴다. */}
      <CollectibleFeaturesForm initial={state} />
    </AdminSectionCard>
      : <AdminNotice role="alert" title="기능 공개 관리" tone="danger">현재 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요. 설정을 읽지 못하는 동안 고객 화면은 세 기능을 모두 숨깁니다.</AdminNotice>}
  </div>;
}

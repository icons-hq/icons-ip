import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AutoOrderConfirmPanel } from '@/components/admin/screens/AutoOrderConfirmPanel';
import { ForcedDeliveryPanel } from '@/components/admin/screens/ForcedDeliveryPanel';
import { ShipmentConsoleScreen } from '@/components/admin/screens/ShipmentConsoleScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { getAutoOrderConfirmation } from '@/lib/admin/auto-order-confirmation.server';
import { normalizeShipmentFilters } from '@/lib/admin/shipment-dispatch';
import { getShipmentConsoleData } from '@/lib/admin/shipment-dispatch.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesDispatchPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const auth=await requireAdminScreenAccess('/admin/sales/dispatch');
  const filters=normalizeShipmentFilters(await searchParams,'dispatch');
  const [data,autoConfirmation]=await Promise.all([getShipmentConsoleData(filters,'dispatch'),getAutoOrderConfirmation()]);
  /* 처리할 주문 표가 첫 화면에 오도록 설정 카드는 표 아래에 둔다. 켜짐·꺼짐은 건수 카드 옆 버튼에서 바로 읽고, 누르면 설정으로 내려간다. */
  const autoOff=autoConfirmation?!autoConfirmation.enabled:false;
  const autoStatus=<a className={`${buttonVariants({variant:'outline'})} shrink-0`} data-slot="button" href="#auto-order-confirm">자동 발주확인 <AdminStatusBadge tone={autoConfirmation?autoConfirmation.enabled?'success':'warning':'danger'}>{autoConfirmation?autoConfirmation.enabled?'켜짐':'꺼짐':'불러오지 못함'}</AdminStatusBadge>{autoOff?<span className="text-xs font-normal text-muted-foreground">신규주문은 직접 발주확인합니다</span>:null}</a>;
  return <section className="flex min-w-0 flex-col gap-6">
    <ShipmentConsoleScreen data={data} actorId={auth.user.id} summaryAside={autoStatus}/>
    {/* key를 두지 않는다 — 저장 뒤 다시 그릴 때 패널이 새로 마운트되면 저장 결과 문구와 포커스가 사라진다. 새 설정은 패널이 맞춘다. */}
    <AutoOrderConfirmPanel initial={autoConfirmation}/>
    {/* 1014-083: 운영에서도 배송 처리 권한자가 사유·확인창·감사 기록을 남기고 강제 배송완료한다(스테이징 전용 테스트 배송완료를 대체). */}
    {hasAdminCapability(auth,'sales.manage')?<ForcedDeliveryPanel/>:null}
  </section>;
}

import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { canAccessAdminScreen, hasAdminCapability, type AdminAccessSource } from './access';
import { adminScreenForPath } from './navigation';
import { getAdminOrderDetail } from './order-detail.server';
import { loadAdminOrderDownloads } from './order-downloads.server';
import { loadAdminOrderProduction } from '@/lib/order-production.server';
import type { AdminOrderDetail } from './order-detail';
import type { AdminOrderDownloads } from './order-downloads';
import type { OrderProduction } from '@/lib/order-production';

export type AdminOrderPreview =
  | { kind: 'loaded'; detail: AdminOrderDetail; production: OrderProduction | null; downloads: AdminOrderDownloads | null; canManage: boolean; canViewCustomer: boolean }
  | { kind: 'forbidden' | 'not_found' | 'error' };

/**
 * 목록 위 주문 상세 팝업(S36-075)이 읽는 값. 전용 상세 라우트(/admin/sales/orders/[orderId])와 같은 로더·같은 화면 권한을 쓴다.
 * 팝업을 읽지 못해도 뒤의 목록은 그대로 열어야 하므로 실패는 값으로 돌려준다.
 */
export async function loadAdminOrderPreview(auth: AdminAccessSource, orderId: string): Promise<AdminOrderPreview> {
  if (!canAccessAdminScreen(auth, adminScreenForPath(`/admin/sales/orders/${orderId}`))) return { kind: 'forbidden' };
  const canManage = hasAdminCapability(auth, 'sales.manage');
  try {
    const [detail, production, downloads] = await Promise.all([getAdminOrderDetail(orderId, canManage), loadAdminOrderProduction(orderId), loadAdminOrderDownloads(orderId)]);
    if (!detail) return { kind: 'not_found' };
    return { kind: 'loaded', detail, production, downloads, canManage, canViewCustomer: hasAdminCapability(auth, 'platform.manage') };
  } catch (error) {
    unstable_rethrow(error);
    return { kind: 'error' };
  }
}

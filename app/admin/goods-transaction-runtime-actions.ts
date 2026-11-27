'use server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { loadGoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';

/**
 * 쇼핑몰 주문 설정(택배 외 수령 방식·착불을 주문서에서 받는 설정)이 켜져 있는지 읽는다. true 켜짐 · false 꺼짐 · null 읽지 못함.
 * 배송정보 관리의 출고지 패널이 열릴 때 읽어, 꺼져 있어 못 쓰는 설정을 고르기 전에 잠그고 이유를 보인다(화면 규칙 5).
 * 그 설정을 켜는 어드민 화면은 없다(개발 담당자가 켠다). 읽기 전용이다.
 */
export async function readGoodsTransactionRuntimeAction(): Promise<boolean | null> {
  if (!await requireAdminActionAccess('/admin/settings/origins', { capability: 'catalog.read' })) return null;
  const mode = await loadGoodsTransactionRuntimeMode();
  return mode === 'transaction' ? true : mode === 'legacy' ? false : null;
}

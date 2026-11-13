import { ReturnAddressesScreen } from '@/components/admin/screens/ReturnAddressesScreen';
import { canAccessAdminScreen } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { RETURN_ADDRESSES_PATH } from '@/lib/admin/return-addresses';
import { loadAdminReturnAddresses } from '@/lib/admin/return-addresses.server';

/* 반품/교환지 주소록(S36-040). 상품 운영자는 조회하고, 등록·수정·삭제는 출고지 설정과 같은 관리자 권한이다. */
export default async function Page() {
  const auth = await requireAdminScreenAccess(RETURN_ADDRESSES_PATH);
  const addresses = await loadAdminReturnAddresses();
  return <ReturnAddressesScreen addresses={addresses} canEdit={canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true })} />;
}

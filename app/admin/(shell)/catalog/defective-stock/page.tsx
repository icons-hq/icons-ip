import { DefectiveStockScreen } from '@/components/admin/screens/DefectiveStockScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { DEFECTIVE_STOCK_PATH } from '@/lib/admin/defective-stock';
import { loadDefectiveStockList } from '@/lib/admin/defective-stock.server';

/* 판매 재고가 아닌 반품 불량 수량을 보는 화면이라 재고 대조와 같은 권한(catalog.manage)으로 연다. */
export default async function Page() {
  await requireAdminScreenAccess(DEFECTIVE_STOCK_PATH, { capability: 'catalog.manage' });
  return <DefectiveStockScreen list={await loadDefectiveStockList()} />;
}

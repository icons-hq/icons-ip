import { useSyncExternalStore } from 'react';
import { PurchaseRestrictionsScreen } from '../../components/admin/screens/PurchaseRestrictionsScreen';
import { normalizePurchaseRestrictionFilters } from '../../lib/admin/purchase-restrictions';
import { restrictionFixtureRows, restrictionVersion, subscribeRestrictions } from './purchase-restriction-actions';
export function PurchaseRestrictionsFixture(){
 useSyncExternalStore(subscribeRestrictions,restrictionVersion,restrictionVersion);
 const filters=normalizePurchaseRestrictionFilters(Object.fromEntries(new URLSearchParams(window.location.search)));
 const rows=restrictionFixtureRows.filter(row=>(filters.state==='all'||(filters.state==='active'?!row.releasedAt:Boolean(row.releasedAt)))
  &&(!filters.query||`${row.nickname} ${row.userId} ${row.maskedEmail} ${row.evidenceOrderId??''}`.includes(filters.query)));
 return <PurchaseRestrictionsScreen data={{filters,rows:rows.slice((filters.page-1)*filters.pageSize,filters.page*filters.pageSize),total:rows.length}}/>;
}

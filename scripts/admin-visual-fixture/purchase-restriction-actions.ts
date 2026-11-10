import { normalizePurchaseRestrictionRegistration, normalizePurchaseRestrictionRelease, type PurchaseRestrictionCustomer, type PurchaseRestrictionRow } from '../../lib/admin/purchase-restrictions';
const buyer = '00000000-0000-4000-8000-000000061402';
const newBuyer = '00000000-0000-4000-8000-000000061403';
export const restrictionFixtureRows: PurchaseRestrictionRow[] = [
 {id:'76000000-0000-4000-8000-000000061402',userId:buyer,nickname:'합성 고객 1',maskedEmail:'f***@example.test',reasonCode:'repeated_purchase',reasonDetail:'합성 데이터: 반복 주문 후 미입금 사례 확인',evidenceOrderId:'70000000-0000-4000-8000-000000061402',createdAt:'2026-10-11T01:10:00Z',createdBy:'검수 담당자',releasedAt:null,releasedBy:null,releaseReason:null},
 {id:'76000000-0000-4000-8000-000000061404',userId:'00000000-0000-4000-8000-000000061404',nickname:'합성 고객 2',maskedEmail:'r***@example.test',reasonCode:'other',reasonDetail:'합성 데이터: 확인 필요',evidenceOrderId:null,createdAt:'2026-10-10T03:10:00Z',createdBy:'검수 담당자',releasedAt:'2026-10-11T07:20:00Z',releasedBy:'검수 담당자',releaseReason:'합성 데이터: 사실관계 확인 후 해제'},
];
let version=0;
const listeners=new Set<()=>void>();
export function subscribeRestrictions(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function restrictionVersion(){return version;}
function changed(){version++;for(const listener of listeners)listener();}
export async function findPurchaseRestrictionCustomerAction(_state:unknown,form:FormData):Promise<{customer?:PurchaseRestrictionCustomer;requestId?:string;error?:string}>{
 const query=String(form.get('customerQuery')??'').trim();
 if(query==='error@example.test')return {error:'고객을 조회하지 못했습니다. 다시 시도해주세요.'};
 if(!['fan@example.test','new@example.test','staff@example.test',buyer,newBuyer].includes(query))return {error:'일치하는 고객을 찾을 수 없습니다.'};
 const id=query==='fan@example.test'||query===buyer?buyer:newBuyer;
 return {customer:{id,nickname:id===buyer?'합성 고객 1':'신규 합성 고객',email:id===buyer?'fan@example.test':query,eligible:query!=='staff@example.test',activeRestrictionId:restrictionFixtureRows.find(row=>row.userId===id&&!row.releasedAt)?.id??null},requestId:crypto.randomUUID()};
}
export async function registerPurchaseRestrictionAction(_state:unknown,form:FormData):Promise<{error?:string;message?:string}>{
 const parsed=normalizePurchaseRestrictionRegistration(form);if('error'in parsed)return{error:parsed.error};
 if(parsed.value.reasonDetail.includes('실패'))return{error:'해당 고객의 주문번호만 근거로 등록할 수 있습니다.'};
 if(restrictionFixtureRows.some(row=>row.userId===parsed.value.userId&&!row.releasedAt))return{error:'이미 구매제한 중인 고객입니다. 목록을 새로 확인해주세요.'};
 restrictionFixtureRows.unshift({id:parsed.value.requestId,userId:parsed.value.userId,nickname:'신규 합성 고객',maskedEmail:'n***@example.test',reasonCode:parsed.value.reasonCode as PurchaseRestrictionRow['reasonCode'],reasonDetail:parsed.value.reasonDetail,evidenceOrderId:parsed.value.evidenceOrderId,createdAt:new Date().toISOString(),createdBy:'검수 담당자',releasedAt:null,releasedBy:null,releaseReason:null});changed();return{message:'신규 굿즈 주문 구매제한을 등록했습니다.'};
}
export async function releasePurchaseRestrictionAction(_state:unknown,form:FormData):Promise<{error?:string;message?:string}>{
 const parsed=normalizePurchaseRestrictionRelease(form);if('error'in parsed)return{error:parsed.error};
 if(parsed.value.reason.includes('실패'))return{error:'구매제한을 처리하지 못했습니다. 목록에서 반영 여부를 확인한 뒤 다시 시도해주세요.'};
 const row=restrictionFixtureRows.find(row=>row.id===parsed.value.restrictionId);if(!row)return{error:'해당 구매제한 기록을 찾을 수 없습니다.'};
 row.releasedAt=new Date().toISOString();row.releasedBy='검수 담당자';row.releaseReason=parsed.value.reason;changed();return{message:'구매제한을 해제했습니다.'};
}

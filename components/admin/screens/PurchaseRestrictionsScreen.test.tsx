import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseRestrictionsScreen } from './PurchaseRestrictionsScreen';
import { PurchaseRestrictionReleaseResult } from './PurchaseRestrictionReleaseGrid';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/purchase-restriction-batch-actions', () => ({ previewPurchaseRestrictionBatchAction: vi.fn(), executePurchaseRestrictionBatchAction: vi.fn(), readPurchaseRestrictionBatchAction: vi.fn() }));
vi.mock('@/app/admin/purchase-restriction-release-actions', () => ({ readRestrictionReleaseAction: vi.fn(), releaseRestrictionsAction: vi.fn() }));
vi.mock('@/app/admin/purchase-restriction-actions',()=>({findPurchaseRestrictionCustomerAction:vi.fn(),registerPurchaseRestrictionAction:vi.fn(),releasePurchaseRestrictionAction:vi.fn()}));
describe('purchase restrictions screen',()=>{
 it('states purchase scope, masks list emails, and preserves release history and reason',()=>{
 const html=renderToStaticMarkup(<PurchaseRestrictionsScreen data={{filters:{query:'',state:'all',page:1,pageSize:50},total:1,rows:[{
 id:'restriction-1',userId:'user-1',nickname:'합성 고객',maskedEmail:'f***@example.test',reasonCode:'other',reasonDetail:'등록 근거',evidenceOrderId:null,
 createdAt:'2026-10-11T00:00:00Z',createdBy:'합성 담당자',releasedAt:'2026-10-12T00:00:00Z',releasedBy:'합성 담당자',releaseReason:'해제 근거',
 }]}}/>);
 expect(html).toContain('신규 상품 주문');expect(html).toContain('기존 주문의 결제·배송·취소·환불은 정상 처리');
 expect(html).toContain('f***@example.test');expect(html).toContain('등록 근거');expect(html).toContain('해제 근거');
 expect(html.match(/name="pageSize"/g)).toHaveLength(1);
 expect(html).not.toContain('name="restrictionId"');
 });
 it('선택 기록 해제 결과를 현재 고객의 다른 제한과 구분한다',()=>{
 const html=renderToStaticMarkup(<PurchaseRestrictionReleaseResult receipt={{id:'89200000-0000-7000-8000-000000000201',reason:'합의 근거',completedAt:'2026-10-13T00:00:00Z',rows:[
 {id:'89200000-0000-7000-8000-000000000101',userId:'89200000-0000-7000-8000-000000000001',outcome:'released',releasedAt:'2026-10-13T00:00:00Z',customerRestricted:true},
 {id:'89200000-0000-7000-8000-000000000102',userId:null,outcome:'not_found',releasedAt:null,customerRestricted:null},
 ]}}/>);
 expect(html).toContain('해제 1건 · 이미 해제 0건 · 기록 없음 1건');
 expect(html).toContain('현재 다른 구매제한 기록이 있습니다.');
 expect(html.match(/고객 확인/g)).toHaveLength(1);
 });
});

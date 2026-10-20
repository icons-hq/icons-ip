import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StoreCreditConsoleScreen } from './StoreCreditConsoleScreen';
import { StoreCreditBatchResult } from './StoreCreditBatchForm';
import { normalizeStoreCreditConsoleFilters, type StoreCreditBatch } from '@/lib/admin/store-credit-console';
vi.mock('@/app/admin/store-credit-console-actions',()=>({executeStoreCreditBatchAction:vi.fn(),findStoreCreditCustomersAction:vi.fn(),importStoreCreditTargetsAction:vi.fn(),previewStoreCreditBatchAction:vi.fn(),readStoreCreditBatchAction:vi.fn()}));
const policy={enabled:false,earnKind:null,earnValue:null,earnMaxPerOrder:null,maxBalance:null,validityDays:null,minUse:null,maxUse:null,restoreGraceDays:null,refundEarnedCreditMode:null,evidence:'',version:1,updatedAt:'2026-10-12T00:00:00Z'};
describe('global credit console',()=>{
 it('keeps policy activation separate and shows one real filter per dimension',()=>{
  const html=renderToStaticMarkup(<StoreCreditConsoleScreen data={{filters:normalizeStoreCreditConsoleFilters({mode:'ledger',kind:'grant',pageSize:'100'}),total:0,rows:[]}} policy={policy}/>);
  expect(html).toContain('적립금 내역');expect(html).toContain('운영 지급');expect(html).toContain('환불 적립금 상계');expect(html.match(/<select[^>]*name="kind"/g)).toHaveLength(1);expect(html.match(/name="pageSize"/g)).toHaveLength(1);expect(html).not.toContain('적립금 지급 등록');
  const registration=renderToStaticMarkup(<StoreCreditConsoleScreen data={{filters:normalizeStoreCreditConsoleFilters({}),total:0,rows:[]}} policy={policy}/>);
  expect(registration).toContain('정책이 비활성');expect(registration).toContain('fieldset disabled');
 });
 it('never labels a failed all-or-nothing grant as issued funds',()=>{
  const batch:StoreCreditBatch={id:'11111111-1111-4111-8111-111111111111',status:'failed',purpose:'general',reason:'합성',amount:1000,expiresAt:'2026-12-01T00:00:00Z',count:1,invalidCount:0,gross:1000,offset:0,net:1000,rows:[{target:'fan@example.test',userId:null,nickname:'합성',error:null,balance:{available:0,reserved:0,debt:0},offset:0}],createdAt:'2026-10-12T00:00:00Z',error:'store_credit_balance_conflict',completedCount:0,failedCount:1,finishedAt:'2026-10-12T00:01:00Z'};
  const html=renderToStaticMarkup(<StoreCreditBatchResult batch={batch}/>);expect(html).toContain('성공 0명');expect(html).toContain('총 발급 예정액');expect(html).toContain('미지급');
  const invalid=renderToStaticMarkup(<StoreCreditBatchResult batch={{...batch,status:'invalid',invalidCount:1,rows:[{...batch.rows[0],error:'customer_not_found'}]}}/>);
  expect(invalid).not.toContain('총 발급 예정액');expect(invalid).toContain('모든 대상의 검증을 통과하면');
 });
});

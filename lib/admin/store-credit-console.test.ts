import { describe, expect, it } from 'vitest';
import { normalizeStoreCreditConsoleFilters, parseStoreCreditBatch, parseStoreCreditConsoleData, parseStoreCreditTargets, storeCreditConsoleHref } from './store-credit-console';
export const BATCH_FIXTURE = { id:'11111111-1111-4111-8111-111111111111',status:'prepared',purpose:'promotion',reason:'합성 지급',amount:1000,expiresAt:'2026-12-01T00:00:00Z',count:1,invalidCount:0,gross:1000,offset:300,net:700,rows:[{target:'fan@example.test',userId:'22222222-2222-4222-8222-222222222222',nickname:'합성 고객',error:null,balance:{available:100,reserved:0,debt:300},offset:300}],createdAt:'2026-10-12T00:00:00Z',error:null };
describe('store credit console contract',()=>{
 it('deduplicates exact identifiers without losing financial recipient limits',()=>{
  expect(parseStoreCreditTargets('FAN@example.test\nfan@example.test')).toEqual({targets:['fan@example.test'],duplicates:1});
  expect(parseStoreCreditTargets(Array.from({length:1000},(_,i)=>`fan${i}@example.test`).join('\n')).targets).toHaveLength(1000);
  expect(()=>parseStoreCreditTargets(Array.from({length:1001},(_,i)=>`fan${i}@example.test`).join('\n'))).toThrow('최대 1,000명');
  expect(()=>parseStoreCreditTargets('고객이름')).toThrow();expect(()=>parseStoreCreditTargets('')).toThrow();
 });
 it('keeps ledger and grant filters distinct and bounded',()=>{
  const filters=normalizeStoreCreditConsoleFilters({mode:'ledger',kind:'failed',from:'2026-02-30',to:'2026-10-01',page:'-1',pageSize:'500'});
  expect(filters).toMatchObject({kind:'',from:'',page:1,pageSize:50});
  expect(storeCreditConsoleHref({...filters,kind:'debt_offset',page:2,pageSize:100})).toContain('mode=ledger');
  expect(storeCreditConsoleHref({...filters,kind:'debt_offset',page:2,pageSize:100})).toContain('kind=debt_offset');
 });
 it('requires count, gross, offset and net to agree before showing an approval',()=>{
  expect(parseStoreCreditBatch(BATCH_FIXTURE)).not.toBeNull();
  for(const patch of [{gross:900},{net:800},{count:2},{rows:[]},{amount:-1},{expiresAt:'bad'},{status:'completed'},{status:'failed',completedCount:1,failedCount:0}]) expect(parseStoreCreditBatch({...BATCH_FIXTURE,...patch})).toBeNull();
  expect(parseStoreCreditBatch({...BATCH_FIXTURE,status:'completed',completedCount:1,failedCount:0,finishedAt:'2026-10-12T00:01:00Z'})).not.toBeNull();
 });
 it('rejects malformed global ledger rows',()=>{
  const filters=normalizeStoreCreditConsoleFilters({});expect(parseStoreCreditConsoleData({total:0,rows:[]},filters)).not.toBeNull();
  expect(parseStoreCreditConsoleData({total:1,rows:[{id:'x'}]},filters)).toBeNull();
 });
});

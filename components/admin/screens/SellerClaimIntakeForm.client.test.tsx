import { isValidElement,type ReactElement,type ReactNode } from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { SellerClaimIntakeForm } from './SellerClaimIntakeForm';
import { sellerClaimContextFixture, sellerClaimReceiptFixture } from '@/lib/admin/seller-claim-intake.fixture';
import { parseSellerClaimInput, type SellerClaimInput } from '@/lib/admin/seller-claim-intake';
const hooks=vi.hoisted(()=>({refs:[] as {current:unknown}[],refIndex:0,state:[] as unknown[],stateIndex:0}));
const mocks=vi.hoisted(()=>({submit:vi.fn(),read:vi.fn(),refresh:vi.fn(),close:vi.fn()}));
vi.mock('react',async()=>{const actual=await vi.importActual<typeof import('react')>('react');return {...actual,useEffect:()=>undefined,useRef:(initial:unknown)=>{const index=hooks.refIndex++;hooks.refs[index]??={current:initial};return hooks.refs[index];},useState:(initial:unknown)=>{const index=hooks.stateIndex++;if(!(index in hooks.state))hooks.state[index]=typeof initial==='function'?(initial as ()=>unknown)():initial;return [hooks.state[index],(next:unknown)=>{hooks.state[index]=typeof next==='function'?(next as (value:unknown)=>unknown)(hooks.state[index]):next;}];}};});
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('@/app/admin/seller-claim-intake-actions',()=>({loadSellerClaimContextAction:vi.fn(),readSellerClaimIntakeAction:mocks.read,submitSellerClaimIntakeAction:mocks.submit}));
type Element=ReactElement<{children?:ReactNode;id?:string;disabled?:boolean;onClick?:()=>void;onSubmit?:(event:unknown)=>void;onChange?:(event:unknown)=>void}>;
function elements(node:ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(elements);if(!isValidElement(node))return [];return [node as Element,...elements((node.props as {children?:ReactNode}).children)];}
function text(node:ReactNode):string{if(Array.isArray(node))return node.map(text).join('');if(isValidElement(node))return text((node.props as {children?:ReactNode}).children);return typeof node==='string'||typeof node==='number'?String(node):'';}
function render(){hooks.refIndex=0;hooks.stateIndex=0;return SellerClaimIntakeForm({context:sellerClaimContextFixture,carriers:sellerClaimContextFixture.carriers,onClose:mocks.close});}
async function settle(){for(let n=0;n<8;n++)await Promise.resolve();}
function change(id:string,value:string|boolean){const field=elements(render()).find(element=>element.props.id===id);if(!field)throw new Error(`Missing ${id}`);field.props.onChange?.({target:{value,checked:value}});}
function click(label:string){const button=elements(render()).find(element=>element.type==='button'&&text(element.props.children)===label);if(!button)throw new Error(`Missing ${label}`);button.props.onClick?.();}
function fill(){
 change('seller-claim-reason','최초 접수 사유');change('seller-claim-customer-time','2026-10-13T08:30');change('seller-claim-evidence','최초 고객 합의 근거');
 const confirmation=elements(render()).find(element=>element.type==='input'&&!element.props.id);
 confirmation?.props.onChange?.({target:{checked:true}});
}
function submit(){elements(render()).find(element=>element.type==='form')!.props.onSubmit?.({preventDefault:()=>{}});}
function receiptFor(input:SellerClaimInput){
 const parsed=parseSellerClaimInput(input);if(!parsed.ok)throw new Error(parsed.error);
 return {...sellerClaimReceiptFixture,...parsed.payload,requestId:parsed.requestId,claimId:parsed.requestId,
  collections:parsed.payload.collections.map((row,index)=>({...sellerClaimReceiptFixture.collections[index],...row}))};
}
describe('seller claim uncertain request identity',()=>{
 beforeEach(()=>{hooks.refs=[];hooks.state=[];vi.clearAllMocks();mocks.submit.mockResolvedValue({error:'응답을 확인하지 못했습니다.',uncertain:true});mocks.read.mockResolvedValue({receipt:null});});
 it('keeps the dispatched payload locked when readback has no receipt yet',async()=>{
  fill();submit();await settle();
  expect(mocks.submit).toHaveBeenCalledTimes(1);const original=structuredClone(mocks.submit.mock.calls[0][0]);
  click('같은 요청의 저장 결과 확인');await settle();
  expect(mocks.read).toHaveBeenCalledWith(original);
  expect(elements(render()).filter(element=>element.type==='fieldset').every(element=>element.props.disabled)).toBe(true);
  expect(text(render())).toContain('같은 내용으로 다시 접수');
  // A stale input event cannot replace the payload frozen at first dispatch.
  change('seller-claim-reason','다른 내용으로 바꾸려는 늦은 입력');
  click('같은 내용으로 다시 접수');await settle();expect(mocks.submit.mock.calls[1][0]).toEqual(original);
 });
 it('ignores a stale submit and field event while the first request is pending',async()=>{
  let resolve!:(value:unknown)=>void;mocks.submit.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  fill();const form=elements(render()).find(element=>element.type==='form')!;
  form.props.onSubmit?.({preventDefault:()=>{}});form.props.onSubmit?.({preventDefault:()=>{}});
  change('seller-claim-source','email');click('닫기');expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  resolve({error:'네트워크 결과 미확인',uncertain:true});await settle();
  click('같은 내용으로 다시 접수');await settle();expect(mocks.submit.mock.calls[1][0].source).toBe('phone');
 });
 it('keeps unresolved input locked even if an identical retry is rejected',async()=>{
  fill();submit();await settle();mocks.submit.mockResolvedValueOnce({error:'현재 상태에서는 접수할 수 없습니다.',uncertain:false});
  click('같은 내용으로 다시 접수');await settle();
  expect(elements(render()).filter(element=>element.type==='fieldset').every(element=>element.props.disabled)).toBe(true);
  click('닫기');expect(mocks.close).not.toHaveBeenCalled();
 });
 it('rejects a mismatched receipt and accepts the late exact receipt without resubmitting',async()=>{
  fill();change('seller-claim-bankName','합성은행');change('seller-claim-accountNumber','000000001234');change('seller-claim-accountHolder','합성 고객');
  submit();await settle();const original=structuredClone(mocks.submit.mock.calls[0][0]);
  mocks.read.mockResolvedValueOnce({receipt:{...receiptFor(original),agreementEvidence:'다른 합의'}});
  click('같은 요청의 저장 결과 확인');await settle();expect(mocks.refresh).not.toHaveBeenCalled();expect(text(render())).toContain('일치하지 않습니다');
  mocks.read.mockResolvedValueOnce({receipt:receiptFor(original)});click('같은 요청의 저장 결과 확인');await settle();
  expect(text(render())).toContain('요청을 저장했습니다');expect(mocks.submit).toHaveBeenCalledTimes(1);expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect((hooks.state[0] as SellerClaimInput).refundAccount).toBeNull();
  expect(hooks.refs.every(ref=>!(ref.current&&typeof ref.current==='object'&&'refundAccount' in ref.current))).toBe(true);
  click('닫기');expect(mocks.close).toHaveBeenCalledTimes(1);
 });
 it('uses a fresh key after a definite first-attempt rejection',async()=>{
  mocks.submit.mockResolvedValueOnce({error:'입력 확인 필요',uncertain:false});fill();submit();await settle();
  const first=mocks.submit.mock.calls[0][0];change('seller-claim-reason','수정한 접수 사유');submit();await settle();
  expect(mocks.submit.mock.calls[1][0].requestId).not.toBe(first.requestId);expect(mocks.submit.mock.calls[1][0].reason).toBe('수정한 접수 사유');
 });
});

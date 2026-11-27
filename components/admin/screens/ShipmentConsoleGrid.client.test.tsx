import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler } from '@/lib/admin/confirm';
import { adminBulkOrderConfirmRequest } from '@/lib/admin/order-confirmations';
import type { ShipmentConsoleRow } from '@/lib/admin/shipment-dispatch';
const mocks = vi.hoisted(() => ({ complete: vi.fn(), export: vi.fn(), exportOrigin: vi.fn(), gaps: vi.fn(), originGaps: vi.fn(), refresh: vi.fn(), states: [] as unknown[], index: 0, work: [] as Promise<void>[], effects: [] as (() => void | (() => void))[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock('@/app/admin/order-actions', () => ({ bulkConfirmAdminOrdersAction: vi.fn(), saveAdminOrderDispatchDelayAction: vi.fn() }));
vi.mock('@/app/admin/shipment-actions', () => ({ completeShipmentsAction: mocks.complete, exportShipmentsAction: mocks.export, exportPendingOriginShipmentsAction: mocks.exportOrigin, shipmentBarcodeGapsAction: mocks.gaps, originBarcodeGapsAction: mocks.originGaps }));
vi.mock('./ShipmentPackPanel', () => ({ ShipmentPackPanel: () => null }));
vi.mock('./OrderDelayNoticePanel', () => ({ OrderDelayNoticePanel: () => null }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
  useTransition: () => [false, (work: () => Promise<void>) => { mocks.work.push(work()); }],
  // 렌더를 함수 호출로 흉내 내므로 effect는 모아 두고 테스트가 필요할 때만 실행한다.
  useEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect); },
}));
import { ConsoleGrid } from '@/components/admin/console';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { bulkConfirmAdminOrdersAction } from '@/app/admin/order-actions';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { DispatchDelayBulkNote } from './DispatchDelayBulkNote';
import { GoodChoiceCard } from '@/components/admin/GoodEditorParts';
import { ShipmentConsoleGrid } from './ShipmentConsoleGrid';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
type Element = ReactElement<Record<string, unknown>>;
/* 처리 막대·팝업은 kit 버튼·셀렉트·입력(ADR-0028)이다 — 렌더 전 요소 트리에서는 그 부품 자체가 요소 종류다. */
const isButton = (node: Element) => node.type === 'button' || node.type === Button;
const isSelect = (node: Element) => node.type === 'select' || node.type === NativeSelect;
const isInput = (node: Element) => node.type === 'input' || node.type === Input;
const ids = ['60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000003'];
const row: ShipmentConsoleRow = { id: ids[0], orderId: ids[0], originId: 'origin', originName: '합성 출고지', status: 'shipping', createdAt: '2026-10-16T00:00:00Z', confirmedAt: null, buyerName: '합성 구매자', recipientName: '합성 수령인', total: 10000, paymentMethod: 'card', shippingFee: 0, carrier: 'hanjin', trackingNumber: 'TEST12345', shippedAt: '2026-10-16T00:00:00Z', deliveredAt: null, exportedAt: null, updatedAt: '2026-10-16T00:00:00Z', delayReason: null, expectedShipDate: null, items: [], pack: { id: ids[2], revision: 1, count: 2, shipmentIds: ids.slice(0, 2), collectFee: 0, canRelease: false } };
const props: Parameters<typeof ShipmentConsoleGrid>[0] = { rows: [row, { ...row, id: ids[1] }, { ...row, id: ids[2], pack: null }], columns: [], gridRows: [], tab: 'transit', currentHref: '/admin/sales/shipping', readyHref: '/admin/sales/dispatch' };
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render() { mocks.index = 0; return ShipmentConsoleGrid(props); }
function button(label: string) { const result = nodes(render()).find(node => isButton(node) && text(node.props.children as ReactNode) === label); if (!result) throw new Error(`Missing button: ${label}`); return result; }
function click(label: string) { const element = button(label); (element.props.onClick as () => void)(); }
function select(selected: string[]) { const grid = nodes(render()).find(node => node.type === ConsoleGrid)!; (grid.props.onSelectionChange as (ids: string[]) => void)(selected); }
/* 배송완료 창의 '도착 일시' 선택 카드(H-01): now = 지금 도착으로 기록, carrier = 택배사 조회의 도착 일시 넣기. */
function arrivalCard(tree: ReactNode, value: 'now' | 'carrier') { return nodes(tree).find(node => node.type === GoodChoiceCard && node.props.value === value)!; }
function chooseArrival(tree: ReactNode, value: 'now' | 'carrier') { (arrivalCard(tree, value).props.onChange as () => void)(); }
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.index = 0; mocks.work = []; mocks.effects = []; mocks.complete.mockResolvedValue({ message: '2건 배송완료', failed: [] }); });
afterEach(() => vi.unstubAllGlobals());
/* H-01: "확인했습니다" 체크는 서버로 가지 않던 화면 전용 브레이크라 없앴다. 창이 건수(합포장 포함)를 말하고 버튼이 그 건수로 실행한다. */
it('선택한 합포장의 보이지 않는 구성 건을 포함한 건수를 창과 버튼에 보이고, 확인 체크 없이 그 묶음만 처리한다', async () => {
  select([ids[0]]); click('선택 배송완료');
  expect(text(render())).toContain('총 2건');
  expect(nodes(render()).some(node => node.type === 'input' && node.props.type === 'checkbox')).toBe(false);
  /* 기본은 '지금 도착으로 기록'이고 일시 칸은 열리지 않는다. 돈·알림 결과 한 줄만 남는다. */
  expect(arrivalCard(render(), 'now').props.checked).toBe(true);
  expect(nodes(render()).some(node => isInput(node) && node.props.name === 'deliveredAt')).toBe(false);
  expect(text(render())).toContain('청약철회·거래확정 기한을 이 일시부터 세고, 주문이 배송완료가 되면 고객에게 앱 알림이 갑니다.');
  expect(button('2건 배송완료 처리').props.disabled).toBe(false);
  expect(mocks.complete).not.toHaveBeenCalled();
  // A background selection change cannot replace the batch the operator reviewed.
  select([ids[2]]); click('2건 배송완료 처리'); await Promise.all(mocks.work);
  expect(mocks.complete).toHaveBeenCalledOnce(); expect(mocks.complete).toHaveBeenCalledWith([ids[0]], { deliveredAt: null, reason: '' });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(nodes(render()).some(node => node.type === CustomerServiceDialog)).toBe(false);
});
it('같은 합포장의 두 줄을 골라도 중복 계산하지 않으며, 돌아갔다 다시 열면 도착 일시 선택이 처음으로 돌아온다', () => {
  select(ids.slice(0, 2)); click('선택 배송완료');
  expect(text(render())).not.toContain('총 4건'); expect(button('2건 배송완료 처리')).toBeTruthy();
  /* 도착 일시를 넣기로 하면 칸이 열리고, 비어 있는 동안에는 버튼이 잠기며 이유를 말한다. */
  chooseArrival(render(), 'carrier');
  expect(nodes(render()).some(node => isInput(node) && node.props.name === 'deliveredAt')).toBe(true);
  expect(button('2건 배송완료 처리').props.disabled).toBe(true);
  expect(text(render())).toContain('도착 일시를 넣으면 누를 수 있습니다.');
  click('2건 배송완료 처리'); expect(mocks.complete).not.toHaveBeenCalled();
  click('돌아가기'); expect(mocks.complete).not.toHaveBeenCalled();
  click('선택 배송완료');
  expect(arrivalCard(render(), 'now').props.checked).toBe(true); expect(button('2건 배송완료 처리').props.disabled).toBe(false);
});
it('김포·남양주에 엑스스퀘어 표준 양식을 기본으로 보내고 기존 창고 양식을 명시적으로 선택할 수 있다', async () => {
  const readyProps = { ...props, tab: 'ready' as const, rows: props.rows.map(value => ({ ...value, status: 'ready' as const })) };
  function ready() { mocks.index = 0; return ShipmentConsoleGrid(readyProps); }
  mocks.export.mockResolvedValue({ error: '합성 응답' });
  const grid = nodes(ready()).find(node => node.type === ConsoleGrid)!;
  (grid.props.onSelectionChange as (ids: string[]) => void)([ids[0]]);
  function exportFile() {
    const target = nodes(ready()).find(node => isButton(node) && text(node.props.children as ReactNode) === '출고지시 내려받기')!;
    (target.props.onClick as () => void)();
  }
  expect(nodes(ready()).find(node => isSelect(node))!.props.value).toBe('auto');
  exportFile();
  expect(mocks.export).not.toHaveBeenCalled();
  expect(text(ready())).toContain('비밀번호 확인');
  for (const input of nodes(ready()).filter(node => isInput(node) && node.props.type === 'password')) {
    expect(input.props).toMatchObject({ minLength: 4, maxLength: 16 });
  }
  const formData = new FormData();
  formData.set('password', '1234'); formData.set('passwordConfirmation', '1234');
  vi.stubGlobal('FormData', vi.fn(function() { return formData; }));
  const form = nodes(ready()).find(node => node.type === 'form')!;
  const reset = vi.fn();
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn(), currentTarget: { reset } });
  await Promise.all(mocks.work);
  expect(reset).toHaveBeenCalledOnce();
  expect(formData.has('password')).toBe(false);
  expect(mocks.export).toHaveBeenLastCalledWith([ids[0]], 'xlsx', 'smartstore', { password: '1234', passwordConfirmation: '1234' });
  const cancel = nodes(ready()).find(node => isButton(node) && text(node.props.children as ReactNode) === '돌아가기')!;
  (cancel.props.onClick as () => void)();
  const layout = nodes(ready()).find(node => isSelect(node))!;
  (layout.props.onChange as (event: unknown) => void)({ target: { value: 'warehouse' } });
  exportFile(); await Promise.all(mocks.work);
  expect(mocks.export).toHaveBeenLastCalledWith([ids[0]], 'xlsx', 'warehouse', undefined);
});

it('남양주(서원) 출고지는 원형 송장양식이 기본이고, 엑스스퀘어 표준 양식을 고르면 출고지 전체 다운로드도 암호화를 거친다',async()=>{
 const origin={id:'00000000-0000-4000-8000-000000042202',name:'남양주',template:'seowon_xlsx',active:true};
 const readyProps={...props,tab:'ready' as const,rows:[],origins:[origin]};
 function ready(){mocks.index=0;return ShipmentConsoleGrid(readyProps);}
 function clickOrigin(){const target=nodes(ready()).find(node=>isButton(node)&&text(node.props.children as ReactNode).startsWith('남양주 출고지시 내려받기'))!;(target.props.onClick as ()=>void)();}
 mocks.exportOrigin.mockResolvedValue({error:'합성 재시도 안내'});
 expect(nodes(ready()).find(node=>isSelect(node))!.props.value).toBe('auto');
 // 버튼이 실제로 받을 양식을 적는다.
 expect(text(ready())).toContain('남양주 출고지시 내려받기 (서원 송장양식)');
 clickOrigin();await Promise.all(mocks.work);
 expect(mocks.exportOrigin).toHaveBeenLastCalledWith(origin.id,'xlsx','warehouse',undefined);
 const layout=nodes(ready()).find(node=>isSelect(node))!;(layout.props.onChange as (event:unknown)=>void)({target:{value:'smartstore'}});
 expect(text(ready())).toContain('남양주 출고지시 내려받기 (엑스스퀘어 표준 양식)');
 clickOrigin();expect(text(ready())).toContain('남양주의 출고지시 보내기 전인 발송 대기 건');
 const input=new FormData();input.set('password','1234');input.set('passwordConfirmation','1234');
 vi.stubGlobal('FormData',vi.fn(function(){return input;}));
 const form=nodes(ready()).find(node=>node.type==='form')!,reset=vi.fn();
 (form.props.onSubmit as (event:unknown)=>void)({preventDefault:vi.fn(),currentTarget:{reset}});await Promise.all(mocks.work);
 expect(mocks.exportOrigin).toHaveBeenLastCalledWith(origin.id,'xlsx','smartstore',{password:'1234',passwordConfirmation:'1234'});
 expect(mocks.export).not.toHaveBeenCalled();expect(reset).toHaveBeenCalledOnce();expect(input.has('password')).toBe(false);
 expect(text(ready())).toContain('합성 재시도 안내');expect(text(ready())).toContain('비밀번호 확인');
});
it('CSV를 골라도 남양주(서원) 송장양식은 XLSX로 받는다고 알리고, 엑스스퀘어 표준 양식을 고르면 그 안내를 거둔다',()=>{
 const origin={id:'00000000-0000-4000-8000-000000042202',name:'남양주',template:'seowon_xlsx',active:true};
 const readyRow={...row,status:'ready' as const,pack:null,originId:origin.id};
 for(const rows of [[],[readyRow]]){
  mocks.states=[];
  const ready=()=>{mocks.index=0;return ShipmentConsoleGrid({...props,tab:'ready',rows,origins:[origin]});};
  const selects=()=>nodes(ready()).filter(node=>isSelect(node));
  expect(text(ready())).not.toContain('XLSX로 받습니다');
  (selects()[1].props.onChange as (event:unknown)=>void)({target:{value:'csv'}});
  expect(text(ready())).toContain('CSV를 골라도 남양주(서원) 송장양식은 XLSX로 받습니다.');
  (selects()[0].props.onChange as (event:unknown)=>void)({target:{value:'smartstore'}});
  expect(text(ready())).not.toContain('XLSX로 받습니다');
 }
});
it('김포 등 다른 출고지와 섞이면 엑스스퀘어 표준 양식이 기본이다',()=>{
 const origins=[{id:'seowon',name:'남양주',template:'seowon_xlsx',active:true},{id:'gimpo',name:'김포',template:'wms_csv',active:true}];
 const readyRow={...row,status:'ready' as const,pack:null};
 function ready(rows:ShipmentConsoleRow[]){mocks.index=0;return ShipmentConsoleGrid({...props,tab:'ready',origins,rows});}
 const gimpo=[{...readyRow,originId:'gimpo'}];
 let grid=nodes(ready(gimpo)).find(node=>node.type===ConsoleGrid)!;(grid.props.onSelectionChange as (ids:string[])=>void)([ids[0]]);
 /* 드롭다운 항목은 '출고지 기본 양식'뿐이고, 실제로 받을 양식은 그 옆의 결과로 보인다(S-06). */
 expect(text(ready(gimpo))).toContain('→ 엑스스퀘어 표준 양식');
 expect(text(ready(gimpo))).not.toContain('남양주만 고르면');
 mocks.states=[];
 const seowonOnly=[{...readyRow,originId:'seowon'}];
 grid=nodes(ready(seowonOnly)).find(node=>node.type===ConsoleGrid)!;(grid.props.onSelectionChange as (ids:string[])=>void)([ids[0]]);
 expect(text(ready(seowonOnly))).toContain('→ 서원 송장양식');
 expect(nodes(ready(seowonOnly)).find(node=>isSelect(node))!.props.value).toBe('auto');
 // 버튼마다 실제 양식을 적는다.
 expect(text(ready(seowonOnly))).toContain('김포 출고지시 내려받기 (엑스스퀘어 표준 양식)');
});
it('출고지시를 이미 보낸 선택 건은 두 번 출고될 수 있다는 확인창을 거쳐야 내려받기 단계로 간다',async()=>{
 const readyProps={...props,tab:'ready' as const,rows:[{...row,status:'ready' as const,exportedAt:'2026-10-20T00:00:00Z'}]};
 function ready(){mocks.index=0;return ShipmentConsoleGrid(readyProps);}
 const confirm=vi.fn(()=>false);setAdminConfirmHandler(async request=>(confirm as unknown as (message: string) => boolean)(`${request.title} ${request.message} [${request.confirmLabel}/${request.cancelLabel}]`));
 const grid=nodes(ready()).find(node=>node.type===ConsoleGrid)!;(grid.props.onSelectionChange as (ids:string[])=>void)([ids[0]]);
 const trigger=nodes(ready()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='출고지시 내려받기')!;
 await (trigger.props.onClick as ()=>Promise<void>)();expect(confirm).toHaveBeenCalledOnce();
 expect(confirm).toHaveBeenCalledWith('출고지시를 이미 보낸 배송 건 1건을 다시 내려받을까요? 창고는 같은 건을 두 번 받으면 걸러내지 못해 두 번 출고할 수 있습니다. [다시 내려받기/돌아가기]');
 expect(text(ready())).not.toContain('비밀번호 확인');expect(mocks.export).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);await (trigger.props.onClick as ()=>Promise<void>)();expect(text(ready())).toContain('비밀번호 확인');
});

/* 1027T-046 통합: ICONS 표준 양식도 출고지와 관계없이 모든 행에 바코드 칸이 있어, 고른 양식 기준으로 센다(표준 양식은 admin_smartstore_shipment_barcode_gaps). */
it('고른 양식(엑스스퀘어 표준·기존 창고 양식)의 바코드 칸 기준으로 내보내기 전에 바코드가 없는 옵션 수를 알리고 막지는 않는다',async()=>{
 const seowon={id:'00000000-0000-4000-8000-000000042202',name:'남양주',template:'seowon_xlsx',active:true};
 const gimpo={id:'00000000-0000-4000-8000-000000042201',name:'김포',template:'wms_csv',active:true};
 const rows=[{...row,status:'ready' as const,pack:null,originId:seowon.id},{...row,id:ids[1],status:'ready' as const,pack:null,originId:gimpo.id}];
 const ready=()=>{mocks.index=0;mocks.effects=[];return ShipmentConsoleGrid({...props,tab:'ready',rows,origins:[seowon,gimpo]});};
 async function settle(){for(const effect of mocks.effects)effect();await Promise.all([...mocks.gaps.mock.results,...mocks.originGaps.mock.results].map(result=>result.value));await new Promise(resolve=>setTimeout(resolve,0));}
 mocks.gaps.mockResolvedValue(2);mocks.originGaps.mockImplementation(async(id:string)=>id===seowon.id?1:5);
 ready();await settle();
 // 출고지 전체 내려받기 버튼: 출고지마다 그 출고지의 기본 양식으로 센다(남양주=서원 송장양식, 김포=ICONS 표준 양식).
 expect(mocks.originGaps.mock.calls).toEqual([[seowon.id,'warehouse'],[gimpo.id,'smartstore']]);
 // 출고지 경고는 다음 파일 한 묶음이 아니라 그 출고지의 출고지시 보내기 전인 발송 대기 건 전체를 센다(리뷰 M27-SHIP-2).
 expect(text(ready())).toContain('남양주 출고지시 보내기 전 건: 바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.');
 expect(text(ready())).toContain('김포 출고지시 보내기 전 건: 바코드가 없는 옵션 5개 — 파일의 바코드 칸이 비어 있습니다.');
 expect(text(ready())).not.toContain('남양주 새 출고지시:');
 const grid=nodes(ready()).find(node=>node.type===ConsoleGrid)!;(grid.props.onSelectionChange as (ids:string[])=>void)(ids.slice(0,2));
 ready();await settle();
 // 섞인 선택은 기본이 ICONS 표준 양식이고, 표준 양식은 모든 행에 바코드 칸이 있어 선택 전체를 그 양식 기준으로 센다.
 expect(mocks.gaps).toHaveBeenLastCalledWith([ids[0],ids[1]],'smartstore');
 expect(text(ready())).toContain('바코드가 없는 옵션 2개 — 파일의 바코드 칸이 비어 있습니다.');
 // 기존 창고 양식을 고르면 같은 선택을 그 양식 기준으로 다시 센다. 바코드 칸이 있는 출고지(서원·김포)의 건만 세는 판정은 서버(admin_shipment_barcode_gaps)가 한다.
 mocks.gaps.mockResolvedValue(1);
 const layout=nodes(ready()).find(node=>isSelect(node))!;(layout.props.onChange as (event:unknown)=>void)({target:{value:'warehouse'}});
 ready();await settle();
 expect(mocks.gaps).toHaveBeenLastCalledWith([ids[0],ids[1]],'warehouse');
 expect(text(ready())).toContain('바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.');
 const exportButton=nodes(ready()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='출고지시 내려받기')!;
 expect(exportButton.props.disabled).toBe(false);
});

it('방금 발주확인해 다른 페이지로 밀린 배송 건도 바코드 경고 대상에 넣고, 바코드 칸 판정은 서버에 맡긴다',async()=>{
 // 리뷰 T4-R23-2: 경고 대상을 현재 페이지 행(rows)으로 거르면, 내보내기에는 들어가는 화면 밖 확인 묶음이 경고에서 빠진다.
 const seowon={id:'00000000-0000-4000-8000-000000042202',name:'남양주',template:'seowon_xlsx',active:true};
 const confirmedId='60000000-0000-4000-8000-000000000009';
 const readyHref='/admin/sales/dispatch?tab=ready&origin=namyangju';
 const base={...props,origins:[seowon],originId:seowon.id,readyHref};
 vi.mocked(bulkConfirmAdminOrdersAction).mockResolvedValue({message:'1건 발주확인했습니다.',confirmedOrderIds:[confirmedId]} as never);
 const fresh=()=>{mocks.index=0;mocks.effects=[];return ShipmentConsoleGrid({...base,tab:'new',currentHref:'/admin/sales/dispatch?tab=new',rows:[{...row,id:confirmedId,orderId:confirmedId,status:'confirmed' as never,pack:null,originId:seowon.id}]});};
 (nodes(fresh()).find(node=>node.type===ConsoleGrid)!.props.onSelectionChange as (ids:string[])=>void)([confirmedId]);
 const confirm=nodes(fresh()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='선택 주문 1건 발주확인')!;
 setAdminConfirmHandler(async()=>true);
 await (confirm.props.onClick as ()=>Promise<void>)();await Promise.all(mocks.work);
 // 발송 대기 탭의 첫 페이지는 앞선 대기 건으로 차 있어 방금 확인한 배송 건이 보이지 않는다.
 const backlog={...row,id:ids[2],status:'ready' as const,pack:null,originId:seowon.id};
 const ready=()=>{mocks.index=0;mocks.effects=[];return ShipmentConsoleGrid({...base,tab:'ready',currentHref:readyHref,rows:[backlog]});};
 expect(text(ready())).toContain('방금 발주확인한 다른 페이지의 1건 포함');
 mocks.gaps.mockResolvedValue(1);mocks.originGaps.mockResolvedValue(0);
 for(const effect of mocks.effects)effect();
 await Promise.all([...mocks.gaps.mock.results,...mocks.originGaps.mock.results].map(result=>result.value));await new Promise(resolve=>setTimeout(resolve,0));
 expect(mocks.gaps).toHaveBeenLastCalledWith([confirmedId],'warehouse');
 expect(text(ready())).toContain('바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.');
});

/* 코드 리뷰: 일부만 처리된 결과가 초록 완료 상자로 나왔다. 서버 문구는 그대로 두고 주의 상자로 그린다. */
it('일부 주문만 발주확인됐거나 일부 배송완료가 실패하면 주의 상자로, 모두 끝나면 완료 상자로 알린다',async()=>{
 const [first,second]=[ids[0],ids[1]];
 setAdminConfirmHandler(async()=>true);
 const notice=(render:()=>ReturnType<typeof ShipmentConsoleGrid>)=>nodes(render()).find(node=>node.type===AdminNotice&&node.props.role==='status');
 const fresh=()=>{mocks.index=0;return ShipmentConsoleGrid({...props,tab:'new',rows:[{...row,id:first,orderId:first,pack:null},{...row,id:second,orderId:second,pack:null}]});};
 (nodes(fresh()).find(node=>node.type===ConsoleGrid)!.props.onSelectionChange as (value:string[])=>void)([first,second]);
 vi.mocked(bulkConfirmAdminOrdersAction).mockResolvedValue({message:'1건을 발주확인했습니다. 처리하지 못한 1건: 00000002 — 주문 상세에서 취소 요청 여부와 현재 상태를 확인해주세요.',confirmedOrderIds:[first]} as never);
 await (nodes(fresh()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='선택 주문 2건 발주확인')!.props.onClick as ()=>Promise<void>)();await Promise.all(mocks.work);
 expect(notice(fresh)?.props.tone).toBe('warning');
 expect(text(notice(fresh)?.props.children as ReactNode)).toContain('처리하지 못한 1건');
 mocks.states=[];mocks.work=[];
 vi.mocked(bulkConfirmAdminOrdersAction).mockResolvedValue({message:'2건을 발주확인했습니다.',confirmedOrderIds:[first,second]} as never);
 (nodes(fresh()).find(node=>node.type===ConsoleGrid)!.props.onSelectionChange as (value:string[])=>void)([first,second]);
 await (nodes(fresh()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='선택 주문 2건 발주확인')!.props.onClick as ()=>Promise<void>)();await Promise.all(mocks.work);
 expect(notice(fresh)?.props.tone).toBe('success');
 mocks.states=[];mocks.work=[];
 mocks.complete.mockResolvedValue({message:'1건을 배송완료로 변경했습니다.',failed:[{id:ids[2],reason:'배송 건을 찾을 수 없습니다.'}]});
 select([ids[2]]);click('선택 배송완료');
 click('1건 배송완료 처리');await Promise.all(mocks.work);
 expect(notice(render)?.props.tone).toBe('warning');
 mocks.states=[];mocks.work=[];
 mocks.complete.mockResolvedValue({message:'1건을 배송완료로 변경했습니다.',failed:[]});
 select([ids[2]]);click('선택 배송완료');
 click('1건 배송완료 처리');await Promise.all(mocks.work);
 expect(notice(render)?.props.tone).toBe('success');
});

it('데이터를 바꾼 처리가 끝나면 이전 바코드 경고를 거두고 다시 조회한다(실패한 내보내기 포함)',async()=>{
 // 리뷰 M27-SHIP-1: 경고는 선택·성공한 내보내기 회차가 바뀔 때만 다시 읽어, 상태가 바뀐 뒤에도 옛 개수가 남았다.
 const seowon={id:'00000000-0000-4000-8000-000000042202',name:'남양주',template:'seowon_xlsx',active:true};
 const rows=[{...row,status:'ready' as const,pack:null,originId:seowon.id}];
 const ready=()=>{mocks.index=0;mocks.effects=[];return ShipmentConsoleGrid({...props,tab:'ready',rows,origins:[seowon]});};
 async function settle(){for(const effect of mocks.effects)effect();await Promise.all([...mocks.gaps.mock.results,...mocks.originGaps.mock.results].map(result=>result.value));await new Promise(resolve=>setTimeout(resolve,0));}
 mocks.gaps.mockResolvedValue(2);mocks.originGaps.mockResolvedValue(0);
 (nodes(ready()).find(node=>node.type===ConsoleGrid)!.props.onSelectionChange as (ids:string[])=>void)([ids[0]]);
 ready();await settle();
 expect(text(ready())).toContain('바코드가 없는 옵션 2개 — 파일의 바코드 칸이 비어 있습니다.');
 // 다른 운영자가 먼저 바꿔 내보내기가 거절됐다. 목록은 새로 고치고, 바코드 개수도 지금 값으로 다시 센다.
 mocks.export.mockResolvedValue({error:'그 사이 배송 건이 바뀌었습니다. 목록을 새로고침한 뒤 다시 내려받아 주세요.'});
 (nodes(ready()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='출고지시 내려받기')!.props.onClick as ()=>void)();
 await Promise.all(mocks.work);
 expect(mocks.export).toHaveBeenLastCalledWith([ids[0]],'xlsx','warehouse',undefined);
 expect(text(ready())).not.toContain('바코드가 없는 옵션 2개');
 const before=mocks.gaps.mock.calls.length;
 mocks.gaps.mockResolvedValue(0);
 ready();await settle();
 expect(mocks.gaps.mock.calls.length).toBeGreaterThan(before);
 expect(text(ready())).not.toContain('바코드가 없는 옵션');
 // 내보내기에 성공하면 서버가 실제로 내보낸 배송 건으로 다시 센 결과를 상태 문구로 보여 준다.
 mocks.export.mockResolvedValue({file:{base64:'',mime:'application/octet-stream',name:'f.xlsx'},message:'1건의 출고지시를 내려받았습니다. 바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.'});
 const anchor={click:vi.fn(),href:'',download:''};
 vi.stubGlobal('document',{createElement:()=>anchor});vi.stubGlobal('URL',{createObjectURL:()=>'blob:x',revokeObjectURL:vi.fn()});
 (nodes(ready()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='출고지시 내려받기')!.props.onClick as ()=>void)();
 await Promise.all(mocks.work);
 expect(anchor.click).toHaveBeenCalledOnce();
 expect(text(ready())).toContain('1건의 출고지시를 내려받았습니다. 바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.');
});

/* QA 라운드 1 M1-b·m1 (CS·운영 S-T04-05 포함): 처리 결과 문구는 100행까지 길어지는 표 아래가 아니라 표 위에, 머리 막대 아래에 붙어 보인다. */
it('배송완료·행 처리 결과를 표 위(표보다 앞) 고정 상자에 두고 닫을 수 있다',async()=>{
 const order=(tree:ReturnType<typeof ShipmentConsoleGrid>)=>{const all=nodes(tree);return {notice:all.findIndex(node=>node.type===AdminNotice&&node.props.role==='status'),grid:all.findIndex(node=>node.type===ConsoleGrid)};};
 mocks.complete.mockResolvedValue({message:'1건을 배송완료로 변경했습니다.',failed:[]});
 select([ids[2]]);click('선택 배송완료');
 click('1건 배송완료 처리');await Promise.all(mocks.work);
 const placed=order(render());
 expect(placed.notice).toBeGreaterThanOrEqual(0);expect(placed.notice).toBeLessThan(placed.grid);
 const box=nodes(render()).find(node=>node.props['data-shipment-console-notice']==='')!;
 expect(String(box.props.className)).toContain('sticky');
 expect(text(box.props.children as ReactNode)).toContain('1건을 배송완료로 변경했습니다.');
 click('닫기');expect(nodes(render()).some(node=>node.type===AdminNotice&&node.props.role==='status')).toBe(false);
 // 행의 운송장 칸·배송 방법 팝업이 올린 결과(표에서 행이 빠지는 처리)도 같은 자리다.
 const readyProps={...props,tab:'ready' as const,dispatchActions:true,rows:props.rows.map(value=>({...value,status:'ready' as const}))};
 mocks.states=[];mocks.index=0;
 const provider=ShipmentConsoleGrid(readyProps) as ReactElement<{value:{report:(notice:{tone:'success';message:string})=>void}}>;
 provider.props.value.report({tone:'success',message:'배송 건 2026111230000007: 운송장 1건을 등록해 배송 중으로 옮겼습니다.'});
 mocks.index=0;const reported=order(ShipmentConsoleGrid(readyProps));
 expect(reported.notice).toBeGreaterThanOrEqual(0);expect(reported.notice).toBeLessThan(reported.grid);
});

/* QA 라운드 1 m9: 맨 위 재고 경고는 행으로 내려가면 보이지 않는다. 파일을 받는 확인 단계에서 다시 알리고, 받을지는 운영자가 정한다. */
it('재고 부족 옵션이 있으면 출고지시 내려받기 확인 단계(비밀번호 창·창고 양식 확인 창)에서 다시 알리고 막지는 않는다',async()=>{
 const shortage={count:2,names:['QA 물류 키링 / A형 (부족 4)','QA 키링 B (부족 1)']};
 const readyProps={...props,tab:'ready' as const,stockShortage:shortage,rows:props.rows.map(value=>({...value,status:'ready' as const,pack:null}))};
 function ready(){mocks.index=0;return ShipmentConsoleGrid(readyProps);}
 (nodes(ready()).find(node=>node.type===ConsoleGrid)!.props.onSelectionChange as (value:string[])=>void)([ids[0]]);
 const exportButton=()=>nodes(ready()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='출고지시 내려받기')!;
 (exportButton().props.onClick as ()=>void)();
 // ICONS 표준 XLSX: 비밀번호 창 안에 경고가 함께 보인다.
 expect(text(ready())).toContain('비밀번호 확인');
 const stockNotice=()=>nodes(ready()).find(node=>node.type===AdminNotice&&node.props.title==='창고 재고보다 출고할 주문이 많은 옵션 2개');
 expect(stockNotice()).toBeDefined();expect(text(stockNotice()!.props.children as ReactNode)).toContain('QA 물류 키링 / A형 (부족 4)');
 (nodes(ready()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='돌아가기')!.props.onClick as ()=>void)();
 // 기존 창고 양식은 비밀번호가 없어도 같은 확인 창을 거친다.
 const layout=nodes(ready()).find(node=>isSelect(node))!;(layout.props.onChange as (event:unknown)=>void)({target:{value:'warehouse'}});
 (exportButton().props.onClick as ()=>void)();
 expect(mocks.export).not.toHaveBeenCalled();
 expect(stockNotice()).toBeDefined();
 expect(nodes(ready()).some(node=>node.type===CustomerServiceDialog&&node.props.title==='출고지시 내려받기')).toBe(true);
 expect(nodes(ready()).some(node=>isInput(node)&&node.props.type==='password')).toBe(false);
 mocks.export.mockResolvedValue({error:'합성 응답'});
 const form=nodes(ready()).find(node=>node.type==='form')!;
 (form.props.onSubmit as (event:unknown)=>void)({preventDefault:vi.fn(),currentTarget:{reset:vi.fn()}});await Promise.all(mocks.work);
 expect(mocks.export).toHaveBeenLastCalledWith([ids[0]],'xlsx','warehouse',undefined);
 // 경고가 없으면 기존 창고 양식은 확인 창 없이 바로 받는다(지금 동작 그대로).
 mocks.states=[];mocks.work=[];mocks.export.mockClear();
 const plainProps={...readyProps,stockShortage:null};
 const plain=()=>{mocks.index=0;return ShipmentConsoleGrid(plainProps);};
 (nodes(plain()).find(node=>node.type===ConsoleGrid)!.props.onSelectionChange as (value:string[])=>void)([ids[0]]);
 (nodes(plain()).find(node=>isSelect(node))!.props.onChange as (event:unknown)=>void)({target:{value:'warehouse'}});
 (nodes(plain()).find(node=>isButton(node)&&text(node.props.children as ReactNode)==='출고지시 내려받기')!.props.onClick as ()=>void)();await Promise.all(mocks.work);
 expect(mocks.export).toHaveBeenLastCalledWith([ids[0]],'xlsx','warehouse',undefined);
 expect(nodes(plain()).some(node=>node.type===CustomerServiceDialog)).toBe(false);
});

afterEach(()=>{setAdminConfirmHandler(null);});

/* ADR-0045(SHP-050·SHP-086): 선택 배송완료는 도착 일시를 둘 중 하나로 고른다. '지금 도착으로 기록'은 처리 시각(null)이고,
   '택배사 조회의 도착 일시 넣기'를 고르면 일시 칸이 열린다. 7일보다 이른 일시는 늦게 처리한 사유가 있어야 누를 수 있으며, 미래 일시는 막는다.
   입력은 KST이고 서버에는 ISO로 보낸다. */
it('선택 배송완료는 택배사 배송완료 일시를 KST로 받아 ISO로 보내고, 7일보다 이르면 사유를 받는다', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-19T03:00:00Z'));
  try {
    select([ids[2]]); click('선택 배송완료');
    const field = () => nodes(render()).find(node => isInput(node) && node.props.name === 'deliveredAt')!;
    /* 처음에는 일시 칸이 없다. 설명 문단('처음 값을 그대로 두면…') 대신 선택 카드가 뜻을 말한다. */
    expect(field()).toBeUndefined();
    expect(text(render())).not.toContain('처음 채워진 값');
    chooseArrival(render(), 'carrier');
    expect(field().props).toMatchObject({ value: '', max: '2026-11-19T12:00' });
    // 미래 일시는 막는다.
    (field().props.onChange as (event: unknown) => void)({ target: { value: '2026-11-19T15:00' } });
    expect(text(render())).toContain('지금보다 뒤일 수 없습니다'); expect(button('1건 배송완료 처리').props.disabled).toBe(true);
    // 8일 전 도착: 사유 칸이 보이고 사유 없이는 누를 수 없다.
    (field().props.onChange as (event: unknown) => void)({ target: { value: '2026-11-11T09:30' } });
    expect(button('1건 배송완료 처리').props.disabled).toBe(true);
    const reason = nodes(render()).find(node => node.type === Textarea && node.props.name === 'arrivalReason')!;
    expect(reason).toBeTruthy();
    (reason.props.onChange as (event: unknown) => void)({ target: { value: ' 택배사 조회로 확인했으나 처리를 놓침 ' } });
    expect(button('1건 배송완료 처리').props.disabled).toBe(false);
    click('1건 배송완료 처리'); await Promise.all(mocks.work);
    expect(mocks.complete).toHaveBeenCalledWith([ids[2]], { deliveredAt: '2026-11-11T00:30:00.000Z', reason: '택배사 조회로 확인했으나 처리를 놓침' });
  } finally { vi.useRealTimers(); }
});

/* 리뷰 R3(ADR-0045): 판매 관리 권한이 없으면(물류 계정) 7일보다 이른 일시는 사유 칸 없이 막고 이유를 보인다. */
it('물류 계정은 7일보다 이른 배송완료 일시를 넣지 못하고 판매 관리 권한이 필요하다고 본다', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-19T03:00:00Z'));
  try {
    const logistics = () => { mocks.index = 0; return ShipmentConsoleGrid({ ...props, canManageSales: false }); };
    const grid = nodes(logistics()).find(node => node.type === ConsoleGrid)!;
    (grid.props.onSelectionChange as (ids: string[]) => void)([ids[2]]);
    (nodes(logistics()).find(node => isButton(node) && text(node.props.children as ReactNode) === '선택 배송완료')!.props.onClick as () => void)();
    chooseArrival(logistics(), 'carrier');
    (nodes(logistics()).find(node => isInput(node) && node.props.name === 'deliveredAt')!.props.onChange as (event: unknown) => void)({ target: { value: '2026-11-01T09:00' } });
    expect(text(logistics())).toContain('판매 관리 권한이 있는 운영자만 사유와 함께 넣을 수 있습니다');
    /* 다음 행동은 지금 화면의 선택지 이름으로 말한다. */
    expect(text(logistics())).toContain("'지금 도착으로 기록'을 고르거나 판매 관리 담당에게 요청해주세요.");
    expect(nodes(logistics()).some(node => node.type === Textarea)).toBe(false);
    expect(nodes(logistics()).find(node => isButton(node) && text(node.props.children as ReactNode) === '1건 배송완료 처리')!.props.disabled).toBe(true);
    (nodes(logistics()).find(node => isInput(node) && node.props.name === 'deliveredAt')!.props.onChange as (event: unknown) => void)({ target: { value: '2026-11-15T09:00' } });
    expect(nodes(logistics()).find(node => isButton(node) && text(node.props.children as ReactNode) === '1건 배송완료 처리')!.props.disabled).toBe(false);
  } finally { vi.useRealTimers(); }
});

/* S-01: 신규주문 탭의 일괄 발주확인은 주문통합검색과 같은 확인창(건수 + 되돌릴 수 없는 결과)을 한 번 거친다. */
it('일괄 발주확인은 건수를 말하는 확인창을 거치고, 돌아가면 아무것도 처리하지 않는다', async () => {
  const [first, second] = [ids[0], ids[1]];
  const fresh = () => { mocks.index = 0; return ShipmentConsoleGrid({ ...props, tab: 'new', rows: [{ ...row, id: first, orderId: first, pack: null }, { ...row, id: second, orderId: second, pack: null }] }); };
  const confirmButton = () => nodes(fresh()).find(node => isButton(node) && text(node.props.children as ReactNode) === '선택 주문 2건 발주확인')!;
  (nodes(fresh()).find(node => node.type === ConsoleGrid)!.props.onSelectionChange as (value: string[]) => void)([first, second]);
  const asked = vi.fn(async () => false);
  setAdminConfirmHandler(asked);
  await (confirmButton().props.onClick as () => Promise<void>)(); await Promise.all(mocks.work);
  /* 주문통합검색의 일괄 발주확인과 같은 문구다(lib/admin/order-confirmations). */
  expect(asked).toHaveBeenCalledWith(adminBulkOrderConfirmRequest(2));
  expect(asked).toHaveBeenCalledWith({ title: '신규주문 2건을 발주확인할까요?', message: '발주확인 뒤에는 고객이 직접 취소할 수 없습니다.', confirmLabel: '2건 발주확인', cancelLabel: '돌아가기' });
  expect(bulkConfirmAdminOrdersAction).not.toHaveBeenCalled();
  asked.mockResolvedValue(true);
  vi.mocked(bulkConfirmAdminOrdersAction).mockResolvedValue({ message: '2건을 발주확인했습니다.', confirmedOrderIds: [first, second] } as never);
  await (confirmButton().props.onClick as () => Promise<void>)(); await Promise.all(mocks.work);
  expect(bulkConfirmAdminOrdersAction).toHaveBeenCalledOnce();
});

/* 화면 규칙 5: 누를 수 없는 버튼은 이유를 말한다. 발송 지연 탭은 고객 안내 때문에 출고할 수 없는 건도 고를 수 있다. */
it('출고지시를 받을 수 없는 건이 섞이면 [출고지시 내려받기]를 잠그고 이유를 처리 막대에 적는다', () => {
  const held = { ...row, status: 'ready' as const, pack: null, preorderReady: false };
  const delayed = (rows: ShipmentConsoleRow[]) => { mocks.index = 0; return ShipmentConsoleGrid({ ...props, tab: 'delayed', dispatchActions: true, rows }); };
  const exportButton = (rows: ShipmentConsoleRow[]) => nodes(delayed(rows)).find(node => isButton(node) && text(node.props.children as ReactNode) === '출고지시 내려받기')!;
  /* 아무것도 고르지 않았으면 고르라고 말한다. */
  expect(text(delayed([held]))).toContain('왼쪽 체크칸에서 배송 건을 고르면 누를 수 있습니다.');
  (nodes(delayed([held])).find(node => node.type === ConsoleGrid)!.props.onSelectionChange as (value: string[]) => void)([ids[0]]);
  expect(exportButton([held]).props.disabled).toBe(true);
  const lock = nodes(delayed([held])).find(node => node.props['data-workbar-lock'] === '')!;
  expect(text(lock.props.children as ReactNode)).toContain('예약 입고 확인 전·제작 완료 전·부분 취소 중·출고 보류·택배 외 배송 건을 빼면 [출고지시 내려받기]를 누를 수 있습니다.');
  expect(exportButton([held]).props.title).toContain('출고지시를 내려받을 수 없는 건');
  /* 출고할 수 있는 건만 고르면 잠기지 않고 이유도 없다. */
  mocks.states = [];
  const ok = { ...held, preorderReady: true };
  (nodes(delayed([ok])).find(node => node.type === ConsoleGrid)!.props.onSelectionChange as (value: string[]) => void)([ids[0]]);
  expect(exportButton([ok]).props.disabled).toBe(false);
  expect(nodes(delayed([ok])).some(node => node.props['data-workbar-lock'] === '')).toBe(false);
});

/* S-02: 줄의 [발송처리]는 확인창 없이 실행된다. 고객 메일이 나가고 회수되지 않는다는 사실은 처리 막대 한 줄이 말한다. */
it('줄에 [발송처리]가 있는 목록은 고객 메일과 되돌리는 곳을 한 줄로 알린다', () => {
  const readyRows = [{ ...row, status: 'ready' as const, pack: null }];
  const ready = (overrides: Partial<Parameters<typeof ShipmentConsoleGrid>[0]> = {}) => { mocks.index = 0; return ShipmentConsoleGrid({ ...props, tab: 'ready', dispatchActions: true, rows: readyRows, ...overrides }); };
  const note = (tree: ReactNode) => nodes(tree).find(node => node.props['data-row-dispatch-note'] === '');
  expect(text(note(ready())!.props.children as ReactNode)).toBe('줄의 [발송처리]를 누르면 바로 배송중으로 바뀌고 고객에게 배송 안내 메일이 갑니다. 잘못 처리했으면 배송현황 관리의 [발송 되돌리기]로 되돌립니다. 보낸 메일은 회수되지 않습니다.');
  /* 되돌리기는 판매 관리 권한의 일이다 — 물류 계정에게는 누구에게 요청하는지 말한다. */
  expect(text(note(ready({ canManageSales: false }))!.props.children as ReactNode)).toContain('계정 주매니저에게 배송현황 관리의 [발송 되돌리기]를 요청해주세요.');
  /* 운송장 칸이 없는 목록(배송현황, 신규주문)에는 이 줄이 없다. */
  expect(note(render())).toBeUndefined();
  expect(note(ready({ tab: 'new' }))).toBeUndefined();
});

/* S-12: 발송 지연 탭에서 고른 배송 건의 주문(주문마다 한 번)에 같은 지연 메모를 넣는 창을 연다. */
it('발송 지연 탭의 [선택 주문 N건 지연 메모]는 고른 주문을 주문번호와 함께 창에 넘긴다', () => {
  const orderA = '50000000-0000-4000-8000-00000000000a', orderB = '50000000-0000-4000-8000-00000000000b';
  const rows = [{ ...row, id: ids[0], orderId: orderA, orderNumber: '2026111210000001', status: 'ready' as const, pack: null },
    { ...row, id: ids[1], orderId: orderA, orderNumber: '2026111210000001', status: 'ready' as const, pack: null },
    { ...row, id: ids[2], orderId: orderB, status: 'ready' as const, pack: null }];
  const delayed = (overrides: Partial<Parameters<typeof ShipmentConsoleGrid>[0]> = {}) => { mocks.index = 0; return ShipmentConsoleGrid({ ...props, tab: 'delayed', rows, ...overrides }); };
  (nodes(delayed()).find(node => node.type === ConsoleGrid)!.props.onSelectionChange as (value: string[]) => void)(ids);
  const open = nodes(delayed()).find(node => isButton(node) && text(node.props.children as ReactNode) === '선택 주문 2건 지연 메모')!;
  (open.props.onClick as () => void)();
  const dialog = nodes(delayed()).find(node => node.type === DispatchDelayBulkNote)!;
  expect(dialog.props.targets).toEqual([{ orderId: orderA, reference: '2026111210000001' }, { orderId: orderB, reference: '0000000B' }]);
  /* 지연 메모는 판매 관리(고객 응대) 일이다. */
  expect(nodes(delayed({ canManageSales: false })).some(node => isButton(node) && text(node.props.children as ReactNode).endsWith('지연 메모'))).toBe(false);
});

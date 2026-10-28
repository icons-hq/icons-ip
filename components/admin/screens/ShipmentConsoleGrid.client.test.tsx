import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ShipmentConsoleRow } from '@/lib/admin/shipment-dispatch';
const mocks = vi.hoisted(() => ({ complete: vi.fn(), export: vi.fn(), exportOrigin: vi.fn(), gaps: vi.fn(), originGaps: vi.fn(), refresh: vi.fn(), states: [] as unknown[], index: 0, work: [] as Promise<void>[], effects: [] as (() => void | (() => void))[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock('@/app/admin/order-actions', () => ({ bulkConfirmAdminOrdersAction: vi.fn() }));
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
import { bulkConfirmAdminOrdersAction } from '@/app/admin/order-actions';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ShipmentConsoleGrid } from './ShipmentConsoleGrid';
type Element = ReactElement<Record<string, unknown>>;
const ids = ['60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000003'];
const row: ShipmentConsoleRow = { id: ids[0], orderId: ids[0], originId: 'origin', originName: '합성 출고지', status: 'shipping', createdAt: '2026-10-16T00:00:00Z', confirmedAt: null, buyerName: '합성 구매자', recipientName: '합성 수령인', total: 10000, paymentMethod: 'card', shippingFee: 0, carrier: 'hanjin', trackingNumber: 'TEST12345', shippedAt: '2026-10-16T00:00:00Z', deliveredAt: null, exportedAt: null, updatedAt: '2026-10-16T00:00:00Z', delayReason: null, expectedShipDate: null, items: [], pack: { id: ids[2], revision: 1, count: 2, shipmentIds: ids.slice(0, 2), collectFee: 0, canRelease: false } };
const props: Parameters<typeof ShipmentConsoleGrid>[0] = { rows: [row, { ...row, id: ids[1] }, { ...row, id: ids[2], pack: null }], columns: [], gridRows: [], tab: 'transit', currentHref: '/admin/sales/shipping', readyHref: '/admin/sales/dispatch' };
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render() { mocks.index = 0; return ShipmentConsoleGrid(props); }
function button(label: string) { const result = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === label); if (!result) throw new Error(`Missing button: ${label}`); return result; }
function click(label: string) { const element = button(label); (element.props.onClick as () => void)(); }
function select(selected: string[]) { const grid = nodes(render()).find(node => node.type === ConsoleGrid)!; (grid.props.onSelectionChange as (ids: string[]) => void)(selected); }
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.index = 0; mocks.work = []; mocks.effects = []; mocks.complete.mockResolvedValue({ message: '2건 배송완료', failed: [] }); });
afterEach(() => vi.unstubAllGlobals());
it('선택한 합포장의 보이지 않는 구성 건을 포함해 확인하고 명시적으로 체크한 뒤에만 처리한다', async () => {
  select([ids[0]]); click('선택 배송완료');
  expect(text(render())).toContain('총 2건');
  expect(button('2건 배송완료 처리').props.disabled).toBe(true);
  click('2건 배송완료 처리'); expect(mocks.complete).not.toHaveBeenCalled();
  const checkbox = nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  // A background selection change cannot replace the batch the operator reviewed.
  select([ids[2]]); click('2건 배송완료 처리'); await Promise.all(mocks.work);
  expect(mocks.complete).toHaveBeenCalledOnce(); expect(mocks.complete).toHaveBeenCalledWith([ids[0]]);
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(nodes(render()).some(node => node.type === CustomerServiceDialog)).toBe(false);
});
it('같은 합포장의 두 행을 골라도 중복 계산하지 않으며 취소 후 재확인에는 체크가 남지 않는다', () => {
  select(ids.slice(0, 2)); click('선택 배송완료');
  expect(text(render())).not.toContain('총 4건'); expect(button('2건 배송완료 처리').props.disabled).toBe(true);
  click('취소'); expect(mocks.complete).not.toHaveBeenCalled();
  click('선택 배송완료'); expect(button('2건 배송완료 처리').props.disabled).toBe(true);
});
it('김포·남양주에 스마트스토어 양식을 기본으로 보내고 기존 창고 양식을 명시적으로 선택할 수 있다', async () => {
  const readyProps = { ...props, tab: 'ready' as const, rows: props.rows.map(value => ({ ...value, status: 'ready' as const })) };
  function ready() { mocks.index = 0; return ShipmentConsoleGrid(readyProps); }
  mocks.export.mockResolvedValue({ error: '합성 응답' });
  const grid = nodes(ready()).find(node => node.type === ConsoleGrid)!;
  (grid.props.onSelectionChange as (ids: string[]) => void)([ids[0]]);
  function exportFile() {
    const target = nodes(ready()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '출고지시 내보내기')!;
    (target.props.onClick as () => void)();
  }
  expect(nodes(ready()).find(node => node.type === 'select')!.props.value).toBe('auto');
  exportFile();
  expect(mocks.export).not.toHaveBeenCalled();
  expect(text(ready())).toContain('비밀번호 확인');
  for (const input of nodes(ready()).filter(node => node.type === 'input' && node.props.type === 'password')) {
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
  const cancel = nodes(ready()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '취소')!;
  (cancel.props.onClick as () => void)();
  const layout = nodes(ready()).find(node => node.type === 'select')!;
  (layout.props.onChange as (event: unknown) => void)({ target: { value: 'warehouse' } });
  exportFile(); await Promise.all(mocks.work);
  expect(mocks.export).toHaveBeenLastCalledWith([ids[0]], 'xlsx', 'warehouse', undefined);
});

it('남양주(서원) 출고지는 원형 송장양식이 기본이고, 74열을 고르면 출고지 전체 다운로드도 암호화를 거친다',async()=>{
 const origin={id:'00000000-0000-4000-8000-000000042202',name:'남양주',template:'seowon_xlsx',active:true};
 const readyProps={...props,tab:'ready' as const,rows:[],origins:[origin]};
 function ready(){mocks.index=0;return ShipmentConsoleGrid(readyProps);}
 function clickOrigin(){const target=nodes(ready()).find(node=>node.type==='button'&&text(node.props.children as ReactNode).startsWith('남양주 새 출고지시 전체 내려받기'))!;(target.props.onClick as ()=>void)();}
 mocks.exportOrigin.mockResolvedValue({error:'합성 재시도 안내'});
 expect(nodes(ready()).find(node=>node.type==='select')!.props.value).toBe('auto');
 // 버튼이 실제로 받을 양식을 적는다.
 expect(text(ready())).toContain('남양주 새 출고지시 전체 내려받기 (서원 송장양식)');
 clickOrigin();await Promise.all(mocks.work);
 expect(mocks.exportOrigin).toHaveBeenLastCalledWith(origin.id,'xlsx','warehouse',undefined);
 const layout=nodes(ready()).find(node=>node.type==='select')!;(layout.props.onChange as (event:unknown)=>void)({target:{value:'smartstore'}});
 expect(text(ready())).toContain('남양주 새 출고지시 전체 내려받기 (스마트스토어 74열)');
 clickOrigin();expect(text(ready())).toContain('남양주의 아직 전달하지 않은 발송 대기 건');
 const input=new FormData();input.set('password','1234');input.set('passwordConfirmation','1234');
 vi.stubGlobal('FormData',vi.fn(function(){return input;}));
 const form=nodes(ready()).find(node=>node.type==='form')!,reset=vi.fn();
 (form.props.onSubmit as (event:unknown)=>void)({preventDefault:vi.fn(),currentTarget:{reset}});await Promise.all(mocks.work);
 expect(mocks.exportOrigin).toHaveBeenLastCalledWith(origin.id,'xlsx','smartstore',{password:'1234',passwordConfirmation:'1234'});
 expect(mocks.export).not.toHaveBeenCalled();expect(reset).toHaveBeenCalledOnce();expect(input.has('password')).toBe(false);
 expect(text(ready())).toContain('합성 재시도 안내');expect(text(ready())).toContain('비밀번호 확인');
});
it('CSV를 골라도 남양주(서원) 송장양식은 XLSX로 받는다고 알리고, 74열을 고르면 그 안내를 거둔다',()=>{
 const origin={id:'00000000-0000-4000-8000-000000042202',name:'남양주',template:'seowon_xlsx',active:true};
 const readyRow={...row,status:'ready' as const,pack:null,originId:origin.id};
 for(const rows of [[],[readyRow]]){
  mocks.states=[];
  const ready=()=>{mocks.index=0;return ShipmentConsoleGrid({...props,tab:'ready',rows,origins:[origin]});};
  const selects=()=>nodes(ready()).filter(node=>node.type==='select');
  expect(text(ready())).not.toContain('XLSX로 받습니다');
  (selects()[1].props.onChange as (event:unknown)=>void)({target:{value:'csv'}});
  expect(text(ready())).toContain('CSV를 골라도 남양주(서원) 송장양식은 XLSX로 받습니다.');
  (selects()[0].props.onChange as (event:unknown)=>void)({target:{value:'smartstore'}});
  expect(text(ready())).not.toContain('XLSX로 받습니다');
 }
});
it('김포 등 다른 출고지와 섞이면 스마트스토어 74열이 기본이다',()=>{
 const origins=[{id:'seowon',name:'남양주',template:'seowon_xlsx',active:true},{id:'gimpo',name:'김포',template:'wms_csv',active:true}];
 const readyRow={...row,status:'ready' as const,pack:null};
 function ready(rows:ShipmentConsoleRow[]){mocks.index=0;return ShipmentConsoleGrid({...props,tab:'ready',origins,rows});}
 const gimpo=[{...readyRow,originId:'gimpo'}];
 let grid=nodes(ready(gimpo)).find(node=>node.type===ConsoleGrid)!;(grid.props.onSelectionChange as (ids:string[])=>void)([ids[0]]);
 expect(text(ready(gimpo))).toContain('선택한 배송 건 내려받기 양식: 스마트스토어 74열');
 mocks.states=[];
 const seowonOnly=[{...readyRow,originId:'seowon'}];
 grid=nodes(ready(seowonOnly)).find(node=>node.type===ConsoleGrid)!;(grid.props.onSelectionChange as (ids:string[])=>void)([ids[0]]);
 expect(text(ready(seowonOnly))).toContain('선택한 배송 건 내려받기 양식: 서원 송장양식');
 expect(nodes(ready(seowonOnly)).find(node=>node.type==='select')!.props.value).toBe('auto');
 // 버튼마다 실제 양식을 적는다.
 expect(text(ready(seowonOnly))).toContain('김포 새 출고지시 전체 내려받기 (스마트스토어 74열)');
});
it('이미 전달한 선택 건은 중복 출고 경고를 확인해야 다운로드 단계로 간다',()=>{
 const readyProps={...props,tab:'ready' as const,rows:[{...row,status:'ready' as const,exportedAt:'2026-10-20T00:00:00Z'}]};
 function ready(){mocks.index=0;return ShipmentConsoleGrid(readyProps);}
 const confirm=vi.fn(()=>false);vi.stubGlobal('window',{confirm});
 const grid=nodes(ready()).find(node=>node.type===ConsoleGrid)!;(grid.props.onSelectionChange as (ids:string[])=>void)([ids[0]]);
 const trigger=nodes(ready()).find(node=>node.type==='button'&&text(node.props.children as ReactNode)==='출고지시 내보내기')!;
 (trigger.props.onClick as ()=>void)();expect(confirm).toHaveBeenCalledOnce();expect(text(ready())).not.toContain('비밀번호 확인');expect(mocks.export).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);(trigger.props.onClick as ()=>void)();expect(text(ready())).toContain('비밀번호 확인');
});

it('바코드 칸이 있는 기존 창고 양식이면 내보내기 전에 바코드가 없는 옵션 수를 알리고 막지는 않는다',async()=>{
 const seowon={id:'00000000-0000-4000-8000-000000042202',name:'남양주',template:'seowon_xlsx',active:true};
 const gimpo={id:'00000000-0000-4000-8000-000000042201',name:'김포',template:'wms_csv',active:true};
 const rows=[{...row,status:'ready' as const,pack:null,originId:seowon.id},{...row,id:ids[1],status:'ready' as const,pack:null,originId:gimpo.id}];
 const ready=()=>{mocks.index=0;mocks.effects=[];return ShipmentConsoleGrid({...props,tab:'ready',rows,origins:[seowon,gimpo]});};
 async function settle(){for(const effect of mocks.effects)effect();await Promise.all([...mocks.gaps.mock.results,...mocks.originGaps.mock.results].map(result=>result.value));await new Promise(resolve=>setTimeout(resolve,0));}
 mocks.gaps.mockResolvedValue(2);mocks.originGaps.mockImplementation(async(id:string)=>id===seowon.id?1:5);
 ready();await settle();
 // 출고지 전체 내려받기 버튼: 서원 양식 출고지만 센다(김포는 기본이 74열이라 바코드 칸이 없다).
 expect(mocks.originGaps.mock.calls).toEqual([[seowon.id]]);
 // 출고지 경고는 다음 파일 한 묶음이 아니라 그 출고지의 미전달 발송 대기 건 전체를 센다(리뷰 M27-SHIP-2).
 expect(text(ready())).toContain('남양주 미전달 발송 대기 건: 바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.');
 expect(text(ready())).not.toContain('남양주 새 출고지시:');
 const grid=nodes(ready()).find(node=>node.type===ConsoleGrid)!;(grid.props.onSelectionChange as (ids:string[])=>void)(ids.slice(0,2));
 ready();await settle();
 // 섞인 선택은 기본이 74열이라 경고하지 않는다. 기존 창고 양식을 고르면 선택 전체를 넘기고,
 // 바코드 칸이 있는 출고지(서원)의 건만 세는 판정은 서버(admin_shipment_barcode_gaps)가 한다.
 expect(mocks.gaps).not.toHaveBeenCalled();
 const layout=nodes(ready()).find(node=>node.type==='select')!;(layout.props.onChange as (event:unknown)=>void)({target:{value:'warehouse'}});
 ready();await settle();
 expect(mocks.gaps).toHaveBeenLastCalledWith([ids[0],ids[1]]);
 expect(text(ready())).toContain('바코드가 없는 옵션 2개 — 파일의 바코드 칸이 비어 있습니다.');
 const exportButton=nodes(ready()).find(node=>node.type==='button'&&text(node.props.children as ReactNode)==='출고지시 내보내기')!;
 expect(exportButton.props.disabled).toBe(false);
 // 스마트스토어 74열에는 바코드 칸이 없어 경고하지 않는다.
 (nodes(ready()).find(node=>node.type==='select')!.props.onChange as (event:unknown)=>void)({target:{value:'smartstore'}});
 expect(text(ready())).not.toContain('바코드가 없는 옵션');
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
 const confirm=nodes(fresh()).find(node=>node.type==='button'&&text(node.props.children as ReactNode)==='선택 주문 1건 발주확인')!;
 (confirm.props.onClick as ()=>void)();await Promise.all(mocks.work);
 // 발송 대기 탭의 첫 페이지는 앞선 대기 건으로 차 있어 방금 확인한 배송 건이 보이지 않는다.
 const backlog={...row,id:ids[2],status:'ready' as const,pack:null,originId:seowon.id};
 const ready=()=>{mocks.index=0;mocks.effects=[];return ShipmentConsoleGrid({...base,tab:'ready',currentHref:readyHref,rows:[backlog]});};
 expect(text(ready())).toContain('방금 발주확인한 다른 페이지의 1건 포함');
 mocks.gaps.mockResolvedValue(1);mocks.originGaps.mockResolvedValue(0);
 for(const effect of mocks.effects)effect();
 await Promise.all([...mocks.gaps.mock.results,...mocks.originGaps.mock.results].map(result=>result.value));await new Promise(resolve=>setTimeout(resolve,0));
 expect(mocks.gaps).toHaveBeenLastCalledWith([confirmedId]);
 expect(text(ready())).toContain('바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.');
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
 mocks.export.mockResolvedValue({error:'배송 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 내보내주세요.'});
 (nodes(ready()).find(node=>node.type==='button'&&text(node.props.children as ReactNode)==='출고지시 내보내기')!.props.onClick as ()=>void)();
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
 (nodes(ready()).find(node=>node.type==='button'&&text(node.props.children as ReactNode)==='출고지시 내보내기')!.props.onClick as ()=>void)();
 await Promise.all(mocks.work);
 expect(anchor.click).toHaveBeenCalledOnce();
 expect(text(ready())).toContain('1건의 출고지시를 내려받았습니다. 바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.');
});

'use client';
import {useEffect,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {bulkConfirmAdminOrdersAction} from '@/app/admin/order-actions';
import {completeShipmentsAction,exportPendingOriginShipmentsAction,exportShipmentsAction,originBarcodeGapsAction,shipmentBarcodeGapsAction} from '@/app/admin/shipment-actions';
import {ConsoleGrid,type ConsoleGridColumn,type ConsoleGridRow} from '@/components/admin/console';
import {isParcelShipment,shipmentConsoleSelectable,type ShipmentConsoleOrigin,type ShipmentConsoleRow,type ShipmentConsoleTab} from '@/lib/admin/shipment-dispatch';
import {shipmentBarcodeGapWarning,type ShipmentExportLayout} from '@/lib/admin/shipment-workbook';
import {EXPORT_PASSWORD_HINT,EXPORT_PASSWORD_MAX_LENGTH,EXPORT_PASSWORD_MIN_LENGTH,exportPasswordError} from '@/lib/admin/export-password';
import {ShipmentPackPanel} from './ShipmentPackPanel';
import {OrderDelayNoticePanel} from './OrderDelayNoticePanel';
import {CustomerServiceDialog} from './CustomerServiceDialog';
import {Button} from '@/components/admin/kit/ui/button';
import {Input} from '@/components/admin/kit/ui/input';
import {Label} from '@/components/admin/kit/ui/label';
import {NativeSelect} from '@/components/admin/kit/ui/native-select';
/* 배송 건 처리 막대·출고지시 팝업(템플릿 룩, ADR-0028). 처리 순서·확인·양식 선택 계약은 그대로다. */
const WORKBAR='flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2';
const CONTROL='flex min-w-0 max-w-full items-center gap-1.5';
const WARNING='text-[var(--wc-warning)]';
const FIELD='flex min-w-0 flex-col gap-1.5 [&>span]:font-medium';
type ExportRequest={format:'xlsx'|'csv';layout:ShipmentExportLayout}&({kind:'selection';ids:string[]}|{kind:'origin';origin:ShipmentConsoleOrigin});
function download(file:{base64:string;mime:string;name:string}){
 const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:file.mime}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** 내보낼 배송 건이 모두 서원 송장양식 출고지(남양주)면 원형 양식이 기본이고, 그 밖에는 스마트스토어 74열이다. */
/** 실제로 내려받을 양식 이름. 기존 창고 양식은 출고지 설정을 따르므로 서원 출고지만이면 서원 송장양식이라고 적는다. */
function layoutLabel(layout:ShipmentExportLayout,seowonOnly:boolean){
 return layout==='smartstore'?'스마트스토어 74열':seowonOnly?'서원 송장양식':'기존 창고 양식';
}
function defaultExportLayout(origins:readonly ShipmentConsoleOrigin[],originIds:readonly string[]):ShipmentExportLayout{
 return originIds.length>0&&originIds.every(id=>origins.find(origin=>origin.id===id)?.template==='seowon_xlsx')?'warehouse':'smartstore';
}
export function ShipmentConsoleGrid({rows,columns,gridRows,tab,currentHref,readyHref,actorId,origins=[],originId=null}:{actorId?:string;rows:ShipmentConsoleRow[];columns:ConsoleGridColumn[];gridRows:ConsoleGridRow[];tab:ShipmentConsoleTab;currentHref:string;readyHref:string;origins?:ShipmentConsoleOrigin[];originId?:string|null}){
 const [selected,setSelected]=useState<string[]>([]);const [pending,startTransition]=useTransition();const router=useRouter();
 const [confirmedSelection,setConfirmedSelection]=useState<{href:string;ids:string[]}|null>(null);
 const [message,setMessage]=useState('');const [error,setError]=useState('');const [format,setFormat]=useState<'xlsx'|'csv'>('xlsx');
 // 운영자가 양식을 고르기 전에는 출고지 기본 양식을 쓴다. 남양주(서원)는 서원 원형 송장양식이 기본이다.
 const [layoutChoice,setLayout]=useState<ShipmentExportLayout|null>(null);
 const [failures,setFailures]=useState<{id:string;reason:string}[]>([]);
 const [packSelection,setPackSelection]=useState<string[]|null>(null);
 const [noticeSelection,setNoticeSelection]=useState<string[]|null>(null);
 const [completion,setCompletion]=useState<{ids:string[];total:number;acknowledged:boolean}|null>(null);
 const [exportRequest,setExportRequest]=useState<ExportRequest|null>(null);
 const [downloadedIds,setDownloadedIds]=useState<Set<string>>(()=>new Set());
 // 이 화면의 처리(발주확인·내보내기·배송완료)가 끝날 때마다 오른다. 성공·실패와 관계없이 바코드 경고를 지금 값으로 다시 센다(리뷰 M27-SHIP-1).
 const [dataRound,setDataRound]=useState(0);
 const [barcodeGaps,setBarcodeGaps]=useState<{key:string;missing:number}|null>(null);
 const [originBarcodeGaps,setOriginBarcodeGaps]=useState<{key:string;counts:Record<string,number>}|null>(null);
 // Revalidation can move just-confirmed shipments behind an existing ready backlog.
 // Keep that successful batch for the immediate export without putting UUIDs in the URL.
 const retainedIds=confirmedSelection?.href===currentHref?confirmedSelection.ids:null;
 const visibleIds=new Set(rows.map(row=>row.id));
 const selectableIds=new Set(rows.filter(row=>tab==='delayed'||shipmentConsoleSelectable(row,tab)).map(row=>row.id));
 const ids=retainedIds?retainedIds.filter(id=>!visibleIds.has(id)||selectableIds.has(id)):selected.filter(id=>selectableIds.has(id));
 const retainedOffPage=retainedIds?.filter(id=>!visibleIds.has(id)).length??0;
 const orderIds=[...new Set(rows.filter(row=>ids.includes(row.id)).map(row=>row.orderId))];
 const exportOrigins=tab==='ready'||tab==='delayed'?origins.filter(origin=>origin.active!==false&&(!originId||origin.id===originId)):[];
 const selectedOrigins=rows.filter(row=>ids.includes(row.id)).map(row=>row.originId);
 const originTemplate=(id:string)=>origins.find(origin=>origin.id===id)?.template;
 const layout=layoutChoice??defaultExportLayout(origins,selectedOrigins.length?selectedOrigins:originId?[originId]:exportOrigins.map(origin=>origin.id));
 // 서원 송장양식은 XLSX로만 주고받으므로 CSV를 골라도 남양주(서원) 파일은 XLSX로 만든다(출고지 기본 양식·기존 창고 양식일 때).
 const seowonCsvNote=format==='csv'&&layoutChoice!=='smartstore'&&origins.some(origin=>origin.active!==false&&origin.template==='seowon_xlsx')?<span className="text-muted-foreground">CSV를 골라도 남양주(서원) 송장양식은 XLSX로 받습니다.</span>:null;
 const hasBatchActions=tab==='new'||tab==='delayed'||rows.some(isParcelShipment)||Boolean(retainedIds?.length);
 const exportEligible=ids.length>0&&ids.every(id=>{const row=rows.find(item=>item.id===id);return row?shipmentConsoleSelectable(row,tab):Boolean(retainedIds?.includes(id));});
 // 10/27 회의 D10: 기존 창고 양식으로 받을 때, 바코드가 없는 옵션 수를 내보내기 전에 알린다. 경고일 뿐 내보내기를 막지 않는다.
 // 파일에 바코드 칸이 있는지(서원 송장양식, 바코드 열을 고른 표준 양식)는 서버가 배송 건 출고지의 설정으로 판정하므로
 // 선택한 배송 건 전체(화면 밖의 방금 발주확인한 묶음 포함)를 넘긴다. 조회는 선택·출고지 구성이 바뀔 때와 이 화면의 처리가
 // 끝날 때(dataRound)마다 다시 한다. 다른 탭에서 바코드를 고친 경우는 내보내기 결과 문구가 실제로 내보낸 배송 건으로 다시 센 값을 알린다.
 // 출고지 경고는 탭을 열 때마다 부르므로 다음 파일 한 묶음 대신 그 출고지의 미전달 발송 대기 건 전체를 가볍게 센다(리뷰 M27-SHIP-2).
 const exportTab=tab==='ready'||tab==='delayed';
 const barcodeKey=exportTab&&layout==='warehouse'&&exportEligible?[...ids].sort().join(','):'';
 const barcodeOrigins=exportOrigins.filter(origin=>(layoutChoice??defaultExportLayout(origins,[origin.id]))==='warehouse');
 const originBarcodeKey=barcodeOrigins.map(origin=>origin.id).join(',');
 useEffect(()=>{
  if(!barcodeKey)return;let live=true;
  shipmentBarcodeGapsAction(barcodeKey.split(',')).then(missing=>{if(live&&missing!==null)setBarcodeGaps({key:`${barcodeKey}#${dataRound}`,missing});},()=>{});
  return()=>{live=false;};
 },[barcodeKey,dataRound]);
 useEffect(()=>{
  if(!originBarcodeKey)return;let live=true;
  Promise.all(originBarcodeKey.split(',').map(id=>originBarcodeGapsAction(id).then(missing=>[id,missing] as const)))
   .then(entries=>{if(live)setOriginBarcodeGaps({key:`${originBarcodeKey}#${dataRound}`,counts:Object.fromEntries(entries.filter((entry):entry is readonly [string,number]=>entry[1]!==null))});},()=>{});
  return()=>{live=false;};
 },[originBarcodeKey,dataRound]);
 const selectionBarcodeGap=barcodeKey&&barcodeGaps?.key===`${barcodeKey}#${dataRound}`?barcodeGaps.missing:0;
 const originBarcodeGap=(id:string)=>originBarcodeKey&&originBarcodeGaps?.key===`${originBarcodeKey}#${dataRound}`?originBarcodeGaps.counts[id]??0:0;
 function select(next:string[]){setConfirmedSelection(null);setSelected(next.filter(id=>selectableIds.has(id)));}
 function reviewCompletion(){
  if(!ids.length||pending)return;
  const expanded=new Set(rows.filter(row=>ids.includes(row.id)).flatMap(row=>row.pack?.shipmentIds??[row.id]));
  setCompletion({ids:[...ids],total:expanded.size,acknowledged:false});
 }
 function requestExport(){
  if(pending||!exportEligible)return;
  const resent=ids.filter(id=>rows.some(row=>row.id===id&&row.exportedAt)||downloadedIds.has(id)).length;
  if(resent&&!window.confirm(`이미 출고지시를 전달한 배송 건 ${resent}건이 포함돼 있습니다. 창고는 같은 건을 두 번 받으면 걸러내지 못해 중복 출고될 수 있습니다. 그래도 다시 내려받을까요?`))return;
  const request:ExportRequest={kind:'selection',ids:[...ids],format,layout};
  if(layout==='smartstore'&&format==='xlsx'){setError('');setExportRequest(request);}
  else run('export',undefined,request);
 }
 function exportOrigin(origin:ShipmentConsoleOrigin){
  if(pending)return;
  const originLayout=layoutChoice??defaultExportLayout(origins,[origin.id]);
  const request:ExportRequest={kind:'origin',origin,format,layout:originLayout};
  if(originLayout==='smartstore'&&format==='xlsx'){setError('');setExportRequest(request);}
  else run('export',undefined,request);
 }
 function run(kind:'confirm'|'export'|'complete',credentials?:{password:string;passwordConfirmation:string},requestedExport?:ExportRequest){
  const exportBatch=kind==='export'?(requestedExport??exportRequest):null;
  const targetIds=kind==='complete'?completion?.ids:exportBatch?.kind==='selection'?exportBatch.ids:ids;
  if(pending||(kind==='export'?!exportBatch:!targetIds?.length))return;
  if(kind==='complete'&&!completion?.acknowledged)return;
  setMessage('');setError('');setFailures([]);
  startTransition(async()=>{
   try{
    if(kind==='confirm'){
     const form=new FormData();orderIds.forEach(id=>form.append('orderIds',id));const result=await bulkConfirmAdminOrdersAction({},form);
     if(result.errors?.form)setError(result.errors.form);
     else{
      setMessage(result.message??'발주확인했습니다.');
      const confirmedOrders=new Set(result.confirmedOrderIds??[]);
      const confirmedIds=rows.filter(row=>ids.includes(row.id)&&confirmedOrders.has(row.orderId)&&isParcelShipment(row)&&row.preorderReady!==false).map(row=>row.id);
      if(confirmedOrders.size){
       setSelected([]);setConfirmedSelection(confirmedIds.length?{href:readyHref,ids:confirmedIds}:null);
       router.push(readyHref);return;
      }
     }
    }else if(kind==='complete'){
     const result=await completeShipmentsAction(targetIds!);if(result.error)setError(result.error);else{setMessage(result.message??'');setFailures(result.failed??[]);setSelected((result.failed??[]).map(row=>row.id));}setCompletion(null);
    }else{
     const request=exportBatch!;
     const result=request.kind==='origin'
      ?await exportPendingOriginShipmentsAction(request.origin.id,request.format,request.layout,credentials)
      :await exportShipmentsAction(request.ids,request.format,request.layout,credentials);
     if(result.error)setError(result.error);
     else if(result.file){
      if(request.layout==='smartstore'&&request.format==='xlsx'&&result.file.encryption!=='ECMA-376-Agile'){setError('파일 암호화를 확인하지 못했습니다. 다시 내려받아 주세요.');return;}
      download(result.file);setExportRequest(null);setMessage(result.message??(request.kind==='selection'?`${request.ids.length}건의 출고지시를 내려받았습니다.`:'출고지시를 내려받았습니다.'));
      if(request.kind==='selection')setDownloadedIds(current=>new Set([...current,...request.ids]));
     }
    }
    router.refresh();
   }catch{setCompletion(null);setError('처리 중 연결이 끊겼습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.');}
   finally{setDataRound(round=>round+1);}
  });
 }
 return <div className="flex min-w-0 flex-col gap-3" data-shipment-console-grid="">
  <ConsoleGrid caption="출고지별 배송 건 목록" preferencesKey={`sales-${tab==='transit'||tab==='delivered'?'shipping':'dispatch'}`} columns={columns} rows={gridRows} emptyLabel="조건에 맞는 배송 건이 없습니다."
   selectable={tab!=='delivered'&&hasBatchActions} selectedIds={ids} onSelectionChange={select}>
   {tab!=='delivered'&&hasBatchActions?<div className={WORKBAR} data-sales-workbar="">
    <span className="text-muted-foreground tabular-nums">{ids.length}개 배송 건 선택</span>
    {retainedOffPage>0?<span className="flex flex-wrap items-center gap-1.5">방금 발주확인한 다른 페이지의 {retainedOffPage}건 포함 <Button type="button" size="xs" variant="outline" onClick={()=>select([])}>선택 해제</Button></span>:null}
    {tab==='new'?<Button type="button" size="sm" disabled={pending||!ids.length} onClick={()=>run('confirm')}>선택 주문 {orderIds.length}건 발주확인</Button>:tab==='transit'?
     <Button type="button" size="sm" disabled={pending||!ids.length} onClick={reviewCompletion}>선택 배송완료</Button>:
     <><span className={CONTROL}><Label className="shrink-0 whitespace-nowrap" htmlFor="shipment-export-layout">엑셀 양식</Label><NativeSelect className="max-w-full" id="shipment-export-layout" size="sm" value={layoutChoice??'auto'} disabled={pending} onChange={event=>setLayout(event.target.value==='auto'?null:event.target.value as ShipmentExportLayout)}><option value="auto">출고지 기본 양식 (남양주만 고르면 서원 송장양식 · 그 밖·여러 출고지는 스마트스토어 74열)</option><option value="smartstore">스마트스토어 양식 (74열)</option><option value="warehouse">기존 창고 양식</option></NativeSelect></span>
     <span className={CONTROL}><Label className="shrink-0 whitespace-nowrap" htmlFor="shipment-export-format">파일 형식</Label><NativeSelect id="shipment-export-format" size="sm" value={format} disabled={pending} onChange={event=>setFormat(event.target.value as 'xlsx'|'csv')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></NativeSelect></span>
     {seowonCsvNote}
     {ids.length?<span className="text-muted-foreground">선택한 배송 건 내려받기 양식: {layoutLabel(layout,selectedOrigins.length>0&&selectedOrigins.every(id=>originTemplate(id)==='seowon_xlsx'))}</span>:null}
     {selectionBarcodeGap>0?<span className={WARNING} role="status">{shipmentBarcodeGapWarning(selectionBarcodeGap)}</span>:null}
     <Button type="button" size="sm" disabled={pending||!exportEligible} onClick={requestExport}>출고지시 내보내기</Button></>}
    {actorId&&(tab==='ready'||tab==='delayed')?<Button type="button" size="sm" variant="outline" disabled={pending||ids.length<1||ids.length>100} onClick={()=>setPackSelection([...ids])}>합포장 관리</Button>:null}
    {tab==='delayed'?<Button type="button" size="sm" variant="outline" disabled={pending||!ids.length} onClick={()=>setNoticeSelection([...ids])}>선택 주문 {orderIds.length}건 고객 지연 안내</Button>:null}
    {pending?<span className="text-muted-foreground" role="status">처리 중…</span>:null}
   </div>:null}
   {exportOrigins.length?<div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2" role="group" aria-label="출고지별 새 출고지시 내려받기">
    {!hasBatchActions?<><span className={CONTROL}><Label className="shrink-0 whitespace-nowrap" htmlFor="shipment-export-layout">엑셀 양식</Label><NativeSelect className="max-w-full" id="shipment-export-layout" size="sm" value={layoutChoice??'auto'} disabled={pending} onChange={event=>setLayout(event.target.value==='auto'?null:event.target.value as ShipmentExportLayout)}><option value="auto">출고지 기본 양식 (남양주만 고르면 서원 송장양식 · 그 밖·여러 출고지는 스마트스토어 74열)</option><option value="smartstore">스마트스토어 양식 (74열)</option><option value="warehouse">기존 창고 양식</option></NativeSelect></span>
     <span className={CONTROL}><Label className="shrink-0 whitespace-nowrap" htmlFor="shipment-export-format">파일 형식</Label><NativeSelect id="shipment-export-format" size="sm" value={format} disabled={pending} onChange={event=>setFormat(event.target.value as 'xlsx'|'csv')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></NativeSelect></span>{seowonCsvNote}</>:null}
    <span className="basis-full text-muted-foreground">선택 없이 출고지별 미전달 발송 대기 건을 버튼에 적힌 양식으로 받습니다(품목 1,000줄까지, 남으면 다시 눌러 이어 받기).</span>
    {exportOrigins.map(origin=><Button key={origin.id} type="button" size="sm" variant="outline" className="h-auto min-h-7 whitespace-normal text-left" disabled={pending} onClick={()=>exportOrigin(origin)}>{origin.name} 새 출고지시 전체 내려받기 ({layoutLabel(layoutChoice??defaultExportLayout(origins,[origin.id]),origin.template==='seowon_xlsx')})</Button>)}
    {barcodeOrigins.map(origin=>originBarcodeGap(origin.id)>0?<span key={`barcode-${origin.id}`} className={WARNING} role="status">{`${origin.name} 미전달 발송 대기 건: ${shipmentBarcodeGapWarning(originBarcodeGap(origin.id))}`}</span>:null)}
   </div>:null}
  </ConsoleGrid>
  {tab==='delayed'?<Button className="self-start" variant="outline" type="button" onClick={()=>setNoticeSelection([])}>고객 지연 안내 이력·결과</Button>:null}
  {actorId&&packSelection!==null?<ShipmentPackPanel key={packSelection.join(',')} actorId={actorId} ids={packSelection} onClose={()=>setPackSelection(null)}/>:null}
  {noticeSelection!==null?<OrderDelayNoticePanel key={noticeSelection.join(',')} shipmentIds={noticeSelection} onClose={()=>setNoticeSelection(null)}/>:null}
  {completion?<CustomerServiceDialog title="배송완료 확인" busy={pending} onClose={()=>setCompletion(null)}>
   <div className="flex flex-col gap-3 text-sm leading-relaxed">
    <p>선택한 {completion.ids.length}건{completion.total>completion.ids.length?`과 같은 합포장에 포함된 배송 건을 합쳐 총 ${completion.total}건`:''}을 배송완료로 처리합니다.</p>
    <p className="text-muted-foreground">배송완료 시각부터 철회 기간이 시작됩니다. 합포장에 포함된 모든 상품의 실제 도착을 확인해주세요.</p>
    <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={completion.acknowledged} disabled={pending} onChange={event=>setCompletion({...completion,acknowledged:event.target.checked})}/><span>모든 상품이 실제 도착한 것을 확인했습니다.</span></label>
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
     <Button type="button" variant="outline" disabled={pending} onClick={()=>setCompletion(null)}>취소</Button>
     <Button type="button" disabled={pending||!completion.acknowledged} onClick={()=>run('complete')}>{pending?'처리 중…':`${completion.total}건 배송완료 처리`}</Button>
    </div>
   </div>
  </CustomerServiceDialog>:null}
  {exportRequest?<CustomerServiceDialog title="엑셀 비밀번호 설정" busy={pending} onClose={()=>{setExportRequest(null);setError('');}}>
   <form autoComplete="off" className="flex flex-col gap-3 text-sm leading-relaxed" data-encrypted-export="" onSubmit={event=>{
    event.preventDefault();const form=event.currentTarget;const input=new FormData(form);
    const password=input.get('password'),passwordConfirmation=input.get('passwordConfirmation');
    form.reset();input.delete('password');input.delete('passwordConfirmation');
    const invalid=exportPasswordError(password,passwordConfirmation);
    if(invalid||typeof password!=='string'||typeof passwordConfirmation!=='string'){setError(invalid??EXPORT_PASSWORD_HINT);return;}
    run('export',{password,passwordConfirmation});
   }}>
    <p>{exportRequest.kind==='selection'?`선택한 ${exportRequest.ids.length}개 배송 건`:`${exportRequest.origin.name}의 아직 전달하지 않은 발송 대기 건`}을 스마트스토어 양식으로 내려받습니다.</p>
    <p className="text-muted-foreground">{EXPORT_PASSWORD_HINT}</p>
    <label className={FIELD}><span>비밀번호</span><Input name="password" type="password" autoComplete="new-password" autoFocus minLength={EXPORT_PASSWORD_MIN_LENGTH} maxLength={EXPORT_PASSWORD_MAX_LENGTH} required disabled={pending} spellCheck={false}/></label>
    <label className={FIELD}><span>비밀번호 확인</span><Input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={EXPORT_PASSWORD_MIN_LENGTH} maxLength={EXPORT_PASSWORD_MAX_LENGTH} required disabled={pending} spellCheck={false}/></label>
    <p className="text-muted-foreground">비밀번호는 저장하지 않습니다. 운송장 회신 파일은 Excel에서 암호를 해제한 뒤 올려주세요.</p>
    {error?<p role="alert" className="text-destructive">{error}</p>:null}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
     <Button type="button" variant="outline" disabled={pending} onClick={()=>{setExportRequest(null);setError('');}}>취소</Button>
     <Button type="submit" disabled={pending}>{pending?'파일 만드는 중…':'암호화 엑셀 다운로드'}</Button>
    </div>
   </form>
  </CustomerServiceDialog>:null}
  {message?<p className="rounded-lg border bg-muted/40 px-3 py-2.5" role="status">{message}</p>:null}{error&&!exportRequest?<p role="alert" className="text-destructive">{error}</p>:null}
  {failures.length?<ul className="flex list-disc flex-col gap-1 pl-5 text-destructive">{failures.map(row=><li key={row.id}><span className="tabular-nums">{row.id}</span>: {row.reason}</li>)}</ul>:null}
 </div>;
}

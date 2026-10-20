'use client';

import Link from 'next/link';
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface CustomerServiceRecordNavigationProps {
  ids:string[]; initialDetail?:string|null; offset?:number; total?:number;
  previousPageHref?:string|null; nextPageHref?:string|null;
}
interface RecordNavigation extends CustomerServiceRecordNavigationProps {
  activeId:string|null; select:(id:string|null)=>void;
  drafts:Record<string,Record<string,string>>; saveDraft:(id:string,field:string,value:string)=>void;
}
const Context=createContext<RecordNavigation|null>(null);
function firstId(ids:string[],detail:string|null|undefined) {return detail==='first'?ids[0]??null:detail==='last'?ids.at(-1)??null:detail&&ids.includes(detail)?detail:null;}
export function CustomerServiceRecordProvider({children,...props}:CustomerServiceRecordNavigationProps&{children:ReactNode}) {
  const signature=JSON.stringify([props.ids,props.initialDetail]);
  const [previousSignature,setPreviousSignature]=useState(signature);
  const [activeId,select]=useState<string|null>(()=>firstId(props.ids,props.initialDetail));
  const [drafts,setDrafts]=useState<RecordNavigation['drafts']>({});
  if(signature!==previousSignature){setPreviousSignature(signature);select(activeId&&props.ids.includes(activeId)?activeId:firstId(props.ids,props.initialDetail));}
  return <Context.Provider value={{...props,activeId,select,drafts,saveDraft:(id,field,value)=>setDrafts(current=>({...current,[id]:{...current[id],[field]:value}}))}}>{children}</Context.Provider>;
}
export function useCustomerServiceRecord(id:string) {
  const context=useContext(Context);
  return context?{open:context.activeId===id,setOpen:(open:boolean)=>context.select(open?id:null),draft:context.drafts[id],saveDraft:(field:string,value:string)=>context.saveDraft(id,field,value)}:null;
}
function detailHref(href:string,value:'first'|'last'){return `${href}${href.includes('?')?'&':'?'}detail=${value}`;}
export function CustomerServiceRecordNavigation({id,busy=false,noun}:{id:string;busy?:boolean;noun:string}) {
  const context=useContext(Context);if(!context)return null;
  const index=context.ids.indexOf(id);const previous=context.ids[index-1],next=context.ids[index+1];
  return <nav className="admin-cs-record-nav" aria-label={`${noun} 상세 이동`}>
    {previous?<button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={()=>context.select(previous)}>이전 {noun}</button>
      :context.previousPageHref&&!busy?<Link className="btn btn-sm btn-ghost" href={detailHref(context.previousPageHref,'last')} scroll={false}>이전 {noun}</Link>:<button type="button" className="btn btn-sm btn-ghost" disabled>이전 {noun}</button>}
    <span>{(context.offset??0)+index+1} / {context.total??context.ids.length}</span>
    {next?<button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={()=>context.select(next)}>다음 {noun}</button>
      :context.nextPageHref&&!busy?<Link className="btn btn-sm btn-ghost" href={detailHref(context.nextPageHref,'first')} scroll={false}>다음 {noun}</Link>:<button type="button" className="btn btn-sm btn-ghost" disabled>다음 {noun}</button>}
  </nav>;
}

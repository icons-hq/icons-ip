/** PostgREST may return fewer rows than requested without an error. Exact
 * remaining counts and an immutable ID cursor make truncation fail closed. */
export const COMPLETE_ID_PAGE_SIZE = 500;
type PageError = { message:string };
export interface CompleteIdPage<T> { data:T[]|null; error:PageError|null; count:number|null }
export async function readCompleteIdPages<T extends {id:string}>(
  fetchPage:(afterId:string|null,pageSize:number)=>PromiseLike<CompleteIdPage<T>>,
):Promise<{data:T[]|null;error:PageError|null}> {
  const rows:T[]=[];let expectedTotal:number|null=null,afterId:string|null=null;
  const failure=()=>({data:null,error:{message:'row_snapshot_incomplete_or_changed'}});
  for(;;){
    const page=await fetchPage(afterId,COMPLETE_ID_PAGE_SIZE);
    if(page.error)return {data:null,error:page.error};
    if(!Number.isSafeInteger(page.count)||page.count===null||page.count<0||!Array.isArray(page.data))return failure();
    expectedTotal??=page.count;
    if(page.count+rows.length!==expectedTotal||page.data.length>page.count)return failure();
    if(page.count>0&&!page.data.length)return failure();
    for(const row of page.data){
      if(typeof row.id!=='string'||!row.id||(afterId!==null&&row.id<=afterId))return failure();
      rows.push(row);afterId=row.id;
    }
    if(rows.length===expectedTotal)return {data:rows,error:null};
  }
}

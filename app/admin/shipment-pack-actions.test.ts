import { beforeEach, expect, it, vi } from 'vitest';
import { changeShipmentPackAction, readShipmentPacksAction } from './shipment-pack-actions';
const m=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:m.rpc})}));
vi.mock('@/lib/admin/action-access.server',()=>({requireAdminActionAccess:m.auth}));
vi.mock('next/cache',()=>({revalidatePath:m.revalidate}));vi.mock('next/navigation',()=>({unstable_rethrow:vi.fn()}));
const id=(n:number)=>`ab160000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={actorId:id(1),sessionId:id(2)},ids=[id(3),id(4)],version='a'.repeat(64),doc={version:'b'.repeat(64),canCreate:false,rows:[]};
const save=()=>changeShipmentPackAction(ids,'create',version,'TEST verified recipients',id(5),identity);
beforeEach(()=>{m.rpc.mockReset();m.auth.mockReset().mockResolvedValue({user:{id:id(1)}});m.revalidate.mockReset();});
it('reads current state after a frozen operation receipt',async()=>{
 m.rpc.mockResolvedValueOnce({data:{kind:'create',packId:id(5)}}).mockResolvedValueOnce({data:doc});expect(await save()).toEqual({document:doc});
 expect(m.rpc).toHaveBeenNthCalledWith(1,'admin_change_shipment_pack',expect.objectContaining({p_operation:id(5),p_version:version,p_ids:ids,p_session:id(2)}));
 expect(m.rpc).toHaveBeenNthCalledWith(2,'admin_get_shipment_packs',{p_ids:ids});
});
it('preserves an uncertain request if current readback fails',async()=>{
 m.rpc.mockResolvedValueOnce({data:{packId:id(5)}}).mockResolvedValueOnce({error:{code:'network'}});expect(await save()).toMatchObject({uncertain:true});expect(m.revalidate).not.toHaveBeenCalled();
});
it('treats a stale preview as a definite rejection',async()=>{
 m.rpc.mockResolvedValue({error:{code:'PT409',message:'shipment_pack_changed'}});expect(await save()).toMatchObject({uncertain:false});expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('blocks another actor and duplicate selections before mutations',async()=>{
 m.auth.mockResolvedValue({user:{id:id(9)}});expect(await save()).toHaveProperty('error');expect(m.rpc).not.toHaveBeenCalled();
 expect(await changeShipmentPackAction([id(3),id(3)],'create',version,'TEST',id(5),identity)).toHaveProperty('error');expect(m.rpc).not.toHaveBeenCalled();
});
it('rejects malformed current documents without rendering raw server data',async()=>{
 m.rpc.mockResolvedValue({data:{...doc,rows:[{buyerName:'unexpected'}]}});expect(await readShipmentPacksAction(ids,identity)).toHaveProperty('error');
});

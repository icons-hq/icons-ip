import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminOrderDetail, AdminShipmentEmailJob } from './order-detail';

export async function getAdminOrderDetail(orderId: string): Promise<AdminOrderDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_order_detail', { target_order_id: orderId });
  if (error) throw new Error('주문 상세를 불러오지 못했습니다.');
  if (!data) return null;
  const {data:jobs,error:jobsError}=await supabase.from('order_shipment_email_jobs')
    .select('shipment_id,status,attempts,last_error_code,updated_at').eq('order_id',orderId);
  if(jobsError) throw new Error('배송 메일 상태를 불러오지 못했습니다.');
  const emailJobs=((jobs??[]) as {shipment_id:string;status:AdminShipmentEmailJob['status'];attempts:number;last_error_code:string|null;updated_at:string}[])
    .map(job=>({shipmentId:job.shipment_id,status:job.status,attempts:job.attempts,lastErrorCode:job.last_error_code,updatedAt:job.updated_at}));
  return {...data as AdminOrderDetail,emailJobs};
}

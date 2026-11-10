import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { isRecord } from '@/lib/admin/customer-segments';
export async function processMarketingMessages(campaignId:string|null=null) {
 const service=createServiceClient();let batches=0;const started=Date.now();
 while(batches<20&&Date.now()-started<40_000){const {data,error}=await service.rpc('process_due_marketing_campaigns',{p_campaign_id:campaignId});
  if(error||!isRecord(data)||typeof data.processed!=='boolean')throw new Error('marketing_processing_failed');if(!data.processed)break;batches++;
 }
 return {batches};
}

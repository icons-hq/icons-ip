import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { imageUrlFromBg } from '@/lib/media';
import { isCount, isRecord } from './customer-segments';
import { parseMarketingCampaign, parseMyMarketingMessage, type MarketingCampaign, type MarketingFilters, type MarketingList, type MyMarketingMessage, type MarketingProduct } from './marketing-messages';
const ERROR='마케팅 메시지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
export async function loadMarketingMessages(filters:MarketingFilters):Promise<MarketingList> {
 const client=await createClient();const {data,error}=await client.rpc('admin_marketing_campaigns',{p_query:filters.query,p_state:filters.state,p_page:filters.page,p_start:filters.start||null,p_end:filters.end||null});
 if(error||!isRecord(data)||!isCount(data.total)||data.page!==filters.page||data.pageSize!==20||!Array.isArray(data.rows)||data.rows.length>20)throw new Error(ERROR);
 const rows=data.rows.map(parseMarketingCampaign);if(rows.some(row=>!row)||new Set(rows.map(row=>row?.id)).size!==rows.length)throw new Error(ERROR);
 const last=Math.max(1,Math.ceil(data.total/20));if(filters.page>last)return loadMarketingMessages({...filters,page:last});return {rows:rows as MarketingCampaign[],total:data.total,page:filters.page,pageSize:20,filters};
}
export async function loadMarketingMessage(id:string):Promise<MarketingCampaign|null> {const client=await createClient();const {data,error}=await client.rpc('admin_get_marketing_campaign',{p_id:id});if(error)throw new Error(ERROR);if(data===null)return null;const campaign=parseMarketingCampaign(data);if(!campaign||campaign.id!==id)throw new Error(ERROR);return campaign;}
export async function loadMarketingProducts(ids:string[]):Promise<MarketingProduct[]> {
 if(!ids.length)return [];
 const catalog=await getCatalogSnapshot({previewDefaultSource:'supabase'});if(catalog.source!=='supabase')throw new Error('상품 정보를 불러오지 못했습니다.');
 const available=new Map(catalog.goods.map(good=>[good.id,good]));
 return ids.flatMap(id=>{const good=available.get(id);return good&&good.saleRestriction!=='adult'?[{id:good.id,name:good.name,imageUrl:imageUrlFromBg(good.img),price:good.price,compareAtPrice:good.compareAtPrice,priceMax:good.priceMax}]:[];});
}
export async function loadMyMarketingMessage(id:string):Promise<MyMarketingMessage|null> {
 const client=await createClient();const {data,error}=await client.rpc('get_my_marketing_message',{p_recipient_id:id});if(error)throw new Error('알림을 불러오지 못했습니다.');if(data===null)return null;
 const message=parseMyMarketingMessage(data);if(!message||message.id!==id)throw new Error('알림 내용이 올바르지 않습니다.');
 return {...message,goods:await loadMarketingProducts(message.goodIds)};
}
export async function loadMyMarketingTestReceipt(id:string):Promise<MyMarketingMessage|null> {
 const {data,error}=await (await createClient()).rpc('get_my_marketing_test_receipt',{p_receipt_id:id});if(error)throw new Error('테스트 알림을 불러오지 못했습니다.');if(data===null)return null;
 const message=parseMyMarketingMessage(data);if(!message||message.id!==id)throw new Error('테스트 알림 내용이 올바르지 않습니다.');return {...message,goods:await loadMarketingProducts(message.goodIds)};
}

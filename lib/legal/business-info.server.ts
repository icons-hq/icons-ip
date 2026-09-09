import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { mergeBusinessInfo, STORE_SETTINGS_CACHE_TAG } from '@/lib/admin/store-settings';
import { BUSINESS_INFO, type BusinessInfo } from './business-info';

/** Anonymous, purpose-limited projection; account settings never enter the public shell. */
export async function loadBusinessInfo():Promise<BusinessInfo> {
  const {url,key,isConfigured}=getSupabaseConfig();
  if (!isConfigured || !url || !key) return BUSINESS_INFO;
  try {
    const client=createServerClient(url,key,{cookies:{getAll:()=>[],setAll:()=>{}}});
    const {data,error}=await client.rpc('get_storefront_settings');
    return error || !data || typeof data!=='object' ? BUSINESS_INFO : mergeBusinessInfo(data);
  } catch { return BUSINESS_INFO; }
}
export const getBusinessInfo=unstable_cache(loadBusinessInfo,['business-info'],{revalidate:300,tags:[STORE_SETTINGS_CACHE_TAG]});

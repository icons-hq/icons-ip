'use server';

import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

export async function suggestGoodsIdentifiersAction(ipId: string, name: string): Promise<{
  code: string; slug: string; defaultVariantCode: string;
} | null> {
  const auth=await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user || !auth.isStaff) return null;
  if (typeof ipId!=='string' || !/^[a-z0-9][a-z0-9-]*$/.test(ipId)
    || typeof name!=='string' || name.length>200) return null;
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('admin_suggest_goods_identifiers',{target_ip_id:ipId,target_name:name});
  const row=Array.isArray(data)?data[0]:null;
  if (error || !row) return null;
  return {code:row.code,slug:row.slug,defaultVariantCode:row.default_variant_code};
}

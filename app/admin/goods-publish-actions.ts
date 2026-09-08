'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

export type GoodPublishActionState = { message?: string; error?: string };
export async function setAdminGoodPublishedAction(_previous: GoodPublishActionState, data: FormData): Promise<GoodPublishActionState> {
  const id = String(data.get('id') ?? '').trim();
  const target = data.get('published');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !['true', 'false'].includes(String(target))) return { error: '상품과 게시 상태를 다시 확인해주세요.' };
  if (target === 'false' && data.get('confirmUnpublish') !== 'yes') return { error: '초안 전환의 영향을 확인해주세요.' };
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured) return { error: '상품 게시 상태를 변경할 수 없습니다. 잠시 후 다시 시도해주세요.' };
    if (!auth.user) redirect('/login?next=%2Fadmin%2Fcatalog%2Fgoods');
    if (!auth.isStaff) return { error: '운영자 권한이 필요합니다.' };
    const client = await createClient();
    const { error } = await client.rpc('admin_set_good_published', { target_id: id, target_published: target === 'true' });
    if (error) return { error: error.message.includes('goods_publish_incomplete')
      ? '상품 유형·대표 이미지·상품정보제공고시와 옵션을 채운 뒤 공개해주세요.'
      : error.message.includes('catalog_item_archived') ? '보관된 상품은 복원한 뒤 공개해주세요.' : '게시 상태를 변경하지 못했습니다. 최신 상품을 확인해주세요.' };
    for (const path of ['/', '/shop', '/cart', '/checkout', '/search', '/admin/catalog/goods', '/admin/catalog/ips']) revalidatePath(path);
    revalidatePath(`/shop/${id}`);
    revalidatePath('/ip/[id]', 'page');
    revalidatePath('/events/[eventId]', 'page');
    return { message: target === 'true' ? '상품을 공개했습니다.' : '상품을 초안으로 되돌렸습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '게시 상태를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

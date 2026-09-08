'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import { IP_INDEX_PATH, ipWorkspaceHref } from '@/lib/admin/ip-workspace';

export interface IpDirectoryActionState extends AdminFormValuesState { errors?: { form: string }; message?: string }
const ID = /^[a-z0-9][a-z0-9-]*$/;

export async function saveIpDirectoryAction(previous: IpDirectoryActionState, data: FormData): Promise<IpDirectoryActionState> {
  const fail = (form: string) => withPreservedFormValues({ errors: { form } }, previous, data);
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(IP_INDEX_PATH)}`);
    if (!auth.isStaff) return fail('관리자 권한이 필요합니다.');
    const id = String(data.get('id') ?? '');
    const expectedFeatured = data.get('expectedFeatured');
    let order: unknown;
    try { order = JSON.parse(String(data.get('expectedOrder') ?? '')); } catch { order = null; }
    if (!ID.test(id) || !Array.isArray(order) || !order.length || order.length > 10000
      || order.some((entry) => typeof entry !== 'string' || !ID.test(entry))
      || new Set(order).size !== order.length || !order.includes(id)
      || !['true', 'false'].includes(String(expectedFeatured))) return fail('IP 노출 화면을 새로고침한 뒤 다시 시도해주세요.');
    const move = data.get('move');
    const position = move === 'up' ? order.indexOf(id) : move === 'down' ? order.indexOf(id) + 2 : Number(data.get('position'));
    if (!Number.isSafeInteger(position) || position < 1 || position > order.length) return fail(`순번은 1~${order.length} 사이로 입력해주세요.`);
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_set_ip_directory', {
      target_id: id, target_featured: data.get('featured') === 'on', target_position: position,
      expected_order: order, expected_featured: expectedFeatured === 'true',
    });
    if (error) {
      if (error.message.includes('ip_featured_limit')) return fail('피처드 IP는 최대 5개입니다. 다른 IP의 피처드를 해제한 뒤 다시 저장해주세요.');
      if (error.message.includes('ip_directory_conflict')) return fail('다른 운영자가 노출 설정을 변경했습니다. 새로고침한 뒤 다시 시도해주세요.');
      if (error.message.includes('catalog_item_archived')) return fail('보관된 IP는 피처드로 지정할 수 없습니다. 먼저 복원해주세요.');
      return fail('IP 노출 설정을 저장하지 못했습니다. 다시 시도해주세요.');
    }
    revalidatePath('/ip');
    revalidatePath(IP_INDEX_PATH);
    revalidatePath(ipWorkspaceHref(id));
    return { message: 'IP 노출 설정을 저장했습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return fail('IP 노출 설정을 저장하지 못했습니다. 입력값은 유지됩니다. 다시 시도해주세요.');
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { hasAdminCapability } from '@/lib/admin/access';
import { ADMIN_INQUIRY_CHAT_PATH, parseInquiryChatContext } from '@/lib/admin/inquiry-chat';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export async function updateInquiryChatTagAction(input: { accountId: string; inquiryId: string; label: string; present: boolean }): Promise<{ error?: string }> {
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user || !auth.isStaff || !hasAdminCapability(auth, 'cs.manage')) return { error: '상담 권한이 필요합니다.' };
    if (!input || input.accountId !== auth.user.id) return { error: '로그인 계정이 바뀌었습니다. 화면을 새로고침해주세요.' };
    if (!isUuid(input.inquiryId) || typeof input.label !== 'string' || typeof input.present !== 'boolean') return { error: '태그 정보를 다시 확인해주세요.' };
    const label = input.label.trim();
    if (!label || [...label].length > 20 || /[\u0000-\u001f\u007f]/.test(label)) return { error: '태그를 1~20자 이내의 한 줄로 입력해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_update_inquiry_chat_tag', {
      p_expected_actor_id: auth.user.id, p_inquiry_id: input.inquiryId, p_label: label, p_present: input.present,
    });
    const context = !error && parseInquiryChatContext(data);
    if (error?.message.includes('inquiry_chat_tag_limit')) return { error: '태그는 대화당 최대 10개까지 추가할 수 있습니다.' };
    if (!context || context.inquiryId !== input.inquiryId || context.tags.includes(label) !== input.present) return { error: '태그를 저장하지 못했습니다. 최신 상태를 확인하고 다시 시도해주세요.' };
    revalidatePath(ADMIN_INQUIRY_CHAT_PATH);
    return {};
  } catch { return { error: '태그 저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도할 수 있습니다.' }; }
}

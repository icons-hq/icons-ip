'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { parseMyOperatorInvitation, type MyOperatorInvitation } from '@/lib/admin/operator-invitations';
import { operatorInvitationTokenHash } from '@/lib/email/operator-invitations.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

type Result = { data: MyOperatorInvitation } | { error: string; uncertain?: boolean };
const validToken = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
export async function readMyOperatorInvitationAction(token: string): Promise<Result> {
  try {
    if (!validToken(token)) return { data: { status: 'unavailable' } };
    const client = await createClient(); const auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) return { error: '초대받은 이메일의 계정으로 로그인해주세요.' };
    const { data, error } = await client.rpc('get_my_operator_invitation', { p_token_hash: operatorInvitationTokenHash(token) });
    const parsed = parseMyOperatorInvitation(data);
    if (error || !parsed) return { error: '초대 정보를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.' };
    return { data: parsed };
  } catch (error) { unstable_rethrow(error); return { error: '초대 정보를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.' }; }
}
export async function acceptOperatorInvitationAction(token: string, operationId: string): Promise<Result> {
  try {
    if (!validToken(token) || !isUuid(operationId)) return { data: { status: 'unavailable' } };
    const client = await createClient(); const auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) return { error: '초대받은 이메일의 계정으로 로그인해주세요.' };
    const { data, error } = await client.rpc('accept_operator_invitation', { p_token_hash: operatorInvitationTokenHash(token), p_operation_id: operationId });
    if (error) {
      if (error.message === 'operator_invitation_email_unverified') return { data: { status: 'email_confirmation_required' } };
      if (error.code === '42501') return { data: { status: 'unavailable' } };
      if (error.message === 'operator_already_manager') return { error: '이미 매니저로 등록된 계정입니다. 관리자에게 기존 권한을 확인해주세요.' };
      if (['22023', '23505', '23514'].includes(error.code ?? '')) return { error: '초대를 수락할 수 없습니다. 관리자에게 초대 상태를 확인해주세요.' };
      return { error: '수락 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
    }
    const parsed = parseMyOperatorInvitation(data);
    if (!parsed || parsed.status !== 'accepted') return { error: '수락 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
    revalidatePath('/admin', 'layout');
    return { data: parsed };
  } catch (error) { unstable_rethrow(error); return { error: '수락 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
}

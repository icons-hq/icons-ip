import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { hasAdminCapability } from './access';
import { createClient } from '@/lib/supabase/server';
import { csReplyRpcArguments, parseCsReplyOperation, parseCsReplyReceipt, type CsReplyOutcome } from './cs-reply-mutations';
import type { CsReplySurface } from './cs-reply-tools';

export async function saveCsReplyRequest(form: FormData, surface: CsReplySurface, id: string, body: string): Promise<CsReplyOutcome> {
  const operation = parseCsReplyOperation({ operationId: form.get('operationId'), accountId: form.get('accountId'),
    expectedRevision: form.get('expectedRevision'), surface, id, body });
  if (!operation) return { kind: 'rejected', error: '저장 요청을 확인할 수 없습니다. 최신 저장본을 다시 확인해주세요.' };
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user || !auth.isStaff || !hasAdminCapability(auth, 'cs.manage') || auth.user.id !== operation.accountId) {
    return { kind: 'rejected', error: '현재 계정의 답변 권한을 확인할 수 없습니다. 화면을 새로고침해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_cs_reply', csReplyRpcArguments(operation));
    if (error) {
      if (error.code === 'PT409' && error.message === 'cs_reply_source_changed') return { kind: 'conflict', error: '원문 또는 답변이 바뀌었습니다. 현재 저장본을 확인한 뒤 작성 문구를 다시 검토해주세요.' };
      if (error.code === 'PT409') return { kind: 'rejected', error: '다른 내용으로 사용된 저장 요청입니다. 현재 저장본을 다시 확인해주세요.' };
      if (error.code === 'P0002') return { kind: 'rejected', error: '답변할 원문을 찾을 수 없습니다. 작성자가 삭제했을 수 있습니다.' };
      if (['42501', '28000', '22023', '22003', '23514', 'PGRST202'].includes(error.code)) {
        return { kind: 'rejected', error: ['42501', '28000'].includes(error.code) ? '답변 권한 또는 로그인 계정이 바뀌었습니다. 화면을 새로고침해주세요.' : '저장 요청을 처리할 수 없습니다. 최신 상태를 확인해주세요.' };
      }
      return { kind: 'uncertain', error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 결과 확인을 눌러주세요.' };
    }
    const receipt = parseCsReplyReceipt(data, operation);
    return receipt ? { kind: 'saved', receipt } : { kind: 'uncertain', error: '저장 응답을 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { kind: 'uncertain', error: '연결이 끊겨 저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.' };
  }
}

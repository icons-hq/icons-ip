'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { INQUIRY_MESSAGE_FILE_LIMIT, parseInquiryFile, type InquiryFile } from '@/lib/inquiry-files';
import { cleanupInquiryFiles, inquiryFileSession, prepareInquiryFile, verifyInquiryFile, type InquiryFileResult } from '@/lib/inquiry-files.server';
import type { AdminInquiryActionState } from './inquiry-actions';
import { MAX_INQUIRY_BODY_LENGTH, inquiryCategoryLabel } from '@/lib/inquiries';
import { sendInquiryAnsweredEmail } from '@/lib/email/transactional.server';
import { transactionRecord } from '@/lib/goods-transaction-values';

const access = () => requireAdminActionAccess('/admin/cs/chat', { capability: 'cs.manage' });
export async function prepareInquiryFileAction(input: InquiryFile, library: boolean): Promise<{ ok: true; id: string; path: string; verified: boolean } | { ok: false; error: string }> {
  try {
    const auth = await access(); const file = parseInquiryFile(input); const session = await inquiryFileSession();
    if (!auth || !file || typeof library !== 'boolean' || session?.actor !== auth.user.id) return { ok: false, error: '파일을 올리지 못했습니다. 허용된 형식의 20MB 이하 파일인지 확인해주세요. 상담 권한이 있는 계정으로 로그인돼 있어야 합니다.' };
    await cleanupInquiryFiles();
    const grant = await prepareInquiryFile(session.actor, session.sessionId, file, library);
    return grant ? { ok: true, ...grant } : { ok: false, error: '파일을 올리지 못했습니다. 파일 보관함에는 최대 100개까지 둘 수 있으니 안 쓰는 파일을 삭제하거나, 올리는 중인 파일이 끝난 뒤 다시 시도해주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '파일 업로드를 준비하지 못했습니다. 다시 시도해주세요.' }; }
}
export async function verifyInquiryFileAction(id: string): Promise<InquiryFileResult> {
  try {
    const auth = await access(); const session = await inquiryFileSession();
    if (!auth || !isUuid(id) || session?.actor !== auth.user.id) return { ok: false, error: '파일을 확인하지 못했습니다. 로그인이 바뀌었다면 화면을 새로고침한 뒤 파일을 다시 올려주세요.' };
    return verifyInquiryFile(session.actor, session.sessionId, id);
  } catch (error) { unstable_rethrow(error); return { ok: false, uncertain: true, error: '파일이 올라갔는지 확인하지 못했습니다. 같은 파일로 다시 시도해주세요.' }; }
}
export async function loadInquiryFileLibraryAction(): Promise<{ files: InquiryFile[] } | { error: string }> {
  try {
    if (!await requireAdminActionAccess('/admin/cs/chat', { capability: 'cs.manage', onUnauthenticated: 'error' })) return { error: '상담 권한이 필요합니다. 로그인이 끝났다면 다시 로그인해주세요.' };
    const { data, error } = await (await createClient()).rpc('admin_inquiry_file_library');
    if (error || !Array.isArray(data)) return { error: '파일 보관함을 불러오지 못했습니다. 다시 시도해주세요.' };
    const files = data.map(parseInquiryFile);
    return files.every((file): file is InquiryFile => !!file) ? { files } : { error: '파일 보관함 내용을 읽지 못했습니다. [목록 다시 불러오기]를 눌러주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '파일 보관함을 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
export async function removeInquiryFileAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!await access() || !isUuid(id)) return { ok: false, error: '파일을 삭제하지 못했습니다. 상담 권한이 있는 계정인지 확인하고 [목록 다시 불러오기]를 눌러주세요.' };
    const { data, error } = await (await createClient()).rpc('admin_retire_inquiry_file', { p_id: id });
    if (error || data !== true) return { ok: false, error: '파일을 보관함에서 삭제하지 못했습니다. 다시 시도해주세요.' };
    await cleanupInquiryFiles(); return { ok: true };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '파일 삭제 결과를 확인하지 못했습니다. 보관함을 다시 불러와주세요.' }; }
}
export async function sendInquiryChatMessageAction(_state: AdminInquiryActionState, formData: FormData): Promise<AdminInquiryActionState> {
  try {
    if (!await access()) return { errors: { form: '상담 권한이 필요합니다.' } };
    const inquiryId = formData.get('inquiryId'); const operationId = formData.get('operationId');
    /* 폼 본문의 CRLF를 LF로 맞춘 뒤 trim·길이 검사·저장한다. 입력창 maxLength(줄바꿈 1자)와 서버의
       2,000자 검사가 같은 글자 수를 센다. */
    const body = String(formData.get('body') ?? '').replace(/\r\n?/g, '\n').trim();
    const files: unknown = JSON.parse(String(formData.get('fileIds') ?? '[]'));
    if (!isUuid(inquiryId) || !isUuid(operationId) || !Array.isArray(files) || files.some(file => !isUuid(file))
      || new Set(files).size !== files.length || files.length > INQUIRY_MESSAGE_FILE_LIMIT || body.length > MAX_INQUIRY_BODY_LENGTH || !body && !files.length)
      return { errors: { body: '메시지를 입력하거나 확인된 파일을 첨부해주세요. 메시지는 2,000자, 첨부는 최대 3개입니다.' } };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_send_inquiry_chat_message', { p_inquiry: inquiryId, p_body: body, p_files: files, p_operation: operationId });
    if (error || !transactionRecord(data) || !isUuid(data.messageId) || data.operationId !== operationId) {
      return { uncertain: !error || !['42501', '23514', '22023', 'P0002', 'PT409'].includes(error.code ?? ''), errors: { form: error?.message.includes('inquiry_closed') ? '완료된 상담에는 보낼 수 없습니다. 작성한 메시지를 복사해 두고, 고객이 새 문의를 남기면 그 대화에서 보내주세요.'
        : error?.code === 'PT409' ? '전송을 확인하는 사이 메시지 내용이 바뀌어 보내지 않았습니다. 메시지를 확인한 뒤 다시 [전송]을 눌러주세요.'
          : '전송 결과를 확인하지 못했습니다. 작성한 메시지와 첨부는 그대로 있습니다. 같은 메시지로 다시 보내주세요. 이미 전송됐다면 두 번 보내지지 않습니다.' } };
    }
    const delivery = await sendInquiryAnsweredEmail({ answerBody: body || '첨부 파일이 도착했습니다. 상담 화면에서 확인해주세요.', categoryLabel: inquiryCategoryLabel(String(formData.get('category') ?? 'etc')),
      inquiryId, messageId: data.messageId, recipient: typeof data.recipientEmail === 'string' ? data.recipientEmail : null,
      reference: Number(data.reference), title: String(data.title) });
    revalidatePath('/admin/cs/chat'); revalidatePath('/admin/cs/inquiries'); revalidatePath(`/admin/cs/inquiries/${inquiryId}`); revalidatePath(`/my/inquiries/${inquiryId}`);
    return { resultKey: operationId, message: delivery.status === 'sent' ? '메시지를 전송했습니다.' : '메시지와 인앱 알림을 전송했습니다. 메일 발송은 완료되지 않았습니다.' };
  } catch (error) { unstable_rethrow(error); return { uncertain: true, errors: { form: '전송됐는지 확인하지 못했습니다. [전송 결과 다시 확인]을 눌러주세요. 다시 눌러도 두 번 보내지지 않습니다.' } }; }
}

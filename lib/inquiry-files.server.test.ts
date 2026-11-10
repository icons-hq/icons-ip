import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc, storage: { from: () => ({ download: mocks.download }) } }) }));
import { downloadInquiryFile } from './inquiry-files.server';
const actor = 'f1100000-0000-4000-8000-000000000001', id = 'f1100000-0000-4000-8000-000000000301';
const session = 'f1100000-0000-4000-8000-000000000101', message = 'f1100000-0000-4000-8000-000000000401';
const bytes = Buffer.from('합성 상담 문서');
const file = { id, name: '합성.txt', mimeType: 'text/plain', size: bytes.length, path: `${actor}/${id}.txt`, sha256: createHash('sha256').update(bytes).digest('hex') };
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: file, error: null }); mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null }); });
describe('비공개 상담 파일 다운로드', () => {
  it('파일을 읽은 뒤 같은 계정·세션·메시지 접근을 다시 확인한다', async () => {
    const result = await downloadInquiryFile(actor, session, id, message);
    expect(Buffer.from(result!.bytes)).toEqual(bytes);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenLastCalledWith('service_inquiry_file_download', { p_actor: actor, p_session: session, p_file: id, p_message: message });
  });
  it('파일 조회 도중 권한이 사라지면 이미 읽은 바이트도 반환하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: file, error: null }).mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    expect(await downloadInquiryFile(actor, session, id, message)).toBeNull();
    expect(mocks.download).toHaveBeenCalledOnce();
  });
  it('동일 크기라도 SHA가 바뀐 파일은 전달하지 않는다', async () => {
    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(bytes.length)]), error: null });
    await expect(downloadInquiryFile(actor, session, id, message)).rejects.toThrow('inquiry_file_changed');
  });
  it('검증 MIME과 파일명 또는 객체 ID가 다르면 Storage를 읽지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...file, name: '합성.html' }, error: null });
    expect(await downloadInquiryFile(actor, session, id, message)).toBeNull();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});

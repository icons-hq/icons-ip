import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadClaimEvidenceAction } from './claim-evidence-actions';

/* 회수 생략 근거 사진(TKT-166·QNA-039): 권한·형식·디코딩 검사 → 비공개 버킷 저장 → 같은 운영자 세션으로 원장 등록. */

const CLAIM_ID = 'abcdef01-1234-4123-8123-123456789abc';
const FILE_ID = 'abcdef02-1234-4123-8123-123456789abc';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), rpc: vi.fn(), upload: vi.fn(), inspect: vi.fn(), from: vi.fn(),
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ storage: { from: mocks.from } }) }));
vi.mock('@/lib/inquiry-file-inspection.server', () => ({ inspectInquiryFile: mocks.inspect }));

function form(file: File | string = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' })) {
  const value = new FormData();
  value.set('claimId', CLAIM_ID); value.set('fileId', FILE_ID); value.set('file', file);
  return value;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff-1' }, role: 'staff', isStaff: true });
  mocks.from.mockReturnValue({ upload: mocks.upload });
  mocks.upload.mockResolvedValue({ data: { path: 'x' }, error: null });
  mocks.inspect.mockResolvedValue('e'.repeat(64));
  mocks.rpc.mockResolvedValue({ data: { id: FILE_ID, claimId: CLAIM_ID, mimeType: 'image/jpeg', size: 3 }, error: null });
});

describe('회수 생략 근거 사진 올리기', () => {
  it('검사한 사진을 클레임 폴더에 덮어쓰지 않고 넣고 원장에 등록한다', async () => {
    expect(await uploadClaimEvidenceAction(form())).toEqual({ ok: true, file: { id: FILE_ID, mimeType: 'image/jpeg', size: 3 } });
    expect(mocks.from).toHaveBeenCalledWith('claim-evidence-private');
    expect(mocks.upload).toHaveBeenCalledWith(`${CLAIM_ID}/${FILE_ID}.jpg`, expect.any(Uint8Array), { contentType: 'image/jpeg', upsert: false });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_register_claim_evidence_file', { p_claim_id: CLAIM_ID, p_file_id: FILE_ID, p_mime_type: 'image/jpeg', p_size_bytes: 3, p_sha256: 'e'.repeat(64) });
  });

  it('같은 사진 번호의 재시도는 이미 있는 객체를 다시 등록해 같은 결과를 돌려준다', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: { message: 'The resource already exists' } });
    expect(await uploadClaimEvidenceAction(form())).toMatchObject({ ok: true });
  });

  it('교환 처리 권한이 없으면 저장소에 손대지 않는다', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture('logistics'), isConfigured: true, user: { id: 'staff-2' }, role: 'staff', isStaff: true });
    expect(await uploadClaimEvidenceAction(form())).toEqual({ ok: false, error: '교환 처리 권한이 필요합니다.' });
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['형식', new File(['x'], 'photo.gif', { type: 'image/gif' })],
    ['빈 파일', new File([], 'photo.jpg', { type: 'image/jpeg' })],
    ['파일 아님', 'not-a-file'],
  ])('지원하지 않는 사진(%s)은 올리지 않는다', async (_label, file) => {
    expect(await uploadClaimEvidenceAction(form(file))).toMatchObject({ ok: false });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('디코딩되지 않는 사진은 저장하지 않는다', async () => {
    mocks.inspect.mockResolvedValue(null);
    expect(await uploadClaimEvidenceAction(form())).toEqual({ ok: false, error: '사진 파일을 읽지 못했습니다. 다른 사진을 골라주세요.' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('원장 등록 거절은 운영자 문구로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'claim_evidence_limit' } });
    expect(await uploadClaimEvidenceAction(form())).toEqual({ ok: false, error: '이 교환에는 근거 사진을 20장까지 올릴 수 있습니다.' });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'claim_evidence_unavailable' } });
    expect(await uploadClaimEvidenceAction(form())).toEqual({ ok: false, error: '교환 요청에만 근거 사진을 올릴 수 있습니다.' });
  });
});

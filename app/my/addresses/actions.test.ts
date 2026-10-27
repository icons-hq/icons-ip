import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAddressBookEntryAction, saveAddressBookEntryAction, setDefaultAddressBookEntryAction } from './actions';

type Profile = { email: string; nickname: string; birth_date: string; onboarded_at: string | null; consents: Record<string, boolean>; suspended_at: string | null };
const ONBOARDED: Profile = { email: 'a@example.test', nickname: '회원', birth_date: '1990-01-01', onboarded_at: '2026-10-01T00:00:00Z', consents: { terms: true, privacy: true }, suspended_at: null };

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'user-1' }, profile: null } as { isConfigured: boolean; user: { id: string; email?: string } | null; profile: unknown },
  rpc: vi.fn(),
  load: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/address-book.server', () => ({ loadMyAddressBook: mocks.load }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const ENTRY = '7a570000-0000-4000-8000-000000000001';
const SAVED = '7a570000-0000-4000-8000-000000000009';
const book = [{ id: ENTRY, label: '집', recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울', address2: null, isDefault: true }];
const draft = { label: ' 집 ', recipientName: '홍길동', phone: '010-1234-5678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '', makeDefault: true };

beforeEach(() => {
  mocks.auth = { isConfigured: true, user: { id: 'user-1' }, profile: ONBOARDED };
  mocks.rpc.mockReset().mockResolvedValue({ data: SAVED, error: null });
  mocks.load.mockReset().mockResolvedValue(book);
});

describe('saveAddressBookEntryAction', () => {
  it('로그인·입력 검증을 통과해야 RPC 를 부른다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null };
    expect(await saveAddressBookEntryAction(null, draft)).toMatchObject({ ok: false, error: 'auth_required', message: '로그인이 만료됐어요. 다시 로그인해주세요.' });
    mocks.auth = { isConfigured: true, user: { id: 'user-1' }, profile: ONBOARDED };
    expect(await saveAddressBookEntryAction('not-a-uuid', draft)).toMatchObject({ ok: false, error: 'address_book_entry_missing' });
    expect(await saveAddressBookEntryAction(null, { ...draft, phone: 12 })).toMatchObject({ ok: false, error: 'address_book_invalid' });
    const invalid = await saveAddressBookEntryAction(null, { ...draft, postalCode: '123', label: '' });
    expect(invalid).toMatchObject({ ok: false, error: 'address_book_invalid', fieldErrors: { postalCode: '우편번호 5자리를 입력해주세요.', label: '배송지 이름을 입력해주세요.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('처리방침에 동의하지 않았거나(온보딩 전) 정지된 회원의 연락처·주소는 받지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: { id: 'user-1' }, profile: { ...ONBOARDED, onboarded_at: null } };
    expect(await saveAddressBookEntryAction(null, draft)).toEqual({ ok: false, error: 'onboarding_required', message: '프로필 설정을 먼저 완료해주세요.' });
    mocks.auth = { isConfigured: true, user: { id: 'user-1' }, profile: { ...ONBOARDED, consents: { terms: true } } };
    expect(await saveAddressBookEntryAction(null, draft)).toMatchObject({ ok: false, error: 'onboarding_required' });
    mocks.auth = { isConfigured: true, user: { id: 'user-1' }, profile: null };
    expect(await setDefaultAddressBookEntryAction(ENTRY)).toMatchObject({ ok: false, error: 'onboarding_required' });
    mocks.auth = { isConfigured: true, user: { id: 'user-1' }, profile: { ...ONBOARDED, suspended_at: '2026-10-27T00:00:00Z' } };
    expect(await saveAddressBookEntryAction(null, draft)).toEqual({ ok: false, error: 'account_suspended', message: '정지된 계정은 배송지를 저장하거나 바꿀 수 없어요.' });
    expect(await setDefaultAddressBookEntryAction(ENTRY)).toMatchObject({ ok: false, error: 'account_suspended' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    /* 자기 배송지 삭제는 막지 않는다. */
    expect(await deleteAddressBookEntryAction(ENTRY)).toEqual({ ok: true, entries: book });
    expect(mocks.rpc).toHaveBeenCalledWith('delete_my_address_book_entry', { p_entry_id: ENTRY });
  });

  it('DB 의 온보딩·정지 거절도 같은 문구로 옮긴다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'onboarding_required' } });
    expect(await saveAddressBookEntryAction(null, draft)).toMatchObject({ ok: false, error: 'onboarding_required' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'account_suspended' } });
    expect(await setDefaultAddressBookEntryAction(ENTRY)).toMatchObject({ ok: false, error: 'account_suspended' });
  });

  it('주문 배송지와 같은 정규화 값만 보내고(배송 메모 없음) 갱신된 주소록을 돌려준다', async () => {
    const result = await saveAddressBookEntryAction(null, { ...draft, deliveryNote: '문 앞' });

    expect(mocks.rpc).toHaveBeenCalledWith('save_my_address_book_entry', {
      p_entry_id: null,
      p_label: '집',
      p_address: { recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110' },
      p_make_default: true,
    });
    expect(result).toEqual({ ok: true, entries: book, savedId: SAVED });
    expect(mocks.load).toHaveBeenCalledWith('user-1');
  });

  it('수정은 내 배송지 id 로 같은 RPC 를 부른다', async () => {
    await saveAddressBookEntryAction(ENTRY, { ...draft, makeDefault: false });
    expect(mocks.rpc).toHaveBeenCalledWith('save_my_address_book_entry', expect.objectContaining({ p_entry_id: ENTRY, p_make_default: false }));
  });

  it('DB 거절은 화면 문구로 옮기고 원문·입력값을 싣지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'address_book_full' } });
    expect(await saveAddressBookEntryAction(null, draft)).toEqual({ ok: false, error: 'address_book_full', message: '배송지는 최대 10개까지 저장할 수 있어요. 쓰지 않는 배송지를 지운 뒤 다시 시도해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'account_deletion_write_fenced' } });
    expect(await saveAddressBookEntryAction(null, draft)).toMatchObject({ ok: false, error: 'account_deletion_write_fenced' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'new row for relation "address_book_entries" 01012345678' } });
    const unknown = await saveAddressBookEntryAction(null, draft);
    expect(unknown).toMatchObject({ ok: false, error: 'unavailable' });
    expect(JSON.stringify(unknown)).not.toContain('01012345678');
    mocks.rpc.mockRejectedValueOnce(new Error('offline'));
    expect(await saveAddressBookEntryAction(null, draft)).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('저장은 됐지만 목록을 다시 읽지 못하면 entries=null 로 알려 화면이 새로 받게 한다', async () => {
    mocks.load.mockResolvedValueOnce(null);
    expect(await saveAddressBookEntryAction(null, draft)).toEqual({ ok: true, entries: null, savedId: SAVED });
  });
});

describe('기본 지정·삭제', () => {
  it('로그인과 id 형식을 먼저 확인한다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null };
    expect(await setDefaultAddressBookEntryAction(ENTRY)).toMatchObject({ ok: false, error: 'auth_required' });
    expect(await deleteAddressBookEntryAction(ENTRY)).toMatchObject({ ok: false, error: 'auth_required' });
    mocks.auth = { isConfigured: true, user: { id: 'user-1' }, profile: ONBOARDED };
    expect(await setDefaultAddressBookEntryAction('x')).toMatchObject({ ok: false, error: 'address_book_entry_missing' });
    expect(await deleteAddressBookEntryAction(null)).toMatchObject({ ok: false, error: 'address_book_entry_missing' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('RPC 하나로 바꾸고 갱신된 주소록을 돌려준다', async () => {
    expect(await setDefaultAddressBookEntryAction(ENTRY)).toEqual({ ok: true, entries: book });
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_my_default_address_book_entry', { p_entry_id: ENTRY });
    expect(await deleteAddressBookEntryAction(ENTRY)).toEqual({ ok: true, entries: book });
    expect(mocks.rpc).toHaveBeenLastCalledWith('delete_my_address_book_entry', { p_entry_id: ENTRY });
  });

  it('다른 회원의 배송지는 없는 배송지로 거절된다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'address_book_entry_missing' } });
    expect(await deleteAddressBookEntryAction(ENTRY)).toMatchObject({ ok: false, error: 'address_book_entry_missing', message: '배송지를 찾지 못했어요. 새로고침한 뒤 다시 시도해주세요.' });
  });
});

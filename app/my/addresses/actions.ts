'use server';

import { unstable_rethrow } from 'next/navigation';
import {
  ADDRESS_BOOK_ERROR_COPY,
  addressBookDraftErrors,
  addressBookOpenFor,
  addressBookSaveInput,
  mapAddressBookError,
  parseAddressBookDraft,
  type AddressBookDraftErrors,
  type AddressBookEntry,
  type AddressBookErrorCode,
} from '@/lib/address-book';
import { loadMyAddressBook } from '@/lib/address-book.server';
import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/*
 * 주소록 쓰기(LFS 패리티 2차 L7 · MY-11). 배송지 관리·주문서·온보딩 안내가 같은 세 액션을 쓴다.
 * 쓰기는 DB RPC(본인·봉인·온보딩·정지·상한·기본 배송지 단일성)가 확정하고, 액션은 로그인·온보딩·정지 확인,
 * 입력 정규화, 오류 문구 매핑과 갱신된 목록 반환만 한다. 주문·결제 경로에는 닿지 않는다.
 * 저장·기본 지정은 주문서 쓰기와 같은 기준(온보딩을 마치고 정지되지 않은 회원)이다 — 처리방침에 동의하지 않은
 * 회원의 연락처·주소는 받지 않는다. 삭제는 자기 개인정보를 지우는 일이라 로그인만 확인한다.
 * 목록은 액션이 다시 읽어 돌려준다 — 화면은 그 값으로 바뀐다(주문서를 통째로 다시 그리지 않는다).
 */

export type AddressBookActionResult =
  | {
    ok: true;
    /** 갱신된 주소록. 다시 읽지 못했으면 null — 화면은 새로고침으로 맞춘다. */
    entries: AddressBookEntry[] | null;
    /** 저장한 주소의 id(추가·수정). */
    savedId?: string;
  }
  | {
    ok: false;
    error: AddressBookErrorCode;
    message: string;
    fieldErrors?: AddressBookDraftErrors;
  };

function failure(error: AddressBookErrorCode, fieldErrors?: AddressBookDraftErrors): AddressBookActionResult {
  return { ok: false, error, message: ADDRESS_BOOK_ERROR_COPY[error], ...(fieldErrors ? { fieldErrors } : {}) };
}

type Writer = { ok: true; userId: string } | { ok: false; error: AddressBookErrorCode };

/**
 * 로그인한 회원. newWrite 이면 온보딩(처리방침 동의)과 정지 여부, 그리고 주소록이 열렸는지(처리방침 주소록 개정 시행일
 * 전에는 staff/admin 미리보기만 — addressBookOpenFor)도 본다. 삭제는 자기 정보를 지우는 일이라 언제나 받는다.
 */
async function writer(newWrite: boolean): Promise<Writer> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { ok: false, error: 'auth_required' };
  if (newWrite) {
    if (isAccountSuspended(auth.profile)) return { ok: false, error: 'account_suspended' };
    if (!isOnboarded(auth.profile, auth.user.email)) return { ok: false, error: 'onboarding_required' };
    if (!addressBookOpenFor(auth)) return { ok: false, error: 'address_book_not_open' };
  }
  return { ok: true, userId: auth.user.id };
}

async function respond(userId: string, savedId?: string): Promise<AddressBookActionResult> {
  return { ok: true, entries: await loadMyAddressBook(userId), ...(savedId ? { savedId } : {}) };
}

/** 추가(entryId=null)·수정. 입력은 폼 그대로 받고 여기서 주문 배송지와 같은 규칙으로 정규화한다. */
export async function saveAddressBookEntryAction(entryId: unknown, draft: unknown): Promise<AddressBookActionResult> {
  try {
    const actor = await writer(true);
    if (!actor.ok) return failure(actor.error);
    const { userId } = actor;
    if (entryId !== null && !isUuid(entryId)) return failure('address_book_entry_missing');
    const parsed = parseAddressBookDraft(draft);
    if (!parsed) return failure('address_book_invalid');
    const fieldErrors = addressBookDraftErrors(parsed);
    const input = addressBookSaveInput(parsed);
    if (!input || Object.keys(fieldErrors).length > 0) return failure('address_book_invalid', fieldErrors);

    const client = await createClient();
    const { data, error } = await client.rpc('save_my_address_book_entry', {
      p_entry_id: entryId,
      p_label: input.label,
      p_address: input.address,
      p_make_default: input.makeDefault,
    });
    if (error) return failure(mapAddressBookError(error.message));
    return respond(userId, isUuid(data) ? data : undefined);
  } catch (error) {
    unstable_rethrow(error);
    return failure('unavailable');
  }
}

export async function setDefaultAddressBookEntryAction(entryId: unknown): Promise<AddressBookActionResult> {
  try {
    const actor = await writer(true);
    if (!actor.ok) return failure(actor.error);
    const { userId } = actor;
    if (!isUuid(entryId)) return failure('address_book_entry_missing');
    const client = await createClient();
    const { error } = await client.rpc('set_my_default_address_book_entry', { p_entry_id: entryId });
    if (error) return failure(mapAddressBookError(error.message));
    return respond(userId);
  } catch (error) {
    unstable_rethrow(error);
    return failure('unavailable');
  }
}

export async function deleteAddressBookEntryAction(entryId: unknown): Promise<AddressBookActionResult> {
  try {
    const actor = await writer(false);
    if (!actor.ok) return failure(actor.error);
    const { userId } = actor;
    if (!isUuid(entryId)) return failure('address_book_entry_missing');
    const client = await createClient();
    const { error } = await client.rpc('delete_my_address_book_entry', { p_entry_id: entryId });
    if (error) return failure(mapAddressBookError(error.message));
    return respond(userId);
  } catch (error) {
    unstable_rethrow(error);
    return failure('unavailable');
  }
}

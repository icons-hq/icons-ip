'use server';

import { unstable_rethrow } from 'next/navigation';
import {
  ADDRESS_BOOK_ERROR_COPY,
  addressBookDraftErrors,
  addressBookSaveInput,
  mapAddressBookError,
  parseAddressBookDraft,
  type AddressBookDraftErrors,
  type AddressBookEntry,
  type AddressBookErrorCode,
} from '@/lib/address-book';
import { loadMyAddressBook } from '@/lib/address-book.server';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/*
 * 주소록 쓰기(LFS 패리티 2차 L7 · MY-11). 배송지 관리·주문서·온보딩 안내가 같은 세 액션을 쓴다.
 * 쓰기는 DB RPC(본인·봉인·상한·기본 배송지 단일성)가 확정하고, 액션은 로그인 확인·입력 정규화·
 * 오류 문구 매핑과 갱신된 목록 반환만 한다. 주문·결제 경로에는 닿지 않는다.
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

async function signedInUserId(): Promise<string | null> {
  const auth = await getCurrentAuthState();
  return auth.isConfigured && auth.user ? auth.user.id : null;
}

async function respond(userId: string, savedId?: string): Promise<AddressBookActionResult> {
  return { ok: true, entries: await loadMyAddressBook(userId), ...(savedId ? { savedId } : {}) };
}

/** 추가(entryId=null)·수정. 입력은 폼 그대로 받고 여기서 주문 배송지와 같은 규칙으로 정규화한다. */
export async function saveAddressBookEntryAction(entryId: unknown, draft: unknown): Promise<AddressBookActionResult> {
  try {
    const userId = await signedInUserId();
    if (!userId) return failure('auth_required');
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
    const userId = await signedInUserId();
    if (!userId) return failure('auth_required');
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
    const userId = await signedInUserId();
    if (!userId) return failure('auth_required');
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

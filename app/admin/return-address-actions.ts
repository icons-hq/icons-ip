'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  RETURN_ADDRESSES_PATH, RETURN_ADDRESS_FORBIDDEN, RETURN_ADDRESS_STALE, normalizeReturnAddressInput, returnAddressErrorMessage, returnAddressSavedMessage,
} from '@/lib/admin/return-addresses';
import { countReturnAddressGoods } from '@/lib/admin/return-addresses.server';
import { isUuid } from '@/lib/uuid';
import { createClient } from '@/lib/supabase/server';

export type ReturnAddressActionState = { message?: string; errors?: Record<string, string>; values?: Record<string, string>; updatedAt?: string; deleted?: boolean; attempt?: number };

const value = (data: FormData, key: string) => { const raw = data.get(key); return typeof raw === 'string' ? raw : ''; };
const validStamp = (stamp: string) => Boolean(stamp) && !Number.isNaN(Date.parse(stamp));

function refresh() {
  revalidatePath(RETURN_ADDRESSES_PATH);
  revalidatePath('/admin/catalog/goods', 'layout');
}

/** 반품/교환지 등록·수정. 수정은 화면이 읽은 updatedAt과 함께 보내 다른 사람의 저장을 덮지 않는다. */
export async function saveReturnAddressAction(previous: ReturnAddressActionState, data: FormData): Promise<ReturnAddressActionState> {
  const values = Object.fromEntries(['id', 'name', 'address', 'phone', 'updatedAt'].map((key) => [key, value(data, key)]));
  const attempt = (previous.attempt ?? 0) + 1;
  const fail = (errors: Record<string, string>) => ({ errors, values, attempt });
  try {
    if (!await requireAdminActionAccess(RETURN_ADDRESSES_PATH, { adminOnly: true, capability: 'platform.manage' })) return fail({ form: RETURN_ADDRESS_FORBIDDEN });
    const parsed = normalizeReturnAddressInput(values);
    if (!parsed.ok) return fail(parsed.errors as Record<string, string>);
    const id = values.id || null;
    if (id && (!isUuid(id) || !validStamp(values.updatedAt))) return fail({ form: RETURN_ADDRESS_STALE });
    const { data: saved, error } = await (await createClient()).rpc('admin_save_return_address', {
      p_id: id, p_values: parsed.value, p_expected_updated_at: id ? values.updatedAt : null,
    });
    const updatedAt = (saved as { updatedAt?: unknown } | null)?.updatedAt;
    if (error || typeof updatedAt !== 'string') return fail({ form: returnAddressErrorMessage(error) });
    refresh();
    if (!id) return { message: '반품/교환지를 등록했습니다. 상품의 반품·교환에서 고를 수 있습니다.', attempt };
    /* 주소를 고치면 이 반품/교환지를 고른 상품의 상세 안내가 바로 바뀐다 — 몇 개인지 저장 직후에 읽어 말한다. 못 읽어도 저장은 끝났다. */
    return { message: returnAddressSavedMessage(await countReturnAddressGoods(id).catch(() => null)), updatedAt, attempt };
  } catch (error) {
    unstable_rethrow(error);
    return fail({ form: '반품/교환지를 저장하지 못했습니다. 입력한 내용은 그대로 있습니다. 잠시 뒤 다시 해 주세요.' });
  }
}

/** 반품/교환지 삭제. 상품이 고른 주소는 DB가 거절한다(이미 승인한 반품·교환의 회수 주소는 그때 정해져 남는다). */
export async function deleteReturnAddressAction(previous: ReturnAddressActionState, data: FormData): Promise<ReturnAddressActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const id = value(data, 'id'), updatedAt = value(data, 'updatedAt');
  try {
    if (!await requireAdminActionAccess(RETURN_ADDRESSES_PATH, { adminOnly: true, capability: 'platform.manage' })) return { errors: { form: RETURN_ADDRESS_FORBIDDEN }, attempt };
    if (!isUuid(id) || !validStamp(updatedAt)) return { errors: { form: RETURN_ADDRESS_STALE }, attempt };
    const { data: deleted, error } = await (await createClient()).rpc('admin_delete_return_address', { p_id: id, p_expected_updated_at: updatedAt });
    if (error || deleted !== true) return { errors: { form: returnAddressErrorMessage(error, 'delete') }, attempt };
    refresh();
    return { message: '반품/교환지를 지웠습니다.', deleted: true, attempt };
  } catch (error) {
    unstable_rethrow(error);
    return { errors: { form: '반품/교환지를 지우지 못했습니다. 잠시 뒤 다시 해 주세요.' }, attempt };
  }
}

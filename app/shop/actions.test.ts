import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { requestRestockAlertAction, requestVariantRestockAlertAction, toggleWishlistAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  from: vi.fn(),
  wishUpsertResult: { error: null } as { error: { message: string } | null },
  wishDeleteResult: { error: null } as { error: { message: string } | null },
  rpcResult: { error: null } as { error: { code?: string; message: string } | null },
  wishUpsert: vi.fn(),
  wishDelete: vi.fn(),
  wishDeleteEq: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

function signedInAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
    },
    isStaff: false,
  };
}

/* delete()는 종단이 없다 — eq 체인을 그대로 await 한다. */
function thenableDeleteBuilder() {
  const builder = {
    eq: mocks.wishDeleteEq,
    then<TResult1 = typeof mocks.wishDeleteResult, TResult2 = never>(
      onfulfilled?: ((value: typeof mocks.wishDeleteResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(mocks.wishDeleteResult).then(onfulfilled, onrejected);
    },
  };
  mocks.wishDeleteEq.mockReturnValue(builder);
  return builder;
}

describe('shop engagement Server Actions', () => {
  beforeEach(() => {
    mocks.auth = signedInAuth();
    mocks.wishUpsertResult = { error: null };
    mocks.wishDeleteResult = { error: null };
    mocks.rpcResult = { error: null };

    for (const mock of [
      mocks.from,
      mocks.wishUpsert,
      mocks.wishDelete,
      mocks.wishDeleteEq,
      mocks.rpc,
    ]) mock.mockReset();

    mocks.wishUpsert.mockImplementation(async () => mocks.wishUpsertResult);
    mocks.wishDelete.mockImplementation(() => thenableDeleteBuilder());
    mocks.rpc.mockImplementation(async () => mocks.rpcResult);
    mocks.from.mockImplementation((table: string) => {
      if (table === 'wishlists') return { upsert: mocks.wishUpsert, delete: mocks.wishDelete };
      throw new Error(`Unexpected table ${table}`);
    });
  });

  describe('toggleWishlistAction', () => {
    it('sends a guest to login instead of touching the database', async () => {
      mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

      await expect(toggleWishlistAction('g100', true)).resolves.toEqual({
        ok: false,
        error: 'auth_required',
      });
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it('refuses a suspended account', async () => {
      mocks.auth = {
        ...signedInAuth(),
        profile: { ...signedInAuth().profile!, suspended_at: '2026-08-01T00:00:00.000Z' },
      };

      await expect(toggleWishlistAction('g100', true)).resolves.toEqual({
        ok: false,
        error: 'account_suspended',
      });
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it('reports unavailable while Supabase is not configured', async () => {
      mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };

      await expect(toggleWishlistAction('g100', true)).resolves.toEqual({
        ok: false,
        error: 'unavailable',
      });
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it('rejects malformed runtime arguments without writing', async () => {
      await expect(toggleWishlistAction('   ', true)).resolves.toEqual({
        ok: false,
        error: 'invalid_request',
      });
      await expect(toggleWishlistAction('g100', 'yes')).resolves.toEqual({
        ok: false,
        error: 'invalid_request',
      });
      expect(mocks.from).not.toHaveBeenCalled();
    });

    /* 하트는 낙관적으로 그려진다 — 같은 목표 상태를 두 번 눌러도 결과가 흔들리면
       화면과 DB가 갈라진다. 멱등은 on conflict do nothing / delete 가 보장한다. */
    it('is idempotent: the same target state twice returns the same result', async () => {
      const first = await toggleWishlistAction('g100', true);
      const second = await toggleWishlistAction('g100', true);

      expect(first).toEqual({ ok: true, wished: true });
      expect(second).toEqual(first);
      expect(mocks.wishUpsert).toHaveBeenNthCalledWith(
        1,
        { user_id: 'user-1', good_id: 'g100' },
        { onConflict: 'user_id,good_id', ignoreDuplicates: true },
      );
      expect(mocks.wishUpsert).toHaveBeenCalledTimes(2);
    });

    it('is idempotent when unwishing twice', async () => {
      const first = await toggleWishlistAction('g100', false);
      const second = await toggleWishlistAction('g100', false);

      expect(first).toEqual({ ok: true, wished: false });
      expect(second).toEqual(first);
      expect(mocks.wishDeleteEq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
      expect(mocks.wishDeleteEq).toHaveBeenNthCalledWith(2, 'good_id', 'g100');
      expect(mocks.wishUpsert).not.toHaveBeenCalled();
    });

    it('does not expose database details when the write fails', async () => {
      mocks.wishUpsertResult = { error: { message: 'sensitive database detail' } };

      await expect(toggleWishlistAction('g100', true)).resolves.toEqual({
        ok: false,
        error: 'unavailable',
      });
    });
  });

  describe('requestRestockAlertAction', () => {
    it('gates guests, suspended accounts and an unconfigured backend', async () => {
      mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
      await expect(requestRestockAlertAction('g100')).resolves.toEqual({
        ok: false,
        error: 'auth_required',
      });

      mocks.auth = {
        ...signedInAuth(),
        profile: { ...signedInAuth().profile!, suspended_at: '2026-08-01T00:00:00.000Z' },
      };
      await expect(requestRestockAlertAction('g100')).resolves.toEqual({
        ok: false,
        error: 'account_suspended',
      });

      mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };
      await expect(requestRestockAlertAction('g100')).resolves.toEqual({
        ok: false,
        error: 'unavailable',
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    /* 품절 판정·재신청은 request_restock_alert RPC 한 트랜잭션이 잠금과 함께 한다 —
       판정과 신청 사이에 재입고 전이가 끼는 경합, 트리거 소유 상태의 직접 쓰기를
       함께 막는 계약이다. 액션의 몫은 호출과 에러 번역뿐이다. */
    it('delegates the sold-out check and upsert to the locking RPC', async () => {
      await expect(requestRestockAlertAction('  g100  ')).resolves.toEqual({
        ok: true,
        status: 'pending',
      });
      expect(mocks.rpc).toHaveBeenCalledWith('request_restock_alert', { target_good_id: 'g100' });
    });

    it('re-requesting the same alert stays pending', async () => {
      const first = await requestRestockAlertAction('g100');
      const second = await requestRestockAlertAction('g100');

      expect(first).toEqual({ ok: true, status: 'pending' });
      expect(second).toEqual(first);
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
    });

    it('refuses a good that is still on sale', async () => {
      mocks.rpcResult = { error: { code: '22023', message: 'good_available' } };

      await expect(requestRestockAlertAction('g100')).resolves.toEqual({
        ok: false,
        error: 'invalid_request',
      });
    });

    it('reports an unknown good as an invalid request', async () => {
      mocks.rpcResult = { error: { code: 'P0002', message: 'good_missing' } };

      await expect(requestRestockAlertAction('ghost')).resolves.toEqual({
        ok: false,
        error: 'invalid_request',
      });
    });

    it('does not expose database details when the write fails', async () => {
      mocks.rpcResult = { error: { code: 'XX000', message: 'sensitive database detail' } };

      await expect(requestRestockAlertAction('g100')).resolves.toEqual({
        ok: false,
        error: 'unavailable',
      });
    });
  });

  /* PD-11 — 고른 품절 옵션의 재입고 알림. 기존 굿즈 단위 액션의 시그니처는 그대로다. */
  describe('requestVariantRestockAlertAction', () => {
    const VARIANT_ID = '00000000-0000-4000-8000-000000056711';

    it('gates guests, suspended accounts and an unconfigured backend before the RPC', async () => {
      mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
      await expect(requestVariantRestockAlertAction('g100', VARIANT_ID)).resolves.toEqual({ ok: false, error: 'auth_required' });

      mocks.auth = {
        ...signedInAuth(),
        profile: { ...signedInAuth().profile!, suspended_at: '2026-08-01T00:00:00.000Z' },
      };
      await expect(requestVariantRestockAlertAction('g100', VARIANT_ID)).resolves.toEqual({ ok: false, error: 'account_suspended' });

      mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };
      await expect(requestVariantRestockAlertAction('g100', VARIANT_ID)).resolves.toEqual({ ok: false, error: 'unavailable' });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('rejects a missing good or a malformed option id without calling the RPC', async () => {
      await expect(requestVariantRestockAlertAction('   ', VARIANT_ID)).resolves.toEqual({ ok: false, error: 'invalid_request' });
      await expect(requestVariantRestockAlertAction('g100', 'not-a-uuid')).resolves.toEqual({ ok: false, error: 'invalid_request' });
      await expect(requestVariantRestockAlertAction('g100', null)).resolves.toEqual({ ok: false, error: 'invalid_request' });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('delegates the sold-out check and upsert to the option RPC with normalized ids', async () => {
      await expect(requestVariantRestockAlertAction('  g100  ', ` ${VARIANT_ID.toUpperCase()} `)).resolves.toEqual({
        ok: true,
        status: 'pending',
      });
      expect(mocks.rpc).toHaveBeenCalledWith('request_variant_restock_alert', {
        target_good_id: 'g100',
        target_variant_id: VARIANT_ID,
      });
      /* 굿즈 단위 RPC 는 부르지 않는다 — 옵션 신청이 "모든 옵션" 신청으로 넓어지면 다른 옵션 재입고에도 알린다. */
      expect(mocks.rpc).not.toHaveBeenCalledWith('request_restock_alert', expect.anything());
    });

    it('re-requesting the same option stays pending', async () => {
      const first = await requestVariantRestockAlertAction('g100', VARIANT_ID);
      const second = await requestVariantRestockAlertAction('g100', VARIANT_ID);

      expect(first).toEqual({ ok: true, status: 'pending' });
      expect(second).toEqual(first);
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['22023', 'variant_available'],
      ['22023', 'variant_preorder'],
      ['P0002', 'variant_missing'],
      ['P0002', 'good_missing'],
    ])('reports %s %s as an invalid request', async (code, message) => {
      mocks.rpcResult = { error: { code, message } };
      await expect(requestVariantRestockAlertAction('g100', VARIANT_ID)).resolves.toEqual({ ok: false, error: 'invalid_request' });
    });

    it('sends an expired session back to login and hides other database details', async () => {
      mocks.rpcResult = { error: { code: '28000', message: 'auth_required' } };
      await expect(requestVariantRestockAlertAction('g100', VARIANT_ID)).resolves.toEqual({ ok: false, error: 'auth_required' });

      /* 탈퇴 신청으로 쓰기가 봉인된 계정(55000)도 저장하지 않고 일반 실패로 접는다. */
      mocks.rpcResult = { error: { code: '55000', message: 'account_deletion_write_fenced' } };
      await expect(requestVariantRestockAlertAction('g100', VARIANT_ID)).resolves.toEqual({ ok: false, error: 'unavailable' });

      mocks.rpcResult = { error: { code: 'XX000', message: 'sensitive database detail' } };
      await expect(requestVariantRestockAlertAction('g100', VARIANT_ID)).resolves.toEqual({ ok: false, error: 'unavailable' });
    });
  });
});

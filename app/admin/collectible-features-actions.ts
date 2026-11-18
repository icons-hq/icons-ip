'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { COLLECTIBLE_FEATURES_PATH, collectibleFeaturesError, parseAdminCollectibleFeatures,
  type AdminCollectibleFeaturesState } from '@/lib/admin/collectible-features';
import { COLLECTIBLE_FEATURES_CACHE_TAG } from '@/lib/collectible-features';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type CollectibleFeaturesResult = { state: AdminCollectibleFeaturesState } | { error: string; uncertain?: boolean };

/** 카드 바인더·굿즈 마켓·카드 트레이드 공개 여부를 한 번에 저장한다. 같은 요청 ID는 같은 결과를 다시 읽는다. */
export async function saveCollectibleFeaturesAction(binder: unknown, market: unknown, exchange: unknown, expectedRevision: unknown,
  operationId: unknown): Promise<CollectibleFeaturesResult> {
  try {
    if (!await requireAdminActionAccess(COLLECTIBLE_FEATURES_PATH, { capability: 'platform.manage', adminOnly: true })) {
      return { error: collectibleFeaturesError('42501') };
    }
    if (typeof binder !== 'boolean' || typeof market !== 'boolean' || typeof exchange !== 'boolean' || typeof expectedRevision !== 'number'
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !isUuid(operationId)) return { error: collectibleFeaturesError('22023') };
    const { data, error } = await (await createClient()).rpc('admin_save_collectible_features', {
      p_binder: binder, p_market: market, p_exchange: exchange, p_expected_revision: expectedRevision, p_operation_id: operationId,
    });
    if (error) {
      const known = error.code === 'PT409' || ['42501', '28000', '22023'].includes(error.code ?? '');
      return known ? { error: collectibleFeaturesError(error.code, error.message) } : { error: collectibleFeaturesError(), uncertain: true };
    }
    const state = parseAdminCollectibleFeatures(data);
    if (!state || state.binder !== binder || state.market !== market || state.exchange !== exchange) return { error: collectibleFeaturesError(), uncertain: true };
    /* 셸 진입점은 쿠키 없는 캐시로 읽는다(lib/collectible-features.server.ts). 저장 직후 태그를 즉시 만료하고(서버 액션 전용 updateTag),
       그 값으로 그려 둔 정적 페이지도 다시 그리게 한다. 라우트·서버 동작은 원래 매 요청 DB를 읽는다. */
    updateTag(COLLECTIBLE_FEATURES_CACHE_TAG);
    revalidatePath('/', 'layout');
    return { state };
  } catch (error) { unstable_rethrow(error); return { error: collectibleFeaturesError(), uncertain: true }; }
}

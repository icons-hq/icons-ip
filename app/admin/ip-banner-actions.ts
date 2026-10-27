'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hasAdminCapability } from '@/lib/admin/access';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { isIpHallBannerImagePath } from '@/lib/ip-hall-banner';
import { createClient } from '@/lib/supabase/server';

/*
 * IP관 PC/MO 배너 저장(11 IP-06 · L8b). IP 기본정보 폼(admin_upsert_ip)과 따로 저장한다 — 그 RPC 의 저장 의도 계약을
 * 건드리지 않고, 배너 두 칸만 감사 RPC(admin_save_ip_hall_banner, platform.manage)로 바꾼다. 업로드 클레임 소비·형식 검사는
 * RPC 와 테이블 트리거가 다시 한다. IP관 화면은 요청마다 그려지므로 경로 재검증만 한다.
 */

export interface AdminIpHallBannerActionState {
  errors?: {
    imagePath?: string;
    mobileImagePath?: string;
    form?: string;
  };
  message?: string;
}

const CATALOG_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PATH_ERROR = '검증된 IP 이미지를 업로드해주세요.';
const SAVE_ERROR = 'IP관 배너를 저장하지 못했습니다. 다시 시도해주세요.';

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

function readPath(formData: FormData, key: string): string | null | false {
  const raw = formData.get(key);
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  return isIpHallBannerImagePath(value) ? value : false;
}

function bannerRpcError(error: { code?: unknown; message?: unknown }): NonNullable<AdminIpHallBannerActionState['errors']> {
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';
  if (message.includes('unverified_artwork')) return { form: '업로드 확인이 끝나지 않았거나 만료된 이미지입니다. 이미지를 다시 업로드해주세요.' };
  if (message.includes('invalid_ip_banner_image_path')) return { form: PATH_ERROR };
  if (message.includes('catalog_record_missing')) return { form: 'IP를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.' };
  if (code === '42501' || code === '28000' || /forbidden|auth_required|operator_/.test(message)) return { form: '관리자 권한이 필요합니다.' };
  return { form: SAVE_ERROR };
}

export async function saveAdminIpHallBannerAction(
  _state: AdminIpHallBannerActionState,
  formData: FormData,
): Promise<AdminIpHallBannerActionState> {
  const rawId = formData.get('ipId');
  const ipId = typeof rawId === 'string' ? rawId.trim() : '';
  const imagePath = readPath(formData, 'hallBannerImagePath');
  const mobileImagePath = readPath(formData, 'hallBannerMobileImagePath');
  if (!CATALOG_ID_PATTERN.test(ipId)) return { errors: { form: '올바른 IP ID가 필요합니다.' } };
  if (imagePath === false || mobileImagePath === false) {
    return {
      errors: {
        ...(imagePath === false ? { imagePath: PATH_ERROR } : {}),
        ...(mobileImagePath === false ? { mobileImagePath: PATH_ERROR } : {}),
      },
    };
  }

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return { errors: { form: SAVE_ERROR } };
  }
  if (!auth.isConfigured) return { errors: { form: SAVE_ERROR } };
  if (!auth.user) redirect(loginPath());
  if (!auth.isStaff || !hasAdminCapability(auth, 'platform.manage')) return { errors: { form: '관리자 권한이 필요합니다.' } };

  let error: { code?: unknown; message?: unknown } | null;
  try {
    const supabase = await createClient();
    ({ error } = await supabase.rpc('admin_save_ip_hall_banner', {
      target_ip_id: ipId,
      target_image_path: imagePath,
      target_mobile_image_path: mobileImagePath,
    }));
  } catch {
    return { errors: { form: SAVE_ERROR } };
  }
  if (error) return { errors: bannerRpcError(error) };

  revalidatePath('/ip/[id]', 'page');
  revalidatePath('/admin/catalog/ips');
  revalidatePath(`/admin/catalog/ips/${ipId}`);
  return {
    message: imagePath || mobileImagePath
      ? 'IP관 배너를 저장했습니다. 공개 IP관에 바로 반영됩니다.'
      : 'IP관 배너를 비웠습니다. IP관은 키아트를 배경으로 씁니다.',
  };
}

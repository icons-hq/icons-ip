import 'server-only';
import { parseIpHallBanner, type IpHallBanner, type IpHallBannerRow } from './ip-hall-banner';
import { normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from './media';
import { createClient } from './supabase/server';

/*
 * IP관 배너 읽기(IP-06). IP관 페이지는 팔로우 상태 때문에 이미 요청마다 그려지므로 캐시 없이 이 IP 한 행만 읽는다.
 * 실패는 배너 없음(키아트 그대로)으로 수렴하고 서버 로그만 남긴다 — 배너 때문에 IP관이 깨지면 안 된다.
 */
export async function loadIpHallBanner(ipId: string): Promise<IpHallBanner | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('ips')
      .select('hall_banner_image_path,hall_banner_mobile_image_path')
      .eq('id', ipId)
      .maybeSingle();
    if (error) {
      console.error('[storefront/ip-hall-banner] read failed', { code: error.code ?? null });
      return null;
    }
    const publicUrlFor = (path: string) => supabase.storage
      .from(PUBLIC_MEDIA_BUCKET)
      .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;
    return parseIpHallBanner(data as IpHallBannerRow | null, publicUrlFor);
  } catch (error) {
    console.error('[storefront/ip-hall-banner] read failed', error instanceof Error ? error.message : String(error));
    return null;
  }
}

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  MARKETING_CONSENT_NOTICE_VERSION,
  MARKETING_CONSENT_NOTICE_VERSION_WITH_KAKAO,
  parseMarketingConsentState,
  type MarketingChannelChoices,
  type MarketingConsentSource,
  type MarketingConsentState,
} from './marketing-consent';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** 본인의 채널별 수신 동의. 읽지 못하면 null — 화면은 미동의로 그리고 저장은 서버가 다시 판정한다. */
export async function readMyMarketingConsentState(client?: SupabaseServerClient): Promise<MarketingConsentState | null> {
  try {
    const supabase = client ?? await createClient();
    const { data, error } = await supabase.rpc('my_marketing_consent_state');
    if (error) return null;
    return parseMarketingConsentState(data);
  } catch {
    return null;
  }
}

/**
 * 채널별 선택을 원장에 기록한다. 같은 선택의 재저장은 DB가 아무것도 바꾸지 않는다(멱등).
 * `state`는 응답 모양이 맞을 때만 채운다 — 저장 성공 여부는 `ok`로만 판단한다.
 */
export async function saveMyMarketingConsents(
  supabase: SupabaseServerClient,
  choices: MarketingChannelChoices,
  source: MarketingConsentSource,
): Promise<{ ok: true; state: MarketingConsentState | null } | { ok: false }> {
  /* 카카오톡 줄을 그리지 않은 저장은 예전 두 수단 RPC를 그대로 부른다(스위치 OFF면 동작 불변). */
  const { data, error } = choices.kakao === undefined
    ? await supabase.rpc('set_my_marketing_consents', {
      p_email: choices.email,
      p_sms: choices.sms,
      p_notice_version: MARKETING_CONSENT_NOTICE_VERSION,
      p_source: source,
    })
    : await supabase.rpc('set_my_marketing_consents_v2', {
      p_email: choices.email,
      p_sms: choices.sms,
      p_kakao: choices.kakao,
      p_notice_version: MARKETING_CONSENT_NOTICE_VERSION_WITH_KAKAO,
      p_source: source,
    });
  if (error) return { ok: false };
  return { ok: true, state: parseMarketingConsentState(data) };
}

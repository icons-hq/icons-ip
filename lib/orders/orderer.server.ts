import 'server-only';
import { phoneVerificationConfig, readMyVerifiedPhone } from '@/lib/sms/phone-verification.server';
import { createClient } from '@/lib/supabase/server';

/** 주문 상세·거래명세서가 보이는 주문자. 주문 시점 스냅샷이 없어 현재 회원 정보다. */
export interface OrdererInfo {
  /** 실명 칸이 없어 닉네임이다. 비어 있으면 '회원'. */
  name: string;
  email: string | null;
  /** 인증 휴대폰의 마스킹 번호. 휴대폰 인증 스위치가 꺼져 있거나 인증 전이면 null. */
  maskedPhone: string | null;
}

/** `getCurrentAuthState()` 결과를 그대로 넘길 수 있게 user·profile이 비어 있을 수 있다. */
export interface OrdererAuthSource {
  user: { email: string | null } | null;
  profile: { nickname?: string | null; email?: string | null } | null;
}

export const ORDERER_FALLBACK_NAME = '회원';

async function readMaskedPhone(): Promise<string | null> {
  if (!phoneVerificationConfig()) return null;
  try {
    const phone = await readMyVerifiedPhone(await createClient());
    return phone?.verified ? phone.maskedPhone : null;
  } catch {
    return null;
  }
}

/**
 * 주문자 정보를 만든다. 이름 = 닉네임(없으면 '회원'), 이메일 = 프로필 이메일 ?? 로그인 이메일,
 * 휴대폰 = 휴대폰 인증이 켜져 있고 인증된 회원의 마스킹 번호(그 밖은 null). 읽기 실패는 휴대폰만 비운다.
 */
export async function loadOrdererInfo(auth: OrdererAuthSource): Promise<OrdererInfo> {
  const email = auth.profile?.email?.trim() || auth.user?.email?.trim() || null;
  return {
    name: auth.profile?.nickname?.trim() || ORDERER_FALLBACK_NAME,
    email,
    maskedPhone: auth.user ? await readMaskedPhone() : null,
  };
}

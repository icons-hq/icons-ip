import type { SupabaseClient } from '@supabase/supabase-js';
import { totpErrorMessage } from '@/lib/admin/mfa';

/*
 * 운영자 인증 앱(TOTP) 브라우저 흐름의 공용 조각. 등록·확인은 GoTrue MFA API가 하고(로그인한 본인 세션),
 * 확인에 성공하면 브라우저 클라이언트가 aal2 세션을 쿠키에 저장한다. 서버 가드는 다음 요청부터 그 세션을 본다.
 */

export interface TotpFactor { id: string; friendlyName: string | null; status: 'verified' | 'unverified'; createdAt: string }
export interface TotpEnrollment { factorId: string; qrCode: string; secret: string }
export type TotpResult<T> = { ok: true; value: T } | { ok: false; error: string };

type Factor = { id: string; factor_type: string; status: string; friendly_name?: string | null; created_at: string };

export async function listTotpFactors(supabase: SupabaseClient): Promise<TotpResult<TotpFactor[]>> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return { ok: false, error: totpErrorMessage(error) };
  const factors = (data.all as Factor[]).filter((factor) => factor.factor_type === 'totp');
  return { ok: true, value: factors.map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name ?? null,
    status: factor.status === 'verified' ? 'verified' : 'unverified', createdAt: factor.created_at })) };
}

/** 이전에 끝내지 않은 등록(미확인)을 지우고 새로 등록한다. 미확인 등록은 aal1에서도 지울 수 있다. */
export async function startTotpEnrollment(supabase: SupabaseClient, leftovers: readonly TotpFactor[], now = new Date()): Promise<TotpResult<TotpEnrollment>> {
  for (const factor of leftovers) {
    if (factor.status === 'verified') continue;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return { ok: false, error: totpErrorMessage(error) };
  }
  const stamp = now.toISOString().slice(0, 19).replace('T', ' ');
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `ICONS 어드민 ${stamp}`, issuer: 'ICONS 어드민' });
  if (error || !data || data.type !== 'totp') return { ok: false, error: totpErrorMessage(error) };
  return { ok: true, value: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

export async function verifyTotp(supabase: SupabaseClient, factorId: string, code: string): Promise<TotpResult<null>> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  return error ? { ok: false, error: totpErrorMessage(error) } : { ok: true, value: null };
}

/** 6자리 숫자만 남긴다(붙여넣기의 공백·하이픈 허용). */
export function normalizeTotpCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  phoneVerificationConfig,
  requestPhoneVerificationCode,
  verifyPhoneVerificationCode,
} from '@/lib/sms/phone-verification.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/*
 * 휴대폰 번호 인증(10/14 회의 1014-005·006) 서버 액션. 온보딩과 설정이 같은 두 액션을 쓴다.
 * 스위치(ICONS_PHONE_VERIFICATION_ENABLED)가 꺼져 있거나 설정이 모자라면 아무것도 보내지 않고 닫힌다.
 */

export interface PhoneVerificationActionState {
  stage?: 'code_sent' | 'verified';
  /** 이 결과가 가리키는 인증 요청. 확인 결과는 보낸 요청 id를 그대로 돌려줘 화면이 지난 요청의 결과와 섞지 않는다. */
  challengeId?: string;
  maskedPhone?: string;
  message?: string;
  /** 이 요청으로는 더 확인할 수 없다(만료·5회 오입력 등) — 화면은 번호 입력으로 돌아간다. */
  restart?: boolean;
  errors?: {
    phone?: string;
    code?: string;
    form?: string;
  };
}

const UNAVAILABLE = '지금은 휴대폰 번호 인증을 사용할 수 없어요.';
const LOGIN_REQUIRED = '로그인한 뒤 휴대폰 번호를 인증할 수 있어요.';

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/* Vercel이 덮어쓰는 접속 IP 헤더. 없으면 IP 한도 없이 회원·번호 한도만 적용된다. */
async function requestIp(): Promise<string | null> {
  const list = await headers();
  const value = list.get('x-real-ip') ?? list.get('x-forwarded-for')?.split(',')[0] ?? '';
  const ip = value.trim();
  return ip && ip.length <= 64 ? ip : null;
}

async function currentUserId(): Promise<string | null> {
  if (!getSupabaseConfig().isConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : data.user.id;
}

export async function requestPhoneCodeAction(
  _state: PhoneVerificationActionState,
  formData: FormData,
): Promise<PhoneVerificationActionState> {
  const config = phoneVerificationConfig();
  if (!config) return { errors: { form: UNAVAILABLE } };
  const userId = await currentUserId();
  if (!userId) return { errors: { form: LOGIN_REQUIRED } };

  try {
    const result = await requestPhoneVerificationCode({
      userId,
      countryIso: readString(formData, 'phoneCountry'),
      phone: readString(formData, 'phone'),
      ip: await requestIp(),
    }, { config });
    if (!result.ok) return { errors: { [result.field]: result.error } };
    return {
      stage: 'code_sent',
      challengeId: result.challengeId,
      maskedPhone: result.maskedPhone,
      message: `${result.maskedPhone}로 인증번호를 보냈어요. 5분 안에 입력해주세요.`,
    };
  } catch {
    return { errors: { form: '인증번호를 보내지 못했어요. 잠시 후 다시 시도해주세요.' } };
  }
}

export async function verifyPhoneCodeAction(
  state: PhoneVerificationActionState,
  formData: FormData,
): Promise<PhoneVerificationActionState> {
  const config = phoneVerificationConfig();
  if (!config) return { errors: { form: UNAVAILABLE } };
  const userId = await currentUserId();
  if (!userId) return { errors: { form: LOGIN_REQUIRED } };

  const challengeId = readString(formData, 'challengeId');
  const maskedPhone = readString(formData, 'maskedPhone').slice(0, 40) || state.maskedPhone;
  try {
    const result = await verifyPhoneVerificationCode({ userId, challengeId, code: readString(formData, 'code') }, { config });
    if (!result.ok) {
      return result.restart
        ? { challengeId, restart: true, errors: { form: result.error } }
        : { stage: 'code_sent', challengeId, maskedPhone, errors: { [result.field]: result.error } };
    }
  } catch {
    return { stage: 'code_sent', challengeId, maskedPhone, errors: { form: '인증번호를 확인하지 못했어요. 잠시 후 다시 시도해주세요.' } };
  }

  revalidatePath('/onboarding');
  revalidatePath('/settings');
  return { stage: 'verified', challengeId, maskedPhone, message: '휴대폰 번호를 인증했어요.' };
}

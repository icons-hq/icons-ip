'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { EMAIL_CHANGE_CODE_TTL_SECONDS } from '@/lib/auth/email-change';
import { emailChangeConfig, notifyPreviousEmail, requestEmailChangeCode, verifyEmailChangeCode } from '@/lib/auth/email-change.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/*
 * 로그인 이메일이 쓸 수 없는 주소(Apple 이메일 가리기 릴레이·빈 값)인 회원의 이메일 변경 서버 액션(2026-11-17).
 * 온보딩과 설정이 같은 두 액션을 쓴다. 대상 계정인지는 DB가 다시 판정한다(화면이 열어 줬다고 믿지 않는다).
 */

export interface EmailChangeActionState {
  stage?: 'code_sent' | 'changed';
  /** 이 결과가 가리키는 요청. 확인 결과는 보낸 요청 id를 그대로 돌려줘 화면이 지난 요청 결과와 섞지 않는다. */
  challengeId?: string;
  email?: string;
  message?: string;
  /** 이 요청으로는 더 확인할 수 없다(만료·5회 오입력·이미 쓰는 주소 등) — 화면은 이메일 입력으로 돌아간다. */
  restart?: boolean;
  errors?: {
    email?: string;
    code?: string;
    form?: string;
  };
}

const UNAVAILABLE = '지금은 이메일을 바꿀 수 없어요. 잠시 후 다시 시도해주세요.';
const LOGIN_REQUIRED = '로그인한 뒤 이메일을 바꿀 수 있어요.';

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/* Vercel이 덮어쓰는 접속 IP 헤더. 없으면 IP 한도 없이 회원·주소 한도만 적용된다. */
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

export async function requestEmailChangeCodeAction(
  _state: EmailChangeActionState,
  formData: FormData,
): Promise<EmailChangeActionState> {
  const config = emailChangeConfig();
  if (!config) return { errors: { form: UNAVAILABLE } };
  const userId = await currentUserId();
  if (!userId) return { errors: { form: LOGIN_REQUIRED } };

  try {
    const result = await requestEmailChangeCode({ userId, email: readString(formData, 'email'), ip: await requestIp() }, { config });
    if (!result.ok) return { errors: { [result.field]: result.error } };
    return {
      stage: 'code_sent',
      challengeId: result.challengeId,
      email: result.email,
      message: `${result.email}로 인증 코드를 보냈어요. ${Math.round(EMAIL_CHANGE_CODE_TTL_SECONDS / 60)}분 안에 입력해주세요.`,
    };
  } catch {
    return { errors: { form: '인증 코드를 보내지 못했어요. 잠시 후 다시 시도해주세요.' } };
  }
}

export async function verifyEmailChangeCodeAction(
  state: EmailChangeActionState,
  formData: FormData,
): Promise<EmailChangeActionState> {
  const config = emailChangeConfig();
  if (!config) return { errors: { form: UNAVAILABLE } };
  const userId = await currentUserId();
  if (!userId) return { errors: { form: LOGIN_REQUIRED } };

  const challengeId = readString(formData, 'challengeId');
  const email = readString(formData, 'email').slice(0, 254) || state.email;
  let changedEmail: string;
  let previousEmail: string | null;
  try {
    const result = await verifyEmailChangeCode({ userId, challengeId, code: readString(formData, 'code') }, { config });
    if (!result.ok) {
      return result.restart
        ? { challengeId, restart: true, errors: { form: result.error } }
        : { stage: 'code_sent', challengeId, email, errors: { [result.field]: result.error } };
    }
    changedEmail = result.email;
    previousEmail = result.previousEmail;
  } catch {
    return { stage: 'code_sent', challengeId, email, errors: { form: '인증 코드를 확인하지 못했어요. 잠시 후 다시 시도해주세요.' } };
  }

  /* 세션을 가로챈 변경을 본인이 알아챌 수 있게 이전 주소로 알린다(응답 뒤, 최선 시도). */
  after(async () => {
    await notifyPreviousEmail(config, { previousEmail, newEmail: changedEmail, challengeId });
  });
  /* 온보딩은 이 조각만 이메일을 보여 주므로 다시 그리지 않는다 — 다시 그리면 대상이 아니게 된 조각이 사라져 완료 안내가
     보이지 않는다. 설정은 프로필 칸의 이메일도 바뀌어야 하므로 다시 그린다. */
  if (readString(formData, 'context') !== 'onboarding') revalidatePath('/settings');
  return { stage: 'changed', challengeId, email: changedEmail, message: `이메일을 ${changedEmail}로 바꿨어요.` };
}

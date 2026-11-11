import 'server-only';

import { contactChannelsLegalGateOpen, envSwitchOn } from '@/lib/auth/contact-channels';

/*
 * 카카오톡 채널(10/14 회의 1014-014, 1014-010의 카카오톡 수단) 런타임 설정. 기본 OFF.
 *
 * 켜지면 (1) 카카오 로그인 동의 화면에 채널 추가 항목이 보이도록 카카오 로그인에 plusfriends 동의항목을 요청하고,
 * (2) 채널을 친구로 추가한 회원에게 운영자가 정한 쿠폰을 한 번 발급하며(로그인·온보딩 완료·채널 웹훅에서 확인),
 * (3) 수단별 마케팅 수신 동의에 카카오톡 줄을 보인다.
 * 채널 추가 항목 자체는 카카오 개발자 콘솔 설정(비즈 앱·채널 연결·대표 채널·plusfriends 동의항목)이 그린다 —
 * 콘솔 설정 없이 plusfriends를 요청하면 카카오가 로그인을 거절하므로(KOE205) 콘솔을 먼저 맞추고 스위치를 켠다.
 * 값이 하나라도 비거나 형식이 어긋나면 null이다(fail closed). 어드민 키는 서버 env로만 받고 남기지 않는다.
 */

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface KakaoChannelConfig {
  /** 카카오톡 채널 프로필 ID(예: _AbCdEf). */
  channelPublicId: string;
  /** 카카오 앱의 대표 어드민 키. 채널 관계 조회(어드민 키 방식)와 채널 웹훅 인증에 쓴다. */
  adminKey: string;
  /** 친구 추가 쿠폰의 쿠폰 코드(어드민 쿠폰 화면에서 만든 정의). 비어 있으면 채널 추가만 받고 쿠폰은 발급하지 않는다. */
  couponCode: string | null;
}

const CHANNEL_PUBLIC_ID = /^_[A-Za-z0-9]{1,64}$/;
const ADMIN_KEY = /^[A-Za-z0-9]{16,128}$/;
const COUPON_CODE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

export function kakaoChannelConfig(env: RuntimeEnvironment = process.env, now: Date = new Date()): KakaoChannelConfig | null {
  if (!envSwitchOn(env, 'ICONS_KAKAO_CHANNEL_ENABLED')) return null;
  if (!contactChannelsLegalGateOpen(env, now)) return null;
  const channelPublicId = env.KAKAO_CHANNEL_PUBLIC_ID?.trim() ?? '';
  const adminKey = env.KAKAO_ADMIN_KEY?.trim() ?? '';
  if (!CHANNEL_PUBLIC_ID.test(channelPublicId) || !ADMIN_KEY.test(adminKey)) return null;
  const couponCode = env.ICONS_KAKAO_CHANNEL_COUPON_CODE?.trim() ?? '';
  if (couponCode && !COUPON_CODE.test(couponCode)) return null;
  return { channelPublicId, adminKey, couponCode: couponCode || null };
}

/** 카카오 로그인에 더해 요청하는 동의항목. 스위치가 꺼져 있으면 아무것도 더하지 않는다(로그인 요청 불변). */
export const KAKAO_CHANNEL_LOGIN_SCOPE = 'plusfriends';

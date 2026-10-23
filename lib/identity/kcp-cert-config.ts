import 'server-only';

import { isKorpayUuid, normalizeKorpaySiteUrl } from '@/lib/payments/korpay-config.mjs';

/*
 * NHN KCP 휴대폰 본인확인 V2 런타임 설정과 성인 인증 rollout gate.
 *
 * 설정이 하나라도 비거나 형식이 어긋나면 null이다 — 인증을 시작하지도, 결과를
 * 처리하지도 않는다(fail closed). 사이트코드·인증키·웹사이트코드는 KCP와 가맹점 사이의
 * 보안 유지 값이라 저장소·문서·로그에 남기지 않고 환경변수로만 받는다.
 *
 * 환경과 모드는 짝이 맞아야 한다. 운영 배포는 운영 모드(cert.kcp.co.kr)만, Preview·
 * 로컬은 테스트 모드(testcert.kcp.co.kr)만 쓴다 — Preview에 운영 자격 증명을 두지
 * 않는다는 ADR-0006 경계를 본인확인에도 그대로 적용한다.
 */

export type KcpCertMode = 'test' | 'production';

export interface KcpCertConfiguration {
  readonly mode: KcpCertMode;
  readonly siteCode: string;
  readonly encKey: string;
  /** DI(중복가입확인정보) 발급 기준. 운영에서는 계약 시 받은 값을 반드시 넘긴다. */
  readonly webSiteId: string | null;
  readonly registrationUrl: string;
  readonly resultUrl: string;
  /** 거래등록 응답의 인증창 주소가 이 origin이어야 브라우저를 보낸다. */
  readonly certWindowOrigin: string;
  /** Ret_URL의 origin. 운영은 https://iconsip.com 하나다. */
  readonly siteOrigin: string;
  /** DI·KCP 거래번호를 키 해시로 바꾸는 서버 비밀값. 바뀌면 1명의 1계정 연속성이 끊긴다. */
  readonly digestSecret: string;
}

const KCP_ORIGINS: Record<KcpCertMode, string> = {
  test: 'https://testcert.kcp.co.kr',
  production: 'https://cert.kcp.co.kr',
};

/** KCP 개발자센터가 공개 예시로 쓰는 공용 테스트 사이트코드. 운영에 들어오면 설정 오류다. */
const KCP_PUBLIC_TEST_SITE_CODE = 'AO7F3';

const SITE_CODE = /^[A-Z0-9]{5}$/;
const ENC_KEY = /^[\x21-\x7e]{16,256}$/;
const WEB_SITE_ID = /^[A-Za-z0-9]{12}$/;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function trimmed(value: string | undefined) {
  const result = value?.trim();
  return result ? result : null;
}

export function kcpCertConfiguration(env: RuntimeEnvironment = process.env): KcpCertConfiguration | null {
  const mode = trimmed(env.KCP_CERT_MODE);
  if (mode !== 'test' && mode !== 'production') return null;

  const production = env.VERCEL_ENV === 'production';
  if (production !== (mode === 'production')) return null;

  const siteCode = trimmed(env.KCP_CERT_SITE_CODE);
  const encKey = trimmed(env.KCP_CERT_ENC_KEY);
  const webSiteId = trimmed(env.KCP_CERT_WEB_SITE_ID);
  const digestSecret = trimmed(env.ADULT_VERIFICATION_DIGEST_SECRET);
  if (
    !siteCode || !SITE_CODE.test(siteCode)
    || !encKey || !ENC_KEY.test(encKey)
    || (webSiteId !== null && !WEB_SITE_ID.test(webSiteId))
    || !digestSecret || digestSecret.length < 32 || digestSecret.length > 512
  ) {
    return null;
  }

  if (mode === 'production' && (siteCode === KCP_PUBLIC_TEST_SITE_CODE || webSiteId === null)) {
    return null;
  }

  const siteOrigin = normalizeKorpaySiteUrl(env.SITE_URL?.trim() ?? '', { production });
  if (!siteOrigin) return null;

  const origin = KCP_ORIGINS[mode];
  return {
    mode,
    siteCode,
    encKey,
    webSiteId,
    registrationUrl: `${origin}/api/reg/certDataReg.do`,
    resultUrl: `${origin}/api/query/getCertData.do`,
    certWindowOrigin: origin,
    siteOrigin,
    digestSecret,
  };
}

export function kcpCertConfigured(env: RuntimeEnvironment = process.env) {
  return kcpCertConfiguration(env) !== null;
}

/**
 * 새 성인 인증을 시작할 수 있는가. 설정이 완성돼 있고, 공개 스위치가 켜졌거나 이
 * 사용자가 단일 canary다. 결과 콜백 처리는 이 gate가 아니라 설정 여부만 본다 — gate를
 * 닫아도 이미 인증창에 들어간 사용자의 결과는 끝까지 처리된다.
 */
export function adultVerificationEnabledFor(
  userId: string | null | undefined,
  env: RuntimeEnvironment = process.env,
) {
  if (!kcpCertConfigured(env)) return false;
  if (env.ADULT_VERIFICATION_ENABLED === 'true') return true;
  const canary = env.ADULT_VERIFICATION_CANARY_USER_ID;
  return typeof userId === 'string'
    && isKorpayUuid(userId)
    && typeof canary === 'string'
    && isKorpayUuid(canary)
    && userId === canary;
}

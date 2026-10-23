import { describe, expect, it } from 'vitest';

import { adultVerificationEnabledFor, kcpCertConfiguration, kcpCertConfigured } from './kcp-cert-config';

const CANARY = '00000000-0000-4000-8000-0000000a1901';

/* 형식만 맞춘 가짜 값이다. 실제 사이트코드·인증키가 아니다. */
const testEnvironment = {
  KCP_CERT_MODE: 'test',
  KCP_CERT_SITE_CODE: 'T0001',
  KCP_CERT_ENC_KEY: 'unit-test-enc-key-0123456789abcdef',
  ADULT_VERIFICATION_DIGEST_SECRET: 'unit-test-digest-secret-0123456789abcdef',
  SITE_URL: 'http://localhost:3100',
};

const productionEnvironment = {
  VERCEL_ENV: 'production',
  KCP_CERT_MODE: 'production',
  KCP_CERT_SITE_CODE: 'P0001',
  KCP_CERT_ENC_KEY: 'unit-test-production-enc-key-0123456789',
  KCP_CERT_WEB_SITE_ID: 'X00000000001',
  ADULT_VERIFICATION_DIGEST_SECRET: 'unit-test-digest-secret-0123456789abcdef',
  SITE_URL: 'https://iconsip.com',
};

describe('kcpCertConfiguration', () => {
  it('테스트 모드는 테스트 서버 주소와 사이트 origin을 쓴다', () => {
    expect(kcpCertConfiguration(testEnvironment)).toEqual({
      mode: 'test',
      siteCode: 'T0001',
      encKey: testEnvironment.KCP_CERT_ENC_KEY,
      webSiteId: null,
      registrationUrl: 'https://testcert.kcp.co.kr/api/reg/certDataReg.do',
      resultUrl: 'https://testcert.kcp.co.kr/api/query/getCertData.do',
      certWindowOrigin: 'https://testcert.kcp.co.kr',
      siteOrigin: 'http://localhost:3100',
      digestSecret: testEnvironment.ADULT_VERIFICATION_DIGEST_SECRET,
    });
  });

  it('운영 모드는 운영 서버와 iconsip.com만 쓴다', () => {
    const config = kcpCertConfiguration(productionEnvironment);
    expect(config?.registrationUrl).toBe('https://cert.kcp.co.kr/api/reg/certDataReg.do');
    expect(config?.resultUrl).toBe('https://cert.kcp.co.kr/api/query/getCertData.do');
    expect(config?.siteOrigin).toBe('https://iconsip.com');
    expect(config?.webSiteId).toBe('X00000000001');
  });

  it('환경과 모드가 엇갈리면 닫는다 — Preview에 운영 자격 증명, 운영에 테스트 서버를 두지 않는다', () => {
    expect(kcpCertConfiguration({ ...productionEnvironment, VERCEL_ENV: 'preview' })).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, VERCEL_ENV: 'production', SITE_URL: 'https://iconsip.com' })).toBeNull();
  });

  it('운영은 공용 테스트 사이트코드와 웹사이트코드 누락을 거절한다', () => {
    expect(kcpCertConfiguration({ ...productionEnvironment, KCP_CERT_SITE_CODE: 'AO7F3' })).toBeNull();
    expect(kcpCertConfiguration({ ...productionEnvironment, KCP_CERT_WEB_SITE_ID: '' })).toBeNull();
  });

  it('운영 Ret_URL origin은 iconsip.com 하나다', () => {
    expect(kcpCertConfiguration({ ...productionEnvironment, SITE_URL: 'https://icons-ip.vercel.app' })).toBeNull();
    expect(kcpCertConfiguration({ ...productionEnvironment, SITE_URL: 'https://iconsip.com/path' })).toBeNull();
  });

  it('운영 밖에서는 https와 로컬 개발 호스트의 http만 Ret_URL origin으로 받는다', () => {
    expect(kcpCertConfiguration({ ...testEnvironment, SITE_URL: 'http://kcp-adult.localhost:3110' })?.siteOrigin)
      .toBe('http://kcp-adult.localhost:3110');
    expect(kcpCertConfiguration({ ...testEnvironment, VERCEL_ENV: 'preview', SITE_URL: 'https://icons-ip.vercel.app' })?.siteOrigin)
      .toBe('https://icons-ip.vercel.app');
    expect(kcpCertConfiguration({ ...testEnvironment, SITE_URL: 'http://example.test' })).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, SITE_URL: 'https://example.test/path' })).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, SITE_URL: ' https://example.test' })).toBeNull();
  });

  it('비어 있거나 형식이 어긋난 값은 fail closed다', () => {
    expect(kcpCertConfiguration({})).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, KCP_CERT_MODE: 'sandbox' })).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, KCP_CERT_SITE_CODE: 'abc12' })).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, KCP_CERT_ENC_KEY: 'short' })).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, KCP_CERT_WEB_SITE_ID: 'too-short' })).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, ADULT_VERIFICATION_DIGEST_SECRET: 'short-secret' })).toBeNull();
    expect(kcpCertConfiguration({ ...testEnvironment, SITE_URL: '' })).toBeNull();
    expect(kcpCertConfigured({ ...testEnvironment, SITE_URL: 'ftp://localhost' })).toBe(false);
  });
});

describe('adultVerificationEnabledFor', () => {
  it('설정이 없으면 공개 스위치가 켜져도 닫혀 있다', () => {
    expect(adultVerificationEnabledFor(CANARY, { ADULT_VERIFICATION_ENABLED: 'true' })).toBe(false);
  });

  it('공개 스위치가 켜지면 모든 로그인 사용자에게 열린다', () => {
    expect(adultVerificationEnabledFor(CANARY, { ...testEnvironment, ADULT_VERIFICATION_ENABLED: 'true' })).toBe(true);
  });

  it('공개 스위치가 꺼져 있으면 단일 canary만 열린다', () => {
    const env = { ...testEnvironment, ADULT_VERIFICATION_CANARY_USER_ID: CANARY };
    expect(adultVerificationEnabledFor(CANARY, env)).toBe(true);
    expect(adultVerificationEnabledFor('00000000-0000-4000-8000-0000000a1902', env)).toBe(false);
    expect(adultVerificationEnabledFor(null, env)).toBe(false);
    expect(adultVerificationEnabledFor(CANARY, { ...testEnvironment, ADULT_VERIFICATION_CANARY_USER_ID: 'not-a-uuid' })).toBe(false);
  });
});

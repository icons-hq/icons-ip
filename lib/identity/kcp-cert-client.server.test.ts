import { describe, expect, it, vi } from 'vitest';

import { fetchKcpCertResult, KcpCertRequestError, registerKcpCertTransaction } from './kcp-cert-client.server';
import type { KcpCertConfiguration } from './kcp-cert-config';
import { decryptKcpCertPayload, encryptKcpCertPayload } from './kcp-cert-crypto';

const config: KcpCertConfiguration = {
  mode: 'test',
  siteCode: 'T0001',
  encKey: 'unit-test-enc-key-0123456789abcdef',
  webSiteId: 'X00000000001',
  registrationUrl: 'https://testcert.kcp.co.kr/api/reg/certDataReg.do',
  resultUrl: 'https://testcert.kcp.co.kr/api/query/getCertData.do',
  certWindowOrigin: 'https://testcert.kcp.co.kr',
  siteOrigin: 'https://example.test',
  digestSecret: 'unit-test-digest-secret-0123456789abcdef',
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('registerKcpCertTransaction', () => {
  it('요청 전문을 암호화해 enc_data 본문과 site_cd·rv 헤더로 보낸다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      res_cd: '0000',
      res_msg: '정상처리',
      call_url: 'https://testcert.kcp.co.kr/certGateway.do',
      reg_cert_key: '1234567890123456',
    }));

    const result = await registerKcpCertTransaction(config, {
      providerOrderId: 'IV00000000000000000000000000000001',
      returnUrl: 'https://example.test/api/identity/kcp/return/nonce',
    }, fetchImpl);

    expect(result).toEqual({ callUrl: 'https://testcert.kcp.co.kr/certGateway.do', registrationKey: '1234567890123456' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(config.registrationUrl);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    const headers = init.headers as Record<string, string>;
    expect(headers.site_cd).toBe('T0001');
    expect(Buffer.from(headers.rv, 'base64')).toHaveLength(16);

    const sent = decryptKcpCertPayload(init.body as string, headers.rv, config.encKey, config.siteCode);
    expect(sent).toEqual({
      site_cd: 'T0001',
      ordr_idxx: 'IV00000000000000000000000000000001',
      Ret_URL: 'https://example.test/api/identity/kcp/return/nonce',
      web_siteid: 'X00000000001',
      param_opt_1: '',
      param_opt_2: '',
      param_opt_3: '',
    });
  });

  it('실패 코드는 DB 어휘 코드로 바꾼다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ res_cd: 'S302', res_msg: '사이트코드 오류' }));
    await expect(registerKcpCertTransaction(config, { providerOrderId: 'IV1', returnUrl: 'https://example.test/r' }, fetchImpl))
      .rejects.toMatchObject({ code: 'kcp_registration_s302' });
  });

  it('우리가 부른 KCP 환경이 아닌 인증창 주소로는 브라우저를 보내지 않는다', async () => {
    for (const callUrl of ['https://evil.test/certGateway.do', 'http://testcert.kcp.co.kr/certGateway.do', 'https://cert.kcp.co.kr/certGateway.do']) {
      const fetchImpl = vi.fn(async () => jsonResponse({ res_cd: '0000', call_url: callUrl, reg_cert_key: '1234567890123456' }));
      await expect(registerKcpCertTransaction(config, { providerOrderId: 'IV1', returnUrl: 'https://example.test/r' }, fetchImpl))
        .rejects.toMatchObject({ code: 'kcp_registration_invalid' });
    }
  });

  it('네트워크·HTTP·형식 오류는 각각 코드로 닫는다', async () => {
    await expect(registerKcpCertTransaction(config, { providerOrderId: 'IV1', returnUrl: 'https://example.test/r' }, vi.fn(async () => {
      throw new TypeError('fetch failed');
    }))).rejects.toMatchObject({ code: 'kcp_registration_network' });
    await expect(registerKcpCertTransaction(config, { providerOrderId: 'IV1', returnUrl: 'https://example.test/r' }, vi.fn(async () => (
      new Response('busy', { status: 503 })
    )))).rejects.toMatchObject({ code: 'kcp_registration_http' });
    await expect(registerKcpCertTransaction(config, { providerOrderId: 'IV1', returnUrl: 'https://example.test/r' }, vi.fn(async () => (
      new Response('<html>', { status: 200 })
    )))).rejects.toMatchObject({ code: 'kcp_registration_invalid' });
    await expect(registerKcpCertTransaction(config, { providerOrderId: 'IV1', returnUrl: 'https://example.test/r' }, vi.fn(async () => jsonResponse({
      res_cd: '0000', call_url: 'https://testcert.kcp.co.kr/certGateway.do', reg_cert_key: 'has spaces',
    })))).rejects.toBeInstanceOf(KcpCertRequestError);
  });
});

describe('fetchKcpCertResult', () => {
  function encryptedResult(certData: Record<string, unknown>) {
    const { encData, rv } = encryptKcpCertPayload(JSON.stringify(certData), config.encKey, config.siteCode);
    return jsonResponse({ res_cd: '0000', res_msg: '정상처리', enc_cert_data: encData, rv });
  }

  const certData = {
    res_cd: '0000',
    res_msg: '정상처리',
    phone_no: '01000000000',
    user_name: '테스트',
    birth_day: '19900101',
    comm_id: 'SKT',
    sex_code: '01',
    local_code: '01',
    CI: 'ci-value',
    DI: 'di-raw',
    CI_URL: 'ci-value',
    DI_URL: 'di%2Bvalue%3D',
    per_cert_no: '25284339349648',
  };

  it('평문 JSON으로 조회하고, 판정에 필요한 세 값만 돌려준다', async () => {
    const fetchImpl = vi.fn(async () => encryptedResult(certData));
    const result = await fetchKcpCertResult(config, {
      providerOrderId: 'IV00000000000000000000000000000001',
      registrationKey: '1234567890123456',
    }, fetchImpl);

    expect(result).toEqual({ birthDay: '19900101', duplicateInfo: 'di+value=', transactionNo: '25284339349648' });
    expect(Object.keys(result).sort()).toEqual(['birthDay', 'duplicateInfo', 'transactionNo']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(config.resultUrl);
    expect(JSON.parse(init.body as string)).toEqual({
      reg_cert_key: '1234567890123456',
      ordr_idxx: 'IV00000000000000000000000000000001',
    });
    expect((init.headers as Record<string, string>).rv).toBeUndefined();
  });

  it('DI_URL이 없으면 원문 DI를 쓴다', async () => {
    const withoutUrl: Record<string, unknown> = { ...certData };
    delete withoutUrl.DI_URL;
    const result = await fetchKcpCertResult(config, { providerOrderId: 'IV1', registrationKey: '1' }, vi.fn(async () => encryptedResult(withoutUrl)));
    expect(result.duplicateInfo).toBe('di-raw');
  });

  it('조회 실패·복호화 실패·인증 실패·필수 값 누락을 각각 거절한다', async () => {
    const request = { providerOrderId: 'IV1', registrationKey: '1' };
    await expect(fetchKcpCertResult(config, request, vi.fn(async () => jsonResponse({ res_cd: '9999' }))))
      .rejects.toMatchObject({ code: 'kcp_result_9999' });
    await expect(fetchKcpCertResult(config, request, vi.fn(async () => jsonResponse({
      res_cd: '0000', enc_cert_data: Buffer.alloc(16).toString('base64'), rv: Buffer.alloc(16).toString('base64'),
    })))).rejects.toMatchObject({ code: 'kcp_result_decrypt' });
    await expect(fetchKcpCertResult(config, request, vi.fn(async () => encryptedResult({ ...certData, res_cd: '1001' }))))
      .rejects.toMatchObject({ code: 'kcp_cert_1001' });
    await expect(fetchKcpCertResult(config, request, vi.fn(async () => encryptedResult({ ...certData, birth_day: '1990-01-01' }))))
      .rejects.toMatchObject({ code: 'kcp_result_invalid' });
    await expect(fetchKcpCertResult(config, request, vi.fn(async () => encryptedResult({ ...certData, DI: '', DI_URL: '' }))))
      .rejects.toMatchObject({ code: 'kcp_result_invalid' });
    await expect(fetchKcpCertResult(config, request, vi.fn(async () => encryptedResult({ ...certData, per_cert_no: '' }))))
      .rejects.toMatchObject({ code: 'kcp_result_invalid' });
  });

  it('오류 메시지에 본인확인 값을 싣지 않는다', async () => {
    const request = { providerOrderId: 'IV1', registrationKey: '1' };
    const error = await fetchKcpCertResult(config, request, vi.fn(async () => encryptedResult({ ...certData, per_cert_no: '' })))
      .catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toMatch(/19900101|di-raw|테스트|01000000000/);
  });
});

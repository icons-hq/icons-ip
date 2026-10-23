import { describe, expect, it, vi } from 'vitest';

import { createKcpCertReturnHandler, maxDuration } from './route';

const NONCE = 'n'.repeat(43);
const TOKEN = 't'.repeat(43);

function context(nonce = NONCE) {
  return { params: Promise.resolve({ nonce }) };
}

function formPost(body: string, contentType = 'application/x-www-form-urlencoded') {
  return new Request(`https://icons.example/api/identity/kcp/return/${NONCE}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

describe('/api/identity/kcp/return/[nonce]', () => {
  it('실행 예산을 KCP 조회 시한(10초) + DB 여유로 둔다', () => {
    expect(maxDuration).toBe(30);
  });

  it('form 콜백의 res_cd·reg_cert_key만 넘기고 확정 티켓 쿠키와 함께 확정 경로로 303한다', async () => {
    const processReturn = vi.fn(async () => ({ kind: 'confirm' as const, ticket: { nonce: NONCE, token: TOKEN } }));
    const handler = createKcpCertReturnHandler({ processReturn });

    const response = await handler(formPost('res_cd=0000&res_msg=%C1%A4%BB%F3&reg_cert_key=1234567890123456&param_opt_1=x'), context());

    expect(processReturn).toHaveBeenCalledWith({ nonce: NONCE, resultCode: '0000', registrationKey: '1234567890123456' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/api/identity/adult/complete');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('set-cookie')).toBe(
      `icons_adult_verification=${NONCE}.${TOKEN}; Path=/api/identity/adult/complete; Max-Age=1800; HttpOnly; SameSite=Lax; Secure`,
    );
  });

  /* 로컬 http 개발 호스트에서는 Secure를 붙이지 않는다 — 붙이면 브라우저가 쿠키를 버린다. */
  it('http 요청에는 Secure 없이 심는다', async () => {
    const processReturn = vi.fn(async () => ({ kind: 'confirm' as const, ticket: { nonce: NONCE, token: TOKEN } }));
    const handler = createKcpCertReturnHandler({ processReturn });

    const response = await handler(new Request(`http://icons.localhost:3000/api/identity/kcp/return/${NONCE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'res_cd=0000&reg_cert_key=1234567890123456',
    }), context());

    expect(response.headers.get('set-cookie')).not.toContain('Secure');
  });

  /* 재전송·다른 브라우저의 콜백은 티켓 없이 확정 경로로 간다 — 이미 받은 쿠키가 있는 브라우저만 이어간다. */
  it('콜백을 선점하지 못한 요청에는 쿠키를 심지 않는다', async () => {
    const handler = createKcpCertReturnHandler({ processReturn: vi.fn(async () => ({ kind: 'confirm' as const, ticket: null })) });

    const response = await handler(formPost('res_cd=0000&reg_cert_key=1234567890123456'), context());

    expect(response.headers.get('location')).toBe('/api/identity/adult/complete');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('GET 쿼리 콜백도 같은 두 값만 읽는다', async () => {
    const processReturn = vi.fn(async () => ({ kind: 'confirm' as const, ticket: null }));
    const handler = createKcpCertReturnHandler({ processReturn });

    await handler(new Request(`https://icons.example/api/identity/kcp/return/${NONCE}?res_cd=3001&reg_cert_key=1234567890123456`), context());

    expect(processReturn).toHaveBeenCalledWith({ nonce: NONCE, resultCode: '3001', registrationKey: '1234567890123456' });
  });

  it('form이 아니거나 같은 필드가 겹친 콜백은 처리하지 않는다', async () => {
    const processReturn = vi.fn();
    const handler = createKcpCertReturnHandler({ processReturn });

    const json = await handler(formPost('{"res_cd":"0000"}', 'application/json'), context());
    const duplicated = await handler(formPost('res_cd=0000&res_cd=9999&reg_cert_key=1'), context());

    expect(processReturn).not.toHaveBeenCalled();
    expect(json.headers.get('location')).toBe('/my/adult-verification/result?status=invalid');
    expect(duplicated.headers.get('location')).toBe('/my/adult-verification/result?status=invalid');
  });

  it('너무 큰 본문은 읽기 전에 거절한다', async () => {
    const processReturn = vi.fn();
    const handler = createKcpCertReturnHandler({ processReturn });

    const response = await handler(formPost(`res_cd=0000&pad=${'x'.repeat(17 * 1024)}`), context());

    expect(processReturn).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=invalid');
  });

  it('우리 세션이 아닌 콜백은 invalid 결과 화면으로 보낸다', async () => {
    const handler = createKcpCertReturnHandler({ processReturn: vi.fn(async () => ({ kind: 'invalid' as const })) });
    const response = await handler(formPost('res_cd=0000&reg_cert_key=1'), context());
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=invalid');
  });

  it('처리 중 장애는 상태를 추측하지 않고 error 결과 화면으로 보낸다', async () => {
    const handler = createKcpCertReturnHandler({ processReturn: vi.fn(async () => { throw new Error('db down'); }) });
    const response = await handler(formPost('res_cd=0000&reg_cert_key=1'), context());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=error');
  });
});

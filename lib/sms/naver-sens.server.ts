import 'server-only';

import { createHmac } from 'node:crypto';
import type { SmsSender, SmsSendResult } from './sender.server';

/** 중국 국제 SMS는 등록한 법인명과 숫자 코드만 넣은 영문 템플릿을 사용한다. */
export function chinaSensSenderFromEnvironment(env: Readonly<Record<string, string | undefined>>): SmsSender | null {
  const accessKey = env.NCP_SENS_ACCESS_KEY?.trim();
  const secretKey = env.NCP_SENS_SECRET_KEY?.trim();
  const serviceId = env.NCP_SENS_SMS_SERVICE_ID?.trim() ?? '';
  const from = env.NCP_SENS_SMS_FROM?.trim() ?? '';
  if (!accessKey || !secretKey || !/^ncp:sms:kr:[0-9]+:[a-zA-Z0-9_-]+$/.test(serviceId) || !/^\d{8,15}$/.test(from)) return null;

  const path = '/sms/v2/services/' + serviceId + '/messages';
  return {
    provider: 'naver_sens',
    async send({ to, purpose, code }): Promise<SmsSendResult> {
      if (purpose !== 'phone_verification' || !code || !/^\d{6}$/.test(code) || !/^\+861\d{10}$/.test(to)) {
        return { ok: false, reason: 'rejected' };
      }
      const timestamp = String(Date.now());
      const signature = createHmac('sha256', secretKey)
        .update(['POST ' + path, timestamp, accessKey].join('\n')).digest('base64');
      let status: number | 'network' = 'network';
      try {
        const response = await fetch('https://sens.apigw.ntruss.com' + path, {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            'x-ncp-apigw-timestamp': timestamp,
            'x-ncp-iam-access-key': accessKey,
            'x-ncp-apigw-signature-v2': signature,
          },
          body: JSON.stringify({
            type: 'SMS', contentType: 'COMM', countryCode: '86', from,
            content: '[ICONS] verification: ' + code, messages: [{ to: to.slice(3) }],
          }),
        });
        status = response.status;
        if (status >= 400 && status < 500 && status !== 408) {
          console.error(`[sms:naver_sens] rejected status=${status}`);
          return { ok: false, reason: 'rejected' };
        }
        if (status === 202) {
          const receipt = await response.json();
          if (receipt?.statusCode === '202' && receipt.statusName === 'success'
            && typeof receipt.requestId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(receipt.requestId)) {
            console.info(`[sms:naver_sens] accepted requestId=${receipt.requestId}`);
            return { ok: true, providerMessageId: receipt.requestId };
          }
        }
      } catch {
        // 요청 본문이 이미 통신사로 넘어갔을 수 있다. 원격 오류에는 번호·인증번호가 포함될 수 있다.
      }
      console.error(`[sms:naver_sens] delivery unknown status=${status}`);
      return { ok: false, reason: 'unknown' };
    },
  };
}

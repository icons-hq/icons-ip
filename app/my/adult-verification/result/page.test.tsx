import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdultVerificationStatus } from '@/lib/identity/adult-verification-status';
import Page from './page';

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<AdultVerificationStatus>>(),
}));

vi.mock('@/lib/identity/adult-verification-status.server', () => ({ loadMyAdultVerification: mocks.status }));

async function render(params: Record<string, string>) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  mocks.status.mockReset().mockResolvedValue({ status: 'none' });
});

describe('/my/adult-verification/result', () => {
  it('완료는 서버의 성인 인증 상태로 확인된 경우에만 보여 준다', async () => {
    mocks.status.mockResolvedValue({ status: 'verified', verifiedAt: '2026-10-23T03:00:00Z', expiresAt: '2027-10-23T03:00:00Z' });

    const html = await render({ status: 'verified', next: '/shop/g1' });

    expect(html).toContain('성인 인증이 완료됐어요');
    expect(html).toContain('href="/shop/g1"');
  });

  /* 주소만 바꿔 "완료"를 띄우지 못한다 — 확인되지 않으면 확인 중 안내로 바꾼다. */
  it('서버에서 확인되지 않은 완료 주소는 확인 중 안내로 바꾼다', async () => {
    const html = await render({ status: 'verified', mode: 'popup' });

    expect(html).not.toContain('성인 인증이 완료됐어요');
    expect(html).toContain('인증 결과를 확인하고 있어요');
    expect(html).toContain('href="/api/identity/adult/complete"');
  });

  it('완료가 아닌 결과는 상태를 다시 읽지 않는다', async () => {
    await render({ status: 'failed' });
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('로그인이 필요하면 로그인 뒤 같은 티켓으로 결과를 이어서 확인한다', async () => {
    const html = await render({ status: 'login_required' });
    expect(html).toContain(`href="/login?next=${encodeURIComponent('/api/identity/adult/complete')}"`);
  });

  it('장애는 다시 확인하기와 처음부터 다시 인증하기를 함께 준다', async () => {
    const html = await render({ status: 'error', next: '/shop/g1' });
    expect(html).toContain('href="/api/identity/adult/complete"');
    expect(html).toContain(`href="/my/adult-verification?next=${encodeURIComponent('/shop/g1')}"`);
  });

  /* 팝업으로 끝난 결과만 원래 창으로 돌아간다. 확인 중은 팝업에서도 다시 확인하기를 보여 준다. */
  it('팝업의 최종 결과는 돌아가는 중 안내를, 확인 중은 행동을 보여 준다', async () => {
    expect(await render({ status: 'failed', mode: 'popup' })).toContain('원래 화면으로 돌아가는 중이에요.');
    const pending = await render({ status: 'pending', mode: 'popup' });
    expect(pending).not.toContain('원래 화면으로 돌아가는 중이에요.');
    expect(pending).toContain('다시 확인하기');
  });

  it('모르는 상태와 바깥 경로는 좁힌다', async () => {
    const html = await render({ status: 'hacked', next: 'https://evil.test/' });
    expect(html).toContain('유효하지 않은 인증 요청이에요');
    expect(html).not.toContain('evil.test');
  });
});

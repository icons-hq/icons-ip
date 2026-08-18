import { describe, expect, it, vi } from 'vitest';
import type { OrderCancellationRequestSummary } from '@/lib/orders';
import { claimStageNotice, submitOrderClaim } from './OrderClaimRequest';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function claim(
  overrides: Partial<OrderCancellationRequestSummary> = {},
): OrderCancellationRequestSummary {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'requested',
    claimType: 'return',
    stage: 'requested',
    reference: 12,
    requestedAt: '2026-08-18T01:00:00.000Z',
    decidedAt: null,
    decisionNote: null,
    reshipCarrier: null,
    reshipTrackingNumber: null,
    ...overrides,
  };
}

/* 저장소 관례대로 실제 Response를 흉내 내지 않고 최소 계약(ok · json)만 돌려준다.
   submitOrderClaim이 그 두 가지만 읽는다. */
function fetcher(response: { ok: boolean; status: number; body: unknown }) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('submitOrderClaim', () => {
  it('유형과 사유, 환불계좌를 함께 보낸다', async () => {
    const send = fetcher({ ok: true, status: 202, body: { status: 'requested' } });

    await submitOrderClaim(
      ORDER_ID,
      {
        accountHolder: '홍길동',
        accountNumber: '110-1234-567890',
        bankName: '국민은행',
        claimType: 'return',
        reasonType: 'defect',
      },
      send,
    );

    expect(send).toHaveBeenCalledWith(
      `/api/orders/${ORDER_ID}/claims`,
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = send.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      claimType: 'return',
      reasonType: 'defect',
      bankName: '국민은행',
    });
  });

  /* 기한 초과와 접수 불가는 실패가 아니라 결과다. 재시도 안내로 뭉치면 구매자가
     같은 요청을 반복한다. */
  it('기한 초과와 접수 불가를 실패와 구분한다', async () => {
    expect(await submitOrderClaim(
      ORDER_ID,
      { claimType: 'return', reasonType: 'change_of_mind' },
      fetcher({ ok: false, status: 409, body: { error: { code: 'deadline_expired' } } }),
    )).toBe('deadline_expired');

    expect(await submitOrderClaim(
      ORDER_ID,
      { claimType: 'exchange', reasonType: 'change_of_mind' },
      fetcher({ ok: false, status: 409, body: { error: { code: 'not_claimable' } } }),
    )).toBe('not_claimable');

    expect(await submitOrderClaim(
      ORDER_ID,
      { claimType: 'return', reasonType: 'change_of_mind' },
      fetcher({ ok: false, status: 502, body: { error: { code: 'claim_failed' } } }),
    )).toBe(false);
  });

  it('자동 승인 응답을 그대로 읽는다', async () => {
    expect(await submitOrderClaim(
      ORDER_ID,
      { claimType: 'cancel', reasonType: 'change_of_mind' },
      fetcher({ ok: true, status: 202, body: { status: 'auto_approved' } }),
    )).toBe('auto_approved');
  });

  it('모르는 응답은 실패로 접는다', async () => {
    expect(await submitOrderClaim(
      ORDER_ID,
      { claimType: 'return', reasonType: 'change_of_mind' },
      fetcher({ ok: true, status: 200, body: { status: 'whatever' } }),
    )).toBe(false);
  });
});

describe('claimStageNotice', () => {
  /* status는 레거시 투영이라 수거 중인 반품도 requested로 보인다. 안내가 stage에서
     나오지 않으면 이미 반송한 구매자가 "아직 접수만 됐다"고 읽는다. */
  it('수거 중과 접수를 구분해 안내한다', () => {
    expect(claimStageNotice(claim({ stage: 'requested' }))).toContain('접수했습니다');
    expect(claimStageNotice(claim({ stage: 'collecting' }))).toContain('반송해주세요');
  });

  it('입고 확인 뒤 안내가 유형에 따라 갈린다', () => {
    expect(claimStageNotice(claim({ stage: 'collected' }))).toContain('3일 이내에 환급');
    expect(claimStageNotice(claim({ claimType: 'exchange', stage: 'collected' })))
      .toContain('재출고를 준비');
  });

  it('보류와 거부는 사유를 함께 전달한다', () => {
    expect(claimStageNotice(claim({ stage: 'on_hold', decisionNote: '반송 비용 정산 확인 중' })))
      .toContain('반송 비용 정산 확인 중');
    expect(claimStageNotice(claim({ stage: 'rejected', decisionNote: '사용 흔적이 있습니다' })))
      .toContain('사용 흔적이 있습니다');
  });

  it('사유가 없으면 문의 경로를 안내한다', () => {
    expect(claimStageNotice(claim({ stage: 'rejected' }))).toContain('1:1 문의');
  });

  it('교환 종결은 환급이 아니라 재출고라고 말한다', () => {
    expect(claimStageNotice(claim({ claimType: 'exchange', stage: 'completed' })))
      .toContain('재출고했습니다');
    expect(claimStageNotice(claim({ stage: 'completed' }))).toContain('환급 처리가 완료');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DRAW_TICKET_GRANT_MAX_QUANTITY,
  mapAdminDrawTicketGrantError,
  normalizeAdminDrawTicketGrantForm,
  parseAdminDrawTicketGrantRecord,
} from './draw-ticket-grants';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const POOL_ID = '33333333-3333-4333-8333-333333333333';

function grantForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values: Record<string, string> = {
    operationId: OPERATION_ID,
    profileId: PROFILE_ID,
    poolId: POOL_ID,
    quantity: '3',
    reason: '소프트런칭 초기 구매자 소급 발급',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe('normalizeAdminDrawTicketGrantForm', () => {
  it('정상 입력을 정규화한다', () => {
    const result = normalizeAdminDrawTicketGrantForm(grantForm());

    expect(result).toEqual({
      ok: true,
      value: {
        operationId: OPERATION_ID,
        profileId: PROFILE_ID,
        poolId: POOL_ID,
        quantity: 3,
        reason: '소프트런칭 초기 구매자 소급 발급',
      },
    });
  });

  it('사유를 필수로 요구한다', () => {
    const result = normalizeAdminDrawTicketGrantForm(grantForm({ reason: '   ' }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.reason).toBeTruthy();
  });

  it('사유는 200자를 넘길 수 없다', () => {
    const result = normalizeAdminDrawTicketGrantForm(grantForm({ reason: 'ㄱ'.repeat(201) }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.reason).toBeTruthy();
  });

  it('수량 상한을 넘기거나 0 이하면 거절한다', () => {
    for (const quantity of ['0', '-1', String(DRAW_TICKET_GRANT_MAX_QUANTITY + 1), '2.5', 'many']) {
      const result = normalizeAdminDrawTicketGrantForm(grantForm({ quantity }));
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.errors.quantity).toBeTruthy();
    }
  });

  it('멱등키·대상·카드풀이 UUID가 아니면 거절한다', () => {
    expect(normalizeAdminDrawTicketGrantForm(grantForm({ operationId: 'nope' })).ok).toBe(false);
    expect(normalizeAdminDrawTicketGrantForm(grantForm({ profileId: 'nope' })).ok).toBe(false);
    expect(normalizeAdminDrawTicketGrantForm(grantForm({ poolId: '' })).ok).toBe(false);
  });
});

describe('parseAdminDrawTicketGrantRecord', () => {
  const row = {
    operation_id: OPERATION_ID,
    granted_at: '2026-08-07T02:30:00.000Z',
    actor_nickname: 'staff_park',
    recipient_id: PROFILE_ID,
    recipient_nickname: 'fan_hongsil',
    recipient_masked_email: 'b***@example.com',
    pool_id: POOL_ID,
    pool_name: '홍실 퀘스트 시즌1',
    quantity: '3',
    opened_count: 1,
    revoked_count: 0,
    reason: '소프트런칭 초기 구매자 소급 발급',
  };

  it('bigint 집계를 숫자로 정규화한다', () => {
    expect(parseAdminDrawTicketGrantRecord(row)).toEqual({
      operationId: OPERATION_ID,
      grantedAt: '2026-08-07T02:30:00.000Z',
      actorNickname: 'staff_park',
      recipientId: PROFILE_ID,
      recipientNickname: 'fan_hongsil',
      recipientMaskedEmail: 'b***@example.com',
      poolId: POOL_ID,
      poolName: '홍실 퀘스트 시즌1',
      quantity: 3,
      openedCount: 1,
      revokedCount: 0,
      reason: '소프트런칭 초기 구매자 소급 발급',
    });
  });

  it('보관·삭제된 카드풀 이름이 없으면 대체 표기를 쓴다', () => {
    const record = parseAdminDrawTicketGrantRecord({ ...row, pool_name: null });
    expect(record?.poolName).toBe('삭제된 카드풀');
  });

  it('형태가 어긋난 행은 null을 준다', () => {
    expect(parseAdminDrawTicketGrantRecord(null)).toBeNull();
    expect(parseAdminDrawTicketGrantRecord({ ...row, operation_id: 'nope' })).toBeNull();
    expect(parseAdminDrawTicketGrantRecord({ ...row, quantity: -1 })).toBeNull();
  });
});

describe('mapAdminDrawTicketGrantError', () => {
  it('RPC 오류를 운영자가 읽을 문구로 옮긴다', () => {
    expect(mapAdminDrawTicketGrantError('reward_pool_not_ready')).toContain('카드풀');
    expect(mapAdminDrawTicketGrantError('profile_not_found')).toContain('회원');
    expect(mapAdminDrawTicketGrantError('recipient_suspended')).toContain('정지');
    expect(mapAdminDrawTicketGrantError('grant_conflict')).toContain('다시');
    expect(mapAdminDrawTicketGrantError('forbidden')).toContain('권한');
    expect(mapAdminDrawTicketGrantError('card_rewards_disabled')).toBe('카드 리워드는 현재 비활성화되어 있습니다.');
    expect(mapAdminDrawTicketGrantError('boom')).toBeTruthy();
  });

  it('내부 오류 원문을 그대로 노출하지 않는다', () => {
    expect(mapAdminDrawTicketGrantError('duplicate key value violates unique constraint'))
      .not.toContain('constraint');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PURCHASE_CONFIRMATION_NOTICE,
  REVIEW_CONFIRMATION_BLOCKS,
  parseReviewConfirmationBlock,
  parseReviewCreateResult,
  reviewConfirmationBlockMessage,
  reviewConfirmationError,
} from './review-purchase-confirmation';

const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('리뷰 등록 = 구매확정 문구 (1014-079)', () => {
  /* 확정 안내는 [구매확정] 패널 문장을 그대로 쓴다. 한쪽만 고치면 고객이 두 화면에서 다른 고지를 받는다. */
  it('확정 안내는 [구매확정] 패널과 같은 문장이다', () => {
    expect(repoFile('components/orders/PurchaseConfirmationPanel.tsx')).toContain(PURCHASE_CONFIRMATION_NOTICE);
  });

  /* DB가 돌려주는 막힌 이유 코드와 화면 문구 목록이 갈라지면 모르는 코드가 일반 문구로 접힌다. */
  it('DB의 막힌 이유 코드는 모두 화면 문구가 있다', () => {
    const migration = repoFile('supabase/migrations/20261113003000_review_confirms_purchase.sql');
    const body = migration.slice(
      migration.indexOf('create function private.purchase_confirmation_block_reason'),
      migration.indexOf('revoke all on function private.purchase_confirmation_block_reason'),
    );
    const codes = [...body.matchAll(/(?:return|then) '([a-z_]+)'/g)].map(match => match[1]);
    expect(new Set(codes)).toEqual(new Set(REVIEW_CONFIRMATION_BLOCKS));
  });

  it('막힌 이유는 알려진 값만 그대로 쓰고, 모르는 값은 일반 사유로 접는다', () => {
    expect(parseReviewConfirmationBlock(null)).toBeNull();
    expect(parseReviewConfirmationBlock('claim_in_progress')).toBe('claim_in_progress');
    expect(parseReviewConfirmationBlock('new_future_reason')).toBe('unavailable');
    expect(parseReviewConfirmationBlock(3)).toBeUndefined();
  });

  it('막힌 이유마다 고객이 할 일을 말한다', () => {
    expect(reviewConfirmationBlockMessage('claim_in_progress')).toContain('취소·반품·교환 신청이 진행 중');
    expect(reviewConfirmationBlockMessage('held', '  사진 확인 중  ')).toContain('(사유: 사진 확인 중)');
    expect(reviewConfirmationBlockMessage('held', null)).not.toContain('사유:');
    expect(reviewConfirmationBlockMessage('unavailable')).toContain('주문 상세에서 상태를 확인');
    for (const block of REVIEW_CONFIRMATION_BLOCKS) expect(reviewConfirmationBlockMessage(block)).not.toContain('상품');
  });

  it('구매확정 오류만 따로 옮기고 리뷰 자체 오류는 기존 변환에 맡긴다', () => {
    expect(reviewConfirmationError('review_purchase_confirmation_ack_required')?.confirmation).toContain('체크해주세요');
    expect(reviewConfirmationError('review_purchase_confirmation_blocked', 'held')?.form).toContain('보류');
    expect(reviewConfirmationError('review_purchase_confirmation_blocked', null)?.form).toContain('주문 상세에서 상태를 확인');
    expect(reviewConfirmationError('purchase_confirmation_auth_changed')?.form).toContain('로그인 상태가 바뀌었습니다');
    expect(reviewConfirmationError('review_already_exists')).toBeNull();
    expect(reviewConfirmationError(undefined)).toBeNull();
  });

  it('등록 결과는 리뷰 ID와 이번 처리의 구매확정 여부만 받는다', () => {
    const reviewId = '11111111-1111-4111-8111-111111111111';
    expect(parseReviewCreateResult({ reviewId, purchaseConfirmed: true })).toEqual({ reviewId, purchaseConfirmed: true });
    expect(parseReviewCreateResult({ reviewId: 'x', purchaseConfirmed: true })).toBeNull();
    expect(parseReviewCreateResult({ reviewId, purchaseConfirmed: 'yes' })).toBeNull();
    expect(parseReviewCreateResult(null)).toBeNull();
  });
});

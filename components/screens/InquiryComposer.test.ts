import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* 10/14 회의 S19 — 고객 화면은 법정 용어 대신 실제로 누르는 절차 이름(주문 취소·반품·교환)으로 안내한다. */
describe('InquiryComposer claim guidance copy', () => {
  it('points to the order detail actions by their customer names', () => {
    const source = readFileSync(new URL('./InquiryComposer.tsx', import.meta.url), 'utf8');

    expect(source).toContain('주문 상세의 주문 취소·반품·교환 신청을 이용해주세요');
    expect(source).not.toContain('청약철회 경로');
  });
});

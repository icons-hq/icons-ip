import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KakaoUnlinkQueueEntry } from '@/lib/admin/kakao-unlink-withdrawal';
import { KakaoUnlinkQueueNotice, KakaoUnlinkWithdrawalQueueScreen } from './KakaoUnlinkWithdrawalQueueScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/admin/community/members/kakao-unlinks', useSearchParams: () => new URLSearchParams() }));

const CLOSED: KakaoUnlinkQueueEntry = { userId: 'a11c0000-0000-4000-8000-000000000003', nickname: '카카오탈퇴', maskedEmail: 'k***@example.test',
  reason: 'ACCOUNT_DELETE', eventAt: '2026-11-19T01:00:00Z', accountClosed: true, suspended: false };
const UNLINKED: KakaoUnlinkQueueEntry = { ...CLOSED, userId: 'a11c0000-0000-4000-8000-000000000004', nickname: '연결해제', reason: 'UNLINK_FROM_APPS',
  accountClosed: false, suspended: true };

describe('카카오 연결 해제 탈퇴 검토 대기 화면', () => {
  it('회원(가린 이메일)·사유·알림 시각·처리 방법·계정 상태를 보이고 회원은 고객 상세로 잇는다', () => {
    const html = renderToStaticMarkup(<KakaoUnlinkWithdrawalQueueScreen entries={[CLOSED, UNLINKED]} />);
    for (const text of ['처리 방법은 해제 사유로 나뉩니다', '탈퇴 검토 대기', '@카카오탈퇴', 'k***@example.test', '카카오계정 탈퇴',
      '카카오계정 페이지에서 연결 해제', '2026. 11. 19.', '알림으로 처리', '회원 확인 필요', '이용 중', '정지']) expect(html).toContain(text);
    expect(html).toContain(`href="/admin/customers/${CLOSED.userId}"`);
    expect(html).toContain(`href="/admin/customers/${UNLINKED.userId}"`);
    expect(html).toMatch(/data-tone="warning"[^>]*>알림으로 처리/);
    expect(html).toMatch(/data-tone="neutral"[^>]*>회원 확인 필요/);
    expect(html).not.toContain('example.test"');
  });

  it('대기 회원이 없으면 빈 목록을, 읽지 못하면 다시 불러오라는 안내를 보인다', () => {
    expect(renderToStaticMarkup(<KakaoUnlinkWithdrawalQueueScreen entries={[]} />)).toContain('탈퇴 검토를 기다리는 회원이 없습니다');
    const failed = renderToStaticMarkup(<KakaoUnlinkWithdrawalQueueScreen entries={null} />);
    expect(failed).toContain('목록을 불러오지 못했습니다');
    expect(failed).not.toContain('탈퇴 검토를 기다리는 회원이 없습니다');
  });

  it('회원 관리 화면 안내는 대기 회원이 있을 때만 건수와 목록 링크를 보인다', () => {
    expect(renderToStaticMarkup(<KakaoUnlinkQueueNotice count={0} />)).toBe('');
    const html = renderToStaticMarkup(<KakaoUnlinkQueueNotice count={2} />);
    expect(html).toContain('탈퇴 검토 대기 2명');
    expect(html).toContain('href="/admin/community/members/kakao-unlinks"');
  });
});

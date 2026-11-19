import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMemberDetail } from '@/lib/admin/members';
import type { MemberWithdrawalActionState } from '@/app/admin/member-withdrawal-actions';
import { CustomerWithdrawalControl } from './CustomerWithdrawalControl';

const mocks = vi.hoisted(() => ({ state: {} as MemberWithdrawalActionState }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useActionState: () => [mocks.state, vi.fn(), false],
}));
vi.mock('@/app/admin/member-withdrawal-actions', () => ({
  processMemberWithdrawalAction: vi.fn(), processKakaoUnlinkWithdrawalAction: vi.fn(), retryMemberWithdrawalSigninBlockAction: vi.fn(),
}));

const MEMBER = '00000000-0000-4000-8000-000000000301';
const customer: AdminMemberDetail = {
  id: MEMBER, nickname: '탈퇴 고객', email: 'leaving@example.test', role: 'user', createdAt: '2026-01-01T00:00:00Z',
  consents: { terms: true, privacy: true, marketing: true }, suspendedAt: null, suspensionReason: null, loyaltyGrade: 'welcome',
  goodsOrderCount: 1, ticketOrderCount: 0, submittedReportCount: 0, receivedReportCount: 0,
  moderation: { managerRole: null, canModerate: true },
  withdrawal: { processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null },
};
const render = (value: AdminMemberDetail = customer) => renderToStaticMarkup(<CustomerWithdrawalControl actor={{ id: 'actor', role: 'admin' }} customer={value} />);

describe('고객 상세 · 탈퇴 요청 처리', () => {
  beforeEach(() => { mocks.state = {}; });

  it('처리 전에는 접힌 폼에 처리 범위·남는 정보·문의 번호·메모·되돌릴 수 없는 처리 버튼을 둔다', () => {
    const html = render();
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*data-member-withdrawal="pending"/);
    for (const text of ['배송지 관리(주소록) 삭제', '인증한 휴대폰 번호', '마케팅 정보 수신 동의 전 수단 철회', '재로그인 차단',
      '완전 삭제가 아니라 다음은 남습니다', '거래 기록', '문의 번호', '처리 메모', '개인정보는 적지 마세요']) expect(html).toContain(text);
    expect(html).toMatch(/<input(?=[^>]*required)(?=[^>]*inputMode="numeric")[^>]*name="inquiryReference"/);
    expect(html).toMatch(/<textarea(?=[^>]*required)(?=[^>]*maxLength="200")[^>]*name="note"/);
    expect(html).toMatch(/<button(?=[^>]*type="submit")[^>]*>탈퇴 요청 처리<\/button>/);
  });

  it('제재할 수 없는 계정에는 처리 폼을 그리지 않는다', () => {
    const html = render({ ...customer, moderation: { managerRole: 'primary', canModerate: false } });
    expect(html).toContain('현재 권한으로 탈퇴 처리할 수 없습니다');
    expect(html).not.toContain('name="inquiryReference"');
  });

  it('상태를 읽지 못하면 처리 동작 없이 새로고침을 안내한다', () => {
    const html = render({ ...customer, withdrawal: null });
    expect(html).toContain('탈퇴 처리 상태를 불러오지 못했습니다');
    expect(html).not.toContain('name="inquiryReference"');
  });

  it('남은 의무로 거절되면 항목과 건수를 보인다', () => {
    mocks.state = { errors: { form: '진행 중인 거래·운영 권한이 남아 있어 처리하지 않았습니다.' },
      blockers: [{ code: 'active_order', count: 2, path: '/orders' }, { code: 'staff_handover', count: 1, path: '/settings' }] };
    const html = render();
    expect(html).toContain('처리하지 않았습니다');
    expect(html).toContain('진행 중인 주문(결제 대기·결제완료·발주확인·배송중·교환 재출고) 2건');
    expect(html).toContain('운영 권한(관리자·매니저) — 권한 회수 뒤 처리 1건');
  });

  it('처리한 계정은 문의 번호·처리 시각과 재로그인 차단 상태를 보이고, 차단이 빠졌으면 다시 적용 버튼을 둔다', () => {
    const processed = { processed: true, processedAt: '2026-11-18T01:00:00Z', inquiryReference: 1234, signinBlocked: false, signinBlockedAt: null };
    const pending = render({ ...customer, suspendedAt: '2026-11-18T01:00:00Z', withdrawal: processed });
    expect(pending).toContain('탈퇴 요청을 처리한 계정입니다');
    expect(pending).toContain('문의 #1234');
    expect(pending).toContain('2026. 11. 18.');
    expect(pending).toMatch(/<button(?=[^>]*type="submit")[^>]*>재로그인 차단 다시 적용<\/button>/);
    expect(pending).not.toContain('name="inquiryReference"');

    const blocked = render({ ...customer, suspendedAt: '2026-11-18T01:00:00Z',
      withdrawal: { ...processed, signinBlocked: true, signinBlockedAt: '2026-11-18T01:00:05Z' } });
    expect(blocked).toContain('재로그인 차단 · ');
    expect(blocked).not.toContain('재로그인 차단 다시 적용');
  });

  it('차단은 끝났어도 지울 프로필 사진이 남았으면 다시 적용 버튼을 둔다. 범위 안내는 익명화를 말한다', () => {
    const processed = { processed: true, processedAt: '2026-11-18T01:00:00Z', inquiryReference: 1234, signinBlocked: true,
      signinBlockedAt: '2026-11-18T01:00:05Z', avatarErasePending: true };
    const html = render({ ...customer, suspendedAt: '2026-11-18T01:00:00Z', withdrawal: processed });
    expect(html).toContain('프로필 사진 파일이 아직 지워지지 않았습니다');
    expect(html).toMatch(/<button(?=[^>]*type="submit")[^>]*>프로필 사진 삭제 다시 적용<\/button>/);
    expect(render({ ...customer, suspendedAt: '2026-11-18T01:00:00Z', withdrawal: { ...processed, avatarErasePending: false } })).not.toContain('다시 적용');
    expect(render()).toContain('프로필 익명화(닉네임은 &#x27;탈퇴한 회원&#x27;과 구분 번호로 바뀌고 생년월일·프로필 사진 파일은 삭제');
  });

  describe('카카오 연결 해제 탈퇴 검토 대기', () => {
    const UNLINK = { reason: 'ACCOUNT_DELETE', eventAt: '2026-11-19T01:00:00Z', accountClosed: true };
    const pending = { processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null };

    it('카카오계정 탈퇴 알림이면 알림 근거 처리 폼(메모·카카오 연결 삭제 포함)을 문의 처리 위에 둔다', () => {
      const html = render({ ...customer, withdrawal: { ...pending, kakaoUnlink: UNLINK } });
      expect(html).toContain('카카오계정 탈퇴 알림을 받은 회원입니다');
      expect(html).toContain('카카오계정 탈퇴 · 2026. 11. 19.');
      expect(html).toContain('카카오 로그인 연결 삭제(카카오 회원번호');
      expect(html).toContain('href="/admin/community/members/kakao-unlinks"');
      expect(html).toMatch(/<textarea(?=[^>]*required)(?=[^>]*maxLength="200")[^>]*name="note"/);
      expect(html).toMatch(/<button(?=[^>]*type="submit")[^>]*>카카오 알림으로 탈퇴 처리<\/button>/);
      expect(html.indexOf('data-member-withdrawal="kakao-unlink"')).toBeLessThan(html.indexOf('data-member-withdrawal="pending"'));
      expect(html).toContain('name="inquiryReference"');
    });

    it('연결만 끊었으면 회원 확인(1:1 문의)을 안내하고 알림 근거 폼은 그리지 않는다', () => {
      const html = render({ ...customer, withdrawal: { ...pending, kakaoUnlink: { ...UNLINK, reason: 'UNLINK_FROM_APPS', accountClosed: false } } });
      expect(html).toContain('카카오 연결을 끊은 회원입니다');
      expect(html).toContain('카카오계정 페이지에서 연결 해제');
      expect(html).toContain('회원에게 탈퇴 의사를 확인하고');
      expect(html).not.toContain('카카오 알림으로 탈퇴 처리');
      expect(html).toContain('name="inquiryReference"');
    });

    it('제재할 수 없는 계정에는 카카오 처리 폼도 그리지 않는다', () => {
      const html = render({ ...customer, moderation: { managerRole: 'primary', canModerate: false }, withdrawal: { ...pending, kakaoUnlink: UNLINK } });
      expect(html).not.toContain('카카오 알림으로 탈퇴 처리');
    });

    it('카카오 알림으로 처리한 계정은 근거(사유·알림 시각)를 보인다', () => {
      const html = render({ ...customer, suspendedAt: '2026-11-19T02:00:00Z', withdrawal: { processed: true, processedAt: '2026-11-19T02:00:00Z',
        inquiryReference: null, signinBlocked: true, signinBlockedAt: '2026-11-19T02:00:05Z', basis: 'kakao_unlink', kakaoUnlink: UNLINK } });
      expect(html).toContain('탈퇴 요청을 처리한 계정입니다');
      expect(html).toContain('카카오 알림 · 카카오계정 탈퇴 (2026. 11. 19.');
      expect(html).not.toContain('문의 #');
    });
  });
});


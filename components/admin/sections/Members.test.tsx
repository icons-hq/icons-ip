import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMemberDetail, AdminMemberSummary } from '@/lib/admin/members';
import { confirmMemberSuspension, MembersSection } from './Members';

const hooks = vi.hoisted(() => ({
  detailAction: vi.fn(),
  detailPending: false,
  detailState: { member: null } as { member: AdminMemberDetail | null },
  searchAction: vi.fn(),
  searchPending: false,
  searchState: { members: [], query: '' } as { members: AdminMemberSummary[]; query: string },
  suspendAction: vi.fn(),
  suspendState: {} as Record<string, unknown>,
  unsuspendAction: vi.fn(),
  unsuspendState: {} as Record<string, unknown>,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown, initial: unknown) => {
      if (action === hooks.searchAction) return [hooks.searchState, vi.fn(), hooks.searchPending];
      if (action === hooks.detailAction) return [hooks.detailState, vi.fn(), hooks.detailPending];
      if (action === hooks.suspendAction) return [hooks.suspendState, vi.fn(), false];
      if (action === hooks.unsuspendAction) return [hooks.unsuspendState, vi.fn(), false];
      return [initial, vi.fn(), false];
    },
  };
});
vi.mock('@/app/admin/member-actions', () => ({
  adjustMemberLoyaltyAction: vi.fn(),
  loadAdminMemberDetailAction: hooks.detailAction,
  recalculateMemberLoyaltyAction: vi.fn(),
  searchAdminMembersAction: hooks.searchAction,
  suspendAdminMemberAction: hooks.suspendAction,
  unsuspendAdminMemberAction: hooks.unsuspendAction,
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

const summaries: AdminMemberSummary[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    nickname: '팬일호',
    maskedEmail: 'f***@icons.gg',
    role: 'user',
    createdAt: '2026-07-01T00:00:00.000Z',
    suspendedAt: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    nickname: '운영이호',
    maskedEmail: 's***@icons.gg',
    role: 'staff',
    createdAt: '2026-07-02T00:00:00.000Z',
    suspendedAt: '2026-07-17T00:00:00.000Z',
  },
];

const detail: AdminMemberDetail = {
  id: summaries[0].id,
  nickname: summaries[0].nickname,
  email: 'fan@example.test',
  role: summaries[0].role,
  createdAt: summaries[0].createdAt,
  consents: { terms: true, privacy: true, marketing: false },
  suspendedAt: null,
  suspensionReason: null,
  loyaltyGrade: 'welcome',
  goodsOrderCount: 2,
  ticketOrderCount: 3,
  submittedReportCount: 4,
  receivedReportCount: 5,
};

describe('MembersSection', () => {
  beforeEach(() => {
    hooks.searchState = { members: summaries, query: '' };
    hooks.searchPending = false;
    hooks.detailState = { member: null };
    hooks.detailPending = false;
    hooks.suspendState = {};
    hooks.unsuspendState = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('목록에는 POST 검색과 마스킹 이메일·정지 상태만 노출한다', () => {
    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );

    expect(html).toContain('회원 검색');
    expect(html).toContain('name="query"');
    expect(html).not.toContain('method="get"');
    expect(html).toContain('f***@icons.gg');
    expect(html).toContain('정지');
    expect(html).not.toContain('fan@example.test');
    expect(html).not.toContain('내부 사유');
  });

  it('명시적으로 연 상세에서만 전체 이메일·현재 동의·운영 집계를 보여준다', () => {
    hooks.detailState = { member: detail };
    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );

    expect(html).toContain('fan@example.test');
    expect(html).toContain('현재 동의 상태');
    expect(html).toContain('굿즈 주문');
    expect(html).toContain('티켓 예매');
    expect(html).toContain('받은 신고');
    expect(html).not.toContain('생년월일');
    expect(html).not.toContain('배송지');
  });

  it('staff는 일반 사용자만 정지할 수 있고 admin은 staff도 해제할 수 있다', () => {
    hooks.detailState = { member: { ...detail, role: 'staff', suspendedAt: '2026-07-17T00:00:00.000Z', suspensionReason: '내부 사유' } };

    const staffHtml = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );
    expect(staffHtml).toContain('이 계정은 현재 권한으로 제재할 수 없습니다.');
    expect(staffHtml).not.toContain('정지 해제');

    const adminHtml = renderToStaticMarkup(
      <MembersSection actor={{ id: 'admin-a', role: 'admin' }} initialMembers={summaries} />,
    );
    expect(adminHtml).toContain('정지 해제');
    expect(adminHtml).toContain('내부 사유');
  });

  it('정지 사유 입력과 action control을 접근 가능한 크기로 렌더링한다', () => {
    hooks.detailState = { member: detail };
    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );

    expect(html).toContain('name="reason"');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('required=""');
    expect(html).toContain('min-height:44px');
  });

  it('현재 검색 결과와 다른 이전 상세는 PII와 제재 form을 렌더링하지 않는다', () => {
    hooks.searchState = { members: [summaries[1]], query: '운영이호' };
    hooks.detailState = { member: detail };

    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );

    expect(html).not.toContain('fan@example.test');
    expect(html).not.toContain('name="reason"');
  });

  it('검색 또는 상세 로딩 중에는 이전 상세 제재 form을 숨긴다', () => {
    hooks.detailState = { member: detail };
    hooks.detailPending = true;

    const detailPendingHtml = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );
    expect(detailPendingHtml).not.toContain('fan@example.test');
    expect(detailPendingHtml).not.toContain('name="reason"');

    hooks.detailPending = false;
    hooks.searchPending = true;
    const searchPendingHtml = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );
    expect(searchPendingHtml).not.toContain('fan@example.test');
    expect(searchPendingHtml).not.toContain('name="reason"');
  });

  it('운영자가 영향 확인을 거절하면 정지 제출을 취소한다', () => {
    const preventDefault = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm });

    confirmMemberSuspension({ preventDefault } as unknown as Parameters<typeof confirmMemberSuspension>[0]);

    expect(confirm).toHaveBeenCalledWith(
      '이 회원을 정지하면 포스트·댓글 작성, 구매·예매, 카드팩 개봉, 게임 플레이를 새로 진행할 수 없습니다. 계속할까요?',
    );
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('상태 변경 성공 뒤 stale 제재 form을 다시 제출하지 못하게 숨긴다', () => {
    hooks.detailState = { member: detail };
    hooks.suspendState = { message: '회원을 정지했습니다.' };

    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );

    expect(html).toContain('회원을 정지했습니다.');
    expect(html).toContain('회원을 다시 검색해 상세를 열어주세요.');
    expect(html).not.toContain('name="reason"');
  });

  it('운영자가 영향을 확인하면 정지 제출을 허용한다', () => {
    const preventDefault = vi.fn();
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });

    confirmMemberSuspension({ preventDefault } as unknown as Parameters<typeof confirmMemberSuspension>[0]);

    expect(preventDefault).not.toHaveBeenCalled();
  });
});

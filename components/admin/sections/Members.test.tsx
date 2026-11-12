import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { setAdminConfirmHandler } from '@/lib/admin/confirm';
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
  moderation: { managerRole: null, canModerate: true },
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
    expect(html).toContain(`href="/admin/customers/${summaries[0].id}"`);
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
    expect(html).toContain('상품 주문');
    expect(html).toContain('티켓 예매');
    expect(html).toContain('받은 신고');
    expect(html).not.toContain('생년월일');
    expect(html).not.toContain('배송지');
  });

  it('raw 역할 대신 DB가 내려준 제재 판단으로 버튼을 연다', () => {
    hooks.detailState = { member: { ...detail, role: 'staff', moderation: { managerRole: 'primary', canModerate: false }, suspendedAt: '2026-07-17T00:00:00.000Z', suspensionReason: '내부 사유' } };

    const staffHtml = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );
    expect(staffHtml).toContain('이 계정은 현재 권한으로 제재할 수 없습니다.');
    expect(staffHtml).not.toContain('정지 해제');

    hooks.detailState.member = { ...hooks.detailState.member!, role: 'admin', moderation: { managerRole: 'deputy', canModerate: true } };
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
    /* 터치 화면(pointer: coarse)에서 정지 버튼은 44px 이상이다. 템플릿 룩에서 마우스 크기는 kit 기본값을 쓴다. */
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*pointer-coarse:min-h-11)[^>]*>(?:<svg[\s\S]*?<\/svg>)? 회원 정지<\/button>/);
  });

  it('검색·상세·정지·등급 보정은 각자의 폼을 제출한다', () => {
    hooks.detailState = { member: detail };
    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );
    /* kit Button은 type을 주지 않으면 type="button"이 된다 — 폼 안 동작은 제출 버튼이어야 한다. */
    for (const label of ['검색', '상세', '회원 정지', '등급 보정', '실적으로 재산정']) {
      expect(html).toMatch(new RegExp(`<button(?=[^>]*type="submit")[^>]*>(?:<svg[\\s\\S]*?</svg>)? ${label}</button>`));
    }
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

  /* 같은 말로 보이는 버튼을 두지 않는다 — 고객 상세는 닉네임 링크, 줄의 버튼은 이 화면의 상세 하나다. */
  it('줄마다 버튼은 하나만 두고 권한은 운영자 말로 보인다', () => {
    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );

    expect(html).not.toContain('고객 상세');
    expect(html.match(/ 상세<\/button>/g)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/admin/customers/${summaries[0].id}"[^>]*>@팬일호</a>`));
    expect(html).toMatch(/data-tone="neutral"[^>]*>직원</);
    expect(html).not.toMatch(/>(?:user|staff|admin)</);
    expect(html).toContain('2명 표시');
  });

  /* 한 사람이 한 줄이고, 정지 회원은 줄의 배지와 버튼으로 찾는다. '이용 중'은 고객 상세와 같은 배지다(같은 상태는 같은 모양). */
  it('회원을 표 한 줄로 보이고 정지 건수는 거르는 버튼이다', () => {
    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );

    expect(html).toContain('data-slot="table"');
    expect(html).toMatch(/<button(?=[^>]*aria-pressed="false")[^>]*>정지 1명만 보기<\/button>/);
    expect(html).toMatch(/data-tone="danger"[^>]*>정지</);
    expect(html).toMatch(/data-tone="success"[^>]*>이용 중</);
  });

  it('상세는 누른 줄 바로 아래에 연다', () => {
    hooks.detailState = { member: detail };
    const html = renderToStaticMarkup(
      <MembersSection actor={{ id: 'staff-a', role: 'staff' }} initialMembers={summaries} />,
    );

    expect(html.indexOf('fan@example.test')).toBeLessThan(html.indexOf('@운영이호'));
  });

  it('운영자가 영향 확인을 거절하면 정지 제출을 취소한다', async () => {
    const preventDefault = vi.fn();
    const confirm = stubAdminConfirm(false);
    const form = { isConnected: true, requestSubmit: vi.fn() };

    confirmMemberSuspension({ preventDefault, currentTarget: form } as unknown as Parameters<typeof confirmMemberSuspension>[0]);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());

    expect(confirm).toHaveBeenCalledWith(
      '이 회원을 정지하면 포스트·댓글 작성, 구매·예매, 카드팩 개봉, 게임 플레이를 새로 진행할 수 없습니다. 계속할까요?',
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(form.requestSubmit).not.toHaveBeenCalled();
    setAdminConfirmHandler(null);
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

  it('운영자가 영향을 확인하기 전에는 보내지 않고, 확인하면 같은 폼을 다시 제출한다', async () => {
    const preventDefault = vi.fn();
    const confirm = stubAdminConfirm(true);
    const form = { isConnected: true, requestSubmit: vi.fn() };
    const event = { preventDefault, currentTarget: form } as unknown as Parameters<typeof confirmMemberSuspension>[0];

    confirmMemberSuspension(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(form.requestSubmit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(form.requestSubmit).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledOnce();
    setAdminConfirmHandler(null);
  });
});

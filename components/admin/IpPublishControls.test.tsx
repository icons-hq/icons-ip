import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { IpPublishControl, IpPublishStateBadge } from './IpPublishControls';

vi.mock('../../app/admin/ip-publish-actions', () => ({
  publishAdminIpAction: vi.fn(),
  unpublishAdminIpAction: vi.fn(),
}));

const at = '2026-09-07T04:00:00.000Z';

describe('IpPublishStateBadge', () => {
  it.each([
    ['draft', '초안'],
    ['published', '공개'],
    ['archived', '보관'],
  ] as const)('labels the %s state as %s', (state, label) => {
    const html = renderToStaticMarkup(<IpPublishStateBadge state={state} />);

    expect(html).toContain(`data-publish-state="${state}"`);
    expect(html).toContain(`>${label}</span>`);
  });
});

describe('IpPublishControl', () => {
  it('offers to publish a draft IP and explains where it will appear', () => {
    const html = renderToStaticMarkup(
      <IpPublishControl id="hwasan" record={{ archivedAt: null, publishedAt: null }} />,
    );

    expect(html).toContain('data-ip-publish-control="draft"');
    expect(html).toContain('name="id"');
    expect(html).toContain('value="hwasan"');
    expect(html).toContain('온라인 팝업 디렉토리·IP관·홈 특집·검색');
    expect(html).toMatch(/<button[^>]*btn-holo[^>]*>공개로 전환<\/button>/);
    expect(html).not.toContain('초안으로 되돌리기');
  });

  it('offers to revert a published IP to draft', () => {
    const html = renderToStaticMarkup(
      <IpPublishControl id="hwasan" record={{ archivedAt: null, publishedAt: at }} />,
    );

    expect(html).toContain('data-ip-publish-control="published"');
    expect(html).toContain('소속 굿즈·카드도 함께 숨겨지지만');
    expect(html).toMatch(/<button[^>]*btn-ghost[^>]*>초안으로 되돌리기<\/button>/);
  });

  it('explains that an archived IP has to be restored first and renders no form', () => {
    const html = renderToStaticMarkup(
      <IpPublishControl id="hwasan" record={{ archivedAt: at, publishedAt: at }} />,
    );

    expect(html).toContain('data-ip-publish-control="archived"');
    expect(html).toContain('보관된 IP는 게시 상태를 바꿀 수 없습니다.');
    expect(html).toContain('게시 이력이 없으면 초안이 됩니다.');
    expect(html).not.toContain('<form');
  });
});

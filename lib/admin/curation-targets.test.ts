import { describe, expect, it } from 'vitest';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { goodDetailHref } from '@/lib/goods-display';
import { adminCurationTargetGroups, adminCurationTargetGroupsFor } from './curation-targets';

const source = {
  events: [
    { id: 'e100', title: '성수 팝업', archivedAt: null },
    { id: 'e200', title: '보관 팝업', archivedAt: '2026-07-01T00:00:00.000Z' },
  ],
  goods: [
    { id: 'g13', title: '홍실 아크릴 블록', archivedAt: null },
    { id: 'g99', title: '보관 굿즈', archivedAt: '2026-07-01T00:00:00.000Z' },
  ],
  ips: [
    { id: 'rilakkuma', title: '리락쿠마', archivedAt: null },
    { id: 'retired', title: '보관 IP', archivedAt: '2026-07-01T00:00:00.000Z' },
  ],
};

function paths(groups: ReturnType<typeof adminCurationTargetGroups>) {
  return groups.flatMap((group) => group.options.map((option) => option.path));
}

describe('admin curation targets', () => {
  it('커뮤니티 임시 비공개 동안 커뮤니티를 고정 타깃으로 제안하지 않는다', () => {
    expect(paths(adminCurationTargetGroups(source)).includes('/community')).toBe(COMMUNITY_ENABLED);
  });

  it('offers real screens and active catalog detail pages only', () => {
    const available = paths(adminCurationTargetGroups(source));

    expect(available).toContain('/');
    expect(available).toContain('/shop');
    expect(available).toContain('/ip/rilakkuma');
    expect(available).toContain('/offline-popups/e100');
    expect(available).not.toContain('/ip/retired');
    expect(available).not.toContain('/offline-popups/e200');
  });

  /*
   * 굿즈 상세가 목록에 없으면 첫 판매 굿즈를 홈에서 상세로 바로 보낼 수 없다.
   * 경로는 공개 화면과 같은 헬퍼로 만들어 두 곳이 어긋나지 않게 한다.
   */
  it('offers active goods detail pages and hides archived ones', () => {
    const goodsGroup = adminCurationTargetGroups(source)
      .find((group) => group.label === '굿즈 상세');

    expect(goodsGroup?.options).toEqual([
      { label: '홍실 아크릴 블록 (g13)', path: goodDetailHref('g13') },
    ]);
    expect(goodDetailHref('g13')).toBe('/shop/g13');
  });

  it('drops empty groups so an empty catalog does not render a blank optgroup', () => {
    const groups = adminCurationTargetGroups({ events: [], goods: [], ips: [] });

    expect(groups.map((group) => group.label)).toEqual(['주요 화면']);
  });

  /*
   * 보관된 IP 를 가리키던 기존 큐레이션을 열었을 때 값이 조용히 홈으로
   * 바뀌면 운영자가 모르는 사이에 편성이 달라진다.
   */
  it('keeps an unlisted current value selectable', () => {
    const groups = adminCurationTargetGroupsFor(source, '/ip/retired');

    expect(groups[0]).toEqual({
      label: '현재 값',
      options: [{ label: '/ip/retired', path: '/ip/retired' }],
    });
  });

  it('does not duplicate a current value that is already listed', () => {
    const groups = adminCurationTargetGroupsFor(source, '/ip/rilakkuma');

    expect(groups.map((group) => group.label)).not.toContain('현재 값');
    expect(paths(groups).filter((path) => path === '/ip/rilakkuma')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { adminCurationTargetGroups, adminCurationTargetGroupsFor } from './curation-targets';

const source = {
  events: [
    { id: 'e100', title: '성수 팝업', archivedAt: null },
    { id: 'e200', title: '보관 팝업', archivedAt: '2026-07-01T00:00:00.000Z' },
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
  it('offers real screens and active catalog detail pages only', () => {
    const available = paths(adminCurationTargetGroups(source));

    expect(available).toContain('/');
    expect(available).toContain('/shop');
    expect(available).toContain('/ip/rilakkuma');
    expect(available).toContain('/events/e100');
    expect(available).not.toContain('/ip/retired');
    expect(available).not.toContain('/events/e200');
  });

  it('drops empty groups so an empty catalog does not render a blank optgroup', () => {
    const groups = adminCurationTargetGroups({ events: [], ips: [] });

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

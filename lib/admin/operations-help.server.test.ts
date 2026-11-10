import { describe, expect, it } from 'vitest';
import { searchAdminOperationHelp } from './operations-help.server';
import { configuredOperatorAccessFixture } from './access.test-fixtures';
import { canAccessAdminScreen } from './access';
import { adminScreenForPath } from './navigation';

describe('문맥 도움말', () => {
  it('현재 화면 관련 도움말이 먼저 나오고 이름과 본문으로 검색한다', () => {
    const result = searchAdminOperationHelp('', '/admin/sales/benefit-report', true);
    expect(result.entries[0].links.some(link => link.href === '/admin/sales/benefit-report')).toBe(true);
    const match = searchAdminOperationHelp('발급분 사용률', '/admin', true);
    expect(match.entries.some(entry => entry.title === '혜택 리포트')).toBe(true);
    expect(searchAdminOperationHelp('이검색은존재하지않음ABC123', '/admin', true).entries).toEqual([]);
  });
  it('staff 결과에서 관리자 전용 화면 진입점을 제외한다', () => {
    const result = searchAdminOperationHelp('적립금', '/admin', false);
    expect(result.entries.flatMap(entry => entry.links).every(link => !adminScreenForPath(link.href)?.adminOnly)).toBe(true);
    expect(searchAdminOperationHelp('적립금', '/admin', true).entries.flatMap(entry => entry.links).some(link => adminScreenForPath(link.href)?.adminOnly)).toBe(true);
  });
  it.each(['logistics', 'deputy', 'influencer', 'agency'] as const)('%s 도움말에서 허용 메뉴만 연결한다', role => {
    const access = configuredOperatorAccessFixture(role);
    const result = searchAdminOperationHelp('', '/admin', access);
    expect(result.entries.flatMap(entry => entry.links).every(link => canAccessAdminScreen(access, adminScreenForPath(link.href)))).toBe(true);
  });

});

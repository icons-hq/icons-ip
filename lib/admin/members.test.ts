import { describe, expect, it } from 'vitest';
import {
  canModerateAdminMember,
  normalizeAdminMemberDetailForm,
  normalizeAdminMemberSearchForm,
  normalizeAdminMemberSuspensionForm,
} from './members';

const profileId = '11111111-1111-4111-8111-111111111111';

describe('admin member form normalization', () => {
  it('검색어를 trim하고 빈 검색은 최근 목록으로 허용한다', () => {
    const form = new FormData();
    form.set('query', '  Fan@Icons.gg  ');
    expect(normalizeAdminMemberSearchForm(form)).toEqual({ ok: true, value: { query: 'Fan@Icons.gg' } });

    form.set('query', '   ');
    expect(normalizeAdminMemberSearchForm(form)).toEqual({ ok: true, value: { query: '' } });
  });

  it('검색어와 내부 사유 길이를 서버에서 제한한다', () => {
    const search = new FormData();
    search.set('query', 'a'.repeat(101));
    expect(normalizeAdminMemberSearchForm(search)).toEqual({
      ok: false,
      errors: { query: '검색어는 100자 이하로 입력해주세요.' },
    });

    const suspension = new FormData();
    suspension.set('profileId', profileId);
    suspension.set('reason', ' '.repeat(2));
    expect(normalizeAdminMemberSuspensionForm(suspension)).toEqual({
      ok: false,
      errors: { reason: '내부 사유는 1자 이상 200자 이하로 입력해주세요.' },
    });
  });

  it('상세·정지 대상은 UUID만 받고 사유를 trim한다', () => {
    const detail = new FormData();
    detail.set('profileId', profileId);
    expect(normalizeAdminMemberDetailForm(detail)).toEqual({ ok: true, value: { profileId } });

    const suspension = new FormData();
    suspension.set('profileId', profileId);
    suspension.set('reason', '  반복적인 운영 방해  ');
    expect(normalizeAdminMemberSuspensionForm(suspension)).toEqual({
      ok: true,
      value: { profileId, reason: '반복적인 운영 방해' },
    });
  });
});

describe('canModerateAdminMember', () => {
  it('staff는 일반 사용자만, admin은 본인/admin을 제외한 user·staff만 관리한다', () => {
    expect(canModerateAdminMember({ actorId: 'staff-a', actorRole: 'staff', memberId: 'fan-a', memberRole: 'user' })).toBe(true);
    expect(canModerateAdminMember({ actorId: 'staff-a', actorRole: 'staff', memberId: 'staff-b', memberRole: 'staff' })).toBe(false);
    expect(canModerateAdminMember({ actorId: 'admin-a', actorRole: 'admin', memberId: 'staff-b', memberRole: 'staff' })).toBe(true);
    expect(canModerateAdminMember({ actorId: 'admin-a', actorRole: 'admin', memberId: 'admin-b', memberRole: 'admin' })).toBe(false);
    expect(canModerateAdminMember({ actorId: 'admin-a', actorRole: 'admin', memberId: 'admin-a', memberRole: 'user' })).toBe(false);
  });
});

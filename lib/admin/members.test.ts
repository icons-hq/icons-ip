import { describe, expect, it } from 'vitest';
import {
  canModerateAdminMember,
  normalizeAdminMemberDetailForm,
  normalizeAdminMemberSearchForm,
  normalizeAdminMemberSuspensionForm,
  parseAdminMemberSummary,
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
  it('Postgres UUID 표기 형식을 받아 유효한 새 버전 식별자가 목록 전체를 깨뜨리지 않는다', () => {
    const id = '019ceabc-def0-7123-8abc-0123456789ab';
    const detail = new FormData(); detail.set('profileId', id.toUpperCase());
    expect(normalizeAdminMemberDetailForm(detail)).toEqual({ ok: true, value: { profileId: id } });
    const record = { profile_id: id, nickname: '합성 회원', masked_email: 't***@example.test', role: 'user', created_at: '2026-10-13T00:00:00Z', suspended_at: null };
    expect(parseAdminMemberSummary(record)).toMatchObject({ id });
    expect(parseAdminMemberSummary({ ...record, profile_id: 'not-a-uuid' })).toBeNull();
  });
});

describe('canModerateAdminMember', () => {
  it('현재 DB 허용만 사용하고 누락·거절·본인에게는 제재 작업을 열지 않는다', () => {
    const input = { actorId: 'actor', memberId: 'member' };
    expect(canModerateAdminMember({ ...input, moderation: { managerRole: 'deputy', canModerate: true } })).toBe(true);
    expect(canModerateAdminMember({ ...input, moderation: { managerRole: 'primary', canModerate: false } })).toBe(false);
    expect(canModerateAdminMember({ ...input, moderation: undefined })).toBe(false);
    expect(canModerateAdminMember({ ...input, memberId: 'actor', moderation: { managerRole: null, canModerate: true } })).toBe(false);
  });
});

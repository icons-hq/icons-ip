import { describe, expect, it } from 'vitest';
import { adminDocumentTitle, nextAdminDocumentTitle } from './useAdminDocumentTitle';

describe('nextAdminDocumentTitle', () => {
  it('서버 메타데이터가 되돌린 제목은 화면 제목으로 바꾼다', () => {
    expect(nextAdminDocumentTitle('ICONS', '취소 관리')).toBe(adminDocumentTitle('취소 관리'));
    expect(nextAdminDocumentTitle(adminDocumentTitle('홈'), '취소 관리')).toBe(adminDocumentTitle('취소 관리'));
  });

  it('이미 맞으면 건드리지 않고, 문의 수 접두사가 붙은 제목도 맞는 제목으로 본다', () => {
    expect(nextAdminDocumentTitle(adminDocumentTitle('홈'), '홈')).toBeNull();
    expect(nextAdminDocumentTitle(`(3) ${adminDocumentTitle('홈')}`, '홈')).toBeNull();
    expect(nextAdminDocumentTitle(`(99+) ${adminDocumentTitle('홈')}`, '홈')).toBeNull();
  });
});

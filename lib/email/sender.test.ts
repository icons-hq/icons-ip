import { describe, expect, it } from 'vitest';
import { EMAIL_SENDER_NAME, brandedSender } from './sender';

describe('메일 발신자 표시 이름', () => {
  it('서비스 이름은 영문 X SQUARE다(비ASCII 표시 이름은 Resend 처리 미확인)', () => {
    expect(EMAIL_SENDER_NAME).toBe('X SQUARE');
    expect(EMAIL_SENDER_NAME).toMatch(/^[\x20-\x7e]+$/);
  });

  it('env의 옛 표시 이름은 버리고 주소만 써서 서비스 이름을 붙인다', () => {
    expect(brandedSender('ICONS <no-reply@iconsip.com>')).toBe('X SQUARE <no-reply@iconsip.com>');
    expect(brandedSender('"ICONS, 운영팀" <no-reply@xsquare.kr>')).toBe('X SQUARE <no-reply@xsquare.kr>');
    expect(brandedSender('  엑스스퀘어 <no-reply@xsquare.kr>  ')).toBe('X SQUARE <no-reply@xsquare.kr>');
    expect(brandedSender('X SQUARE <no-reply@xsquare.kr>')).toBe('X SQUARE <no-reply@xsquare.kr>');
  });

  it('주소만 있는 값에도 서비스 이름을 붙인다', () => {
    expect(brandedSender('no-reply@iconsip.com')).toBe('X SQUARE <no-reply@iconsip.com>');
  });

  it('주소를 찾지 못한 값은 그대로 돌려 설정 오류를 숨기지 않는다', () => {
    expect(brandedSender('ICONS')).toBe('ICONS');
    expect(brandedSender('broken <not-an-address>')).toBe('broken <not-an-address>');
  });
});

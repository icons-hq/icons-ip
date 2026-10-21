import { describe, expect, it } from 'vitest';
import { exportPasswordError } from './export-password';
import { readExportPassword } from './export-request.server';

describe('엑셀 비밀번호와 요청 경계', () => {
  it('숫자만·영문만·기호만 입력해도 인쇄 ASCII 4~16자를 그대로 받는다', () => {
    for (const password of ['1234', 'ABCD', 'Z'.repeat(16), '!"#$%&\'()*+,-./:', ';<=>?@[\\]^_`{|}~']) expect(exportPasswordError(password, password)).toBeNull();
    for (const password of ['', 'A'.repeat(3), 'A'.repeat(17), 'Test Password12', '한국어Password12', 'TEST\nPassword12', ' TESTPassword12', 'TESTPassword12 ', 'TEST\tPassword12', 'TESTPassword12\n']) expect(exportPasswordError(password, password)).not.toBeNull();
    expect(exportPasswordError('StrongTEST123!', 'strongTEST123!')).toContain('일치');
  });
  it.each(['1234', 'A'.repeat(16)])('요청 본문에서 허용 길이의 비밀번호 %s를 그대로 받는다', async password => {
    const request = new Request('https://example.test/api?screen=shipping', { method: 'POST',
      headers: { origin: 'https://example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ password, passwordConfirmation: password }) });
    await expect(readExportPassword(request, ['screen'])).resolves.toBe(password);
  });
  it('본문만 받으며 모르는 키·잘못된 형식·상한 초과를 거부한다', async () => {
    const request = (body: string, content = 'application/json') => new Request('https://example.test/api?screen=orders', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': content }, body });
    const body = JSON.stringify({ password: 'StrongTEST123!', passwordConfirmation: 'StrongTEST123!' });
    await expect(readExportPassword(request(body), ['screen'])).resolves.toBe('StrongTEST123!');
    await expect(readExportPassword(request(body), [])).rejects.toThrow('조건');
    await expect(readExportPassword(request(body, 'text/plain'), ['screen'])).rejects.toThrow('형식');
    await expect(readExportPassword(request('{'), ['screen'])).rejects.toThrow('형식');
    await expect(readExportPassword(request(JSON.stringify({ password: 'StrongTEST123!', passwordConfirmation: 'StrongTEST123!', debug: true })), ['screen'])).rejects.toThrow('형식');
    await expect(readExportPassword(request('x'.repeat(4097)), ['screen'])).rejects.toThrow('너무 큽니다');
    const absent = request(body); absent.headers.delete('origin');
    await expect(readExportPassword(absent, ['screen'])).rejects.toThrow('현재 관리자');
    const normalized = request(body); normalized.headers.set('host', 'icons-qa.localhost:4348'); normalized.headers.set('origin', 'https://icons-qa.localhost:4348');
    await expect(readExportPassword(normalized, ['screen'])).resolves.toBe('StrongTEST123!');
    normalized.headers.set('origin', 'https://example.test'); normalized.headers.set('x-forwarded-host', 'example.test');
    await expect(readExportPassword(normalized, ['screen'])).rejects.toThrow('현재 관리자');
    for (const host of ['example.test@evil.test', 'example.test,evil.test', 'example.test/path', 'example.test?query', 'example.test#fragment', 'example.test with-space', 'example.test:99999']) {
      const malformed = request(body); malformed.headers.set('host', host);
      await expect(readExportPassword(malformed, ['screen'])).rejects.toThrow('현재 관리자');
    }
    for (const [host, origin] of [['example.test:443','https://example.test'], ['[::1]:4348','https://[::1]:4348'], ['example.test:8443','https://example.test:8443']]) {
      const standard = request(body); standard.headers.set('host', host); standard.headers.set('origin', origin);
      await expect(readExportPassword(standard, ['screen'])).resolves.toBe('StrongTEST123!');
    }
    const crossSite = request(body); crossSite.headers.set('sec-fetch-site', 'cross-site');
    await expect(readExportPassword(crossSite, ['screen'])).rejects.toThrow('현재 관리자');
  });
});

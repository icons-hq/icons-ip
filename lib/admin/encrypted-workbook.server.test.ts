import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import officeCrypto from 'officecrypto-tool';
import { describe, expect, it } from 'vitest';
import { encryptAdminWorkbook } from './encrypted-workbook.server';

describe('Office Agile 파일 암호화', () => {
  it.each(['1234', 'A'.repeat(16)])('허용 길이의 암호 %s로 원본 ZIP 바이트를 보존하고 매번 다른 파일을 만든다', async password => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('원본');
    sheet.addRow(['00000123', '=1+1', 1000]); sheet.getCell('C1').numFmt = '#,##0';
    const plain = Buffer.from(await workbook.xlsx.writeBuffer()); const before = Buffer.from(plain);
    const first = encryptAdminWorkbook(plain, password); const second = encryptAdminWorkbook(plain, password);
    expect(first.bytes.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    expect(first.bytes.equals(second.bytes)).toBe(false); expect(plain.equals(before)).toBe(true);
    expect(first.sha256).toBe(createHash('sha256').update(first.bytes).digest('hex'));
    expect((await officeCrypto.decrypt(first.bytes, { password })).equals(before)).toBe(true);
    await expect(officeCrypto.decrypt(first.bytes, { password: 'IncorrectPassword!' })).rejects.toThrow();
  });
  it('평문 형식과 허용 길이 밖의 암호는 파일 생성 전에 거부한다', () => {
    expect(() => encryptAdminWorkbook(Buffer.from('not zip'), '1234')).toThrow('파일 형식');
    for (const password of ['123', 'A'.repeat(17)]) {
      expect(() => encryptAdminWorkbook(Buffer.from('PK\u0003\u0004'), password)).toThrow('비밀번호');
    }
  });
});

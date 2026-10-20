import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import officeCrypto from 'officecrypto-tool';
import { describe, expect, it } from 'vitest';
import { encryptAdminWorkbook } from './encrypted-workbook.server';

describe('Office Agile 파일 암호화', () => {
  it('원본 ZIP 바이트를 그대로 암호화하며 매번 다른 파일을 만든다', async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('원본');
    sheet.addRow(['00000123', '=1+1', 1000]); sheet.getCell('C1').numFmt = '#,##0';
    const plain = Buffer.from(await workbook.xlsx.writeBuffer()); const before = Buffer.from(plain);
    const password = 'SyntheticQA-Only-2026!';
    const first = encryptAdminWorkbook(plain, password); const second = encryptAdminWorkbook(plain, password);
    expect(first.bytes.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    expect(first.bytes.equals(second.bytes)).toBe(false); expect(plain.equals(before)).toBe(true);
    expect(first.sha256).toBe(createHash('sha256').update(first.bytes).digest('hex'));
    expect((await officeCrypto.decrypt(first.bytes, { password })).equals(before)).toBe(true);
    await expect(officeCrypto.decrypt(first.bytes, { password: 'IncorrectPassword!' })).rejects.toThrow();
  });
  it('평문 형식과 약한 암호는 파일 생성 전에 거부한다', () => {
    expect(() => encryptAdminWorkbook(Buffer.from('not zip'), 'SyntheticQA-Only-2026!')).toThrow('파일 형식');
    expect(() => encryptAdminWorkbook(Buffer.from('PK\u0003\u0004'), 'short')).toThrow('비밀번호');
  });
});

import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { encryptAdminWorkbook } from './encrypted-workbook.server';
import { readReturnIntakeFile } from './claim-return-intake.server';

vi.mock('server-only', () => ({}));

async function workbook(rows: unknown[][], sheets = 1) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('반품입고').addRows(rows);
  for (let index = 1; index < sheets; index += 1) book.addWorksheet(`추가 ${index}`).addRows([['내용']]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const upload = (bytes: Buffer | string, name: string) => new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name);

describe('반품입고 회신 파일 읽기', () => {
  it('XLSX의 엑셀 날짜와 15자리 이하 숫자를 읽고, SHA-256은 올린 파일 그대로의 값이다', async () => {
    const bytes = await workbook([['회수송장번호', '주문번호', '입고일'], [123456789012, '2026111210000003', new Date(Date.UTC(2026, 10, 11))]]);
    const read = await readReturnIntakeFile(upload(bytes, '반품입고.xlsx'), '');
    expect(read.table[1]).toEqual(['123456789012', '2026111210000003', '2026-11-11']);
    expect(read.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(read.lineErrors).toEqual({});
  });
  it('수식·긴 숫자 칸은 그 줄의 오류로 남긴다', async () => {
    const bytes = await workbook([['송장번호', '입고일'], [{ formula: '1+1' }, '2026-11-12'], [12345678901234567, '2026-11-12']]);
    const read = await readReturnIntakeFile(upload(bytes, 'reply.xlsx'), '');
    expect(read.lineErrors).toEqual({ 2: '수식은 사용할 수 없습니다.', 3: '긴 번호는 숫자 대신 텍스트 형식으로 저장해주세요.' });
  });
  it('비밀번호를 건 XLSX는 비밀번호로 풀어 읽는다(근거는 암호화된 파일의 SHA-256)', async () => {
    const plain = await workbook([['송장번호', '입고일'], ['RP0001', '2026-11-12']]);
    const encrypted = encryptAdminWorkbook(plain, 'Return!2026').bytes;
    const read = await readReturnIntakeFile(upload(encrypted, 'locked.xlsx'), 'Return!2026');
    expect(read.table[1]).toEqual(['RP0001', '2026-11-12']);
    expect(read.sha256).toBe(createHash('sha256').update(encrypted).digest('hex'));
    await expect(readReturnIntakeFile(upload(encrypted, 'locked.xlsx'), 'wrong-pass')).rejects.toThrow();
  });
  it('내용이 있는 시트가 둘이면 거절한다', async () => {
    await expect(readReturnIntakeFile(upload(await workbook([['송장번호', '입고일']], 2), 'two.xlsx'), '')).rejects.toThrow('시트 하나');
  });
  it('CSV·TSV를 읽고, 다른 형식·빈 파일·1MB 초과는 거절한다', async () => {
    const csv = await readReturnIntakeFile(upload('﻿회수송장번호,입고일\n"RP,0001",2026-11-12\n', '반품입고.csv'), '');
    expect(csv.table).toEqual([['회수송장번호', '입고일'], ['RP,0001', '2026-11-12']]);
    const tsv = await readReturnIntakeFile(upload('송장번호\t입고일\nRP0002\t2026-11-12', 'reply.tsv'), '');
    expect(tsv.table[1]).toEqual(['RP0002', '2026-11-12']);
    await expect(readReturnIntakeFile(upload('x', 'reply.pdf'), '')).rejects.toThrow('XLSX 또는 CSV');
    await expect(readReturnIntakeFile(upload('', 'reply.csv'), '')).rejects.toThrow('파일을 골라주세요');
    await expect(readReturnIntakeFile(upload('a'.repeat(1024 * 1024 + 1), 'big.csv'), '')).rejects.toThrow('1MB');
  });
});

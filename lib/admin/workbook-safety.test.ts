import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readBoundedZip } from './bounded-zip.server';
import { loadSafeWorkbook, readSafeWorkbookCell } from './workbook-safety';
const limits = { entries: 20, entryBytes: 1024, totalBytes: 2048 };
async function zip(entries: Record<string, string>) {
  const archive = new JSZip();
  for (const [name, value] of Object.entries(entries))
    archive.file(name, value);
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
describe('bounded workbook and image ZIP reads', () => {
  it('rejects tiny compressed files whose expanded content exceeds the limit', async () => {
    const bytes = await zip({ 'image.png': 'A'.repeat(100000) });
    expect(bytes.length).toBeLessThan(1000);
    await expect(readBoundedZip(bytes, limits)).rejects.toThrow('상한');
  });
  it('rejects embedded objects, traversal and ambiguous image basenames', async () => {
    await expect(
      readBoundedZip(await zip({ 'xl/embeddings/object.bin': 'data' }), limits),
    ).rejects.toThrow('삽입');
    await expect(
      readBoundedZip(await zip({ '../escape.png': 'data' }), limits),
    ).rejects.toThrow();
    await expect(
      readBoundedZip(await zip({ 'a/image.png': 'a', 'b/image.png': 'b' }), {
        ...limits,
        imagesOnly: true,
      }),
    ).rejects.toThrow('같은 파일명');
  });
  it('rejects malformed archives and compressed file size before ExcelJS allocation', async () => {
    await expect(
      readBoundedZip(Buffer.from('not a zip'), limits),
    ).rejects.toThrow('ZIP');
    await expect(
      loadSafeWorkbook(Buffer.alloc(21), { fileBytes: 20 }),
    ).rejects.toThrow('용량');
  });
  it('reads text identifiers losslessly while rejecting formulas and dates', () => {
    const sheet = new ExcelJS.Workbook().addWorksheet('test');
    const cell = sheet.getCell('A1');
    cell.value = '000123';
    expect(readSafeWorkbookCell(cell, true)).toEqual({ value: '000123' });
    cell.value = 123;
    expect(readSafeWorkbookCell(cell, true).error).toContain('텍스트');
    cell.value = { formula: 'HYPERLINK("https://example.test")', result: 1 };
    expect(readSafeWorkbookCell(cell).error).toContain('수식');
    cell.value = new Date();
    expect(readSafeWorkbookCell(cell).error).toContain('날짜');
  });
});

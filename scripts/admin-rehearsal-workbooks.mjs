import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import sharp from 'sharp';

/** Populate the actual downloaded template by header names, preserving its formatting. */
export async function buildRehearsalWorkbooks({
  template,
  run,
  ipId,
  originCode = 'gimpo',
  count = 30,
}) {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(run ?? ''))
    throw new Error('run requires 3–40 lowercase letters, digits or hyphens');
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(ipId ?? '') || count !== 30)
    throw new Error('S1 requires an IP ID and 30 products');
  if (!template.length || template.length > 2 * 1024 * 1024)
    throw new Error('Download the current application template (maximum 2MB)');
  const output = {};
  for (const mode of ['draft', 'draft-errors', 'publish']) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template);
    const sheet = workbook.getWorksheet('상품');
    if (!sheet || sheet.getCell('A1').text !== 'ICONS 상품 일괄 등록 v1')
      throw new Error('Current goods template required');
    const headers = new Map();
    sheet.getRow(4).eachCell((cell, column) => headers.set(cell.text, column));
    let row = 5;
    for (let product = 1; product <= count; product++)
      for (const option of [0, 1]) {
        const fields = {
          상품코드: `${run.toUpperCase()}-${String(product).padStart(2, '0')}`,
          상품명: `[연습] ${run} 상품 ${product}`,
          'IP ID': ipId,
          '게시 상태': mode === 'publish' ? '공개' : '초안',
          '상품 유형': '문구',
          '기본 판매가': 12000,
          '재고 표시': 'ok',
          '무통장 허용': '아니오',
          '판매 제한': 'none',
          '출고지 코드': originCode,
          '배송비 유형': 'policy',
          '개별 배송비': 0,
          옵션코드: `${run.toUpperCase()}-${String(product).padStart(2, '0')}-${option ? 'B' : 'A'}`,
          옵션명: option ? '파랑' : '빨강',
          '옵션 축 1': '색상',
          '옵션 값 1': option ? '파랑' : '빨강',
          '옵션 판매가': option ? 13000 : 12000,
          '옵션 재고': mode === 'draft-errors' && product === count ? -1 : 10,
          제조자: '[연습용] 가상 제조자',
          제조국: '[연습용] 대한민국',
          소재: '[연습용] 종이',
          크기: '[연습용] 10cm',
          제조연월: '2026-09',
          'AS 책임자': '[연습용] 운영팀',
          'AS 연락처': 'cs@staging.icons.test',
          '상품 설명': '합성 운영 연습 상품입니다. 실제 구매·출고·연락 금지.',
          '대표 이미지 파일명': 'rehearsal.png',
        };
        for (const [header, value] of Object.entries(fields)) {
          const column = headers.get(header);
          if (!column) throw new Error(`Template field missing: ${header}`);
          const cell = sheet.getCell(row, column);
          cell.value = value;
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { vertical: 'middle', wrapText: true };
        }
        sheet.getRow(row).height = 32;
        row++;
      }
    sheet.autoFilter = `A4:AR${row - 1}`;
    output[`goods-${mode}.xlsx`] = Buffer.from(
      await workbook.xlsx.writeBuffer(),
    );
  }
  const zip = new JSZip();
  zip.file(
    'rehearsal.png',
    await sharp({
      create: { width: 96, height: 96, channels: 3, background: '#72849a' },
    })
      .png()
      .toBuffer(),
  );
  output['goods-images.zip'] = await zip.generateAsync({ type: 'nodebuffer' });
  return output;
}
async function main() {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1])
      throw new Error('Use --name value pairs');
    values[args[i].slice(2)] = args[i + 1];
  }
  if (!values.out || !values.template)
    throw new Error(
      '--out directory and --template downloaded-template.xlsx are required',
    );
  const directory = resolve(values.out);
  await mkdir(directory, { recursive: true });
  const files = await buildRehearsalWorkbooks({
    template: await readFile(values.template),
    run: values.run,
    ipId: values.ip,
    originCode: values.origin ?? 'gimpo',
  });
  for (const [name, bytes] of Object.entries(files))
    await writeFile(`${directory}/${name}`, bytes, { flag: 'wx' });
  console.log(
    `Created 30 products / 60 options and image ZIP in ${directory}.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

import { createHash } from 'node:crypto';
import CFB from 'cfb';
import ExcelJS from 'exceljs';
import officeCrypto from 'officecrypto-tool';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptUploadedWorkbook, encryptAdminWorkbook, isOleContainer } from './encrypted-workbook.server';

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

describe('업로드한 비밀번호 파일 복호화', () => {
  const LIMIT = 1024 * 1024;
  const UNREADABLE = '암호 파일을 열지 못했습니다';
  const plain = async () => {
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('회신').addRow(['00000123', 'hanjin', '12345678']);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  };
  /** 컨테이너는 정상인 채로 파일에 적힌 복호화 매개변수만 바꾼다. */
  function withEncryptionInfo(bytes: Buffer, edit: (xml: string) => string) {
    const container = CFB.read(bytes, { type: 'buffer' });
    const entry = CFB.find(container, '/EncryptionInfo')!;
    const info = Buffer.from(entry.content as Uint8Array);
    entry.content = Buffer.concat([info.subarray(0, 8), Buffer.from(edit(info.subarray(8).toString('utf8')))]);
    entry.size = entry.content.length;
    return Buffer.from(CFB.write(container, { type: 'buffer' }));
  }
  afterEach(() => { vi.restoreAllMocks(); });

  it('내려받을 때 정한 비밀번호로 원본 ZIP을 돌려주고 평문 XLSX는 대상이 아니다', async () => {
    const zip = await plain(); const sealed = encryptAdminWorkbook(zip, '1234').bytes;
    expect(isOleContainer(sealed)).toBe(true); expect(isOleContainer(zip)).toBe(false);
    expect((await decryptUploadedWorkbook(sealed, '1234', LIMIT)).equals(zip)).toBe(true);
  });
  it('Excel에서 바꾼 다운로드 규칙 밖의 비밀번호와 Excel 2007 표준 암호화도 연다', async () => {
    const zip = await plain();
    const excelPassword = '한글 포함 비밀번호 1234567890 긴 문장';
    expect((await decryptUploadedWorkbook(officeCrypto.encrypt(zip, { password: excelPassword }), excelPassword, LIMIT)).equals(zip)).toBe(true);
    const standard = officeCrypto.encrypt(zip, { password: 'abcd', type: 'standard' });
    expect((await decryptUploadedWorkbook(standard, 'abcd', LIMIT)).subarray(0, zip.length).equals(zip)).toBe(true);
  });
  it('비밀번호가 없거나 틀리면 서로 다른 문구로 거절하고 입력값을 문구에 담지 않는다', async () => {
    const sealed = encryptAdminWorkbook(await plain(), '1234').bytes;
    await expect(decryptUploadedWorkbook(sealed, '', LIMIT)).rejects.toThrow('파일 비밀번호를 입력');
    const wrong = await decryptUploadedWorkbook(sealed, 'Wrong-Secret-9', LIMIT).catch(error => error as Error);
    expect((wrong as Error).message).toContain('파일 비밀번호가 맞지 않습니다');
    expect((wrong as Error).message).not.toContain('Wrong-Secret-9');
  });
  it('라이브러리 오류 문구는 밖으로 내보내지 않는다', async () => {
    const sealed = encryptAdminWorkbook(await plain(), '1234').bytes;
    vi.spyOn(officeCrypto, 'decrypt').mockRejectedValueOnce(new Error('failed for password=Leaked-Secret'));
    const failure = await decryptUploadedWorkbook(sealed, 'Leaked-Secret', LIMIT).catch(error => error as Error);
    expect((failure as Error).message).toContain(UNREADABLE); expect((failure as Error).message).not.toContain('Leaked-Secret');
  });
  it('구형 XLS는 비밀번호를 묻지 않고 거절하며 XLS 복호화 코드를 실행하지 않는다', async () => {
    const legacy = CFB.utils.cfb_new(); CFB.utils.cfb_add(legacy, 'Workbook', Buffer.from('biff8'));
    const decrypt = vi.spyOn(officeCrypto, 'decrypt');
    await expect(decryptUploadedWorkbook(Buffer.from(CFB.write(legacy, { type: 'buffer' })), '', LIMIT)).rejects.toThrow('구형 Excel');
    expect(decrypt).not.toHaveBeenCalled();
  });
  it('컨테이너가 깨졌거나 복호화 결과가 ZIP이 아니면 파일을 열지 못한다고 안내한다', async () => {
    await expect(decryptUploadedWorkbook(Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(64)]), '1234', LIMIT)).rejects.toThrow(UNREADABLE);
    const notZip = officeCrypto.encrypt(Buffer.from('not a zip package'), { password: 'abcd', type: 'standard' });
    await expect(decryptUploadedWorkbook(notZip, 'abcd', LIMIT)).rejects.toThrow(UNREADABLE);
  });
  it.each([
    ['반복 횟수 상한 초과', (xml: string) => xml.replace('spinCount="100000"', 'spinCount="1000001"')],
    ['작은따옴표로 쓴 반복 횟수', (xml: string) => xml.replace('spinCount="100000"', "spinCount='99999999'")],
    ['공백을 앞세운 반복 횟수', (xml: string) => xml.replace('spinCount="100000"', 'spinCount=" 4000000"')],
    ['줄바꿈을 앞세운 반복 횟수', (xml: string) => xml.replace('spinCount="100000"', 'spinCount="\n4000000"')],
    ['문자 참조로 쓴 반복 횟수', (xml: string) => xml.replace('spinCount="100000"', 'spinCount="&#57;00000000"')],
    ['키 길이로 큰 메모리 요구', (xml: string) => xml.replaceAll('keyBits="256"', 'keyBits="80000000"')],
    ['블록 길이로 큰 메모리 요구', (xml: string) => xml.replaceAll('blockSize="16"', 'blockSize="80000000"')],
  ])('%s 파일은 해시·할당 전에 거절한다', async (_label, edit) => {
    const sealed = withEncryptionInfo(encryptAdminWorkbook(await plain(), '1234').bytes, edit);
    const decrypt = vi.spyOn(officeCrypto, 'decrypt');
    await expect(decryptUploadedWorkbook(sealed, '1234', LIMIT)).rejects.toThrow(UNREADABLE);
    expect(decrypt).not.toHaveBeenCalled();
  });
  it('Excel 기본 반복 횟수와 상한까지의 값은 그대로 처리한다', async () => {
    const zip = await plain(); const sealed = encryptAdminWorkbook(zip, '1234').bytes;
    const decrypt = vi.spyOn(officeCrypto, 'decrypt').mockResolvedValueOnce(zip);
    await expect(decryptUploadedWorkbook(withEncryptionInfo(sealed, xml => xml.replace('spinCount="100000"', 'spinCount="1000000"')), '1234', LIMIT)).resolves.toBe(zip);
    expect(decrypt).toHaveBeenCalledOnce();
  });
  it('복호화 전에도 파일 크기 한도를 적용한다', async () => {
    const sealed = encryptAdminWorkbook(await plain(), '1234').bytes;
    const decrypt = vi.spyOn(officeCrypto, 'decrypt');
    await expect(decryptUploadedWorkbook(sealed, '1234', sealed.length - 1)).rejects.toThrow('용량이 상한을 초과');
    expect(decrypt).not.toHaveBeenCalled();
  });
});

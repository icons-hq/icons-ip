import 'server-only';
import { createHash } from 'node:crypto';
import officeCrypto from 'officecrypto-tool';
import { exportPasswordError } from './export-password';

const OLE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');

/** Encrypt the unchanged ExcelJS ZIP buffer using ECMA-376 Agile defaults. */
export function encryptAdminWorkbook(plain: Buffer, password: string): { bytes: Buffer; sha256: string } {
  if (exportPasswordError(password, password)) throw new Error('엑셀 비밀번호 형식을 확인해주세요.');
  if (!plain.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) throw new Error('엑셀 파일 형식을 확인해주세요.');
  try {
    const bytes = officeCrypto.encrypt(plain, { password });
    if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(OLE_SIGNATURE) || !officeCrypto.isEncrypted(bytes)) {
      throw new Error('invalid encrypted workbook');
    }
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch {
    // A library error may contain arguments. Never propagate it or return plaintext.
    throw new Error('파일을 암호화하지 못했습니다. 잠시 후 다시 내려받아 주세요.');
  }
}

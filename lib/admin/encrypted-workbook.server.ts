import 'server-only';
import { createHash } from 'node:crypto';
import CFB from 'cfb';
import officeCrypto from 'officecrypto-tool';
import { exportPasswordError } from './export-password';

const OLE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const ZIP_SIGNATURE = Buffer.from('504b0304', 'hex');
const UNREADABLE_WORKBOOK = '암호 파일을 열지 못했습니다. Excel에서 XLSX로 다시 저장해 올려주세요.';
// Agile 파일은 이 값들을 스스로 적어 두고 복호화는 그만큼 해시를 돌고 메모리를 잡는다. 업로드가 서버 비용을 정하지 못하게 막는다.
// 반복 횟수는 Excel 기본값 100,000회의 10배까지만 받는다.
const AGILE_PARAMETER_LIMITS: Record<string, number> = { spinCount: 1_000_000, keyBits: 256, blockSize: 16 };

/** Encrypt the unchanged ExcelJS ZIP buffer using ECMA-376 Agile defaults. */
export function encryptAdminWorkbook(plain: Buffer, password: string): { bytes: Buffer; sha256: string } {
  if (exportPasswordError(password, password)) throw new Error('엑셀 비밀번호 형식을 확인해주세요.');
  if (!plain.subarray(0, 4).equals(ZIP_SIGNATURE)) throw new Error('엑셀 파일 형식을 확인해주세요.');
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

/** 비밀번호가 걸린 XLSX 또는 구형 XLS. 일반 XLSX는 ZIP이라 해당하지 않는다. */
export function isOleContainer(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(OLE_SIGNATURE);
}

function assertAgileParametersBounded(encryptionInfo: Buffer): void {
  // 나온 값은 모두 순수 정수여야 한다. 복호화 쪽은 공백이 붙은 값도 숫자로 바꾸고 문자 참조도 풀어 읽는다.
  for (const [, name, , value] of encryptionInfo.toString('utf8').matchAll(/\b(spinCount|keyBits|blockSize)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    if (!/^\d{1,8}$/.test(value) || Number(value) > AGILE_PARAMETER_LIMITS[name]) throw new Error(UNREADABLE_WORKBOOK);
  }
}

/**
 * 업로드한 비밀번호 파일을 메모리에서 열어 ZIP 바이트를 돌려준다. 비밀번호는 인자로만 지나가고 어디에도 남기지 않는다.
 * 결과에는 호출자가 평문 XLSX와 같은 크기·압축 해제 한도를 적용해야 한다.
 * 라이브러리 오류에는 인자가 섞일 수 있어 아래의 정해진 문구만 밖으로 내보낸다.
 */
export async function decryptUploadedWorkbook(bytes: Buffer, password: string, maxFileBytes: number): Promise<Buffer> {
  if (bytes.length > maxFileBytes) throw new Error('XLSX 파일 용량이 상한을 초과합니다.');
  let encryptionInfo: Buffer | null;
  try {
    const entry = CFB.find(CFB.read(bytes, { type: 'buffer' }), '/EncryptionInfo');
    encryptionInfo = entry?.content ? Buffer.from(entry.content as Uint8Array) : null;
  } catch {
    throw new Error(UNREADABLE_WORKBOOK);
  }
  if (!encryptionInfo) throw new Error('구형 Excel 형식(.xls)은 올릴 수 없습니다. Excel에서 XLSX로 저장해주세요.');
  if (!password) throw new Error('비밀번호가 걸린 파일입니다. 파일 비밀번호를 입력한 뒤 다시 등록해주세요.');
  assertAgileParametersBounded(encryptionInfo);
  let plain: Buffer;
  try {
    plain = await officeCrypto.decrypt(bytes, { password });
  } catch (error) {
    throw new Error(error instanceof Error && error.message === 'The password is incorrect'
      ? '파일 비밀번호가 맞지 않습니다. 파일을 내려받을 때 정한 비밀번호를 확인해주세요.'
      : UNREADABLE_WORKBOOK);
  }
  if (!Buffer.isBuffer(plain) || !plain.subarray(0, 4).equals(ZIP_SIGNATURE)) throw new Error(UNREADABLE_WORKBOOK);
  return plain;
}

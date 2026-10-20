import 'server-only';
import { createHash } from 'node:crypto';
import { DIGITAL_FILE_MAX_BYTES, DIGITAL_MIME_EXTENSIONS } from '@/lib/goods-fulfillment';
/** Signature/size verification, not an antivirus claim. Payloads are never
 * executed, expanded, transcoded, or served inline by the application. */
export function inspectDigitalFile(bytes: Uint8Array, mime: string): string | null {
 if (!bytes.length || bytes.length > DIGITAL_FILE_MAX_BYTES || !Object.hasOwn(DIGITAL_MIME_EXTENSIONS, mime)) return null;
 const starts = (...prefix: number[]) => prefix.every((v, i) => bytes[i] === v);
 let valid = false;
 switch (mime) {
  case 'application/pdf': valid = starts(0x25, 0x50, 0x44, 0x46, 0x2d) && Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).includes(Buffer.from('%%EOF')); break;
  case 'application/zip': valid = starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06); break;
  case 'image/png': valid = starts(137, 80, 78, 71, 13, 10, 26, 10); break;
  case 'image/jpeg': valid = starts(0xff, 0xd8, 0xff) && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9; break;
  case 'audio/mpeg': valid = starts(0x49, 0x44, 0x33) || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0; break;
  case 'video/mp4': valid = bytes.length >= 12 && Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp'; break;
  case 'text/plain': try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); valid = !bytes.includes(0); } catch { valid = false; } break;
 }
 return valid ? createHash('sha256').update(bytes).digest('hex') : null;
}

import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { INQUIRY_FILE_MAX_BYTES, INQUIRY_FILE_MIME_EXTENSIONS } from './inquiry-files';
/** Images must decode within a bounded pixel budget. Documents use signatures;
 * the application never executes or expands their content. */
export async function inspectInquiryFile(bytes: Uint8Array, mimeType: string): Promise<string | null> {
  if (!bytes.length || bytes.length > INQUIRY_FILE_MAX_BYTES || !Object.hasOwn(INQUIRY_FILE_MIME_EXTENSIONS, mimeType)) return null;
  const buffer = Buffer.from(bytes);
  if (mimeType.startsWith('image/')) {
    try {
      const image = sharp(bytes, { animated: true, failOn: 'error', limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      const width = metadata.width ?? 0, height = metadata.height ?? 0, frameHeight = metadata.pageHeight ?? height;
      const format = mimeType === 'image/jpeg' ? 'jpeg' : mimeType.slice(6);
      if (metadata.format !== format || width < 1 || frameHeight < 1 || width > 12000 || frameHeight > 12000
        || width * height > 40_000_000 || (metadata.pages ?? 1) > 100) return null;
      // Producing bounded output forces decoding; metadata alone accepts truncated files.
      await image.resize({ width: 1, height: 1, fit: 'inside' }).raw().toBuffer();
      return createHash('sha256').update(bytes).digest('hex');
    } catch { return null; }
  }
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const compound = starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  const zip = starts(0x50, 0x4b, 0x03, 0x04);
  let valid = false;
  switch (mimeType) {
    case 'video/mp4': valid = bytes.length >= 12 && buffer.subarray(4, 8).toString() === 'ftyp'; break;
    case 'application/pdf': valid = starts(0x25, 0x50, 0x44, 0x46, 0x2d) && buffer.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from('%%EOF')); break;
    case 'text/plain': try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); valid = !bytes.includes(0); } catch { valid = false; } break;
    case 'application/vnd.ms-excel': valid = compound && (buffer.includes(Buffer.from('Workbook', 'utf16le')) || buffer.includes(Buffer.from('Book', 'utf16le'))); break;
    case 'application/vnd.ms-powerpoint': valid = compound && buffer.includes(Buffer.from('PowerPoint Document', 'utf16le')); break;
    case 'application/msword': valid = compound && buffer.includes(Buffer.from('WordDocument', 'utf16le')); break;
    case 'application/x-hwp': valid = compound && buffer.includes(Buffer.from('FileHeader', 'utf16le')) && buffer.includes(Buffer.from('HWP Document File')); break;
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': valid = zip && buffer.includes(Buffer.from('[Content_Types].xml')) && buffer.includes(Buffer.from('xl/workbook.xml')); break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': valid = zip && buffer.includes(Buffer.from('[Content_Types].xml')) && buffer.includes(Buffer.from('word/document.xml')); break;
  }
  return valid ? createHash('sha256').update(bytes).digest('hex') : null;
}

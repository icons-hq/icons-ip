import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { inquiryFileFromUpload, parseInquiryFile, INQUIRY_FILE_MAX_BYTES } from './inquiry-files';
import { inspectInquiryFile } from './inquiry-file-inspection.server';
import sharp from 'sharp';
const id = 'f1100000-0000-4000-8000-000000000001';
describe('상담 파일 계약', () => {
  it('브라우저 MIME 누락과 무관하게 허용 확장자만 준비하고 20MB 초과·경로 파일명을 거절한다', () => {
    expect(inquiryFileFromUpload({ name: '안내.pdf', type: '', size: 400 }, id)?.mimeType).toBe('application/pdf');
    expect(inquiryFileFromUpload({ name: '안내.html', type: 'application/pdf', size: 400 }, id)).toBeNull();
    expect(inquiryFileFromUpload({ name: 'a.pdf', type: '', size: INQUIRY_FILE_MAX_BYTES + 1 }, id)).toBeNull();
    expect(parseInquiryFile({ id, name: '../a.pdf', mimeType: 'application/pdf', size: 400 })).toBeNull();
    expect(parseInquiryFile({ id, name: 'synthetic.html', mimeType: 'text/plain', size: 400 })).toBeNull();
    expect(parseInquiryFile({ id, name: 'PHOTO.JPEG', mimeType: 'image/jpeg', size: 400 })?.name).toBe('PHOTO.JPEG');
  });
  it('실제 내용을 확인하고 확장자만 바꾼 파일·손상된 PDF·잘못된 텍스트는 통과시키지 않는다', async () => {
    expect(await inspectInquiryFile(Buffer.from('%PDF-1.7\n%%EOF'), 'application/pdf')).toMatch(/^[a-f0-9]{64}$/);
    expect(await inspectInquiryFile(Buffer.from('<html>file</html>'), 'application/pdf')).toBeNull();
    expect(await inspectInquiryFile(Buffer.from('%PDF-1.7\n'), 'application/pdf')).toBeNull();
    expect(await inspectInquiryFile(new Uint8Array([0, 10]), 'text/plain')).toBeNull();
    expect(await inspectInquiryFile(Buffer.from('한 글자도 전송합니다.'), 'text/plain')).toMatch(/^[a-f0-9]{64}$/);
  });
  it('헤더만 있는 PNG·GIF·WebP와 손상된 실제 사진을 거절하고 디코딩 가능한 사진만 받는다', async () => {
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#2387dd' } }).png().toBuffer();
    expect(await inspectInquiryFile(image, 'image/png')).toMatch(/^[a-f0-9]{64}$/);
    for (const [value, mime] of [[image.subarray(0, 8), 'image/png'], [image.subarray(0, 40), 'image/png'],
      [Buffer.from('GIF89a'), 'image/gif'], [Buffer.from('RIFF0000WEBP'), 'image/webp']] as const) expect(await inspectInquiryFile(value, mime)).toBeNull();
    expect(await inspectInquiryFile(image, 'image/jpeg')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { decryptPhoto, encryptPhoto, readPhoto, unpackDocumentEvidence } from './overseas-evidence.server';
import { OVERSEAS_UPLOAD_LIMIT } from './overseas-adult';

describe('해외 심사 증빙', () => {
  it('같은 사진도 다른 객체가 되며 두 키 조각·신청·암호문이 모두 맞아야 열린다', () => {
    const photo = Buffer.from('synthetic photo');
    const a = encryptPhoto('request-a', photo),
      b = encryptPhoto('request-a', photo);
    expect(a.object.equals(b.object)).toBe(false);
    expect(decryptPhoto('request-a', a.share, a.object)).toEqual(photo);
    expect(() => decryptPhoto('request-b', a.share, a.object)).toThrow();
    expect(() => decryptPhoto('request-a', b.share, a.object)).toThrow();
    a.object[a.object.length - 1] ^= 1;
    expect(() => decryptPhoto('request-a', a.share, a.object)).toThrow();
  });
  it('실제 이미지의 메타데이터를 제거하고, 내용·용량을 확인한다', async () => {
    const input = await sharp({ create: { width: 360, height: 480, channels: 3, background: 'white' } })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const request = (body: Uint8Array<ArrayBuffer>) => new Request('http://localhost/test', { method: 'POST', body });
    const photo = await readPhoto(request(new Uint8Array(input)));
    const sealed = encryptPhoto('doc', photo);
    const opened = decryptPhoto('doc', sealed.share, sealed.object);
    expect((await sharp(opened).metadata()).exif).toBeUndefined();
    await expect(readPhoto(request(new Uint8Array([1, 2, 3])))).rejects.toThrow();
    await expect(readPhoto(request(new Uint8Array(OVERSEAS_UPLOAD_LIMIT + 1)))).rejects.toThrow();
  });
  it('기존 입력형 신청은 제출 당시 암호문을 읽을 수 있다', () => {
    const fields = Buffer.from(JSON.stringify({ name: 'Émilie O’Neil', gender: 'X' }));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(fields.length);
    const bytes = Buffer.from('legacy jpeg');
    const result = unpackDocumentEvidence(Buffer.concat([length, fields, bytes]));
    expect(result.identity).toEqual({ name: 'Émilie O’Neil', gender: 'X' });
    expect(result.photo).toEqual(bytes);
  });
});

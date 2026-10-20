import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createFile, type MP4BoxBuffer } from 'mp4box';
import { inspectAndNormalizeGoodsVideo } from './goods-video-parser.server';

const original = new Uint8Array(readFileSync(new URL('./fixtures/goods-media-h264-aac.mp4', import.meta.url)));
function bytes() { return new Uint8Array(original); }
function atomOffset(value: Uint8Array, atom: string) { const offset = Buffer.from(value).indexOf(atom); expect(offset).toBeGreaterThan(3); return offset; }
describe('server MP4 structural validation', () => {
  it('accepts real H.264/AAC samples and removes identifying container metadata without changing sample offsets', () => {
    const result = inspectAndNormalizeGoodsVideo(original);
    expect(result).not.toBeNull();
    expect(result?.metadata).toMatchObject({ width: 160, height: 120, durationMs: 2000, audioCodec: 'mp4a.40.2', byteSize: original.length });
    expect(result?.metadata.sha256).toBe(createHash('sha256').update(result!.bytes).digest('hex'));
    expect(Buffer.from(result!.bytes).includes(Buffer.from('SYNTHETIC LOCAL QA VIDEO'))).toBe(false);
    expect(inspectAndNormalizeGoodsVideo(result!.bytes)?.metadata).toEqual(result?.metadata);
  });
  it('rejects truncated containers, oversized table counts and sample offsets outside the actual media bytes', () => {
    expect(inspectAndNormalizeGoodsVideo(original.subarray(0, original.length - 8))).toBeNull();
    const count = bytes(); new DataView(count.buffer).setUint32(atomOffset(count, 'stsz') + 12, 0xffffffff);
    expect(inspectAndNormalizeGoodsVideo(count)).toBeNull();
    const offset = bytes(); new DataView(offset.buffer).setUint32(atomOffset(offset, 'stco') + 12, original.length + 1);
    expect(inspectAndNormalizeGoodsVideo(offset)).toBeNull();
  });
  it('rejects unsupported video codec and malformed AVC samples even when metadata looks valid', () => {
    const codec = bytes(); codec.set(Buffer.from('hvc1'), Buffer.from(codec).lastIndexOf('avc1'));
    expect(inspectAndNormalizeGoodsVideo(codec)).toBeNull();
    const corrupt = bytes(); const file = createFile(false); const buffer = corrupt.buffer.slice(0) as MP4BoxBuffer; buffer.fileStart = 0; file.appendBuffer(buffer, true); file.flush();
    const sample = file.getTrackSamplesInfo(file.getInfo().videoTracks[0].id)[0]; corrupt.fill(0xff, sample.offset, sample.offset + 4);
    expect(inspectAndNormalizeGoodsVideo(corrupt)).toBeNull();
  });
  it('rejects external data references and durations beyond one minute', () => {
    const reference = bytes(); new DataView(reference.buffer).setUint32(atomOffset(reference, 'url ') + 4, 0);
    expect(inspectAndNormalizeGoodsVideo(reference)).toBeNull();
    const long = bytes(), view = new DataView(long.buffer), mvhd = atomOffset(long, 'mvhd');
    view.setUint32(mvhd + 20, view.getUint32(mvhd + 16) * 61);
    expect(inspectAndNormalizeGoodsVideo(long)).toBeNull();
  });
});

import 'server-only';
import { createHash } from 'node:crypto';
import { createFile, type MP4BoxBuffer, type Sample } from 'mp4box';
import { GOODS_MEDIA_MAX_BYTES, GOODS_MEDIA_MAX_DIMENSION, GOODS_MEDIA_MAX_DURATION_MS, type GoodsMediaMetadata } from '@/lib/goods-media';

const MAX_SAMPLES = 15_000;
const MAX_BOXES = 5_000;
const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts']);
const permitted: Record<string, Set<string>> = {
  root: new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'udta', 'meta', 'uuid']),
  moov: new Set(['mvhd', 'trak', 'udta', 'meta', 'free']),
  trak: new Set(['tkhd', 'mdia', 'edts', 'udta', 'meta', 'free']),
  mdia: new Set(['mdhd', 'hdlr', 'minf', 'udta', 'meta', 'free']),
  minf: new Set(['vmhd', 'smhd', 'dinf', 'stbl', 'free']),
  stbl: new Set(['stsd', 'stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64', 'stss', 'sdtp', 'sgpd', 'sbgp', 'free']),
  dinf: new Set(['dref', 'free']), edts: new Set(['elst', 'free']),
  avc1: new Set(['avcC', 'pasp', 'btrt', 'colr', 'clap', 'free']),
  mp4a: new Set(['esds', 'btrt', 'free']),
};
type Extent = { start: number; end: number };
class InvalidVideo extends Error {}
function requireVideo(condition: unknown): asserts condition { if (!condition) throw new InvalidVideo(); }

/** Bounds and table counts are checked before the third-party parser allocates sample arrays. */
function sanitizeAndInspect(source: Uint8Array): { bytes: Uint8Array<ArrayBuffer>; mdats: Extent[] } {
  const bytes = new Uint8Array(source), view = new DataView(bytes.buffer), mdats: Extent[] = [];
  const typeAt = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const uint = (offset: number, limit: number) => { requireVideo(offset + 4 <= limit); return view.getUint32(offset); };
  let boxCount = 0, ftypCount = 0, moovCount = 0, trackCount = 0;
  function walk(start: number, end: number, parent: string, depth = 0) {
    requireVideo(depth <= 10);
    for (let offset = start; offset < end;) {
      requireVideo(++boxCount <= MAX_BOXES && offset + 8 <= end);
      const type = typeAt(offset + 4), smallSize = uint(offset, end); let size = smallSize, header = 8;
      if (smallSize === 1) { requireVideo(offset + 16 <= end); const large = view.getBigUint64(offset + 8); requireVideo(large <= BigInt(GOODS_MEDIA_MAX_BYTES)); size = Number(large); header = 16; }
      if (smallSize === 0) { requireVideo(parent === 'root' && type === 'mdat'); size = end - offset; }
      const limit = offset + size, payload = offset + header;
      requireVideo(size >= header && limit <= end && permitted[parent]?.has(type));
      if (['udta', 'meta', 'uuid', 'free', 'skip'].includes(type)) {
        // Keep every box's byte extent: stco/co64 sample offsets do not move.
        bytes.set([102, 114, 101, 101], offset + 4); bytes.fill(0, payload, limit);
      } else if (containers.has(type)) {
        if (type === 'moov') requireVideo(++moovCount === 1);
        if (type === 'trak') requireVideo(++trackCount <= 2);
        walk(payload, limit, type, depth + 1);
      } else if (type === 'ftyp') {
        requireVideo(++ftypCount === 1 && size >= 16 && size <= 256 && (size - header) % 4 === 0);
        requireVideo(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(typeAt(payload)));
      } else if (type === 'mdat') { mdats.push({ start: payload, end: limit }); }
      else if (type === 'dref') {
        requireVideo(uint(payload + 4, limit) === 1);
        const entry = payload + 8, entrySize = uint(entry, limit);
        requireVideo(entrySize === 12 && entry + entrySize === limit && typeAt(entry + 4) === 'url ' && uint(entry + 8, limit) === 1);
      } else if (type === 'stsd') {
        requireVideo(uint(payload + 4, limit) === 1);
        const entry = payload + 8, entrySize = uint(entry, limit), entryType = typeAt(entry + 4);
        requireVideo(entrySize <= 16_384 && entry + entrySize === limit && ['avc1', 'mp4a'].includes(entryType));
        requireVideo(entry + 16 <= limit && view.getUint16(entry + 14) === 1);
        const childStart = entry + (entryType === 'avc1' ? 86 : 36);
        requireVideo(childStart <= limit);
        if (entryType === 'avc1') bytes.fill(0, entry + 50, entry + 82);
        if (entryType === 'mp4a') requireVideo(view.getUint16(entry + 16) === 0);
        walk(childStart, limit, entryType, depth + 1);
      } else if (type === 'stsz') {
        const sampleSize = uint(payload + 4, limit), count = uint(payload + 8, limit);
        requireVideo(count > 0 && count <= MAX_SAMPLES && sampleSize <= GOODS_MEDIA_MAX_BYTES && payload + 12 + (sampleSize === 0 ? count * 4 : 0) === limit);
      } else if (['stts', 'ctts', 'stsc', 'stco', 'co64', 'stss'].includes(type)) {
        const count = uint(payload + 4, limit), stride = type === 'stsc' ? 12 : ['stts', 'ctts', 'co64'].includes(type) ? 8 : 4;
        requireVideo(count <= MAX_SAMPLES && payload + 8 + count * stride === limit);
        if (type === 'stts' || type === 'ctts') { let samples = 0; for (let n = 0; n < count; n++) samples += uint(payload + 8 + n * stride, limit); requireVideo(samples <= MAX_SAMPLES); }
      } else if (type === 'elst') {
        const count = uint(payload + 4, limit), version = bytes[payload];
        requireVideo(version <= 1 && count <= 8 && payload + 8 + count * (version === 1 ? 20 : 12) === limit);
      } else if (type === 'sgpd' || type === 'sbgp') {
        const version = bytes[payload]; requireVideo(version <= 2 && size <= 65_536);
        const countOffset = payload + (type === 'sgpd' ? version === 0 ? 8 : version === 1 ? 12 : 16 : version === 0 ? 8 : 12);
        requireVideo(uint(countOffset, limit) <= MAX_SAMPLES);
      } else if (type === 'sdtp') { requireVideo(size <= MAX_SAMPLES + 16); }
      else if (type === 'hdlr') { requireVideo(payload + 24 <= limit && size <= 1024); bytes.fill(0, payload + 24, limit); }
      else if (['mvhd', 'tkhd', 'mdhd'].includes(type)) {
        const version = bytes[payload]; requireVideo(version <= 1 && size <= 160 && payload + (version === 1 ? 20 : 12) <= limit);
        bytes.fill(0, payload + 4, payload + (version === 1 ? 20 : 12));
      } else { requireVideo(size <= 16_384); }
      offset = limit;
    }
  }
  walk(0, bytes.byteLength, 'root'); requireVideo(ftypCount === 1 && moovCount === 1 && mdats.length > 0);
  return { bytes, mdats };
}

function validAvcSample(bytes: Uint8Array, sample: Sample): boolean {
  const description = sample.description as unknown as { avcC?: { lengthSizeMinusOne?: number } };
  const width = Number(description.avcC?.lengthSizeMinusOne) + 1;
  if (![1, 2, 4].includes(width)) return false;
  const end = sample.offset + sample.size; let offset = sample.offset, nalCount = 0;
  while (offset < end) {
    if (++nalCount > 256 || offset + width > end) return false;
    let size = 0; for (let i = 0; i < width; i++) size = size * 256 + bytes[offset + i]; offset += width;
    if (size < 1 || offset + size > end || bytes[offset] & 0x80 || (bytes[offset] & 0x1f) < 1 || (bytes[offset] & 0x1f) > 23) return false;
    offset += size;
  }
  return offset === end;
}

/** Structural/codec inspection, not a full video decoder or a malware scanner. */
export function inspectAndNormalizeGoodsVideo(source: Uint8Array): { bytes: Uint8Array; metadata: GoodsMediaMetadata } | null {
  if (source.byteLength < 32 || source.byteLength > GOODS_MEDIA_MAX_BYTES) return null;
  try {
    const { bytes, mdats } = sanitizeAndInspect(source), file = createFile(false);
    let failed = false; file.onError = () => { failed = true; };
    const input = bytes.buffer.slice(0) as MP4BoxBuffer; input.fileStart = 0;
    file.appendBuffer(input, true); file.flush(); const info = file.getInfo();
    requireVideo(!failed && info.hasMoov && !info.isFragmented && info.videoTracks.length === 1 && info.audioTracks.length <= 1 && info.tracks.length === 1 + info.audioTracks.length);
    const video = info.videoTracks[0], audio = info.audioTracks[0];
    const width = video.video?.width ?? 0, height = video.video?.height ?? 0;
    requireVideo(Number.isInteger(width) && width > 0 && width <= GOODS_MEDIA_MAX_DIMENSION && Number.isInteger(height) && height > 0 && height <= GOODS_MEDIA_MAX_DIMENSION);
    requireVideo(/^avc1\.[a-fA-F0-9]{6}$/.test(video.codec) && (!audio || audio.codec === 'mp4a.40.2'));
    // Edit lists trim AAC priming frames; the movie timeline is the visible duration.
    const durationMs = Math.ceil(Math.max(info.duration / info.timescale, ...info.tracks.map(track => track.movie_duration / track.movie_timescale)) * 1000);
    requireVideo(Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= GOODS_MEDIA_MAX_DURATION_MS);
    const extents: Extent[] = [];
    for (const track of info.tracks) {
      requireVideo(Number.isSafeInteger(track.timescale) && track.timescale > 0 && track.timescale <= 1_000_000 && track.nb_samples > 0 && track.nb_samples <= MAX_SAMPLES);
      const samples = file.getTrackSamplesInfo(track.id); requireVideo(samples.length === track.nb_samples);
      let totalDuration = 0;
      for (const sample of samples) {
        requireVideo(Number.isSafeInteger(sample.offset) && Number.isSafeInteger(sample.size) && sample.size > 0 && Number.isSafeInteger(sample.duration) && sample.duration > 0);
        requireVideo(mdats.some(mdat => sample.offset >= mdat.start && sample.offset + sample.size <= mdat.end));
        if (track.id === video.id) requireVideo(validAvcSample(bytes, sample));
        extents.push({ start: sample.offset, end: sample.offset + sample.size }); totalDuration += sample.duration;
      }
      requireVideo(totalDuration / track.timescale <= GOODS_MEDIA_MAX_DURATION_MS / 1000 + 0.1);
    }
    extents.sort((a, b) => a.start - b.start); for (let i = 1; i < extents.length; i++) requireVideo(extents[i].start >= extents[i - 1].end);
    return { bytes, metadata: { width, height, durationMs, byteSize: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), videoCodec: video.codec, audioCodec: audio?.codec ?? null } };
  } catch { return null; }
}

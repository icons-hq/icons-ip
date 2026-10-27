import { describe, expect, it } from 'vitest';
import { imageSizeFromBytes } from './image-size';

/* 셸 띠배너 자리 예약용 고유 크기 읽기 — 어드민 아트웍 형식(jpg·png·webp)의 머리만 본다. */

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((character) => character.charCodeAt(0)) : part)));
const u32be = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const u24le = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
const u16le = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const u16be = (value: number) => [(value >>> 8) & 0xff, value & 0xff];

const png = (width: number, height: number) => bytes([0x89], 'PNG\r\n\x1a\n', u32be(13), 'IHDR', u32be(width), u32be(height), [8, 6, 0, 0, 0]);
const riff = (chunk: string, body: number[]) => bytes('RIFF', u32be(0), 'WEBP', chunk, u32be(body.length), body);

describe('이미지 머리에서 고유 크기 읽기', () => {
  it('PNG — IHDR 의 폭·높이', () => {
    expect(imageSizeFromBytes(png(375, 52))).toEqual({ width: 375, height: 52 });
    expect(imageSizeFromBytes(png(1440, 36))).toEqual({ width: 1440, height: 36 });
  });

  it('WebP — 확장(VP8X)·무손실(VP8L)·손실(VP8) 머리', () => {
    expect(imageSizeFromBytes(riff('VP8X', [0, 0, 0, 0, ...u24le(1679), ...u24le(35), 0]))).toEqual({ width: 1680, height: 36 });
    /* VP8L: 서명 0x2f 뒤 14비트 폭-1, 14비트 높이-1 (리틀 엔디언 비트열). 폭 750, 높이 104. */
    const w = 750 - 1;
    const h = 104 - 1;
    const bits = w | (h << 14);
    expect(imageSizeFromBytes(riff('VP8L', [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff, 0]))).toEqual({ width: 750, height: 104 });
    expect(imageSizeFromBytes(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(420), ...u16le(60), 0, 0]))).toEqual({ width: 420, height: 60 });
  });

  it('JPEG — APP 구간·채움 바이트를 건너 첫 프레임 머리(SOF)를 읽는다', () => {
    const app0 = [0xff, 0xe0, ...u16be(16), ...Array.from({ length: 14 }, () => 0)];
    const dqt = [0xff, 0xdb, ...u16be(4), 0, 0];
    const sof2 = [0xff, 0xff, 0xc2, ...u16be(17), 8, ...u16be(108), ...u16be(750), 3, 0, 0, 0];
    expect(imageSizeFromBytes(bytes([0xff, 0xd8], app0, dqt, sof2))).toEqual({ width: 750, height: 108 });
    /* DHT(C4)는 프레임 머리가 아니다. */
    const dht = [0xff, 0xc4, ...u16be(4), 0, 0];
    const sof0 = [0xff, 0xc0, ...u16be(17), 8, ...u16be(36), ...u16be(1440), 3, 0, 0, 0];
    expect(imageSizeFromBytes(bytes([0xff, 0xd8], dht, sof0))).toEqual({ width: 1440, height: 36 });
  });

  it('모르는 형식·잘린 머리·프레임 머리가 읽은 범위 밖이면 null — 크기 속성 없이 그리던 그대로다', () => {
    expect(imageSizeFromBytes(bytes('GIF89a', u16le(10), u16le(10)))).toBeNull();
    expect(imageSizeFromBytes(png(375, 52).subarray(0, 20))).toBeNull();
    expect(imageSizeFromBytes(png(0, 52))).toBeNull();
    expect(imageSizeFromBytes(bytes([0xff, 0xd8, 0xff, 0xe1], u16be(60000), [0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageSizeFromBytes(bytes([0xff, 0xd8, 0xff, 0xda], u16be(8), [0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageSizeFromBytes(riff('VP8L', [0x00, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageSizeFromBytes(new Uint8Array())).toBeNull();
  });
});

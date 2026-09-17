import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { ART_ASSET_URLS, ART_SLOTS_PENDING } from './art';
import { ART_SLOT_COUNT, ENDINGS, SCENES } from './story';

const publicDirectory = new URL('../../../public/', import.meta.url);

const storySlots = [
  ...SCENES.flatMap((scene) => [scene.art, ...scene.choices.map((choice) => choice.art)]),
  ...ENDINGS.flatMap((ending) => [ending.art, ending.cardArt]),
];

describe('홍실 퀘스트 일러스트 매니페스트', () => {
  it('스토리 슬롯이 중복 없이 발주 규모와 일치한다', () => {
    expect(storySlots).toHaveLength(ART_SLOT_COUNT);
    expect(new Set(storySlots)).toHaveLength(ART_SLOT_COUNT);
  });

  /* 매니페스트가 스토리에 없는 슬롯을 들고 있으면 죽은 원화다 — 옛 4막 슬롯이
   * 그대로 남는 사고를 막는다. */
  it('등록된 슬롯이 전부 스토리에 실제로 쓰인다', () => {
    const known = new Set(storySlots);
    const orphans = Object.keys(ART_ASSET_URLS).filter((slot) => !known.has(slot));
    expect(orphans).toEqual([]);
  });

  it('스토리의 모든 원화 슬롯이 새 자산으로 연결된다', () => {
    const registered = new Set<string>(Object.keys(ART_ASSET_URLS));
    const pending = storySlots.filter((slot) => !registered.has(slot));
    expect(pending).toEqual([]);
    expect(ART_SLOTS_PENDING).toBe(0);
  });

  it('등록된 슬롯은 전부 비어 있지 않은 WebP 파일을 가리킨다', () => {
    for (const assetUrl of Object.values(ART_ASSET_URLS)) {
      expect(assetUrl).toMatch(/^\/generated\/hong-sil-vn-v2\/.+\.webp$/);

      const assetPath = fileURLToPath(new URL(assetUrl.slice(1), publicDirectory));
      expect(existsSync(assetPath), assetUrl).toBe(true);
      expect(statSync(assetPath).size, assetUrl).toBeGreaterThan(0);
    }
  });

  it('표면별 원화 규격을 지킨다', async () => {
    for (const assetUrl of Object.values(ART_ASSET_URLS)) {
      const assetPath = fileURLToPath(new URL(assetUrl.slice(1), publicDirectory));
      const metadata = await sharp(assetPath).metadata();
      const expected = assetUrl.includes('/choices/')
        ? { width: 1600, height: 700 }
        : assetUrl.includes('/cards/')
          ? { width: 1000, height: 1400 }
          : { width: 1600, height: 1000 };

      expect(
        { width: metadata.width, height: metadata.height },
        assetUrl,
      ).toEqual(expected);
    }
  });
});

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ART_ASSET_URLS } from './art';
import { ART_SLOT_COUNT, ENDINGS, SCENES } from './story';

const publicDirectory = new URL('../../../public/', import.meta.url);

const storySlots = [
  ...SCENES.flatMap((scene) => [scene.art, ...scene.choices.map((choice) => choice.art)]),
  ...ENDINGS.flatMap((ending) => [ending.art, ending.cardArt]),
];

describe('홍실 퀘스트 일러스트 매니페스트', () => {
  it('스토리가 요구하는 56개 슬롯을 중복과 누락 없이 연결한다', () => {
    expect(storySlots).toHaveLength(ART_SLOT_COUNT);
    expect(new Set(storySlots)).toHaveLength(ART_SLOT_COUNT);
    expect(Object.keys(ART_ASSET_URLS).sort()).toEqual([...storySlots].sort());
  });

  it('모든 슬롯이 비어 있지 않은 WebP 파일을 가리킨다', () => {
    for (const assetUrl of Object.values(ART_ASSET_URLS)) {
      expect(assetUrl).toMatch(/^\/generated\/hong-sil-vn\/.+\.webp$/);

      const assetPath = fileURLToPath(new URL(assetUrl.slice(1), publicDirectory));
      expect(existsSync(assetPath), assetUrl).toBe(true);
      expect(statSync(assetPath).size, assetUrl).toBeGreaterThan(0);
    }
  });
});

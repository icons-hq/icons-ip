import { describe, expect, it } from 'vitest';
import type { Ip } from '@/lib/data';
import { buildGoodPreview, goodFormValues } from './good-preview';

const ip: Ip = {
  id: 'hong-sil-quest',
  title: '홍실 퀘스트',
  sub: 'SOOP2RANG · 캐릭터 IP',
  v: { key: 'character', label: '캐릭터 IP', color: '#FFD84D' },
  glyph: '홍실',
  bg: 'linear-gradient(#300008, #FF2E63)',
  fans: 0,
  goods: 3,
  cards: 0,
  featured: false,
  tagline: '붉은 실을 따라',
  synopsis: '홍실 퀘스트 컬렉션',
};

const values = {
  id: 'g13',
  ipId: 'hong-sil-quest',
  name: '  아크릴 블록  ',
  type: '아크릴 블록',
  price: '12000',
  badge: '신상',
  stock: 'low',
  description: '  붉은 실을 따라 놓인 아크릴 블록입니다.  ',
  noticeMaker: '주식회사 아이콘스',
  noticeOrigin: '대한민국',
  noticeMaterial: '아크릴',
  noticeSize: '80 x 60 x 20mm · 90g',
  noticeMadeOn: '2026-07',
  noticeAsManager: '아이콘스 고객센터',
  noticeAsContact: '02-000-0000',
};

describe('어드민 굿즈 미리보기', () => {
  /* #184 — 저장된 값이 아니라 지금 폼에 들어 있는 값을 그린다. */
  it('폼 값과 업로드 전 이미지를 공개 화면 모양으로 옮긴다', () => {
    const preview = buildGoodPreview({
      values,
      imageUrls: {
        imagePath: 'blob:selected-main',
        galleryPath0: 'blob:selected-gallery-0',
        galleryPath2: 'blob:selected-gallery-2',
        detailImagePath: 'https://cdn.example/detail.webp',
      },
      fallbackBg: null,
      ip,
      stockQty: 8,
    });

    expect(preview.good).toEqual({
      id: 'g13',
      name: '아크릴 블록',
      ip: 'hong-sil-quest',
      type: '아크릴 블록',
      price: 12000,
      badge: '신상',
      stock: 'low',
      stockQty: 8,
      img: 'url("blob:selected-main") center / cover no-repeat',
    });
    expect(preview.gallery).toEqual([
      'url("blob:selected-gallery-0") center / cover no-repeat',
      'url("blob:selected-gallery-2") center / cover no-repeat',
    ]);
    expect(preview.detailImageUrl).toBe('https://cdn.example/detail.webp');
    expect(preview.description).toBe('붉은 실을 따라 놓인 아크릴 블록입니다.');
    expect(preview.notice.maker).toBe('주식회사 아이콘스');
    expect(preview.ip).toBe(ip);
  });

  it('비어 있는 입력을 안전한 자리표시로 떨어뜨린다', () => {
    const preview = buildGoodPreview({
      values: { price: '-5', stock: 'unknown' },
      imageUrls: {},
      fallbackBg: null,
      ip: null,
      stockQty: 0,
    });

    expect(preview.good.name).toBe('(굿즈 이름 미입력)');
    expect(preview.good.type).toBe('(유형 미입력)');
    expect(preview.good.price).toBe(0);
    expect(preview.good.stock).toBe('ok');
    expect(preview.good.img).toContain('linear-gradient');
    expect(preview.description).toBeNull();
    expect(preview.notice.origin).toBeNull();
  });

  /*
   * #184 완료 조건 — 저장된 값이 아니라 폼에 지금 있는 값이 반영돼야 한다.
   * 저장 전 수정본을 그대로 읽어 미리보기가 바뀌는지 확인한다.
   */
  it('저장하지 않은 폼 수정본을 그대로 읽어 미리보기에 반영한다', () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    formData.set('name', '수정 중인 이름');
    formData.set('price', '15000');
    formData.set('noticeOrigin', '일본');
    formData.set('imagePath', 'public-media/catalog/good/11111111-1111-4111-8111-111111111111.webp');

    const preview = buildGoodPreview({
      values: goodFormValues(formData),
      imageUrls: {},
      fallbackBg: 'url("/generated/goods/g13.webp") center / cover no-repeat',
      ip,
      stockQty: 8,
    });

    expect(preview.good.name).toBe('수정 중인 이름');
    expect(preview.good.price).toBe(15000);
    expect(preview.notice.origin).toBe('일본');
  });

  it('파일 항목은 폼 값에서 걸러낸다', () => {
    const formData = new FormData();
    formData.set('name', '아크릴 블록');
    formData.set('artwork', new File(['x'], 'x.png', { type: 'image/png' }));

    expect(goodFormValues(formData)).toEqual({ name: '아크릴 블록' });
  });

  it('아트워크가 없으면 레거시 배경 값으로 떨어진다', () => {
    const preview = buildGoodPreview({
      values,
      imageUrls: {},
      fallbackBg: 'url("/generated/goods/g13.webp") center / cover no-repeat',
      ip,
      stockQty: 0,
    });

    expect(preview.good.img).toBe('url("/generated/goods/g13.webp") center / cover no-repeat');
  });
});

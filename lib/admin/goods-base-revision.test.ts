import { describe, expect, it } from 'vitest';
import { GOODS_BASE_CHANGED_MESSAGE, goodBaseRevisionFailure, readGoodBaseRevision } from './goods-base-revision';

const form = (value?: string) => { const data = new FormData(); if (value !== undefined) data.set('baseRevision', value); return data; };

describe('상품 기본 칸 버전(CAT-027)', () => {
  it('숨은 칸의 버전을 읽고, 없으면 비교하지 않으며, 형식이 틀리면 거절한다', () => {
    expect(readGoodBaseRevision(form())).toBeNull();
    expect(readGoodBaseRevision(form(''))).toBeNull();
    expect(readGoodBaseRevision(form('0'))).toBe(0);
    expect(readGoodBaseRevision(form('42'))).toBe(42);
    for (const bad of ['-1', '01', '1.5', 'abc', ' 3', '9'.repeat(17)]) expect(readGoodBaseRevision(form(bad))).toBe('invalid');
  });

  it('DB 거절을 운영자 문구로 바꾼다', () => {
    expect(goodBaseRevisionFailure('goods_base_changed')).toBe(GOODS_BASE_CHANGED_MESSAGE);
    expect(goodBaseRevisionFailure('invalid_goods_base_revision')).toContain('저장 요청을 확인하지 못했습니다');
    expect(goodBaseRevisionFailure('goods_options_changed')).toBeNull();
  });
});

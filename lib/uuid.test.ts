import { describe, expect, it } from 'vitest';
import { isUuid } from './uuid';

describe('Postgres UUID 형식', () => {
  it.each(['00000000-0000-0000-0000-000000000000', '123e4567-e89b-42d3-a456-426614174000', '019A6A09-9408-7000-8000-000000000001'])('하이픈 형식 UUID를 인식한다: %s', value => {
    expect(isUuid(value)).toBe(true);
  });
  it.each([null, undefined, 1, {}, '', 'not-a-uuid', '123e4567e89b42d3a456426614174000', ' 123e4567-e89b-42d3-a456-426614174000', '123e4567-e89b-42d3-a456-426614174000\n'])('입력 형식이 다르면 거절한다', value => {
    expect(isUuid(value)).toBe(false);
  });
});

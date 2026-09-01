/**
 * THROWAWAY PROTOTYPE: 실측한 글로벌 캐릭터 스토어 구조가 ICONS의 현재 데이터에도 맞는가?
 * 승격 전에 선택된 변형만 제품 코드로 다시 구현한다.
 */

export type PrototypeVariant = 'A' | 'B' | 'C';

export const PROTOTYPE_VARIANTS: readonly PrototypeVariant[] = ['A', 'B', 'C'];

export function normalizePrototypeVariant(
  value: string | string[] | undefined,
): PrototypeVariant {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === 'B' || candidate === 'C' ? candidate : 'A';
}

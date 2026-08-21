export function usesLastBellTouchLayout(input: { width: number; height: number; pointer: 'coarse' | 'fine' }): boolean {
  return input.pointer === 'coarse' || (input.width <= 900 && input.height <= 480 && input.width > input.height);
}

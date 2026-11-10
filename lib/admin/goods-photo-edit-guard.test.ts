import { expect, it } from 'vitest';
import { createGoodsPhotoEditGuard, goodsPhotoEditTarget } from './goods-photo-edit-guard';
import { createGoodsImageSlots, promoteGoodsImage } from './goods-image-grid';
const actor = '99000000-0000-4000-8000-000000000001';
const other = '99000000-0000-4000-8000-000000000002';
function start() { const guard = createGoodsPhotoEditGuard(actor, 'good-a'); guard.activate(); guard.authenticate(actor, 'session-one'); return guard; }
it('처음 로그인 확인 전과 저장 중에는 사진 편집을 시작하지 않는다', () => {
  const guard = createGoodsPhotoEditGuard(actor, 'good-a'); guard.activate(); expect(guard.capture('key', 'path')).toBeNull();
  guard.authenticate(actor, 'session-one'); const ticket = guard.capture('key', 'path')!; expect(guard.isCurrent(ticket)).toBe(true);
  guard.setBusy(true); expect(guard.capture('key', 'path')).toBeNull(); expect(guard.canApply(ticket)).toBe(false);
  // An already accepted upload may finish during another pending request.
  expect(guard.isCurrent(ticket)).toBe(true);
});
it.each([[other, 'session-two'], [null, null], [actor, 'session-two']] as const)('계정/로그인 변경 뒤 이전 세션이 돌아와도 오래된 편집을 살리지 않는다 (%s)', (id, session) => {
  const guard = start(), ticket = guard.capture('key', 'path')!;
  guard.authenticate(id, session); expect(guard.isCurrent(ticket)).toBe(false);
  guard.authenticate(actor, 'session-one'); expect(guard.capture('key', 'path')).toBeNull();
});
it('토큰 갱신의 같은 세션은 보존하고 unmount/재마운트는 작업을 무효화한다', () => {
  const guard = start(), ticket = guard.capture('key', 'path')!;
  guard.authenticate(actor, 'session-one'); expect(guard.isCurrent(ticket)).toBe(true);
  guard.dispose(); expect(guard.isCurrent(ticket)).toBe(false);
  guard.activate(); guard.authenticate(actor, 'session-one'); expect(guard.isCurrent(ticket)).toBe(false); expect(guard.capture('key', 'path')).not.toBeNull();
});
it('같은 계정·상품 ID여도 다른 폼의 작업을 받지 않는다', () => {
  const first = start(), second = start(), ticket = first.capture('key', 'path')!;
  expect(second.isCurrent(ticket)).toBe(false);
});
it('자리 이동은 같은 타일을 따르지만 삭제·교체·진행중 타일에는 적용하지 않는다', () => {
  const slots = createGoodsImageSlots(['one', 'two'], ['url-one', 'url-two']), guard = start();
  const ticket = guard.capture(slots[1]!.key, slots[1]!.path)!;
  expect(goodsPhotoEditTarget(promoteGoodsImage(slots, 1), ticket)).toBe(0);
  expect(goodsPhotoEditTarget([slots[0], { ...slots[1]!, path: 'other' }], ticket)).toBe(-1);
  expect(goodsPhotoEditTarget([slots[0], { ...slots[1]!, status: 'uploading' }], ticket)).toBe(-1);
  expect(goodsPhotoEditTarget([slots[0]], ticket)).toBe(-1);
});

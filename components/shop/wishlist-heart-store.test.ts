import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import {
  claimWishConfirmations,
  confirmWish,
  confirmedWish,
  forgetWishConfirmations,
  observeWishSignOut,
  subscribeWishConfirmations,
} from './wishlist-heart-store';

beforeEach(() => forgetWishConfirmations());

describe('wishlist heart session store', () => {
  it('remembers only what the server confirmed, per good, for the member who confirmed it', () => {
    expect(confirmedWish('member-a', 'g1')).toBeUndefined();

    confirmWish('g1', true, 'member-a');
    confirmWish('g2', false, 'member-a');

    expect(confirmedWish('member-a', 'g1')).toBe(true);
    expect(confirmedWish('member-a', 'g2')).toBe(false);
  });

  it('notifies subscribers on real changes and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWishConfirmations(listener);

    confirmWish('g1', true, 'member-a');
    confirmWish('g1', true, 'member-a');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    confirmWish('g1', false, 'member-a');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forgets every confirmation at the login wall so the next visitor starts from server values', () => {
    const listener = vi.fn();
    subscribeWishConfirmations(listener);
    confirmWish('g1', true, 'member-a');
    listener.mockClear();

    forgetWishConfirmations();
    forgetWishConfirmations();

    expect(confirmedWish('member-a', 'g1')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  /* 같은 탭에서 회원이 바뀌면(로그아웃 → 다른 회원 로그인, 둘 다 소프트 내비게이션) 모듈이 살아남는다.
     이전 회원의 확인값이 다음 회원의 서버 값을 덮으면 공용 기기에서 찜 이력이 드러난다(l4-data-2 · l4-ui-2). */
  it('never shows one member’s confirmations to another member or to a guest', () => {
    confirmWish('g1', true, 'member-a');

    expect(confirmedWish('member-b', 'g1')).toBeUndefined();
    expect(confirmedWish(null, 'g1')).toBeUndefined();
    expect(confirmedWish('member-a', 'g1')).toBe(true);
  });

  it('empties the store when a different viewer (or a guest) claims it', () => {
    const listener = vi.fn();
    subscribeWishConfirmations(listener);
    confirmWish('g1', true, 'member-a');
    listener.mockClear();

    claimWishConfirmations('member-a');
    expect(listener).not.toHaveBeenCalled();

    claimWishConfirmations('member-b');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(confirmedWish('member-a', 'g1')).toBeUndefined();

    confirmWish('g2', true, 'member-b');
    claimWishConfirmations(null);
    expect(confirmedWish('member-b', 'g2')).toBeUndefined();
  });

  /* 상세 하트는 뷰어를 모른다 — 지금 주인 몫으로 적어 뒤로 가기로 돌아간 목록이 같은 사실을 본다.
     주인이 없으면(게스트·아직 목록을 안 본 세션) 읽을 하트가 없으므로 적지 않는다. */
  it('records viewer-less confirmations from the detail heart under the current owner only', () => {
    confirmWish('g9', true);
    claimWishConfirmations('member-a');
    expect(confirmedWish('member-a', 'g9')).toBeUndefined();

    confirmWish('g9', true);
    expect(confirmedWish('member-a', 'g9')).toBe(true);
  });

  /* 로그아웃 폼 제출·AuthPresenceProvider 의 signed-out·다른 탭 방송이 모두 이 이벤트를 낸다.
     같은 회원이 다시 로그인해도 이전 세션의 확인값이 아니라 서버 값부터 시작한다. */
  it('clears on the app’s in-tab sign-out signal, even for the same member signing back in', () => {
    const target = new EventTarget();
    const stop = observeWishSignOut(target);
    confirmWish('g1', true, 'member-a');

    target.dispatchEvent(new Event(INQUIRY_DRAFT_SIGN_OUT_EVENT));
    expect(confirmedWish('member-a', 'g1')).toBeUndefined();

    stop();
    confirmWish('g1', true, 'member-a');
    target.dispatchEvent(new Event(INQUIRY_DRAFT_SIGN_OUT_EVENT));
    expect(confirmedWish('member-a', 'g1')).toBe(true);
  });
});

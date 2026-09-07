import { describe, expect, it } from 'vitest';
import {
  formatPopupPeriod,
  phaseProgress,
  popupCacheTag,
  scheduleDayTicks,
  windowSpan,
  type PopupPhaseView,
} from './popups';

const FROM = '2026-09-07T00:00:00+09:00';
const TO = '2026-09-14T00:00:00+09:00';

describe('편성 달력 좌표', () => {
  it('창 안의 구간을 0~1 위치로 옮긴다', () => {
    const span = windowSpan('2026-09-08T00:00:00+09:00', '2026-09-10T00:00:00+09:00', FROM, TO);
    expect(span).toEqual({ left: 1 / 7, width: 2 / 7 });
  });

  it('창 밖으로 나간 부분은 잘라 낸다', () => {
    /* 이미 돌고 있는 팝업이 왼쪽 끝에서 시작해야 「지금 걸쳐 있다」가 읽힌다. */
    const span = windowSpan('2026-08-01T00:00:00+09:00', '2026-09-08T00:00:00+09:00', FROM, TO);
    expect(span).toEqual({ left: 0, width: 1 / 7 });
  });

  it('창과 겹치지 않으면 그리지 않는다', () => {
    expect(windowSpan('2026-10-01T00:00:00+09:00', '2026-10-02T00:00:00+09:00', FROM, TO)).toBeNull();
    /* 끝이 창 시작과 같은 순간은 겹친 것이 아니다(반열림). */
    expect(windowSpan('2026-09-01T00:00:00+09:00', FROM, FROM, TO)).toBeNull();
  });

  it('망가진 값에는 좌표를 지어내지 않는다', () => {
    expect(windowSpan('언제', TO, FROM, TO)).toBeNull();
    expect(windowSpan(FROM, TO, TO, FROM)).toBeNull();
  });

  it('날짜 눈금은 KST 하루 간격이다', () => {
    const ticks = scheduleDayTicks(FROM, TO);
    expect(ticks).toHaveLength(7);
    expect(ticks[0]).toEqual({ label: '9. 7.', at: 0 });
    expect(ticks[1].at).toBeCloseTo(1 / 7);
  });
});

describe('페이즈 진행률', () => {
  const phase: PopupPhaseView = {
    key: 'live_1', label: '1부',
    startsAt: '2026-09-07T10:00:00+09:00', endsAt: '2026-09-07T14:00:00+09:00',
    on: true, done: false,
  };

  it('시작 전 0, 끝난 뒤 1', () => {
    expect(phaseProgress(phase, '2026-09-07T09:00:00+09:00')).toBe(0);
    expect(phaseProgress(phase, '2026-09-07T20:00:00+09:00')).toBe(1);
  });

  it('가운데는 비율이다', () => {
    expect(phaseProgress(phase, '2026-09-07T11:00:00+09:00')).toBe(0.25);
  });
});

describe('표시 어휘', () => {
  it('기간은 언제나 서울 시각으로 읽는다', () => {
    /* 저장은 UTC instant다. 서버가 어느 타임존이든 화면은 같은 시각을 보여야 한다. */
    expect(formatPopupPeriod('2026-09-07T01:00:00Z', '2026-09-07T05:00:00Z')).toBe('9. 7. 오전 10:00 ~ 9. 7. 오후 2:00');
  });

  it('캐시 태그는 팝업마다 다르다', () => {
    expect(popupCacheTag('demo-popup')).toBe('popup:demo-popup');
    expect(popupCacheTag('other')).not.toBe(popupCacheTag('demo-popup'));
  });
});

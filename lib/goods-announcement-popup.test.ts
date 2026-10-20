import { describe, expect, it } from 'vitest';
import { nextKstMidnight, parseHomeAnnouncementPopup, popupDismissedUntil } from './goods-announcement-popup';
const item = { id: '00000000-0000-4000-8000-000000062211', dismissKey: '00000000-0000-4000-8000-000000062212', title: '공지', body: '내용', format: 'plain', device: 'all', important: false, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z' };
describe('홈 공지 공개와 하루 숨김', () => {
  it('서버 응답을 확인하고 내부 부가 필드는 공개 모델에 복제하지 않는다', () => {
    expect(parseHomeAnnouncementPopup({ item: { ...item, revision: 8 }, nextChangeAt: item.endsAt })).toEqual({ item, nextChangeAt: item.endsAt });
    expect(parseHomeAnnouncementPopup({ item: { ...item, startsAt: item.endsAt }, nextChangeAt: null })).toBeNull();
    expect(parseHomeAnnouncementPopup({ item: { ...item, device: 'bad' }, nextChangeAt: null })).toBeNull();
    expect(parseHomeAnnouncementPopup({ item: null })).toBeNull();
    expect(parseHomeAnnouncementPopup({ item: null, nextChangeAt: null })).toEqual({ item: null, nextChangeAt: null });
  });
  it('한국 자정에 만료하고 다른 선택·잘못된 저장값·과도한 숨김은 사용하지 않는다', () => {
    const now = Date.parse('2026-10-14T14:59:59Z'); const until = Date.parse('2026-10-14T15:00:00Z');
    expect(nextKstMidnight(now)).toBe(until);
    const raw = JSON.stringify({ key: item.dismissKey, until });
    expect(popupDismissedUntil(raw, item.dismissKey, now)).toBe(until);
    expect(popupDismissedUntil(raw, item.dismissKey, until)).toBeNull();
    expect(popupDismissedUntil(raw, item.id, now)).toBeNull();
    expect(popupDismissedUntil('{', item.id, now)).toBeNull();
    expect(popupDismissedUntil(JSON.stringify({ key: item.dismissKey, until: until + 1 }), item.dismissKey, now)).toBeNull();
  });
});

import type { GoodsAnnouncementActionState } from '../../app/admin/goods-announcement-actions';
import { blankGoodsAnnouncement, parseGoodsAnnouncementInput, type GoodsAnnouncement } from '../../lib/admin/goods-announcements';

export const ANNOUNCEMENT_FIXTURE_ID = '00000000-0000-4000-8000-000000072001';
export const ANNOUNCEMENT_FIXTURE_ACCOUNT_ID = '00000000-0000-4000-8000-000000072003';
export const ANNOUNCEMENT_FIXTURE_GOODS = [
  { id: 'fixture-good-01', name: '[합성] 아크릴 키링', code: 'SYNTHETIC-KEYRING', archived: false },
  { id: 'fixture-good-02', name: '[합성] 포토카드 바인더', code: 'SYNTHETIC-BINDER', archived: false },
  { id: 'fixture-good-03', name: '[합성] 미니 포스터', code: 'SYNTHETIC-POSTER', archived: false },
];
const STORAGE_KEY = 'admin-visual-fixture:goods-announcement';
const INITIAL: GoodsAnnouncement = { ...blankGoodsAnnouncement(ANNOUNCEMENT_FIXTURE_ID), reference: 1001, revision: 1, title: '[합성] 배송 일정 안내',
  body: '화요일부터 순차 출고합니다. 실제 고객 공지가 아닌 UI 검수용 합성 문장입니다.', enabled: true, important: true, category: 'shipping', createdAt: '2026-10-12T08:00:00Z', updatedAt: '2026-10-12T08:00:00Z' };
export function readAnnouncementFixture(): GoodsAnnouncement {
  try { return { ...INITIAL, ...JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') }; } catch { return INITIAL; }
}
export async function saveGoodsAnnouncementAction(previous: GoodsAnnouncementActionState, form: FormData): Promise<GoodsAnnouncementActionState> {
  if (form.get('accountId') !== ANNOUNCEMENT_FIXTURE_ACCOUNT_ID) return { outcome: 'rejected', errors: { form: '합성 검수 계정을 확인해주세요.' } };
  const parsed = parseGoodsAnnouncementInput(form);
  if (!parsed.ok) return { errors: parsed.errors, saved: previous.saved, outcome: 'rejected' };
  if (new URLSearchParams(window.location.search).get('saveResult') === 'fail') return { saved: previous.saved, outcome: 'rejected', errors: { form: '합성 저장 실패입니다. 입력을 유지합니다. 실제 서버에는 요청하지 않았습니다.' } };
  const previousPopup = readAnnouncementFixture().popup;
  const popup = parsed.popupIntent === 'set' ? { selected: true, revision: previousPopup.revision + 1, startsAt: parsed.value.popupStartsAt, endsAt: parsed.value.popupEndsAt }
    : parsed.popupIntent === 'clear' ? { selected: false, revision: previousPopup.revision + 1, startsAt: null, endsAt: null } : previousPopup;
  const saved: GoodsAnnouncement = { ...blankGoodsAnnouncement(parsed.id), ...parsed.value, popup, reference: 1001, revision: parsed.revision + 1,
    createdAt: INITIAL.createdAt, updatedAt: new Date().toISOString(), goods: parsed.value.goodIds.flatMap(id => ANNOUNCEMENT_FIXTURE_GOODS.filter(good => good.id === id)) };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  return { saved: readAnnouncementFixture(), outcome: 'saved', message: '합성 저장과 다시 읽기를 완료했습니다. 실제 서버에는 요청하지 않았습니다.' };
}
export async function resolveGoodsAnnouncementSaveAction(): Promise<GoodsAnnouncementActionState> { return { outcome: 'unknown', errors: { form: '합성 화면은 실제 저장 요청을 조회하지 않습니다.' } }; }
export async function findGoodsForAnnouncementAction(query: string, page: number) {
  const rows = ANNOUNCEMENT_FIXTURE_GOODS.filter(good => `${good.id} ${good.name} ${good.code}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return { data: { rows, total: rows.length, page, pageSize: 20 } };
}

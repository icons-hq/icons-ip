import { describe, expect, it } from 'vitest';
import { createCsEditorDraftStore } from './cs-editor-drafts';
import { createGoodsAnnouncementPendingSave, goodsAnnouncementPendingDisplayValue, goodsAnnouncementPendingForm, GOODS_ANNOUNCEMENT_PENDING_LABELS, parseGoodsAnnouncementPendingSave, retainGoodsAnnouncementPendingSave } from './goods-announcement-pending';

const ACCOUNT = '00000000-0000-4000-8000-000000062210';
const ID = '00000000-0000-4000-8000-000000062211';
const OPERATION = '00000000-0000-4000-8000-000000062212';
const SESSION = '00000000-0000-4000-8000-000000062213';
function form() {
  const value = new FormData();
  for (const [key, text] of Object.entries({ id: ID, revision: '7', popupRevision: '13', title: ' 최초 제목 ', body: '  첫 줄\r\n다음 줄  ', format: 'plain',
    category: 'shipping', device: 'all', enabled: 'true', important: 'false', allGoods: 'false', goodIds: '["good-a","good-b"]',
    usePeriod: 'true', startsAt: '2026-10-14T09:00', endsAt: '', useImportantPeriod: 'false', popupIntent: 'preserve' })) value.set(key, text);
  return value;
}
function storage() {
  const rows = new Map<string, string>();
  return { get length() { return rows.size; }, key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); }, rows };
}
describe('상품공지 고정 저장 요청', () => {
  it('원래 공백·개행·빈 경계·revision·상품 순서를 보존하고 전송 FormData를 별도로 만든다', () => {
    const input = form(); input.set('$ACTION_ID_framework', 'ignored');
    const pending = createGoodsAnnouncementPendingSave(input, ACCOUNT, ID, OPERATION)!;
    input.set('body', '나중에 바꾼 내용');
    const outgoing = goodsAnnouncementPendingForm(pending);
    expect(outgoing.get('body')).toBe('  첫 줄\r\n다음 줄  ');
    expect(outgoing.get('title')).toBe(' 최초 제목 ');
    expect(outgoing.get('endsAt')).toBe(''); expect(outgoing.get('importantStartsAt')).toBeNull();
    expect(outgoing.get('revision')).toBe('7'); expect(outgoing.get('popupRevision')).toBe('13');
    expect(outgoing.get('goodIds')).toBe('["good-a","good-b"]'); expect(outgoing.get('accountId')).toBe(ACCOUNT);
    expect(outgoing.get('operationId')).toBe(OPERATION); expect(outgoing.has('$ACTION_ID_framework')).toBe(false);
    outgoing.set('body', '외부 변경'); expect(goodsAnnouncementPendingForm(pending).get('body')).toBe('  첫 줄\r\n다음 줄  ');
  });
  /* 1027T-005: 노출 위치는 보관·복구되고, 위치 칸 이전에 보관된 요청(칸 없음)도 그대로 복구된다. */
  it('노출 위치를 보관하고 위치 칸이 없던 요청도 복구한다', () => {
    const input = form(); input.set('placement', 'bottom');
    const pending = createGoodsAnnouncementPendingSave(input, ACCOUNT, ID, OPERATION)!;
    expect(goodsAnnouncementPendingForm(pending).get('placement')).toBe('bottom');
    expect(GOODS_ANNOUNCEMENT_PENDING_LABELS.placement).toBe('노출 위치');
    expect(goodsAnnouncementPendingDisplayValue('placement', 'bottom')).toBe('상세 하단');
    const legacy = createGoodsAnnouncementPendingSave(form(), ACCOUNT, ID, OPERATION)!;
    expect(parseGoodsAnnouncementPendingSave(legacy)).toEqual(legacy);
    expect(goodsAnnouncementPendingForm(legacy).has('placement')).toBe(false);
    expect(parseGoodsAnnouncementPendingSave({ ...pending, entries: pending.entries.map(entry => entry[0] === 'placement' ? ['placement', 'outside'] : entry) })).toBeNull();
  });
  it('허용하지 않은 필드·중복·파일·다른 계정/대상·과도한 본문을 보관하지 않는다', () => {
    const pending = createGoodsAnnouncementPendingSave(form(), ACCOUNT, ID, OPERATION)!;
    for (const entries of [
      [...pending.entries, ['access_token', 'not-stored']],
      [...pending.entries, ['title', '중복']],
      pending.entries.map(entry => entry[0] === 'body' ? ['body', '가'.repeat(30001)] : entry),
      pending.entries.map(entry => entry[0] === 'accountId' ? ['accountId', ID] : entry),
      pending.entries.filter(entry => entry[0] !== 'popupRevision'),
    ]) expect(parseGoodsAnnouncementPendingSave({ ...pending, entries })).toBeNull();
    expect(parseGoodsAnnouncementPendingSave({ ...pending, id: OPERATION })).toBeNull();
    const file = form(); file.set('body', new Blob(['text']), 'body.txt');
    expect(createGoodsAnnouncementPendingSave(file, ACCOUNT, ID, OPERATION)).toBeNull();
  });
  it('내부 이동·새로고침은 명시 복구를 요구하며 계정·로그인 세션·공지별로 격리한다', () => {
    const tab = storage();
    const make = (accountId = ACCOUNT, recordId = ID) => createCsEditorDraftStore({ accountId, scope: 'goods-announcement-save', recordId, storage: tab, parse: parseGoodsAnnouncementPendingSave, retainUntilResolved: retainGoodsAnnouncementPendingSave });
    const pending = createGoodsAnnouncementPendingSave(form(), ACCOUNT, ID, OPERATION)!;
    const first = make(); first.authenticate(ACCOUNT, SESSION); expect(first.change(pending)).toBe(true); expect(first.getSnapshot().saved).toBe(true);
    const different = make(ACCOUNT, OPERATION); different.authenticate(ACCOUNT, SESSION); expect(different.getSnapshot().recovery).toBeNull();
    const reload = make(); reload.authenticate(ACCOUNT, SESSION);
    expect(reload.getSnapshot()).toMatchObject({ value: null, recovery: pending }); expect(reload.restore()).toEqual(pending);
    expect([...goodsAnnouncementPendingForm(reload.getSnapshot().value!).entries()]).toEqual(pending.entries);
    const newSession = make(); newSession.authenticate(ACCOUNT, OPERATION); expect(newSession.getSnapshot().recovery).toBeNull(); expect(tab.rows.size).toBe(0);
    reload.authenticate(ID, SESSION); expect(reload.isActive()).toBe(false); expect(reload.change(pending)).toBe(false);
  });
  it('미확정 요청은 일주일 뒤 다른 초안의 정리에도 남고 확정 후에만 제거한다', () => {
    const tab = storage(); let now = 1000;
    const make = () => createCsEditorDraftStore({ accountId: ACCOUNT, scope: 'goods-announcement-save', recordId: ID, storage: tab,
      parse: parseGoodsAnnouncementPendingSave, retainUntilResolved: retainGoodsAnnouncementPendingSave, now: () => now });
    const pending = createGoodsAnnouncementPendingSave(form(), ACCOUNT, ID, OPERATION)!;
    const first = make(); first.authenticate(ACCOUNT, SESSION); first.change(pending);
    now += 7 * 24 * 60 * 60 * 1000;
    const unrelated = createCsEditorDraftStore({ accountId: ACCOUNT, scope: 'ordinary-draft', recordId: ID, storage: tab,
      parse: (value: unknown) => typeof value === 'string' ? value : null, now: () => now });
    unrelated.authenticate(ACCOUNT, SESSION);
    const reload = make(); reload.authenticate(ACCOUNT, SESSION);
    expect(reload.getSnapshot().recovery).toEqual(pending); expect(reload.restore()).toEqual(pending);
    reload.discard(); expect(tab.rows.size).toBe(0);
  });
});

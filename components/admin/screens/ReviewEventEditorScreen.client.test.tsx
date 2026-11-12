import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler } from '@/lib/admin/confirm';
import { newReviewEventValues, reviewEventDayOffset, REVIEW_EVENT_CREDIT_POLICY_OFF, type ReviewEventCreditPolicy } from '@/lib/review-events';

type TemplatePickerProps = { onSelect: (template: { title: string; description: string }) => void; onClose: () => void };
type TemplateEditorProps = { initial?: { title: string; description: string }; onSaved: () => void; onClose: () => void };
type MessageNode = { childElementCount: number; scrollIntoView: (options: unknown) => void; focus: (options: unknown) => void };
const mocks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, save: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
  ref: { current: null as MessageNode | null }, effects: [] as { effect: () => void; deps: unknown[] }[],
  TemplatePicker: vi.fn<(props: TemplatePickerProps) => null>(() => null),
  TemplateEditor: vi.fn<(props: TemplateEditorProps) => null>(() => null) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock('@/app/admin/review-event-actions', () => ({ saveReviewEventAction: mocks.save, archiveReviewEventAction: vi.fn(), publishReviewEventAction: vi.fn(),
  revokeReviewEventAwardAction: vi.fn(), selectReviewEventEntriesAction: vi.fn(), searchReviewEventTargetsAction: vi.fn() }));
vi.mock('./ReviewEventTemplatesScreen', () => ({ ReviewEventTemplatePicker: mocks.TemplatePicker, ReviewEventTemplateEditor: mocks.TemplateEditor }));
vi.mock('../ReviewEventTargetPicker', () => ({ ReviewEventTargetPicker: () => null }));
vi.mock('../ReviewEventExportButton', () => ({ ReviewEventExportButton: () => null }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useState: (initial: unknown) => {
      const index = mocks.index++;
      if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
    },
    useTransition: () => [false, (callback: () => void) => { callback(); }],
    /* 결과 문장 자리 하나만 ref·effect를 쓴다. 렌더마다 effect를 모아 두고 테스트가 직접 실행한다. */
    useRef: () => mocks.ref,
    useEffect: (effect: () => void, deps: unknown[]) => { mocks.effects.push({ effect, deps }); },
  };
});

import { ReviewEventEditorScreen } from './ReviewEventEditorScreen';

type Element = ReactElement<Record<string, unknown>>;
const ID = '92000000-0000-4000-8000-000000000101';
const ON: ReviewEventCreditPolicy = { enabled: true, maxBalance: 5000, validityDays: 30 };
const OFF: ReviewEventCreditPolicy = { enabled: false, maxBalance: null, validityDays: null };
const OFF_HTML = REVIEW_EVENT_CREDIT_POLICY_OFF.replace('>', '&gt;');
type Props = Parameters<typeof ReviewEventEditorScreen>[0];
let props: Props;
function render() { mocks.index = 0; return ReviewEventEditorScreen(props) as Element; }
function html() { mocks.index = 0; return renderToStaticMarkup(<ReviewEventEditorScreen {...props} />); }
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }
function field(label: string) {
  const wrapper = nodes(render()).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith(label));
  const input = wrapper && nodes(wrapper).find(node => node.type === 'input' || node.type === 'select');
  if (!input) throw new Error(`Missing field ${label}`);
  return input;
}
function change(label: string, value: string) { (field(label).props.onChange as (event: unknown) => void)({ target: { value } }); }
function save() {
  const button = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '이벤트 저장');
  (button!.props.onClick as () => void)();
}

beforeEach(() => {
  mocks.states = []; mocks.index = 0; mocks.ref.current = null; mocks.effects = []; vi.clearAllMocks();
  props = { id: ID, workspace: null, creditPolicy: ON, policyHref: null };
});

describe('ReviewEventEditorScreen (R6)', () => {
  it('shows the store credit policy state at the top, with a settings link only for operators who can open it', () => {
    expect(html()).toContain('적립금 정책: 켜짐 · 보유 상한 5,000원 · 유효기간 30일');
    expect(html()).not.toContain('href="/admin/settings/store-credits"');

    props = { ...props, creditPolicy: OFF, policyHref: '/admin/settings/store-credits' };
    mocks.states = [];
    const off = html();
    expect(off).toContain('적립금 정책: 꺼짐');
    expect(off).toContain(OFF_HTML);
    expect(off).toContain('href="/admin/settings/store-credits"');
  });

  /* 응모마감 뒤 할 일은 화면 맨 아래에 있다. 머리에서 그 자리로 가는 버튼이 첫 화면에 있어야 한다. */
  it('offers the next step from the header and explains locked fields for a closed event', () => {
    const event = { ...newReviewEventValues(), id: ID, number: 7, title: '가을 포토리뷰', revision: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', archivedAt: null, announcedAt: null, state: 'closed', canEdit: false, entryCount: 0, selectedCount: 0, awardedCount: 0, revokedCount: 0 } as const;
    props = { ...props, workspace: { event, total: 0, page: 1, pageSize: 50, canPay: true, creditPolicy: ON, selected: [], rows: [] }, creditPolicy: undefined };
    const markup = html();
    expect(markup).toContain('가을 포토리뷰');
    expect(markup).toMatch(/href="#review-event-selection"[^>]*>당첨자 선정·발표로 이동</);
    expect(markup).toContain('id="review-event-selection"');
    expect(markup.indexOf('시작한 이벤트의 조건은 수정할 수 없습니다.')).toBeLessThan(markup.indexOf('이벤트 정보'));
    expect(markup).not.toContain('data-admin-notice="info"');

    props = { ...props, workspace: { ...props.workspace!, event: { ...event, state: 'ready' } } };
    mocks.states = [];
    expect(html()).toMatch(/href="#review-event-publish"[^>]*>발표 및 지급으로 이동</);
  });

  it('blocks saving with the policy-off reason before calling the server', () => {
    props = { ...props, creditPolicy: OFF };
    change('이벤트명', '후기 이벤트'); change('내용', '별점과 무관한 후기');
    expect(html()).not.toContain('role="alert"');
    save();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(html()).toContain(`role="alert">${OFF_HTML}`);
  });

  it('shows errors next to each field instead of a single summary line', () => {
    change('내용', '별점과 무관한 후기'); change('1인당 적립금', '9000');
    expect(html()).toContain('보유 상한 5,000원을 넘습니다');
    save();
    expect(mocks.save).not.toHaveBeenCalled();
    const markup = html();
    expect(markup).toContain('이벤트명은 1~15자로 입력하세요.');
    expect(markup).toMatch(/aria-invalid="true"[^>]*placeholder="최대 15자"|placeholder="최대 15자"[^>]*aria-invalid="true"/);
    expect(field('이벤트명').props['aria-describedby']).toBe('review-event-title-error');
    expect(field('내용').props['aria-invalid']).toBeUndefined();
  });

  it('moves the end and announcement dates when the start date changes', () => {
    const start = field('시작일').props.value as string;
    const next = reviewEventDayOffset(start, 5);
    change('시작일', next);
    expect(field('시작일').props.value).toBe(next);
    expect(field('종료일').props.value).toBe(reviewEventDayOffset(next, 7));
    expect(field('발표일').props.value).toBe(reviewEventDayOffset(next, 10));
  });

  it('trims surrounding spaces and saves when the values fit the policy', async () => {
    mocks.save.mockResolvedValue({ error: '다른 운영자가 변경했습니다.' });
    change('이벤트명', ' 후기 이벤트 '); change('내용', '별점과 무관한 후기 ');
    save();
    expect(mocks.save).toHaveBeenCalledWith(ID, 0, expect.any(String), expect.objectContaining({ title: '후기 이벤트', description: '별점과 무관한 후기', creditAmount: newReviewEventValues().creditAmount }));
  });
});

/* SHEET-017: 등록 화면에서 문구 템플릿을 불러오고, 지금 문구를 템플릿으로 남긴다. 적립금 정책이 꺼져 있어도 된다. */
describe('ReviewEventEditorScreen wording templates (SHEET-017)', () => {
  const template = { id: '93100000-0000-4000-8000-000000000101', title: '포토리뷰 이벤트', description: '사진과 함께 후기를 남겨주세요', revision: 1, createdAt: '2026-11-11T01:00:00Z', updatedAt: '2026-11-11T01:00:00Z' };
  function click(label: string) { (nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === label)!.props.onClick as () => void)(); }
  function picker() { return nodes(render()).find(node => node.type === mocks.TemplatePicker) as ReactElement<Parameters<typeof mocks.TemplatePicker>[0]> | undefined; }
  function templateForm() { return nodes(render()).find(node => node.type === mocks.TemplateEditor) as ReactElement<Parameters<typeof mocks.TemplateEditor>[0]> | undefined; }
  afterEach(() => { vi.unstubAllGlobals(); });

  it('offers loading and saving templates while the credit policy blocks the event save', () => {
    props = { ...props, creditPolicy: OFF };
    const markup = html();
    expect(markup).toContain('템플릿 불러오기');
    expect(markup).toContain('현재 문구를 템플릿으로 저장');
    expect(markup).toContain('href="/admin/cs/review-events/templates"');
    expect(markup).toContain('적립금 정책이 꺼져 있어도 템플릿 저장은 됩니다.');
  });

  it('replaces only the title and description, asking first when typed wording differs', async () => {
    const confirm = vi.fn(() => false);
    setAdminConfirmHandler(async (request) => (confirm as unknown as (message: string) => boolean)(request.message));
    change('이벤트명', '가을 이벤트'); change('1인당 적립금', '3000');
    click('템플릿 불러오기');
    await picker()!.props.onSelect(template);
    expect(confirm).toHaveBeenCalledWith('작성 중인 이벤트명·내용을 템플릿 문구로 바꿀까요?');
    expect(field('이벤트명').props.value).toBe('가을 이벤트');
    confirm.mockReturnValue(true);
    await picker()!.props.onSelect(template);
    expect(field('이벤트명').props.value).toBe(template.title);
    expect(field('내용').props.value).toBe(template.description);
    expect(field('1인당 적립금').props.value).toBe(3000);
    expect(picker()).toBeUndefined();
    expect(html()).toContain('이벤트를 저장해야 반영됩니다');
  });

  it('refuses a template whose wording breaks the event field rules instead of failing later on save', () => {
    const confirm = vi.fn(() => true);
    setAdminConfirmHandler(async (request) => (confirm as unknown as (message: string) => boolean)(request.message));
    change('이벤트명', '가을 이벤트');
    click('템플릿 불러오기');
    picker()!.props.onSelect({ ...template, title: `${template.title} ` });
    expect(confirm).not.toHaveBeenCalled();
    expect(field('이벤트명').props.value).toBe('가을 이벤트');
    expect(html()).toContain('불러올 수 없습니다');
  });

  it('loads into empty fields without asking', () => {
    const confirm = vi.fn(() => false);
    setAdminConfirmHandler(async (request) => (confirm as unknown as (message: string) => boolean)(request.message));
    click('템플릿 불러오기');
    picker()!.props.onSelect(template);
    expect(confirm).not.toHaveBeenCalled();
    expect(field('이벤트명').props.value).toBe(template.title);
  });

  it('opens the template form with the trimmed current wording', () => {
    change('이벤트명', ' 후기 이벤트 '); change('내용', '사용 후기 ');
    click('현재 문구를 템플릿으로 저장');
    expect(templateForm()!.props.initial).toEqual({ title: '후기 이벤트', description: '사용 후기' });
    templateForm()!.props.onSaved();
    expect(templateForm()).toBeUndefined();
    expect(html()).toContain('템플릿으로 저장했습니다');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('hides the template controls once the event terms are locked', () => {
    const event = { ...newReviewEventValues(), id: ID, number: 7, title: '가을 포토리뷰', description: '후기', revision: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', archivedAt: null, announcedAt: null, state: 'active', canEdit: false, entryCount: 0, selectedCount: 0, awardedCount: 0, revokedCount: 0 } as const;
    props = { ...props, workspace: { event, total: 0, page: 1, pageSize: 50, canPay: true, creditPolicy: ON, selected: [], rows: [] }, creditPolicy: undefined };
    expect(html()).not.toContain('템플릿 불러오기');
  });
});

/* 1027T-026·027: 아래쪽 버튼을 누른 사람이 결과와 막힌 이유를 보고, 누를 수 없는 버튼은 그 이유를 옆에 적는다. */
describe('ReviewEventEditorScreen disabled reasons (1027T-026·027)', () => {
  const base = { ...newReviewEventValues('2026-11-12'), id: ID, number: 7, title: '가을 포토리뷰', description: '사진 후기', revision: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', archivedAt: null, announcedAt: null, canEdit: false, entryCount: 0, selectedCount: 0, awardedCount: 0, revokedCount: 0 };
  function detail(state: 'scheduled' | 'active' | 'closed' | 'ready', options: { canPay?: boolean; policy?: ReviewEventCreditPolicy; canEdit?: boolean } = {}) {
    const event = { ...base, state, canEdit: options.canEdit ?? false };
    props = { ...props, workspace: { event, total: 0, page: 1, pageSize: 50, canPay: options.canPay ?? true, creditPolicy: options.policy ?? ON, selected: [], rows: [] }, creditPolicy: undefined };
    mocks.states = [];
  }
  const button = (label: string) => nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === label);

  it('moves the screen and focus to the result line whenever a save is refused, not on first render', () => {
    const node = { childElementCount: 1, scrollIntoView: vi.fn(), focus: vi.fn() };
    mocks.ref.current = node;
    render(); mocks.effects.forEach(({ effect }) => effect());
    expect(node.scrollIntoView).not.toHaveBeenCalled();

    props = { ...props, creditPolicy: OFF };
    change('이벤트명', '후기 이벤트'); change('내용', '별점과 무관한 후기');
    save(); save();
    mocks.effects = []; render();
    const [{ effect, deps }] = mocks.effects;
    expect(deps).toEqual([2]);
    effect();
    expect(node.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(node.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(html()).toMatch(/data-review-event-message=""[^>]*tabindex="-1"[^>]*>.*role="alert">/s);
  });

  /* 리뷰: 새 이벤트 첫 저장은 상세로 옮겨 가며 결과 문장 없이 포커스가 몸통에 남았다. 혜택과 같은 한 번용 saved 표시로 상세 맨 위에 보인다. */
  it('moves a new event to its detail with the one-time saved flag', async () => {
    const event = { ...newReviewEventValues(), id: ID, number: 9, title: '후기 이벤트', description: '별점과 무관한 후기', revision: 1, createdAt: '2026-11-12T01:00:00Z', updatedAt: '2026-11-12T01:00:00Z', archivedAt: null, announcedAt: null, state: 'scheduled', canEdit: true, entryCount: 0, selectedCount: 0, awardedCount: 0, revokedCount: 0 };
    mocks.save.mockResolvedValue({ event });
    change('이벤트명', '후기 이벤트'); change('내용', '별점과 무관한 후기');
    save();
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/admin/cs/review-events/${ID}?saved=1`));
  });

  it('shows the first-save result at the top of the detail, focuses it and clears the flag', () => {
    detail('scheduled', { canEdit: true });
    props = { ...props, justSaved: true };
    const node = { childElementCount: 1, scrollIntoView: vi.fn(), focus: vi.fn() };
    mocks.ref.current = node;
    const replaceState = vi.fn();
    vi.stubGlobal('window', { history: { replaceState }, location: { pathname: `/admin/cs/review-events/${ID}`, search: '?saved=1' } });
    expect(html()).toMatch(/data-review-event-message=""[^>]*>.*role="status">리뷰이벤트를 저장했습니다\. 시작 전에는 이 화면에서 조건을 고칠 수 있습니다\./s);
    mocks.effects = []; render();
    const [message, flag] = mocks.effects;
    expect(message.deps).toEqual([1]);
    message.effect();
    expect(node.focus).toHaveBeenCalledWith({ preventScroll: true });
    flag.effect();
    expect(replaceState).toHaveBeenCalledWith(null, '', `/admin/cs/review-events/${ID}`);
    vi.unstubAllGlobals();
  });

  /* ③: 정책 꺼짐으로 저장을 막으면 위 주의 안내와 아래 오류가 같은 문장을 두 번 말했다. 오류가 나오면 주의 안내는 제목만 남긴다. */
  it('says the policy-off sentence once after a refused save', () => {
    props = { ...props, creditPolicy: OFF };
    const count = (markup: string) => markup.split(OFF_HTML).length - 1;
    expect(count(html())).toBe(1);
    change('이벤트명', '후기 이벤트'); change('내용', '별점과 무관한 후기');
    save();
    const markup = html();
    expect(count(markup)).toBe(1);
    expect(markup).toContain(`role="alert">${OFF_HTML}`);
    expect(markup).toContain('적립금 정책: 꺼짐');
  });

  it('says why publishing is locked before the announcement date and ties it to the button', () => {
    detail('scheduled');
    const publish = button('발표 및 지급 확정')!;
    expect(publish.props.disabled).toBe(true);
    expect(publish.props['aria-describedby']).toBe('review-event-publish-reason');
    expect(html()).toContain('응모 기간(종료일 2026. 11. 20.)이 끝나고 발표일(2026. 11. 23.)이 되면 확정할 수 있습니다.');
    expect(html()).toContain('응모 기간이 끝난 뒤(종료일 2026. 11. 20. 다음 날부터) 당첨자를 선정할 수 있습니다.');

    detail('closed');
    expect(html()).toContain('발표일(2026. 11. 23.)부터 확정할 수 있습니다.');
    expect(html()).not.toContain('id="review-event-selection-reason"');

    detail('ready');
    expect(button('발표 및 지급 확정')!.props.disabled).toBe(false);
    expect(html()).not.toContain('id="review-event-publish-reason"');
  });

  it('names the permission and the policy path when they block publishing', () => {
    detail('ready', { canPay: false });
    expect(button('발표 및 지급 확정')!.props['aria-describedby']).toBe('review-event-publish-permission');
    expect(html()).toContain('현재 계정에는 혜택 지급 권한이 없습니다. 지급 권한이 있는 운영자가 확정해야 합니다.');

    detail('ready', { policy: OFF });
    props = { ...props, policyHref: '/admin/settings/store-credits' };
    const markup = html();
    expect(markup).toContain('적립금 정책이 꺼져 있어 발표·지급을 확정할 수 없습니다. 판매자 정보 &gt; 적립금 정책(관리자)에서 켠 뒤 확정하세요.');
    expect(markup).toMatch(/id="review-event-publish-permission"[^>]*>.*href="\/admin\/settings\/store-credits"/s);
  });

  it('explains the selection save and the archive lock instead of leaving the buttons dead', () => {
    detail('closed');
    const selectSave = button('선정 저장')!;
    expect(selectSave.props.disabled).toBe(true);
    expect(selectSave.props['aria-describedby']).toBe('review-event-select-reason');
    expect(html()).toContain('선정 사유를 2자 이상 입력하면 저장할 수 있습니다.');
    const reason = nodes(render()).find(node => node.type === 'textarea')!;
    (reason.props.onChange as (event: unknown) => void)({ target: { value: '사진이 자세함' } });
    expect(button('선정 저장')!.props.disabled).toBe(false);
    expect(html()).not.toContain('선정 사유를 2자 이상 입력하면');

    detail('scheduled', { canEdit: true });
    expect(button('이벤트 보관')!.props.disabled).toBe(false);
    change('내용', '사진 후기 남기기');
    expect(button('이벤트 보관')!.props.disabled).toBe(true);
    expect(button('이벤트 보관')!.props['aria-describedby']).toBe('review-event-archive-reason');
    expect(html()).toContain('조건을 고치는 중에는 보관할 수 없습니다. 먼저 이벤트를 저장해주세요.');
  });
});

afterEach(() => { setAdminConfirmHandler(null); });

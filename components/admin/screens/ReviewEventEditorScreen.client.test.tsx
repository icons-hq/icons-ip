import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newReviewEventValues, reviewEventDayOffset, REVIEW_EVENT_CREDIT_POLICY_OFF, type ReviewEventCreditPolicy } from '@/lib/review-events';

const mocks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, save: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock('@/app/admin/review-event-actions', () => ({ saveReviewEventAction: mocks.save, archiveReviewEventAction: vi.fn(), publishReviewEventAction: vi.fn(),
  revokeReviewEventAwardAction: vi.fn(), selectReviewEventEntriesAction: vi.fn(), searchReviewEventTargetsAction: vi.fn() }));
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
  mocks.states = []; mocks.index = 0; vi.clearAllMocks();
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

import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 리뷰 삭제: 브라우저 기본 confirm 대신 고객 공용 확인창으로 묻는다. 확인하면 같은 제출 버튼으로 폼을 다시 제출해 서버 액션을 그대로 잇는다. */
const mocks = vi.hoisted(() => ({ deleteReview: vi.fn() }));
vi.mock('@/app/my/reviews/actions', () => ({ deleteReviewAction: mocks.deleteReview }));
import { stubCustomerConfirm } from '@/lib/customer-confirm.test-support';
import { ReviewDeleteButton } from './ReviewDeleteButton';

type SubmitLike = { currentTarget: FakeForm; nativeEvent: { submitter: unknown }; preventDefault: ReturnType<typeof vi.fn> };
type FormElement = ReactElement<{ action: unknown; onSubmit: (event: SubmitLike) => void }>;
interface FakeForm { isConnected: boolean; requestSubmit: ReturnType<typeof vi.fn>; resent: SubmitLike[] }
const submitEvent = (form: FakeForm, submitter: unknown): SubmitLike => ({ currentTarget: form, nativeEvent: { submitter }, preventDefault: vi.fn() });
function mount() {
  const element = ReviewDeleteButton({ goodId: 'g13', reviewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) as FormElement;
  /* requestSubmit은 submit 이벤트를 동기로 다시 보낸다 — 같은 onSubmit이 한 번 더 불린다. */
  const form: FakeForm = { isConnected: true, resent: [], requestSubmit: vi.fn((submitter: unknown) => {
    const event = submitEvent(form, submitter); form.resent.push(event); element.props.onSubmit(event);
  }) };
  return { element, form };
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
const submitter = { name: '삭제 버튼' };
let confirm: ReturnType<typeof stubCustomerConfirm> | null = null;

beforeEach(() => {
  const native = vi.fn(() => { throw new Error('native confirm must not be used'); });
  vi.stubGlobal('window', { confirm: native }); vi.stubGlobal('confirm', native);
});
afterEach(() => { confirm?.restore(); confirm = null; vi.unstubAllGlobals(); });

describe('ReviewDeleteButton', () => {
  it('삭제를 누르면 제출을 멈추고 고객 확인창에 묻는다 — 돌아가기를 고르면 제출하지 않는다', async () => {
    confirm = stubCustomerConfirm(false);
    const { element, form } = mount();
    expect(element.props.action).toBe(mocks.deleteReview);
    const event = submitEvent(form, submitter);
    element.props.onSubmit(event);
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    expect(confirm).toHaveBeenCalledWith({ title: '이 리뷰를 삭제할까요?', message: '삭제한 리뷰와 사진은 복구할 수 없고, 같은 주문에 다시 쓸 수 있어요.', confirmLabel: '리뷰 삭제' });
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });
  it('리뷰 삭제를 고르면 같은 제출 버튼으로 다시 제출하고, 그 제출은 막지 않아 서버 액션이 그대로 실행된다', async () => {
    confirm = stubCustomerConfirm(true);
    const { element, form } = mount();
    element.props.onSubmit(submitEvent(form, submitter));
    await flush();
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
    expect(form.requestSubmit).toHaveBeenCalledWith(submitter);
    expect(form.resent[0].preventDefault).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    /* 다시 제출이 끝나면 통과 표식을 지운다 — 다음 삭제도 다시 묻는다. */
    const next = submitEvent(form, submitter);
    element.props.onSubmit(next);
    expect(next.preventDefault).toHaveBeenCalled();
  });
  it('확인창이 떠 있는 동안 폼이 화면에서 사라지면 다시 제출하지 않는다', async () => {
    let answer!: (value: boolean) => void;
    confirm = stubCustomerConfirm(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    const { element, form } = mount();
    element.props.onSubmit(submitEvent(form, submitter));
    await flush();
    form.isConnected = false;
    answer(true);
    await flush();
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });
});

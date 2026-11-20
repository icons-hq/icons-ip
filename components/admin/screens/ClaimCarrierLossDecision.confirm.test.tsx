import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

/* 되돌릴 수 없는 결정(배송 분실 기록·회수 생략)은 체크박스만으로 제출하지 않고 셸 확인창(confirmAdminSubmit)을 거친다(AGENTS.md,
 * PR #694 리뷰). DOM 없이 컴포넌트를 함수로 불러 form의 onSubmit을 직접 실행한다 — 훅은 정해 둔 값으로 돌려준다. */
const hooks = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [{}, vi.fn(), false],
    useState: (initial: unknown) => {
      const index = hooks.index++;
      const value = index in hooks.values ? hooks.values[index] : typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [value, () => undefined];
    },
  };
});
vi.mock('./ClaimPreviewDialog', () => ({ useClaimPreviewBusy: () => undefined }));
vi.mock('@/app/admin/claim-actions', () => ({ recordOrderClaimCarrierLossAction: vi.fn(), waiveOrderClaimCollectionAction: vi.fn() }));
vi.mock('@/lib/admin/claim-evidence.client', () => ({ uploadClaimEvidence: vi.fn() }));
import { ClaimCarrierLossDecision, carrierLossConfirmRequest } from './ClaimCarrierLossDecision';
import { ClaimCollectionWaiverDecision, collectionWaiverConfirmRequest } from './ClaimCollectionWaiverDecision';

const CLAIM = '10000000-0000-4000-8000-000000000001', SHIPMENT = '20000000-0000-4000-8000-000000000002';
let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
afterEach(() => { confirm?.restore(); confirm = null; });

/* 훅 순서대로 값을 둔다(배송 분실: 작업 번호·열림·사고 번호·메모·확인·사진·업로드 중·업로드 오류). */
function renderForm(element: () => ReactElement, values: unknown[]) {
  hooks.index = 0; hooks.values = values;
  const form = element() as ReactElement<{ onSubmit?: (event: unknown) => void }>;
  expect(form.type).toBe('form');
  return form;
}
async function submit(form: ReactElement<{ onSubmit?: (event: unknown) => void }>) {
  const target = { isConnected: true, requestSubmit: vi.fn() }, submitter = { name: 'submit' }, preventDefault = vi.fn();
  form.props.onSubmit?.({ currentTarget: target, preventDefault, nativeEvent: { submitter } });
  await new Promise(resolve => setTimeout(resolve, 0));
  return { target, submitter, preventDefault };
}

describe('배송 분실 기록 확인창', () => {
  const lossForm = () => renderForm(() => ClaimCarrierLossDecision({ claimId: CLAIM, claimRevision: 3, originName: 'TEST 남양주', shipmentId: SHIPMENT }),
    ['30000000-0000-4000-8000-000000000003', true, ' HJ-ACC-20261119-01 ']);

  it('대상 출고지·사고 번호·되돌릴 수 없는 결과를 확인받은 뒤에만 제출한다', async () => {
    confirm = stubAdminConfirm(true);
    const { target, submitter, preventDefault } = await submit(lossForm());
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toBe(carrierLossConfirmRequest('TEST 남양주', 'HJ-ACC-20261119-01').message);
    expect(confirm.mock.calls[0][0]).toContain('택배사 사고 번호 HJ-ACC-20261119-01로 TEST 남양주 배송 건의 분실을 기록합니다. 기록하면 되돌릴 수 없습니다');
    expect(target.requestSubmit).toHaveBeenCalledWith(submitter);
  });
  it('확인창에서 취소하면 제출하지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    const { target, preventDefault } = await submit(lossForm());
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(target.requestSubmit).not.toHaveBeenCalled();
  });
  it('확인 버튼은 위험색이고 이름이 동작을 말한다', () => {
    expect(carrierLossConfirmRequest('TEST 남양주', 'HJ-1')).toMatchObject({ title: 'TEST 남양주 배송 분실로 기록할까요?', confirmLabel: '배송 분실 기록', destructive: true });
  });
});

describe('회수 생략 결정 확인창', () => {
  const waiverForm = () => renderForm(() => ClaimCollectionWaiverDecision({ claimId: CLAIM, originName: 'TEST 김포', shipmentId: SHIPMENT }), []);

  it('되돌릴 수 없는 회수 생략을 확인받은 뒤에만 제출한다', async () => {
    confirm = stubAdminConfirm(true);
    const { target } = await submit(waiverForm());
    expect(confirm.mock.calls[0][0]).toBe(collectionWaiverConfirmRequest('TEST 김포').message);
    expect(confirm.mock.calls[0][0]).toContain('결정은 되돌릴 수 없습니다');
    expect(target.requestSubmit).toHaveBeenCalledOnce();
  });
  it('확인창에서 취소하면 제출하지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    const { target } = await submit(waiverForm());
    expect(target.requestSubmit).not.toHaveBeenCalled();
  });
});

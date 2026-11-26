import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

/* 되돌릴 수 없는 결정(배송 분실 기록·회수 생략)은 셸 확인창(confirmAdminSubmit)을 거친다(AGENTS.md, PR #694 리뷰).
 * 확인 체크는 없다(2026-11-26 화면 규칙) — 서버 액션이 받는 확인 값은 화면이 채우고, 같은 사실은 확인창이 묻는다.
 * DOM 없이 컴포넌트를 함수로 불러 form의 onSubmit을 직접 실행한다 — 훅은 정해 둔 값으로 돌려준다. */
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

/* 훅 순서대로 값을 둔다(배송 분실: 작업 번호·열림·사고 번호·메모·사진·업로드 중·업로드 오류, 회수 생략: 사유·사진·업로드 중·업로드 오류). */
function renderForm(element: () => ReactElement, values: unknown[]) {
  hooks.index = 0; hooks.values = values;
  const form = element() as ReactElement<{ onSubmit?: (event: unknown) => void }>;
  expect(form.type).toBe('form');
  return form;
}
/** 폼 안의 네이티브 요소를 모은다(kit 부품은 props만 본다 — 함수로 부르지 않는다). */
function elements(node: ReactNode, found: ReactElement<Record<string, unknown>>[] = []) {
  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    found.push(child); elements(child.props.children as ReactNode, found);
  });
  return found;
}
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
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
  it('확인 버튼은 위험색이고 이름이 동작을 말한다. 물러나는 버튼은 [돌아가기]다', () => {
    expect(carrierLossConfirmRequest('TEST 남양주', 'HJ-1')).toMatchObject({ title: 'TEST 남양주 배송 분실로 기록할까요?', confirmLabel: '배송 분실 기록', cancelLabel: '돌아가기', destructive: true });
  });
  it('확인 체크 없이 확인 값을 채워 보내고, 아직 채우지 않은 것을 버튼 옆에 보인다', () => {
    const empty = elements(lossForm());
    expect(empty.some(node => node.props.type === 'checkbox')).toBe(false);
    expect(empty.find(node => node.props.name === 'confirmed')?.props).toMatchObject({ type: 'hidden', value: 'on' });
    expect(text(empty.find(node => node.props['data-claim-carrier-loss-missing'] !== undefined))).toBe('아직 필요한 것: 분실 확인 메모 · 근거 사진');
    expect(empty.find(node => node.props.type === 'submit')?.props.disabled).toBe(true);
    const filled = elements(renderForm(() => ClaimCarrierLossDecision({ claimId: CLAIM, claimRevision: 3, originName: 'TEST 남양주', shipmentId: SHIPMENT }),
      ['30000000-0000-4000-8000-000000000003', true, 'HJ-ACC-20261119-01', 'TEST 한진 고객센터 분실 확인 회신', [{ id: '40000000-0000-4000-8000-000000000004', mimeType: 'image/jpeg', size: 10 }]]));
    expect(filled.some(node => node.props['data-claim-carrier-loss-missing'] !== undefined)).toBe(false);
    expect(filled.find(node => node.props.type === 'submit')?.props.disabled).toBe(false);
    expect(filled.filter(node => node.props.name === 'evidenceFileId').map(node => node.props.value)).toEqual(['40000000-0000-4000-8000-000000000004']);
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
  it('확인 체크 없이 확인 값을 채워 보내고, 아직 채우지 않은 것을 버튼 옆에 보인다', () => {
    expect(collectionWaiverConfirmRequest('TEST 김포')).toMatchObject({ confirmLabel: '회수 없이 제작 시작', cancelLabel: '돌아가기', destructive: true });
    const empty = elements(waiverForm());
    expect(empty.some(node => node.props.type === 'checkbox')).toBe(false);
    expect(empty.find(node => node.props.name === 'confirmed')?.props).toMatchObject({ type: 'hidden', value: 'on' });
    expect(text(empty.find(node => node.props['data-claim-waiver-missing'] !== undefined))).toBe('아직 필요한 것: 회수 생략 사유 · 근거 사진');
    const filled = elements(renderForm(() => ClaimCollectionWaiverDecision({ claimId: CLAIM, originName: 'TEST 김포', shipmentId: SHIPMENT }),
      ['고객 사진으로 인쇄 불량을 확인했습니다', [{ id: '40000000-0000-4000-8000-000000000004', mimeType: 'image/jpeg', size: 10 }]]));
    expect(filled.some(node => node.props['data-claim-waiver-missing'] !== undefined)).toBe(false);
    expect(filled.find(node => node.props.type === 'submit')?.props.disabled).toBe(false);
  });
});
